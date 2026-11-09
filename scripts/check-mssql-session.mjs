/**
 * 用真实 SQL Server 验证 MssqlSession（不启动 Electron）。
 *
 *   node --env-file=.env.local scripts/check-mssql-session.mjs
 *
 * 会创建并删除临时表 dbo.dbcraft_check，只使用测试库连接。
 */
import { MssqlSession } from '../src/main/services/mssql/MssqlSession.ts';
import {
  buildAddColumn,
  buildCreateTable,
  buildDropColumn,
  buildDropObject,
  buildModifyColumn,
  buildRenameColumn,
  buildRenameTable,
} from '../src/shared/dialect/ddl.ts';
import {
  buildTableEditStatements,
} from '../src/shared/dialect/dml.ts';
import { buildTablePageQuery } from '../src/shared/dialect/identifiers.ts';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const input = {
  type: 'mssql',
  name: 'mssql-check',
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

try {
  await session.query('IF OBJECT_ID(N\'dbo.dbcraft_check_view\', N\'V\') IS NOT NULL DROP VIEW dbo.dbcraft_check_view');
  await session.query('IF OBJECT_ID(N\'dbo.dbcraft_check\', N\'U\') IS NOT NULL DROP TABLE dbo.dbcraft_check');
  await session.query(`
    CREATE TABLE dbo.dbcraft_check (
      id int IDENTITY(1,1) NOT NULL PRIMARY KEY,
      name nvarchar(50) NOT NULL,
      amount decimal(18,2) NULL,
      created datetime2(3) NOT NULL CONSTRAINT DF_dbcraft_check_created DEFAULT SYSUTCDATETIME()
    )
  `);
  console.log('[建表] ok');

  const inserted = await session.query(
    "INSERT INTO dbo.dbcraft_check (name, amount) VALUES (N'第一行', 12.34)",
  );
  assert(inserted.statementType === 'change' && inserted.changes === 1, 'insert changes wrong');
  await session.query("INSERT INTO dbo.dbcraft_check (name, amount) VALUES (N'第二行', NULL)");
  console.log('[插入] ok');

  const selected = await session.query('SELECT id, name, amount, created FROM dbo.dbcraft_check ORDER BY id');
  assert(selected.columns.length === 4, 'column count wrong');
  assert(selected.rows.length === 2, 'row count wrong');
  assert(typeof selected.rows[0][0] === 'number', 'int should stay number');
  assert(selected.rows[0][2] === '12.34', `decimal should be string, got ${selected.rows[0][2]}`);
  assert(
    /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/.test(String(selected.rows[0][3])),
    `datetime2 format unexpected: ${selected.rows[0][3]}`,
  );
  console.log('[查询]', selected.columns.map((c) => `${c.name}:${c.declaredType}`).join(', '));

  const duplicate = await session.query('SELECT 1 AS dup, 2 AS dup, 3 AS other');
  assert(duplicate.columns.length === 3, 'duplicate columns lost');
  assert(duplicate.rows[0].length === 3, 'duplicate row cells lost');
  console.log('[重复列] ok');

  const schema = await session.schema();
  assert(schema.some((item) => item.name === 'dbcraft_check'), 'schema missing test table');
  assert(
    schema.every((item) => Boolean(item.schema)),
    'schema objects should carry schema name',
  );
  console.log(`[对象树] ${schema.length} 个对象，schema=${schema[0]?.schema}`);

  const meta = await session.getTableMeta('dbo.dbcraft_check', 'table');
  assert(meta.editable, 'table should be editable');
  assert(meta.primaryKey.join(',') === 'id', 'primary key wrong');
  assert(meta.columns.find((c) => c.name === 'id')?.readOnly, 'identity should be readonly');
  assert(meta.columns.find((c) => c.name === 'amount')?.declaredType === 'decimal(18,2)', 'declared type wrong');
  console.log('[表元数据] columns=', meta.columns.map((c) => c.name).join(','));

  const detail = await session.getTableDetail('dbo.dbcraft_check');
  assert(detail.comment === null, 'comment should be null');
  assert(detail.indexes.length === 0, 'only PK index expected');
  console.log('[表结构] indexes/fks/checks =', detail.indexes.length, detail.foreignKeys.length, detail.checks.length);

  const ddl = await session.getDdl('dbo.dbcraft_check', 'table');
  assert(/CREATE TABLE \[dbo\]\.\[dbcraft_check\]/.test(ddl), 'ddl table name wrong');
  assert(/IDENTITY\(1,1\)/.test(ddl), 'ddl identity missing');
  assert(/PRIMARY KEY \(\[id\]\)/.test(ddl), 'ddl pk missing');
  console.log('[DDL]\n' + ddl);

  // UI 表设计生成的 MSSQL DDL：schema + IDENTITY + ALTER 在真机回放。
  await session.query(
    "IF OBJECT_ID(N'dbo.dbcraft_ui_check', N'U') IS NOT NULL DROP TABLE dbo.dbcraft_ui_check",
  );
  const uiCreate = buildCreateTable('mssql', {
    schema: 'dbo',
    name: 'dbcraft_ui_check',
    columns: [
      { name: 'id', type: 'INT', primaryKey: true, autoIncrement: true },
      { name: 'name', type: 'NVARCHAR(50)', notNull: true },
    ],
  });
  assert(uiCreate.ok && uiCreate.sql.includes('[dbo].[dbcraft_ui_check]'), 'ui create failed');
  assert(uiCreate.ok && uiCreate.sql.includes('IDENTITY(1,1)'), 'ui identity missing');
  await session.query(uiCreate.sql);

  const uiAdd = buildAddColumn('mssql', 'dbo.dbcraft_ui_check', {
    name: 'note',
    type: 'NVARCHAR(100)',
  });
  assert(uiAdd.ok, 'ui add column failed');
  await session.query(uiAdd.sql);

  const uiRenameColumn = buildRenameColumn(
    'mssql',
    'dbo.dbcraft_ui_check',
    'note',
    'memo',
  );
  assert(uiRenameColumn.ok, 'ui rename column failed');
  await session.query(uiRenameColumn.sql);

  const uiModify = buildModifyColumn('mssql', 'dbo.dbcraft_ui_check', 'memo', {
    name: 'memo',
    type: 'NVARCHAR(200)',
    notNull: false,
  });
  assert(uiModify.ok, 'ui modify column failed');
  await session.query(uiModify.sql);

  await session.query(
    "INSERT INTO dbo.dbcraft_ui_check (name, memo) VALUES (N'ui', N'ok')",
  );
  const uiRows = await session.query(
    'SELECT id, name, memo FROM dbo.dbcraft_ui_check ORDER BY id',
  );
  assert(uiRows.rows.length === 1 && uiRows.rows[0][0] === 1, 'ui identity insert failed');
  assert(uiRows.rows[0][2] === 'ok', 'ui modified column missing');

  const uiDropColumn = buildDropColumn('mssql', 'dbo.dbcraft_ui_check', 'memo');
  assert(uiDropColumn.ok, 'ui drop column failed');
  await session.query(uiDropColumn.sql);

  const uiRenameTable = buildRenameTable(
    'mssql',
    'dbo.dbcraft_ui_check',
    'dbcraft_ui_check_renamed',
  );
  assert(uiRenameTable.ok, 'ui rename table failed');
  await session.query(uiRenameTable.sql);

  const uiDropTable = buildDropObject('mssql', 'dbo.dbcraft_ui_check_renamed', 'table');
  assert(uiDropTable.ok, 'ui drop table failed');
  await session.query(uiDropTable.sql);
  console.log('[UI DDL] schema/IDENTITY/ADD/RENAME/MODIFY/DROP ok');

  const page = buildTablePageQuery(
    'mssql',
    'dbo.dbcraft_check',
    50,
    0,
    { column: 'id', direction: 'desc' },
    { column: 'name', value: '第一' },
  );
  const pageResult = await session.query(page.sql, page.params);
  assert(pageResult.rows.length === 1, `page filter wrong: ${pageResult.rows.length}`);
  console.log('[表数据页] ok:', page.sql);

  const insertStatement = buildTableEditStatements('mssql', meta.name, meta, [
    { kind: 'insert', values: { name: '第三行', amount: '3.50' } },
  ])[0];
  await session.query(insertStatement.sql, insertStatement.params);

  const updateStatement = buildTableEditStatements('mssql', meta.name, meta, [
    {
      kind: 'update',
      keys: { id: 1 },
      values: { name: '改过的第一行' },
      original: { name: '第一行' },
    },
  ])[0];
  const updated = await session.query(updateStatement.sql, updateStatement.params);
  assert(updated.changes === 1, 'update changes wrong');

  const conflict = await session.query(updateStatement.sql, updateStatement.params);
  assert(conflict.changes === 0, 'optimistic lock should fail on stale original');
  console.log('[表编辑] insert/update/乐观锁 ok');

  const deleteStatement = buildTableEditStatements('mssql', meta.name, meta, [
    { kind: 'delete', keys: { id: 3 } },
  ])[0];
  const deleted = await session.query(deleteStatement.sql, deleteStatement.params);
  assert(deleted.changes === 1, 'delete changes wrong');
  console.log('[表编辑] delete ok');

  // 取消：WAITFOR 被取消后会话仍可复用。
  const pending = session.query("WAITFOR DELAY '00:00:05'");
  setTimeout(() => void session.cancel(), 500);
  let canceled = false;
  try {
    await pending;
  } catch {
    canceled = true;
  }
  assert(canceled, 'cancel should abort WAITFOR');
  const afterCancel = await session.query('SELECT 1 AS v');
  assert(afterCancel.rows[0][0] === 1, 'session should stay alive after cancel');
  console.log('[取消] ok，会话可继续查询');

  // 查询错误不应让整个会话失效。
  let missingFailed = false;
  try {
    await session.query('SELECT * FROM dbo.dbcraft_missing_table');
  } catch {
    missingFailed = true;
  }
  assert(missingFailed, 'missing table should reject');
  const afterError = await session.query('SELECT 1 AS ok');
  assert(afterError.rows[0][0] === 1, 'session should stay alive after query error');
  assert(session.alive, 'session should stay alive after query error');
  console.log('[错误] ok，会话保持可用');

  const empty = await session.query('SELECT * FROM dbo.dbcraft_check WHERE 1 = 0');
  assert(empty.columns.length === 4, 'empty result should keep column metadata');
  assert(empty.rows.length === 0, 'empty result should have no rows');
  console.log('[空结果] ok');

  await session.query(
    'CREATE VIEW dbo.dbcraft_check_view AS SELECT id, name FROM dbo.dbcraft_check',
  );
  const viewMeta = await session.getTableMeta('dbo.dbcraft_check_view', 'view');
  assert(!viewMeta.editable && viewMeta.reasonCode === 'view', 'view should be readonly');
  const viewDdl = await session.getDdl('dbo.dbcraft_check_view', 'view');
  assert(/CREATE\s+VIEW/i.test(viewDdl), 'view ddl failed');
  console.log('[视图] ok');
  await session.query('DROP VIEW dbo.dbcraft_check_view');
} finally {
  await session.query('IF OBJECT_ID(N\'dbo.dbcraft_check_view\', N\'V\') IS NOT NULL DROP VIEW dbo.dbcraft_check_view').catch(
    () => undefined,
  );
  await session.query('IF OBJECT_ID(N\'dbo.dbcraft_check\', N\'U\') IS NOT NULL DROP TABLE dbo.dbcraft_check').catch(
    () => undefined,
  );
  await session
    .query(
      "IF OBJECT_ID(N'dbo.dbcraft_ui_check', N'U') IS NOT NULL DROP TABLE dbo.dbcraft_ui_check",
    )
    .catch(() => undefined);
  await session
    .query(
      "IF OBJECT_ID(N'dbo.dbcraft_ui_check_renamed', N'U') IS NOT NULL DROP TABLE dbo.dbcraft_ui_check_renamed",
    )
    .catch(() => undefined);
  await session.close();
  console.log('[清理] 会话已关闭');
}
