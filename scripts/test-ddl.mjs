/**
 * CREATE TABLE 生成器的纯逻辑测试。
 *
 * 运行：npm run test:ddl
 */
import { buildTableDesign } from '../src/shared/dialect/table-diff.ts';
import {
  buildAddCheck,
  buildAddColumn,
  buildAddForeignKey,
  buildCreateIndex,
  buildCreateTable,
  buildCreateView,
  buildDropCheck,
  buildDropColumn,
  buildDropForeignKey,
  buildDropIndex,
  buildDropObject,
  buildDropTrigger,
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
];

for (const [definition, expected] of failures) {
  const result = buildCreateTable('sqlite', definition);
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
  [
    buildAddColumn('mssql', 'users', { name: 'id', type: 'INT', autoIncrement: true }),
    '不支持主键/自增',
  ],
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

const mssqlComment = buildTableComment('mssql', 'dbo.users', "O'Brien");
assert(mssqlComment.ok, 'mssql table comment should be generated');
assert(mssqlComment.sql.includes('sp_addextendedproperty'), 'mssql add comment missing');
assert(mssqlComment.sql.includes("O''Brien"), 'mssql comment quote escaping failed');
assert(mssqlComment.sql.includes("@level0name = N'dbo'"), 'mssql schema missing');
const mssqlClearComment = buildTableComment('mssql', 'dbo.users', '');
assert(
  mssqlClearComment.ok && mssqlClearComment.sql.includes('sp_dropextendedproperty'),
  'mssql clear comment missing',
);

console.log('ddl table comment check passed');

// FOREIGN KEY
expectSql(
  buildAddForeignKey('mysql', 'orders', {
    name: 'fk_orders_user_id',
    columns: ['user_id'],
    referencedTable: 'users',
    referencedColumns: ['id'],
    onDelete: 'CASCADE',
  }),
  'ALTER TABLE `orders` ADD CONSTRAINT `fk_orders_user_id` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE;',
);
expectSql(
  buildAddForeignKey('mssql', 'dbo.orders', {
    name: 'fk_orders_user_id',
    columns: ['user_id'],
    referencedTable: 'dbo.users',
    referencedColumns: ['id'],
    onDelete: 'CASCADE',
  }),
  'ALTER TABLE [dbo].[orders] ADD CONSTRAINT [fk_orders_user_id] FOREIGN KEY ([user_id]) REFERENCES [dbo].[users] ([id]) ON DELETE CASCADE;',
);
expectSql(
  buildDropForeignKey('mysql', 'orders', 'fk_orders_user_id'),
  'ALTER TABLE `orders` DROP FOREIGN KEY `fk_orders_user_id`;',
);
expectSql(
  buildDropForeignKey('mssql', 'dbo.orders', 'fk_orders_user_id'),
  'ALTER TABLE [dbo].[orders] DROP CONSTRAINT [fk_orders_user_id];',
);
assert(
  !buildAddForeignKey('sqlite', 'orders', {
    columns: ['user_id'],
    referencedTable: 'users',
    referencedColumns: ['id'],
  }).ok,
  'sqlite foreign key should require rebuild',
);

console.log('ddl foreign key check passed');

// CHECK
expectSql(
  buildAddCheck('mysql', 'orders', 'ck_amount', 'amount > 0'),
  'ALTER TABLE `orders` ADD CONSTRAINT `ck_amount` CHECK (amount > 0);',
);
expectSql(
  buildDropCheck('mysql', 'orders', 'ck_amount'),
  'ALTER TABLE `orders` DROP CHECK `ck_amount`;',
);
expectSql(
  buildDropCheck('mariadb', 'orders', 'ck_amount'),
  'ALTER TABLE `orders` DROP CONSTRAINT `ck_amount`;',
);
expectSql(
  buildDropCheck('mssql', 'dbo.orders', 'ck_amount'),
  'ALTER TABLE [dbo].[orders] DROP CONSTRAINT [ck_amount];',
);
assert(
  !buildAddCheck('sqlite', 'orders', 'ck_amount', 'amount > 0').ok,
  'sqlite check should require rebuild',
);

console.log('ddl check constraint check passed');

// TRIGGER
expectSql(buildDropTrigger('mysql', 'trg_orders'), 'DROP TRIGGER IF EXISTS `trg_orders`;');
expectSql(buildDropTrigger('sqlite', 'trg_orders'), 'DROP TRIGGER IF EXISTS "trg_orders";');
expectSql(buildDropTrigger('mssql', 'trg_orders'), 'DROP TRIGGER [trg_orders];');

console.log('ddl trigger check passed');

// TABLE DESIGN：新建与编辑差异
const detail = {
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
      declaredType: 'VARCHAR(10)',
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
    {
      name: 'old_col',
      declaredType: 'TEXT',
      notNull: false,
      primaryKey: false,
      autoIncrement: false,
      defaultValue: null,
      readOnly: false,
    },
  ],
  indexes: [],
  foreignKeys: [],
  checks: [],
  comment: null,
};

