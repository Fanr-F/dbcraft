/**
 * 表格编辑 DML 生成器测试（参数化、乐观锁、主键保护）。
 *
 * 运行：npm run test:dml
 */
import Database from 'better-sqlite3';
import {
  buildConflictCheckStatement,
  buildDeleteStatement,
  buildInsertStatement,
  buildTableEditStatements,
  buildUpdateStatement,
} from '../src/shared/dialect/dml.ts';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function expectSql(statement, expectedSql, expectedParams) {
  assert(
    statement.sql === expectedSql,
    `SQL mismatch:\n--- actual ---\n${statement.sql}\n--- expected ---\n${expectedSql}`,
  );
  assert(
    JSON.stringify(statement.params) === JSON.stringify(expectedParams),
    `params mismatch: ${JSON.stringify(statement.params)} !== ${JSON.stringify(expectedParams)}`,
  );
}

function expectThrows(fn, fragment) {
  try {
    fn();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    assert(message.includes(fragment), `expected "${fragment}" in "${message}"`);
    return;
  }
  throw new Error(`expected throw containing "${fragment}"`);
}

const meta = {
  name: 'users',
  kind: 'table',
  editable: true,
  primaryKey: ['id'],
  columns: [
    {
      name: 'id',
      declaredType: 'INTEGER',
      notNull: true,
      primaryKey: true,
      autoIncrement: true,
      defaultValue: null,
      readOnly: true,
    },
    {
      name: 'name',
      declaredType: 'TEXT',
      notNull: false,
      primaryKey: false,
      autoIncrement: false,
      defaultValue: null,
      readOnly: false,
    },
    {
      name: 'note',
      declaredType: 'TEXT',
      notNull: false,
      primaryKey: false,
      autoIncrement: false,
      defaultValue: null,
      readOnly: false,
    },
  ],
};

// SQLite：乐观锁用 IS，允许把 NULL 作为原始值比较。
expectSql(
  buildUpdateStatement('sqlite', 'users', meta, {
    kind: 'update',
    keys: { id: 1 },
    values: { name: 'alice', note: null },
    original: { name: 'old', note: null },
  }),
  'UPDATE "users" SET "name" = ?, "note" = ? WHERE "id" = ? AND "name" IS ? AND "note" IS ?',
  ['alice', null, 1, 'old', null],
);

// MySQL：NULL 安全等于 <=>。
expectSql(
  buildUpdateStatement('mysql', 'users', meta, {
    kind: 'update',
    keys: { id: 7 },
    values: { name: 'bob' },
    original: { name: 'bob-old' },
  }),
  'UPDATE `users` SET `name` = ? WHERE `id` = ? AND `name` <=> ?',
  ['bob', 7, 'bob-old'],
);

// MSSQL：命名占位符 + 展开的 NULL 比较。
expectSql(
  buildUpdateStatement('mssql', 'users', meta, {
    kind: 'update',
    keys: { id: 3 },
    values: { name: 'carol' },
    original: { name: 'carol-old' },
  }),
  'UPDATE [users] SET [name] = @p1 WHERE [id] = @p2 AND ([name] = @p3 OR ([name] IS NULL AND @p3 IS NULL))',
  ['carol', 3, 'carol-old'],
);

// 删除只用主键。
expectSql(
  buildDeleteStatement('sqlite', 'users', meta, { kind: 'delete', keys: { id: 9 } }),
  'DELETE FROM "users" WHERE "id" = ?',
  [9],
);

// 新增：列顺序即参数顺序。
expectSql(
  buildInsertStatement('sqlite', 'users', meta, {
    kind: 'insert',
    values: { name: 'dave', note: null },
  }),
  'INSERT INTO "users" ("name", "note") VALUES (?, ?)',
  ['dave', null],
);

// 空新增：SQLite 用 DEFAULT VALUES，MySQL 用 () VALUES ()。
expectSql(
  buildInsertStatement('sqlite', 'users', meta, { kind: 'insert', values: {} }),
  'INSERT INTO "users" DEFAULT VALUES',
  [],
);
expectSql(
  buildInsertStatement('mysql', 'users', meta, { kind: 'insert', values: {} }),
  'INSERT INTO `users` () VALUES ()',
  [],
);

