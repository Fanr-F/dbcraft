/**
 * CREATE TABLE 生成器的纯逻辑测试。
 *
 * 运行：npm run test:ddl
 */
import {
  buildAddColumn,
  buildCreateIndex,
  buildCreateTable,
  buildCreateView,
  buildDropColumn,
  buildDropIndex,
  buildDropObject,
  buildModifyColumn,
  buildRenameColumn,
  buildRenameTable,
  buildTableComment,
} from '../src/shared/dialect/ddl.ts';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function expectSql(result, expected) {
  assert(result.ok, `expected ok, got: ${result.ok ? '' : result.message}`);
  assert(result.sql === expected, `SQL mismatch:\n--- actual ---\n${result.sql}\n--- expected ---\n${expected}`);
}

const sqlite = buildCreateTable('sqlite', {
  name: 'users',
  columns: [
    { name: 'id', type: 'INTEGER', primaryKey: true, autoIncrement: true },
    { name: 'email', type: 'TEXT', notNull: true, unique: true },
    { name: 'created_at', type: 'TEXT', defaultValue: 'CURRENT_TIMESTAMP' },
  ],
});
expectSql(
  sqlite,
  'CREATE TABLE "users" (\n' +
    '  "id" INTEGER PRIMARY KEY AUTOINCREMENT,\n' +
    '  "email" TEXT NOT NULL UNIQUE,\n' +
    '  "created_at" TEXT DEFAULT CURRENT_TIMESTAMP\n' +
    ');',
);
assert(sqlite.warnings.length === 0, 'unexpected SQLite warning');

const mysql = buildCreateTable('mysql', {
  name: 'orders',
  columns: [
    { name: 'id', type: 'INT', primaryKey: true, autoIncrement: true },
    { name: 'no', type: 'VARCHAR(64)', notNull: true },
    { name: 'flag', type: 'TINYINT', defaultValue: '0' },
  ],
});
expectSql(
  mysql,
  'CREATE TABLE `orders` (\n' +
    '  `id` INT NOT NULL AUTO_INCREMENT PRIMARY KEY,\n' +
    '  `no` VARCHAR(64) NOT NULL,\n' +
    '  `flag` TINYINT DEFAULT 0\n' +
    ');',
);

const quoted = buildCreateTable('sqlite', {
  name: 'we"ird',
  columns: [{ name: 'a`b', type: 'TEXT' }],
});
assert(quoted.ok, 'quoted identifiers should be accepted');
assert(quoted.sql.includes('"we""ird"'), 'sqlite table name not escaped');
assert(quoted.sql.includes('"a`b"'), 'sqlite column name not escaped');
assert(quoted.warnings.length === 1, 'missing no-primary-key warning');

const mysqlQuoted = buildCreateTable('mariadb', {
  name: 'a`b',
  columns: [{ name: 'x', type: 'INT', primaryKey: true }],
});
assert(mysqlQuoted.ok, 'mariadb table should be accepted');
assert(mysqlQuoted.sql.includes('`a``b`'), 'backtick not escaped');

const failures = [
  [{ name: '  ', columns: [{ name: 'a', type: 'TEXT' }] }, '表名不能为空'],
  [{ name: 't', columns: [] }, '至少需要一列'],
  [
    { name: 't', columns: [{ name: 'a', type: 'TEXT' }, { name: 'A', type: 'TEXT' }] },
    '列名重复',
  ],
  [
    { name: 't', columns: [{ name: 'a', type: 'TEXT', autoIncrement: true }] },
    '自增列必须同时设为主键',
  ],
  [
    { name: 't', columns: [{ name: 'a', type: 'TEXT', primaryKey: true, autoIncrement: true }] },
    'SQLite 的自增列类型必须是 INTEGER',
  ],
  [
    {
      name: 't',
      columns: [
        { name: 'a', type: 'INT', primaryKey: true },
        { name: 'b', type: 'INT', primaryKey: true },
      ],
    },
    '单列主键',
  ],
  [
    { name: 't', columns: [{ name: 'a', type: 'INT' }] },
    'MSSQL',
  ],
];

for (const [definition, expected] of failures) {
  const result = buildCreateTable(
    definition.name === 't' && expected === 'MSSQL' ? 'mssql' : 'sqlite',
    definition,
  );
  assert(!result.ok, `expected failure containing "${expected}"`);
  assert(
    result.message.includes(expected),
    `message "${result.message}" does not include "${expected}"`,
  );
}

console.log('ddl generator check passed');

// DROP / RENAME
expectSql(buildDropObject('sqlite', 'users', 'table'), 'DROP TABLE "users";');
expectSql(buildDropObject('mysql', 'active_users', 'view'), 'DROP VIEW `active_users`;');
expectSql(buildRenameTable('sqlite', 'old', 'new'), 'ALTER TABLE "old" RENAME TO "new";');
expectSql(
  buildRenameTable('mariadb', 'old', 'new'),
  'ALTER TABLE `old` RENAME TO `new`;',
);