const createDesign = buildTableDesign({
  dialect: 'sqlite',
  mode: 'create',
  tableName: 'orders',
  columns: [
    { name: 'id', type: 'INTEGER', primaryKey: true, autoIncrement: true },
    { name: 'no', type: 'TEXT', notNull: true },
  ],
});
assert(createDesign.ok, 'create design should succeed');
assert(
  createDesign.ok && createDesign.statements[0].includes('CREATE TABLE "orders"'),
  'create design SQL missing',
);

const wizardDesign = buildTableDesign({
  dialect: 'mysql',
  mode: 'create',
  tableName: 'orders_wizard',
  columns: [
    { name: 'id', type: 'INTEGER', primaryKey: true, autoIncrement: true },
    { name: 'amount', type: 'DECIMAL(10,2)', notNull: true },
  ],
  indexes: [{ name: 'idx_amount', columns: ['amount'], unique: true }],
  foreignKeys: [
    {
      name: 'fk_orders_wizard_user',
      columns: ['id'],
      referencedTable: 'users',
      referencedColumns: ['id'],
      onDelete: 'CASCADE',
    },
  ],
  checks: [{ name: 'ck_amount', expression: 'amount > 0' }],
  comment: '订单',
  options: { engine: 'InnoDB', charset: 'utf8mb4' },
});
assert(wizardDesign.ok, `wizard design failed: ${wizardDesign.ok ? '' : wizardDesign.message}`);
assert(
  wizardDesign.ok && wizardDesign.statements[0].includes('CONSTRAINT `fk_orders_wizard_user` FOREIGN KEY'),
  'wizard foreign key missing',
);
assert(
  wizardDesign.ok && wizardDesign.statements[0].includes('CONSTRAINT `ck_amount` CHECK (amount > 0)'),
  'wizard check missing',
);
assert(
  wizardDesign.ok && wizardDesign.statements[0].includes('ENGINE=InnoDB DEFAULT CHARSET=utf8mb4'),
  'wizard options missing',
);
assert(
  wizardDesign.ok && wizardDesign.statements[1].includes('CREATE UNIQUE INDEX `idx_amount`'),
  'wizard index missing',
);
assert(
  wizardDesign.ok && wizardDesign.statements[2].includes('COMMENT = \'订单\''),
  'wizard comment missing',
);

const editDesign = buildTableDesign({
  dialect: 'mysql',
  mode: 'edit',
  tableName: 'users_new',
  detail,
  columns: [
    { name: 'id', type: 'INTEGER', primaryKey: true, autoIncrement: true, originalName: 'id' },
    { name: 'title', type: 'VARCHAR(10)', originalName: 'name' },
    { name: 'note', type: 'VARCHAR(50)', notNull: true, originalName: 'note' },
    { name: 'created_at', type: 'DATETIME' },
  ],
});
assert(editDesign.ok, `edit design should succeed: ${editDesign.ok ? '' : editDesign.message}`);
assert(editDesign.ok && editDesign.statements.length === 5, 'edit design statement count wrong');
assert(
  editDesign.ok && editDesign.statements[0] === 'ALTER TABLE `users` RENAME TO `users_new`;',
  'table rename should come first',
);
assert(
  editDesign.ok && editDesign.statements[1].includes('RENAME COLUMN `name` TO `title`'),
  'column rename missing',
);
assert(
  editDesign.ok && editDesign.statements[2].includes('ADD COLUMN `created_at`'),
  'added column missing',
);
assert(
  editDesign.ok && editDesign.statements[3].includes('DROP COLUMN `old_col`'),
  'dropped column missing',
);
assert(
  editDesign.ok && editDesign.statements[4].includes('MODIFY COLUMN `note` VARCHAR(50) NOT NULL'),
  'modified column missing',
);

