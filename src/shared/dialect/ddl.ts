import type { DatabaseType, DdlColumnDefinition, DdlTableDefinition } from '../ipc-contract';
import { quoteIdent } from './identifiers.ts';

export type DdlGenerateResult =
  | { ok: true; sql: string; warnings: string[] }
  | { ok: false; message: string; warnings: string[] };

/** 校验并生成单条 CREATE TABLE。 */
export function buildCreateTable(
  dialect: DatabaseType,
  definition: DdlTableDefinition,
): DdlGenerateResult {
  const warnings: string[] = [];

  const tableName = definition.name.trim();
  if (!tableName) {
    return { ok: false, message: '表名不能为空。', warnings };
  }

  if (definition.columns.length === 0) {
    return { ok: false, message: '至少需要一列。', warnings };
  }

  const names = new Set<string>();
  for (const column of definition.columns) {
    const name = column.name.trim();
    if (!name) {
      return { ok: false, message: '列名不能为空。', warnings };
    }
    const key = name.toLowerCase();
    if (names.has(key)) {
      return { ok: false, message: `列名重复：${name}。`, warnings };
    }
    names.add(key);

    if (!column.type.trim()) {
      return { ok: false, message: `列「${name}」缺少类型。`, warnings };
    }
  }

  const primaryKeys = definition.columns.filter((column) => column.primaryKey);
  if (primaryKeys.length > 1) {
    return { ok: false, message: '当前仅支持单列主键。', warnings };
  }

  const autoColumns = definition.columns.filter((column) => column.autoIncrement);
  if (autoColumns.length > 1) {
    return { ok: false, message: '自增列只能有一个。', warnings };
  }

  if (autoColumns.length === 1) {
    const column = autoColumns[0];
    if (dialect === 'mssql') {
      if (!isMssqlIdentityType(column.type)) {
        return {
          ok: false,
          message: 'MSSQL 的 IDENTITY 列必须是整数类型（tinyint/smallint/int/bigint）。',
          warnings,
        };
      }
    } else {
      if (!column.primaryKey) {
        return { ok: false, message: '自增列必须同时设为主键。', warnings };
      }
      if (dialect === 'sqlite' && column.type.trim().toUpperCase() !== 'INTEGER') {
        return {
          ok: false,
          message: 'SQLite 的自增列类型必须是 INTEGER。',
          warnings,
        };
      }
    }
  }

  if (primaryKeys.length === 0) {
    warnings.push('该表没有主键；数据网格将默认只读，只能通过 SQL 修改。');
  }

  const lines = definition.columns.map((column) => `  ${renderColumn(dialect, column)}`);
  const target =
    dialect === 'mssql'
      ? quoteIdent('mssql', qualifyMssqlName(tableName, definition.schema))
      : quoteIdent(dialect, tableName);

  const sql = `CREATE TABLE ${target} (\n${lines.join(',\n')}\n);`;
  return { ok: true, sql, warnings };
}

/** MSSQL 的对象名以 schema 或已限定的 `schema.table` 形式传入。 */
function qualifyMssqlName(name: string, schema?: string): string {
  const trimmed = name.trim();
  if (schema?.trim()) return `${schema.trim()}.${trimmed}`;
  return trimmed;
}

function isMssqlIdentityType(type: string): boolean {
  return /^(tinyint|smallint|int|bigint)\b/i.test(type.trim());
}

function mssqlMultipart(name: string): { schema: string; object: string } {
  const trimmed = name.trim();
  const index = trimmed.indexOf('.');
  if (index > 0) {
    return { schema: trimmed.slice(0, index), object: trimmed.slice(index + 1) };
  }
  return { schema: 'dbo', object: trimmed };
}

function mssqlStringLiteral(value: string): string {
  return `N'${value.replace(/'/g, "''")}'`;
}

function renderColumn(dialect: DatabaseType, column: DdlColumnDefinition): string {
  const columnName = quoteIdent(dialect, column.name.trim());
  const type = column.type.trim();

  if (column.autoIncrement) {
    if (dialect === 'sqlite') {
      return `${columnName} INTEGER PRIMARY KEY AUTOINCREMENT`;
    }
    if (dialect === 'mssql') {
      const parts = [`${columnName} ${type} IDENTITY(1,1)`, 'NOT NULL'];
      if (column.primaryKey) parts.push('PRIMARY KEY');
      else if (column.unique) parts.push('UNIQUE');
      return parts.join(' ');
    }
    return `${columnName} ${type} NOT NULL AUTO_INCREMENT PRIMARY KEY`;
  }

  const parts = [columnName, type];
  if (column.primaryKey) {
    parts.push('PRIMARY KEY');
  } else {
    if (column.notNull) parts.push('NOT NULL');
    if (column.unique) parts.push('UNIQUE');
  }

  const defaultValue = column.defaultValue?.trim();
  if (defaultValue) {
    parts.push(`DEFAULT ${defaultValue}`);
  }

  return parts.join(' ');
}