const actionFailures = [
  [buildDropObject('sqlite', '  ', 'table'), '表名不能为空'],
  [buildDropObject('sqlite', '', 'view'), '视图名不能为空'],
  [buildRenameTable('sqlite', 'same', 'same'), '相同'],
  [buildRenameTable('sqlite', 'old', ''), '新表名不能为空'],
  [buildDropObject('mssql', 'users', 'table'), 'MSSQL'],
];

for (const [result, expected] of actionFailures) {
  assert(!result.ok, `expected failure containing "${expected}"`);
  assert(
    result.message.includes(expected),
    `message "${result.message}" does not include "${expected}"`,
  );
}

console.log('ddl actions check passed');

// ADD COLUMN
expectSql(
  buildAddColumn('sqlite', 'users', {
    name: 'age',
    type: 'INTEGER',
    notNull: true,
    defaultValue: '0',
  }),
  'ALTER TABLE "users" ADD COLUMN "age" INTEGER NOT NULL DEFAULT 0;',
);
expectSql(
  buildAddColumn('mysql', 'users', {
    name: 'email',
    type: 'VARCHAR(64)',
    unique: true,
  }),
  'ALTER TABLE `users` ADD COLUMN `email` VARCHAR(64) UNIQUE;',
);

const addWarnings = buildAddColumn('sqlite', 'users', {
  name: 'nickname',
  type: 'TEXT',
  notNull: true,
});
assert(addWarnings.ok, 'add column should be accepted');
assert(addWarnings.warnings.length === 1, 'missing NOT NULL warning');

const addFailures = [
  [buildAddColumn('sqlite', '', { name: 'a', type: 'TEXT' }), '表名不能为空'],
  [buildAddColumn('sqlite', 'users', { name: ' ', type: 'TEXT' }), '列名不能为空'],
  [buildAddColumn('sqlite', 'users', { name: 'a', type: ' ' }), '缺少类型'],
  [
    buildAddColumn('sqlite', 'users', { name: 'id', type: 'INT', primaryKey: true }),
    '不支持主键/自增',
  ],
  [
    buildAddColumn('sqlite', 'users', { name: 'id', type: 'INT', autoIncrement: true }),
    '不支持主键/自增',
  ],
  [buildAddColumn('mssql', 'users', { name: 'a', type: 'INT' }), 'MSSQL'],
];

for (const [result, expected] of addFailures) {
  assert(!result.ok, `expected add-column failure containing "${expected}"`);
  assert(
    result.message.includes(expected),
    `message "${result.message}" does not include "${expected}"`,
  );
}

console.log('ddl add column check passed');

// INDEX
expectSql(
  buildCreateIndex('sqlite', 'users', ['status', 'created_at']),
  'CREATE INDEX "idx_users_status_created_at" ON "users" ("status", "created_at");',
);
expectSql(
  buildCreateIndex('mysql', 'users', ['email'], { name: 'uq_users_email', unique: true }),
  'CREATE UNIQUE INDEX `uq_users_email` ON `users` (`email`);',
);
expectSql(
  buildDropIndex('sqlite', 'idx_users_status'),
  'DROP INDEX "idx_users_status";',
);
expectSql(
  buildDropIndex('mariadb', 'idx_users_status', 'users'),
  'DROP INDEX `idx_users_status` ON `users`;',
);

const indexFailures = [
  [buildCreateIndex('sqlite', 'users', []), '至少需要一列'],
  [buildCreateIndex('sqlite', '', ['a']), '表名不能为空'],
  [buildCreateIndex('mssql', 'users', ['a']), 'MSSQL'],
  [buildDropIndex('sqlite', '  '), '索引名不能为空'],
  [buildDropIndex('mysql', 'idx'), '需要表名'],
];

for (const [result, expected] of indexFailures) {
  assert(!result.ok, `expected index failure containing "${expected}"`);
  assert(
    result.message.includes(expected),
    `message "${result.message}" does not include "${expected}"`,
  );
}

console.log('ddl index check passed');

// DROP COLUMN
expectSql(
  buildDropColumn('sqlite', 'users', 'note'),
  'ALTER TABLE "users" DROP COLUMN "note";',
);
expectSql(
  buildDropColumn('mysql', 'users', 'note'),
  'ALTER TABLE `users` DROP COLUMN `note`;',
);
const dropColumnWarnings = buildDropColumn('sqlite', 'users', 'note');
assert(dropColumnWarnings.ok && dropColumnWarnings.warnings.length === 1, 'missing drop warning');

const dropColumnFailures = [
  [buildDropColumn('sqlite', '', 'note'), '表名不能为空'],
  [buildDropColumn('sqlite', 'users', '  '), '列名不能为空'],
  [buildDropColumn('mssql', 'users', 'note'), 'MSSQL'],
];

for (const [result, expected] of dropColumnFailures) {
  assert(!result.ok, `expected drop-column failure containing "${expected}"`);
  assert(
    result.message.includes(expected),
    `message "${result.message}" does not include "${expected}"`,
  );
}

console.log('ddl drop column check passed');