const sqliteModify = buildTableDesign({
  dialect: 'sqlite',
  mode: 'edit',
  tableName: 'users',
  detail: {
    ...detail,
    columns: detail.columns.map((column) => ({ ...column, declaredType: column.name === 'note' ? 'TEXT' : column.declaredType })),
  },
  columns: [
    { name: 'id', type: 'INTEGER', primaryKey: true, autoIncrement: true, originalName: 'id' },
    { name: 'name', type: 'VARCHAR(10)', originalName: 'name' },
    { name: 'note', type: 'VARCHAR(50)', originalName: 'note' },
    { name: 'old_col', type: 'TEXT', originalName: 'old_col' },
  ],
});
assert(
  sqliteModify.ok,
  `sqlite modify should fall back to rebuild: ${sqliteModify.ok ? '' : sqliteModify.message}`,
);
assert(
  sqliteModify.ok && sqliteModify.sqliteForeignKeysOff,
  'sqlite rebuild must disable foreign keys',
);
assert(
  sqliteModify.ok && sqliteModify.statements[0].includes('CREATE TABLE "__dbcraft_rebuild_users"'),
  'sqlite rebuild create missing',
);

const sqliteAdd = buildTableDesign({
  dialect: 'sqlite',
  mode: 'edit',
  tableName: 'users',
  detail,
  columns: [
    ...detail.columns.map((column) => ({
      name: column.name,
      type: column.declaredType,
      primaryKey: column.primaryKey,
      autoIncrement: column.autoIncrement,
      notNull: column.notNull,
      originalName: column.name,
    })),
    { name: 'age', type: 'INTEGER' },
  ],
});
assert(sqliteAdd.ok, 'sqlite add should use native ALTER');
assert(
  sqliteAdd.ok && sqliteAdd.statements[0] === 'ALTER TABLE "users" ADD COLUMN "age" INTEGER;',
  'sqlite add statement wrong',
);

const designFailures = [
  [
    buildTableDesign({
      dialect: 'sqlite',
      mode: 'edit',
      tableName: 'users',
      detail,
      columns: [{ name: 'name', type: 'VARCHAR(10)', originalName: 'name' }],
    }),
    '主键/自增列不能删除',
  ],
  [
    buildTableDesign({
      dialect: 'sqlite',
      mode: 'edit',
      tableName: 'users',
      detail,
      columns: [
        { name: 'id', type: 'INT', primaryKey: false, originalName: 'id' },
        ...detail.columns.slice(1).map((column) => ({
          name: column.name,
          type: column.declaredType,
          originalName: column.name,
        })),
      ],
    }),
    '主键列不能',
  ],
  [
    buildTableDesign({
      dialect: 'sqlite',
      mode: 'edit',
      tableName: 'users',
      detail,
      columns: detail.columns.map((column) => ({
        name: column.name,
        type: column.declaredType,
        primaryKey: column.primaryKey,
        autoIncrement: column.autoIncrement,
        notNull: column.notNull,
        originalName: column.name,
      })),
    }),
    '没有检测到结构变化',
  ],
];

// MSSQL：schema + IDENTITY + 常用 ALTER
const mssqlCreate = buildCreateTable('mssql', {
  schema: 'sales',
  name: 'orders',
  columns: [
    { name: 'id', type: 'INT', primaryKey: true, autoIncrement: true },
    { name: 'no', type: 'NVARCHAR(64)', notNull: true },
    { name: 'flag', type: 'BIT', defaultValue: '0' },
  ],
});
expectSql(
  mssqlCreate,
  'CREATE TABLE [sales].[orders] (\n' +
    '  [id] INT IDENTITY(1,1) NOT NULL PRIMARY KEY,\n' +
    '  [no] NVARCHAR(64) NOT NULL,\n' +
    '  [flag] BIT DEFAULT 0\n' +
    ');',
);
expectSql(
  buildAddColumn('mssql', 'sales.orders', { name: 'note', type: 'NVARCHAR(200)' }),
  'ALTER TABLE [sales].[orders] ADD [note] NVARCHAR(200);',
);
expectSql(
  buildDropColumn('mssql', 'sales.orders', 'note'),
  'ALTER TABLE [sales].[orders] DROP COLUMN [note];',
);
expectSql(
  buildRenameColumn('mssql', 'sales.orders', 'no', 'order_no'),
  "EXEC sp_rename N'sales.orders.no', N'order_no', N'COLUMN';",
);
expectSql(
  buildRenameTable('mssql', 'sales.orders', 'orders_new'),
  "EXEC sp_rename N'sales.orders', N'orders_new';",
);
expectSql(
  buildModifyColumn('mssql', 'sales.orders', 'no', {
    name: 'no',
    type: 'NVARCHAR(128)',
    notNull: true,
  }),
  'ALTER TABLE [sales].[orders] ALTER COLUMN [no] NVARCHAR(128) NOT NULL;',
);
expectSql(
  buildCreateIndex('mssql', 'sales.orders', ['no']),
  'CREATE INDEX [idx_sales_orders_no] ON [sales].[orders] ([no]);',
);
expectSql(
  buildDropIndex('mssql', 'idx_sales_orders_no', 'sales.orders'),
  'DROP INDEX [idx_sales_orders_no] ON [sales].[orders];',
);
expectSql(
  buildDropObject('mssql', 'sales.orders', 'table'),
  'DROP TABLE [sales].[orders];',
);
expectSql(
  buildCreateView('mssql', 'sales.active_orders', 'SELECT * FROM sales.orders'),
  'CREATE VIEW [sales].[active_orders] AS\nSELECT * FROM sales.orders;',
);

