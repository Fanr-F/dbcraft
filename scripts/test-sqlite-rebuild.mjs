/**
 * SQLite 重建表生成器的纯逻辑 + 真实 SQLite 回放测试。
 *
 * 运行：npm run test:sqlite-rebuild
 */
import Database from 'better-sqlite3';
import { buildSqliteRebuild } from '../src/shared/dialect/sqlite-rebuild.ts';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function column(name, type, overrides = {}) {
  return {
    name,
    declaredType: type,
    notNull: false,
    primaryKey: false,
    autoIncrement: false,
    defaultValue: null,
    readOnly: false,
    ...overrides,
  };
}

const detail = {
  name: 'users',
  kind: 'table',
  editable: true,
  primaryKey: ['id'],
  columns: [
    column('id', 'INTEGER', { primaryKey: true, notNull: true, readOnly: true }),
    column('name', 'TEXT', { notNull: false }),
    column('note', 'TEXT', { defaultValue: "'x'" }),
  ],
  indexes: [{ name: 'idx_users_name', unique: true, columns: ['name'] }],
  foreignKeys: [],
};

const rebuilt = buildSqliteRebuild(detail, {
  name: 'name',
  type: 'VARCHAR(100)',
  notNull: true,
});
assert(rebuilt.ok, `rebuild generation failed: ${rebuilt.ok ? '' : rebuilt.message}`);
assert(rebuilt.statements.length === 5, `expected 5 statements, got ${rebuilt.statements.length}`);
assert(
  rebuilt.statements[0].includes('"name" VARCHAR(100) NOT NULL'),
  'target column definition not updated',
);
assert(
  rebuilt.statements[1].includes('INSERT INTO "__dbcraft_rebuild_users" ("id", "name", "note")'),
  'copy statement wrong',
);
assert(rebuilt.statements[4].includes('CREATE UNIQUE INDEX "idx_users_name"'), 'index not recreated');
assert(rebuilt.warnings.length >= 2, 'missing rebuild warnings');

const composite = buildSqliteRebuild(
  {
    ...detail,
    name: 'memberships',
    columns: [
      column('user_id', 'INTEGER', { primaryKey: true, notNull: true }),
      column('role', 'TEXT', { primaryKey: true, notNull: true }),
      column('note', 'TEXT'),
    ],
    indexes: [],
  },
  { name: 'note', type: 'VARCHAR(50)', notNull: false },
);
assert(composite.ok, 'composite PK rebuild should be supported');
assert(
  composite.ok && composite.statements[0].includes('PRIMARY KEY ("user_id", "role")'),
  'composite PK clause missing',
);

const compositeDb = new Database(':memory:');
compositeDb.exec(
  'CREATE TABLE memberships (user_id INTEGER NOT NULL, role TEXT NOT NULL, note TEXT, PRIMARY KEY(user_id, role))',
);
compositeDb
  .prepare('INSERT INTO memberships (user_id, role, note) VALUES (?, ?, ?), (?, ?, ?)')
  .run(1, 'admin', 'x', 1, 'user', null);
compositeDb.exec('BEGIN');
for (const sql of composite.ok ? composite.statements : []) {
  compositeDb.exec(sql);
}
compositeDb.exec('COMMIT');
assert(
  compositeDb.prepare('SELECT COUNT(*) AS count FROM memberships').get().count === 2,
  'composite data not preserved',
);
const compositeInfo = compositeDb.prepare('PRAGMA table_info(memberships)').all();
assert(
  compositeInfo.filter((row) => row.pk > 0).length === 2,
  'composite primary key lost',
);
assert(
  compositeInfo.find((row) => row.name === 'note').type === 'VARCHAR(50)',
  'composite target type not changed',
);
compositeDb.close();

const missing = buildSqliteRebuild(detail, { name: 'nope', type: 'TEXT', notNull: false });
assert(!missing.ok, 'missing column should be rejected');

// 真实 SQLite 回放：数据、索引与新列定义都要保留。
const database = new Database(':memory:');
database.exec('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, note TEXT DEFAULT \'x\')');
database.exec('CREATE UNIQUE INDEX idx_users_name ON users(name)');
database
  .prepare('INSERT INTO users (id, name) VALUES (?, ?), (?, ?)')
  .run(1, 'alice', 2, 'bob');

database.exec('BEGIN');
for (const sql of rebuilt.statements) {
  database.exec(sql);
}
database.exec('COMMIT');

const rows = database.prepare('SELECT id, name, note FROM users ORDER BY id').all();
assert(rows.length === 2 && rows[0].name === 'alice', 'data not preserved');
assert(rows[0].note === 'x', 'default value not preserved');

const info = database.prepare('PRAGMA table_info(users)').all();
const nameColumn = info.find((row) => row.name === 'name');
assert(nameColumn.type === 'VARCHAR(100)', `type not changed: ${nameColumn?.type}`);
assert(nameColumn.notnull === 1, 'not-null not applied');

const indexes = database.prepare('PRAGMA index_list(users)').all();
assert(
  indexes.some((index) => index.name === 'idx_users_name' && index.unique === 1),
  'index missing after rebuild',
);
assert(
  database.prepare('PRAGMA foreign_key_check').all().length === 0,
  'foreign key check failed',
);
database.close();

console.log('sqlite rebuild check passed');