// RENAME COLUMN
expectSql(
  buildRenameColumn('sqlite', 'users', 'note', 'remark'),
  'ALTER TABLE "users" RENAME COLUMN "note" TO "remark";',
);
expectSql(
  buildRenameColumn('mysql', 'users', 'note', 'remark'),
  'ALTER TABLE `users` RENAME COLUMN `note` TO `remark`;',
);
const renameColumnWarnings = buildRenameColumn('sqlite', 'users', 'note', 'remark');
assert(
  renameColumnWarnings.ok && renameColumnWarnings.warnings.length === 1,
  'missing rename-column warning',
);
const mariadbRename = buildRenameColumn('mariadb', 'users', 'note', 'remark');
assert(
  mariadbRename.ok && mariadbRename.warnings[0].includes('10.5'),
  'missing MariaDB version warning',
);

const renameColumnFailures = [
  [buildRenameColumn('sqlite', '', 'a', 'b'), '表名不能为空'],
  [buildRenameColumn('sqlite', 'users', '', 'b'), '原列名不能为空'],
  [buildRenameColumn('sqlite', 'users', 'a', ' '), '新列名不能为空'],
  [buildRenameColumn('sqlite', 'users', 'a', 'a'), '新旧列名相同'],
  [buildRenameColumn('mssql', 'users', 'a', 'b'), 'MSSQL'],
];

for (const [result, expected] of renameColumnFailures) {
  assert(!result.ok, `expected rename-column failure containing "${expected}"`);
  assert(
    result.message.includes(expected),
    `message "${result.message}" does not include "${expected}"`,
  );
}

console.log('ddl rename column check passed');

// MODIFY COLUMN
expectSql(
  buildModifyColumn('mysql', 'users', 'note', {
    name: 'note',
    type: 'VARCHAR(255)',
    notNull: true,
    defaultValue: "'x'",
  }),
  "ALTER TABLE `users` MODIFY COLUMN `note` VARCHAR(255) NOT NULL DEFAULT 'x';",
);
expectSql(
  buildModifyColumn('percona', 'users', 'balance', {
    name: 'balance',
    type: 'DECIMAL(12,2)',
    notNull: false,
  }),
  'ALTER TABLE `users` MODIFY COLUMN `balance` DECIMAL(12,2);',
);
const modifyWarnings = buildModifyColumn('mysql', 'users', 'note', {
  name: 'note',
  type: 'TEXT',
  notNull: true,
});
assert(
  modifyWarnings.ok && modifyWarnings.warnings.length === 2,
  'missing modify-column warnings',
);

const modifyFailures = [
  [buildModifyColumn('sqlite', 'users', 'note', { name: 'note', type: 'TEXT' }), 'SQLite 不支持'],
  [buildModifyColumn('mysql', 'users', 'note', { name: 'note', type: '' }), '缺少类型'],
  [
    buildModifyColumn('mysql', 'users', 'id', {
      name: 'id',
      type: 'INT',
      primaryKey: true,
    }),
    '主键/自增',
  ],
  [buildModifyColumn('mssql', 'users', 'note', { name: 'note', type: 'TEXT' }), 'MSSQL'],
];

for (const [result, expected] of modifyFailures) {
  assert(!result.ok, `expected modify-column failure containing "${expected}"`);
  assert(
    result.message.includes(expected),
    `message "${result.message}" does not include "${expected}"`,
  );
}

console.log('ddl modify column check passed');

// CREATE VIEW
expectSql(
  buildCreateView('sqlite', 'active_users', 'SELECT * FROM users WHERE active = 1;'),
  'CREATE VIEW "active_users" AS\nSELECT * FROM users WHERE active = 1;',
);
expectSql(
  buildCreateView('mysql', 'order_view', 'WITH x AS (SELECT 1) SELECT * FROM x'),
  'CREATE VIEW `order_view` AS\nWITH x AS (SELECT 1) SELECT * FROM x;',
);

const viewFailures = [
  [buildCreateView('sqlite', '', 'SELECT 1'), '视图名不能为空'],
  [buildCreateView('sqlite', 'v', '   '), '不能为空'],
  [buildCreateView('sqlite', 'v', 'DROP TABLE users'), '必须以 SELECT 或 WITH 开头'],
  [buildCreateView('mssql', 'v', 'SELECT 1'), 'MSSQL'],
];

for (const [result, expected] of viewFailures) {
  assert(!result.ok, `expected create-view failure containing "${expected}"`);
  assert(
    result.message.includes(expected),
    `message "${result.message}" does not include "${expected}"`,
  );
}

console.log('ddl create view check passed');

// TABLE COMMENT
expectSql(
  buildTableComment('mysql', 'users', "用户's 表"),
  "ALTER TABLE `users` COMMENT = '用户''s 表';",
);
expectSql(
  buildTableComment('mariadb', 'users', ''),
  "ALTER TABLE `users` COMMENT = '';",
);
assert(
  !buildTableComment('sqlite', 'users', 'x').ok,
  'sqlite table comment should be rejected',
);
assert(
  !buildTableComment('mysql', '', 'x').ok,
  'empty table name should be rejected',
);

console.log('ddl table comment check passed');