const mssqlDesign = buildTableDesign({
  dialect: 'mssql',
  mode: 'create',
  tableName: 'orders',
  schema: 'sales',
  columns: [
    { name: 'id', type: 'INT', primaryKey: true, autoIncrement: true },
    { name: 'no', type: 'NVARCHAR(64)', notNull: true },
  ],
});
assert(
  mssqlDesign.ok,
  `MSSQL table design should create schema-qualified table: ${mssqlDesign.ok ? '' : mssqlDesign.message}`,
);
assert(
  mssqlDesign.ok && mssqlDesign.statements[0].includes('[sales].[orders]'),
  'MSSQL design schema missing',
);
assert(
  mssqlDesign.ok && mssqlDesign.statements[0].includes('IDENTITY(1,1)'),
  'MSSQL design identity missing',
);

const mssqlDefaultChange = buildTableDesign({
  dialect: 'mssql',
  mode: 'edit',
  tableName: 'orders',
  schema: 'sales',
  detail: {
    ...detail,
    name: 'sales.orders',
    columns: [
      {
        ...detail.columns[0],
        name: 'id',
        declaredType: 'INT',
        primaryKey: true,
        autoIncrement: true,
      },
      { ...detail.columns[1], name: 'no', declaredType: 'NVARCHAR(64)', defaultValue: "'x'" },
    ],
  },
  columns: [
    {
      name: 'id',
      type: 'INT',
      primaryKey: true,
      autoIncrement: true,
      originalName: 'id',
    },
    {
      name: 'no',
      type: 'NVARCHAR(64)',
      defaultValue: "'y'",
      originalName: 'no',
    },
  ],
});
assert(!mssqlDefaultChange.ok, 'MSSQL default value change should be rejected');
assert(
  mssqlDefaultChange.message.includes('默认值'),
  'MSSQL default change message missing',
);

for (const [result, expected] of designFailures) {
  assert(!result.ok, `expected table-design failure containing "${expected}"`);
  assert(
    result.message.includes(expected),
    `message "${result.message}" does not include "${expected}"`,
  );
}

console.log('ddl table design check passed');

// COLUMN ORDER
const orderDetail = {
  ...detail,
  primaryKey: [],
  columns: detail.columns
    .filter((column) => column.name !== 'id')
    .map((column) => ({ ...column, primaryKey: false, autoIncrement: false })),
};
const mysqlOrder = buildTableDesign({
  dialect: 'mysql',
  mode: 'edit',
  tableName: 'users',
  detail: orderDetail,
  columns: [
    { name: 'note', type: 'TEXT', originalName: 'note' },
    { name: 'name', type: 'VARCHAR(10)', originalName: 'name' },
    { name: 'old_col', type: 'TEXT', originalName: 'old_col' },
  ],
});
assert(mysqlOrder.ok, `mysql order change failed: ${mysqlOrder.ok ? '' : mysqlOrder.message}`);
assert(
  mysqlOrder.ok && mysqlOrder.statements[0].includes('MODIFY COLUMN `note` TEXT FIRST'),
  'mysql first column reorder missing',
);
assert(
  mysqlOrder.ok && mysqlOrder.statements[1].includes('AFTER `note`'),
  'mysql reorder AFTER missing',
);

const sqliteOrder = buildTableDesign({
  dialect: 'sqlite',
  mode: 'edit',
  tableName: 'users',
  detail: orderDetail,
  columns: [
    { name: 'note', type: 'TEXT', originalName: 'note' },
    { name: 'name', type: 'VARCHAR(10)', originalName: 'name' },
    { name: 'old_col', type: 'TEXT', originalName: 'old_col' },
  ],
});
assert(sqliteOrder.ok, 'sqlite order change failed');
assert(
  sqliteOrder.ok && sqliteOrder.statements[0].includes('"note" TEXT') &&
    sqliteOrder.statements[0].indexOf('"note"') < sqliteOrder.statements[0].indexOf('"name"'),
  'sqlite column order not applied',
);