/** ALTER TABLE ... ADD COLUMN；不支持通过该语句添加主键/自增列。 */
export function buildAddColumn(
  dialect: DatabaseType,
  tableName: string,
  column: DdlColumnDefinition,
): DdlGenerateResult {
  const table = requireName(tableName, '表名');
  if (!table.ok) {
    return { ok: false, message: table.message, warnings: [] };
  }

  const name = column.name.trim();
  if (!name) {
    return { ok: false, message: '列名不能为空。', warnings: [] };
  }

  if (!column.type.trim()) {
    return { ok: false, message: `列「${name}」缺少类型。`, warnings: [] };
  }

  if (column.primaryKey || column.autoIncrement) {
    return {
      ok: false,
      message: 'ADD COLUMN 不支持主键/自增；请在建表时定义，或重建表。',
      warnings: [],
    };
  }

  const warnings: string[] = [];
  if (column.notNull && !column.defaultValue?.trim()) {
    warnings.push('非空列没有默认值：已有数据的表会拒绝添加。');
  }

  return {
    ok: true,
    sql:
      dialect === 'mssql'
        ? `ALTER TABLE ${quoteIdent('mssql', table.name)} ADD ${renderColumn(dialect, column)};`
        : `ALTER TABLE ${quoteIdent(dialect, table.name)} ADD COLUMN ${renderColumn(dialect, column)};`,
    warnings,
  };
}

function requireName(
  value: string,
  label: string,
): { ok: true; name: string } | { ok: false; message: string } {
  const name = value.trim();
  return name.length > 0
    ? { ok: true, name }
    : { ok: false, message: `${label}不能为空。` };
}

/** DROP TABLE / DROP VIEW。 */
export function buildDropObject(
  dialect: DatabaseType,
  name: string,
  kind: 'table' | 'view',
): DdlGenerateResult {
  const target = requireName(name, kind === 'view' ? '视图名' : '表名');
  if (!target.ok) {
    return { ok: false, message: target.message, warnings: [] };
  }

  const keyword = kind === 'view' ? 'DROP VIEW' : 'DROP TABLE';
  return {
    ok: true,
    sql: `${keyword} ${quoteIdent(dialect, target.name)};`,
    warnings: [`删除${kind === 'view' ? '视图' : '表'}不可撤销。`],
  };
}

/** 重命名表（SQLite / MySQL 系都支持 ALTER TABLE ... RENAME TO）。 */
export function buildRenameTable(
  dialect: DatabaseType,
  oldName: string,
  newName: string,
): DdlGenerateResult {
  const from = requireName(oldName, '原表名');
  if (!from.ok) {
    return { ok: false, message: from.message, warnings: [] };
  }

  const to = requireName(newName, '新表名');
  if (!to.ok) {
    return { ok: false, message: to.message, warnings: [] };
  }

  if (from.name === to.name) {
    return { ok: false, message: '新旧表名相同。', warnings: [] };
  }

  if (dialect === 'mssql') {
    if (to.name.includes('.')) {
      return {
        ok: false,
        message: 'MSSQL 重命名表只接受新表名；跨 schema 移动请使用 SQL 编辑器。',
        warnings: [],
      };
    }
    const current = mssqlMultipart(from.name);
    return {
      ok: true,
      sql: `EXEC sp_rename ${mssqlStringLiteral(
        `${current.schema}.${current.object}`,
      )}, ${mssqlStringLiteral(to.name)};`,
      warnings: [],
    };
  }

  return {
    ok: true,
    sql: `ALTER TABLE ${quoteIdent(dialect, from.name)} RENAME TO ${quoteIdent(dialect, to.name)};`,
    warnings: [],
  };
}