// 主键不允许更新。
expectThrows(
  () =>
    buildUpdateStatement('sqlite', 'users', meta, {
      kind: 'update',
      keys: { id: 1 },
      values: { id: 2 },
      original: { id: 1 },
    }),
  '不可编辑',
);

// 未知列必须被拒绝，避免渲染层传来的列名进入 SQL。
expectThrows(
  () =>
    buildUpdateStatement('sqlite', 'users', meta, {
      kind: 'update',
      keys: { id: 1 },
      values: { "name'; DROP TABLE users; --": 'x' },
      original: { name: 'old' },
    }),
  '未知列',
);

// 缺主键、缺原始值、表名不一致都要报错。
expectThrows(
  () =>
    buildDeleteStatement('sqlite', 'users', meta, {
      kind: 'delete',
      keys: { name: 'x' },
    }),
  '缺少主键列',
);

expectThrows(
  () =>
    buildUpdateStatement('sqlite', 'users', meta, {
      kind: 'update',
      keys: { id: 1 },
      values: { name: 'x' },
      original: {},
    }),
  '原始值不能为空',
);

expectThrows(
  () =>
    buildTableEditStatements('sqlite', 'other', meta, [
      { kind: 'delete', keys: { id: 1 } },
    ]),
  '表名与元数据不一致',
);

// 批量编译在错误信息里带上序号。
expectThrows(
  () =>
    buildTableEditStatements('sqlite', 'users', meta, [
      { kind: 'delete', keys: { id: 1 } },
      { kind: 'delete', keys: { nope: 1 } },
    ]),
  '第 2 项编辑无效',
);

// MSSQL rowversion 不是普通更新值，但可作为乐观锁条件。
const rowversionMeta = {
  ...meta,
  columns: [
    ...meta.columns,
    {
      name: 'rv',
      declaredType: 'rowversion',
      notNull: true,
      primaryKey: false,
      autoIncrement: false,
      defaultValue: null,
      readOnly: true,
      rowversion: true,
    },
  ],
};
expectSql(
  buildUpdateStatement('mssql', 'users', rowversionMeta, {
    kind: 'update',
    keys: { id: 1 },
    values: { name: 'alice' },
    original: { name: 'old', rv: 'AAAA' },
  }),
  'UPDATE [users] SET [name] = @p1 WHERE [id] = @p2 AND ([name] = @p3 OR ([name] IS NULL AND @p3 IS NULL)) AND ([rv] = @p4 OR ([rv] IS NULL AND @p4 IS NULL))',
  ['alice', 1, 'old', 'AAAA'],
);

// 冲突预检使用与 UPDATE 相同的乐观锁条件；INSERT 不需要预检。
expectSql(
  buildConflictCheckStatement('sqlite', 'users', meta, {
    kind: 'update',
    keys: { id: 1 },
    values: { name: 'alice' },
    original: { name: 'old' },
  }),
  'SELECT 1 AS hit FROM "users" WHERE "id" = ? AND "name" IS ?',
  [1, 'old'],
);
assert(
  buildConflictCheckStatement('sqlite', 'users', meta, { kind: 'insert', values: {} }) === null,
  'insert should not need conflict precheck',
);
expectSql(
  buildConflictCheckStatement('mssql', 'users', meta, {
    kind: 'delete',
    keys: { id: 3 },
  }),
  'SELECT 1 AS hit FROM [users] WHERE [id] = @p1',
  [3],
);

// 主键默认只读；显式开启后才允许 UPDATE 主键。
expectThrows(
  () =>
    buildTableEditStatements('sqlite', 'users', meta, [
      {
        kind: 'update',
        keys: { id: 1 },
        values: { id: 5 },
        original: { id: 1 },
      },
    ]),
  '不可编辑',
);
expectSql(
  buildUpdateStatement(
    'sqlite',
    'users',
    meta,
    {
      kind: 'update',
      keys: { id: 1 },
      values: { id: 5 },
      original: { id: 1 },
    },
    { allowPrimaryKeyChange: true },
  ),
  'UPDATE "users" SET "id" = ? WHERE "id" = ? AND "id" IS ?',
  [5, 1, 1],
);

