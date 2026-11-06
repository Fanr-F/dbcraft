/**
 * 用真实 SQL Server 验证多数据库对象树的后端能力（不启动 Electron）：
 *   - databases() 列出可见数据库并标记当前库
 *   - schema({ database }) 跨库读取表/视图/存储过程
 *   - useDatabase() 切换会话当前库
 *   - tableExtras() 读取约束/触发器/索引
 *
 * 在 tempdb 创建临时表/索引/触发器/存储过程，结束后清理。
 *   node --env-file=.env.local scripts/check-mssql-multidb.mjs
 */
import { MssqlSession } from '../src/main/services/mssql/MssqlSession.ts';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const input = {
  type: 'mssql',
  name: 'mssql-multidb-check',
  group: '',
  env: 'dev',
  host: process.env.DBCRAFT_MSSQL_HOST,
  port: Number(process.env.DBCRAFT_MSSQL_PORT || 1433),
  username: process.env.DBCRAFT_MSSQL_USER,
  password: process.env.DBCRAFT_MSSQL_PASSWORD,
  database: process.env.DBCRAFT_MSSQL_DATABASE || 'master',
  encrypt: process.env.DBCRAFT_MSSQL_ENCRYPT !== 'false',
  trustServerCertificate: process.env.DBCRAFT_MSSQL_TRUST !== 'false',
  ...(process.env.DBCRAFT_MSSQL_INSTANCE
    ? { instanceName: process.env.DBCRAFT_MSSQL_INSTANCE }
    : {}),
};

const session = await MssqlSession.create(input, { connectTimeoutMs: 8000 });
console.log(`[连接] ${session.label} ${session.serverVersion}`);

const originalDatabase = String(
  (await session.query('SELECT DB_NAME()')).rows[0]?.[0] ?? '',
);
console.log(`[当前库] ${originalDatabase}`);

try {
  const databases = await session.databases();
  assert(databases.length > 0, '数据库列表为空');
  assert(
    databases.some((database) => database.current && database.name === originalDatabase),
    '当前数据库标记错误',
  );
  assert(
    databases.some((database) => database.name === 'tempdb'),
    '未列出 tempdb',
  );
  console.log(`[数据库] ${databases.map((database) => database.name).join(', ')}`);

  await session.useDatabase('tempdb');
  const switched = String((await session.query('SELECT DB_NAME()')).rows[0]?.[0] ?? '');
  assert(switched === 'tempdb', `切换数据库失败：${switched}`);
  console.log('[切换] tempdb ok');

  await session.query('DROP TABLE IF EXISTS dbo.dbcraft_multi_probe');
  await session.query('DROP PROCEDURE IF EXISTS dbo.dbcraft_multi_probe_proc');
  await session.query(`
    CREATE TABLE dbo.dbcraft_multi_probe (
      id int IDENTITY(1,1) NOT NULL CONSTRAINT PK_dbcraft_multi_probe PRIMARY KEY,
      name nvarchar(40) NOT NULL CONSTRAINT DF_dbcraft_multi_probe_name DEFAULT (N''),
      amount decimal(18,2) NULL
    )
  `);
  await session.query(
    'CREATE INDEX ix_dbcraft_multi_probe_name ON dbo.dbcraft_multi_probe(name)',
  );
  await session.query(`
    CREATE TRIGGER dbo.trg_dbcraft_multi_probe
    ON dbo.dbcraft_multi_probe AFTER INSERT AS
    BEGIN
      SET NOCOUNT ON;
    END
  `);
  await session.query(`
    CREATE PROCEDURE dbo.dbcraft_multi_probe_proc
    AS
    BEGIN
      SET NOCOUNT ON;
      SELECT 1 AS ok;
    END
  `);
  console.log('[准备] tempdb 临时表/索引/触发器/存储过程已创建');

  const objects = await session.schema({ database: 'tempdb' });
  console.log(
    `[对象明细] ${objects.map((object) => `${object.name}:${object.type}`).join(', ')}`,
  );
  assert(
    objects.some((object) => object.name === 'dbcraft_multi_probe' && object.type === 'table'),
    '跨库 schema 未返回临时表',
  );
  assert(
    objects.some(
      (object) => object.name === 'dbcraft_multi_probe_proc' && object.type === 'procedure',
    ),
    '跨库 schema 未返回存储过程',
  );
  console.log('[对象] 表/存储过程 ok');

  const extras = await session.tableExtras('tempdb', 'dbo.dbcraft_multi_probe');
  assert(
    extras.constraints.some((item) => item.kind === 'PRIMARY KEY'),
    '约束缺少主键',
  );
  assert(
    extras.constraints.some((item) => item.kind === 'DEFAULT'),
    '约束缺少默认值',
  );
  assert(
    extras.indexes.some((item) => item.name === 'ix_dbcraft_multi_probe_name'),
    '索引缺少普通索引',
  );
  assert(
    extras.triggers.some((item) => item.name === 'trg_dbcraft_multi_probe'),
    '触发器缺失',
  );
  console.log(
    `[表子对象] constraints=${extras.constraints.length} triggers=${extras.triggers.length} indexes=${extras.indexes.length}`,
  );

  await session.useDatabase(originalDatabase);
  const restored = String((await session.query('SELECT DB_NAME()')).rows[0]?.[0] ?? '');
  assert(restored === originalDatabase, `恢复数据库失败：${restored}`);
  console.log(`[恢复] ${restored} ok`);
} finally {
  try {
    await session.useDatabase('tempdb');
    await session.query('DROP PROCEDURE IF EXISTS dbo.dbcraft_multi_probe_proc');
    await session.query('DROP TABLE IF EXISTS dbo.dbcraft_multi_probe');
    await session.useDatabase(originalDatabase);
    console.log('[清理] 临时对象已删除');
  } finally {
    await session.close();
  }
}