function defaultIndexName(table: string, columns: string[]): string {
  const base = `idx_${table}_${columns.join('_')}`
    .replace(/[^\w]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return (base || 'idx_index').slice(0, 60);
}

export function buildCreateIndex(
  dialect: DatabaseType,
  tableName: string,
  columns: string[],
  options: { name?: string; unique?: boolean } = {},
): DdlGenerateResult {
  const table = requireName(tableName, '表名');
  if (!table.ok) {
    return { ok: false, message: table.message, warnings: [] };
  }

  const normalized = columns.map((column) => column.trim()).filter(Boolean);
  if (normalized.length === 0) {
    return { ok: false, message: '至少需要一列。', warnings: [] };
  }

  const indexName = options.name?.trim() || defaultIndexName(table.name, normalized);
  const unique = options.unique ? 'UNIQUE ' : '';
  const columnList = normalized.map((column) => quoteIdent(dialect, column)).join(', ');

  return {
    ok: true,
    sql: `CREATE ${unique}INDEX ${quoteIdent(dialect, indexName)} ON ${quoteIdent(dialect, table.name)} (${columnList});`,
    warnings: [],
  };
}

export function buildDropIndex(  dialect: DatabaseType,
  indexName: string,
  tableName?: string,
): DdlGenerateResult {
  const index = requireName(indexName, '索引名');
  if (!index.ok) {
    return { ok: false, message: index.message, warnings: [] };
  }

  if (dialect === 'sqlite') {
    return { ok: true, sql: `DROP INDEX ${quoteIdent(dialect, index.name)};`, warnings: [] };
  }

  const table = requireName(tableName ?? '', '表名');
  if (!table.ok) {
    return {
      ok: false,
      message: `${dialect === 'mssql' ? 'MSSQL' : 'MySQL 系'}删除索引需要表名。`,
      warnings: [],
    };
  }

  return {
    ok: true,
    sql: `DROP INDEX ${quoteIdent(dialect, index.name)} ON ${quoteIdent(dialect, table.name)};`,
    warnings: [],
  };
}

/** ALTER TABLE ... COMMENT；仅 MySQL 系支持表注释。 */
export function buildTableComment(
  dialect: DatabaseType,
  tableName: string,
  comment: string,
): DdlGenerateResult {
  if (dialect === 'mssql') {
    return {
      ok: false,
      message: 'MSSQL 表注释使用扩展属性（MS_Description），暂不支持 UI 编辑。',
      warnings: [],
    };
  }
  if (dialect === 'sqlite') {
    return {
      ok: false,
      message: 'SQLite 不支持表注释。',
      warnings: [],
    };
  }

  const table = requireName(tableName, '表名');
  if (!table.ok) {
    return { ok: false, message: table.message, warnings: [] };
  }

  const escaped = comment.replace(/\\/g, '\\\\').replace(/'/g, "''");
  return {
    ok: true,
    sql: `ALTER TABLE ${quoteIdent(dialect, table.name)} COMMENT = '${escaped}';`,
    warnings: [],
  };
}

/** CREATE VIEW ... AS SELECT；只接受 SELECT / WITH 开头的定义。 */
export function buildCreateView(
  dialect: DatabaseType,
  viewName: string,
  selectSql: string,
): DdlGenerateResult {
  const view = requireName(viewName, '视图名');
  if (!view.ok) {
    return { ok: false, message: view.message, warnings: [] };
  }

  const query = selectSql.trim().replace(/;+\s*$/, '');
  if (!query) {
    return { ok: false, message: '视图定义不能为空。', warnings: [] };
  }
  if (!/^(?:select|with)\b/i.test(query)) {
    return { ok: false, message: '视图定义必须以 SELECT 或 WITH 开头。', warnings: [] };
  }

  return {
    ok: true,
    sql: `CREATE VIEW ${quoteIdent(dialect, view.name)} AS\n${query};`,
    warnings: ['创建视图不会执行查询；请确认引用的表/列存在。'],
  };
}

/** ALTER TABLE ... DROP COLUMN；SQLite 需要 3.35+。 */
export function buildDropColumn(
  dialect: DatabaseType,
  tableName: string,
  columnName: string,
): DdlGenerateResult {
  const table = requireName(tableName, '表名');
  if (!table.ok) {
    return { ok: false, message: table.message, warnings: [] };
  }

  const column = requireName(columnName, '列名');
  if (!column.ok) {
    return { ok: false, message: column.message, warnings: [] };
  }

  const warnings =
    dialect === 'sqlite'
      ? ['SQLite 需要 3.35+；低版本请重建表。删除列不可撤销。']
      : dialect === 'mssql'
        ? ['删除列不可撤销；如有默认约束、索引、CHECK 或外键依赖，需先删除依赖。']
        : ['删除列不可撤销。'];

  return {
    ok: true,
    sql: `ALTER TABLE ${quoteIdent(dialect, table.name)} DROP COLUMN ${quoteIdent(dialect, column.name)};`,
    warnings,
  };
}

/** ALTER TABLE ... RENAME COLUMN；SQLite 3.25+ / MySQL 8.0+ / MariaDB 10.5+。 */
export function buildRenameColumn(
  dialect: DatabaseType,
  tableName: string,
  oldName: string,
  newName: string,
): DdlGenerateResult {
  const table = requireName(tableName, '表名');
  if (!table.ok) {
    return { ok: false, message: table.message, warnings: [] };
  }

  const from = requireName(oldName, '原列名');
  if (!from.ok) {
    return { ok: false, message: from.message, warnings: [] };
  }

  const to = requireName(newName, '新列名');
  if (!to.ok) {
    return { ok: false, message: to.message, warnings: [] };
  }

  if (from.name === to.name) {
    return { ok: false, message: '新旧列名相同。', warnings: [] };
  }

  if (dialect === 'mssql') {
    if (to.name.includes('.')) {
      return { ok: false, message: 'MSSQL 新列名不能包含 schema。', warnings: [] };
    }
    return {
      ok: true,
      sql: `EXEC sp_rename ${mssqlStringLiteral(
        `${table.name}.${from.name}`,
      )}, ${mssqlStringLiteral(to.name)}, ${mssqlStringLiteral('COLUMN')};`,
      warnings: [],
    };
  }

  const warnings =
    dialect === 'sqlite'
      ? ['SQLite 需要 3.25+。']
      : dialect === 'mariadb'
        ? ['MariaDB 需要 10.5+；10.3/10.4 请使用 CHANGE COLUMN。']
        : [];

  return {
    ok: true,
    sql: `ALTER TABLE ${quoteIdent(dialect, table.name)} RENAME COLUMN ${quoteIdent(
      dialect,
      from.name,
    )} TO ${quoteIdent(dialect, to.name)};`,
    warnings,
  };
}

/**
 * 修改列类型 / 非空 / 默认值。
 * SQLite 不支持 MODIFY COLUMN，必须重建表；这里明确拒绝而不是生成危险 SQL。
 */
export function buildModifyColumn(
  dialect: DatabaseType,
  tableName: string,
  columnName: string,
  column: DdlColumnDefinition,
): DdlGenerateResult {
  if (dialect === 'sqlite') {
    return {
      ok: false,
      message:
        'SQLite 不支持 MODIFY COLUMN。修改类型/默认值/可空需要通过「重建表」完成，当前版本尚未开放该入口。',
      warnings: [],
    };
  }

  const table = requireName(tableName, '表名');
  if (!table.ok) {
    return { ok: false, message: table.message, warnings: [] };
  }

  const name = requireName(columnName, '列名');
  if (!name.ok) {
    return { ok: false, message: name.message, warnings: [] };
  }

  if (!column.type.trim()) {
    return { ok: false, message: `列「${name.name}」缺少类型。`, warnings: [] };
  }

  if (column.primaryKey || column.autoIncrement) {
    return {
      ok: false,
      message: '修改列不处理主键/自增；请使用建表或重建表流程。',
      warnings: [],
    };
  }

  const warnings: string[] = ['修改列会重写该列数据；请确认类型可安全转换。'];
  if (column.notNull) {
    warnings.push('设为非空前，已有 NULL 数据会导致执行失败。');
  }
  if (dialect === 'mariadb') {
    warnings.push('MariaDB 的 MODIFY COLUMN 会保留未写出的属性；请核对生成 SQL。');
  }

  if (dialect === 'mssql') {
    warnings.push('MSSQL 的 ALTER COLUMN 不修改默认值；如需修改默认值请先删除默认约束。');
    return {
      ok: true,
      sql: `ALTER TABLE ${quoteIdent('mssql', table.name)} ALTER COLUMN ${quoteIdent(
        'mssql',
        name.name,
      )} ${column.type.trim()} ${column.notNull ? 'NOT NULL' : 'NULL'};`,
      warnings,
    };
  }

  return {
    ok: true,
    sql: `ALTER TABLE ${quoteIdent(dialect, table.name)} MODIFY COLUMN ${renderColumn(
      dialect,
      { ...column, name: name.name },
    )};`,
    warnings,
  };
}