// 自增列默认拒绝显式 INSERT；显式开启后放行（UPDATE 仍拒绝）。
expectThrows(
  () =>
    buildInsertStatement('sqlite', 'users', meta, {
      kind: 'insert',
      values: { id: 10, name: 'explicit' },
    }),
  '不可编辑',
);
expectSql(
  buildInsertStatement(
    'sqlite',
    'users',
    meta,
    { kind: 'insert', values: { id: 10, name: 'explicit' } },
    { allowIdentityInsert: true },
  ),
  'INSERT INTO "users" ("id", "name") VALUES (?, ?)',
  [10, 'explicit'],
);
expectThrows(
  () =>
    buildUpdateStatement(
      'sqlite',
      'users',
      meta,
      {
        kind: 'update',
        keys: { id: 1 },
        values: { id: 10 },
        original: { id: 1 },
      },
      { allowIdentityInsert: true },
    ),
  '不可编辑',
);

// 带引号的标识符正确转义。
const weirdMeta = {
  ...meta,
  columns: [
    ...meta.columns,
    {
      name: 'we"ird',
      declaredType: 'TEXT',
      notNull: false,
      primaryKey: false,
      autoIncrement: false,
      defaultValue: null,
      readOnly: false,
    },
  ],
};
expectSql(
  buildUpdateStatement('sqlite', 'users', weirdMeta, {
    kind: 'update',
    keys: { id: 1 },
    values: { 'we"ird': 'v' },
    original: { 'we"ird': 'old' },
  }),
  'UPDATE "users" SET "we""ird" = ? WHERE "id" = ? AND "we""ird" IS ?',
  ['v', 1, 'old'],
);

// 用真实 SQLite 验证乐观锁语义（NULL 比较、0 行冲突）。
const database = new Database(':memory:');
database.exec('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, note TEXT)');
database
  .prepare('INSERT INTO users (id, name, note) VALUES (?, ?, ?), (?, ?, ?)')
  .run(1, 'old', null, 2, 'keep', 'x');

const update = buildUpdateStatement('sqlite', 'users', meta, {
  kind: 'update',
  keys: { id: 1 },
  values: { name: 'alice', note: null },
  original: { name: 'old', note: null },
});
const updated = database.prepare(update.sql).run(...update.params);
assert(updated.changes === 1, `optimistic update should hit 1 row, got ${updated.changes}`);
const row = database.prepare('SELECT id, name, note FROM users WHERE id = 1').get();
assert(row.name === 'alice' && row.note === null, 'row values mismatch after update');

// 原始值不匹配时必须 0 行（上层据此判定冲突并回滚）。
const stale = database.prepare(update.sql).run(...update.params);
assert(stale.changes === 0, 'stale update should not match any row');

const insert = buildInsertStatement('sqlite', 'users', meta, {
  kind: 'insert',
  values: { name: 'dave' },
});
const inserted = database.prepare(insert.sql).run(...insert.params);
assert(inserted.changes === 1, 'insert should affect 1 row');

const remove = buildDeleteStatement('sqlite', 'users', meta, {
  kind: 'delete',
  keys: { id: 2 },
});
const removed = database.prepare(remove.sql).run(...remove.params);
assert(removed.changes === 1, 'delete should affect 1 row');
database.close();

// 无主键表：默认不可更新/删除，但高风险模式允许 INSERT。
const noPkMeta = {
  name: 'logs',
  kind: 'table',
  editable: false,
  primaryKey: [],
  columns: [
    {
      name: 'message',
      declaredType: 'TEXT',
      notNull: false,
      primaryKey: false,
      autoIncrement: false,
      defaultValue: null,
      readOnly: false,
    },
  ],
};
expectSql(
  buildInsertStatement('sqlite', 'logs', noPkMeta, {
    kind: 'insert',
    values: { message: 'hello' },
  }),
  'INSERT INTO "logs" ("message") VALUES (?)',
  ['hello'],
);
expectThrows(
  () => buildDeleteStatement('sqlite', 'logs', noPkMeta, { kind: 'delete', keys: { message: 'x' } }),
  '没有主键',
);
expectThrows(
  () =>
    buildUpdateStatement('sqlite', 'logs', noPkMeta, {
      kind: 'update',
      keys: { message: 'x' },
      values: { message: 'y' },
      original: { message: 'x' },
    }),
  '没有主键',
);

console.log('test:dml passed');
