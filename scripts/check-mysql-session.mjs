/**
 * 用真实 MySQL / MariaDB 验证会话与补全依赖的元数据（不启动 Electron）。
 *
 *   node --env-file-if-exists=.env.local scripts/check-mysql-session.mjs mysql
 *   node --env-file-if-exists=.env.local scripts/check-mysql-session.mjs mariadb
 *
 * 默认连接 127.0.0.1:3307（MySQL）/ 3308（MariaDB），root 空密码。
 * 可用 DBCRAFT_MYSQL_* / DBCRAFT_MARIADB_* 覆盖。
 * 会创建并删除临时库 dbcraft_check / dbcraft_check_other。
 */
import { MysqlSession } from '../src/main/services/mysql/MysqlSession.ts';
import { MariaSession } from '../src/main/services/mariadb/MariaSession.ts';
import { buildTablePageQuery } from '../src/shared/dialect/identifiers.ts';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const vendor = (process.argv[2] ?? 'mysql').toLowerCase();
if (vendor !== 'mysql' && vendor !== 'mariadb' && vendor !== 'percona') {
  throw new Error(`unknown vendor: ${vendor}`);
}
const isMaria = vendor === 'mariadb';
const envPrefix = isMaria ? 'DBCRAFT_MARIADB' : 'DBCRAFT_MYSQL';
const defaultPort = isMaria ? 3308 : 3307;

const input = {
  type: isMaria ? 'mariadb' : 'mysql',
  name: `${vendor}-check`,
  group: '',
  env: 'dev',
  host: process.env[`${envPrefix}_HOST`] ?? '127.0.0.1',
  port: Number(process.env[`${envPrefix}_PORT`] ?? defaultPort),
  username: process.env[`${envPrefix}_USER`] ?? 'root',
  password: process.env[`${envPrefix}_PASSWORD`] ?? '',
  database: '',
  sslMode: process.env[`${envPrefix}_SSL`] ?? 'disable',
};

const DatabaseSession = isMaria ? MariaSession : MysqlSession;
const session = await DatabaseSession.create(input, { connectTimeoutMs: 8000 });
console.log(`[连接] ${session.label} ${session.serverVersion} (${vendor})`);

try {
  await session.query('DROP DATABASE IF EXISTS dbcraft_check');
  await session.query('DROP DATABASE IF EXISTS dbcraft_check_other');
  await session.query(
    'CREATE DATABASE dbcraft_check CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci',
  );
  await session.query(
    'CREATE DATABASE dbcraft_check_other CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci',
  );
  await session.useDatabase('dbcraft_check');

  await session.query(`
    CREATE TABLE dbcraft_check.items (
      id int NOT NULL AUTO_INCREMENT PRIMARY KEY,
      name varchar(50) NOT NULL,
      amount decimal(18,2) NULL,
      created datetime NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await session.query(
    "INSERT INTO dbcraft_check.items (name, amount) VALUES ('第一行', 12.34), ('第二行', NULL)",
  );
  await session.query('CREATE TABLE dbcraft_check_other.remote_items (id int PRIMARY KEY, label varchar(20))');
  console.log('[建库建表] ok');

  // 补全依赖：当前库对象、列、跨库 schema。
  const schema = await session.schema();
  assert(
    schema.some((object) => object.name === 'items' && object.type === 'table'),
    'schema missing items table',
  );
  assert(
    !schema.some((object) => object.name === 'remote_items'),
    'current schema should not include other database tables',
  );

  const meta = await session.getTableMeta('items', 'table');
  const columnNames = meta.columns.map((column) => column.name);
  assert(
    JSON.stringify(columnNames) === JSON.stringify(['id', 'name', 'amount', 'created']),
    `column completion source wrong: ${columnNames.join(',')}`,
  );
  assert(meta.columns.find((column) => column.name === 'id')?.readOnly, 'auto increment should be readonly');
  assert(
    meta.columns.find((column) => column.name === 'amount')?.declaredType === 'decimal(18,2)',
    'declared type wrong',
  );

  const crossSchema = await session.schema({ database: 'dbcraft_check_other' });
  assert(
    crossSchema.some((object) => object.name === 'remote_items'),
    'cross-database schema completion source missing remote_items',
  );
  console.log('[对象/列/跨库] ok');

  const databases = await session.databases();
  assert(
    databases.some((database) => database.name === 'dbcraft_check' && database.current),
    'databases() should mark current database',
  );
  assert(
    databases.some((database) => database.name === 'dbcraft_check_other' && !database.current),
    'databases() should include other database',
  );
  console.log('[库列表] ok');

  const selected = await session.query('SELECT id, name, amount FROM items ORDER BY id');
  assert(selected.rows.length === 2, 'row count wrong');
  assert(selected.rows[0][2] === '12.34', `decimal should stay string, got ${selected.rows[0][2]}`);

  const page = buildTablePageQuery(
    'mysql',
    'items',
    50,
    0,
    { column: 'id', direction: 'desc' },
    { column: 'name', value: '第一' },
  );
  const pageResult = await session.query(page.sql, page.params);
  assert(pageResult.rows.length === 1, `page filter wrong: ${pageResult.rows.length}`);
  console.log('[查询/分页] ok');

  // 取消后会话应继续可用（MySQL 系通过控制连接 KILL QUERY）。
  // 被 KILL 的 SLEEP 可能抛错，也可能成功返回 1；以耗时判断是否真的中止。
  const started = Date.now();
  const pending = session.query('SELECT SLEEP(10)');
  setTimeout(() => void session.cancel(), 500);
  try {
    await pending;
  } catch {
    // 取消按预期抛出。
  }
  const elapsed = Date.now() - started;
  assert(elapsed < 6000, `cancel did not stop SLEEP (${elapsed}ms)`);
  const afterCancel = await session.query('SELECT 1 AS v');
  assert(
    String(afterCancel.rows[0][0]) === '1',
    `session should stay alive after cancel: ${JSON.stringify(afterCancel.rows)}`,
  );
  console.log(`[取消] ok，${elapsed}ms，会话可继续查询`);

  let missingFailed = false;
  try {
    await session.query('SELECT * FROM dbcraft_missing_table');
  } catch {
    missingFailed = true;
  }
  assert(missingFailed, 'missing table should reject');
  assert(session.alive, 'session should stay alive after query error');
  console.log('[错误] ok，会话保持可用');
} finally {
  await session.query('DROP DATABASE IF EXISTS dbcraft_check').catch(() => undefined);
  await session.query('DROP DATABASE IF EXISTS dbcraft_check_other').catch(() => undefined);
  await session.close();
  console.log('[清理] 会话已关闭');
}
