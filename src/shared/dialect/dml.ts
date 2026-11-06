import type {
  DatabaseType,
  QueryCell,
  TableEdit,
  TableMeta,
} from '../ipc-contract';
import { quoteIdent } from './identifiers.ts';

/** 一条参数化语句；参数顺序与 SQL 中的占位符一致。 */
export interface BuiltStatement {
  sql: string;
  params: QueryCell[];
}

function placeholder(type: DatabaseType, index: number): string {
  return type === 'mssql' ? `@p${index + 1}` : '?';
}

/** 乐观锁比较：SQLite 用 IS，MySQL 系用 NULL 安全等于，MSSQL 展开。 */
function sameValue(type: DatabaseType, column: string, placeholderText: string): string {
  const quoted = quoteIdent(type, column);
  switch (type) {
    case 'mysql':
    case 'percona':
    case 'mariadb':
      return `${quoted} <=> ${placeholderText}`;
    case 'mssql':
      return `(${quoted} = ${placeholderText} OR (${quoted} IS NULL AND ${placeholderText} IS NULL))`;
    case 'sqlite':
    default:
      return `${quoted} IS ${placeholderText}`;
  }
}

function requirePlainObject(
  value: Record<string, QueryCell> | undefined,
  label: string,
): Record<string, QueryCell> {
  if (!value || Object.keys(value).length === 0) {
    throw new Error(`${label}不能为空。`);
  }
  return value;
}

function assertKnownColumns(meta: TableMeta, columns: string[], label: string): void {
  const known = new Set(meta.columns.map((column) => column.name));
  for (const name of columns) {
    if (!known.has(name)) {
      throw new Error(`${label}包含未知列「${name}」。`);
    }
  }
}

function assertPrimaryKey(meta: TableMeta, keys: Record<string, QueryCell>): void {
  if (meta.primaryKey.length === 0) {
    throw new Error('表没有主键，无法安全地定位要修改的行。');
  }
  for (const name of meta.primaryKey) {
    if (!(name in keys)) {
      throw new Error(`缺少主键列「${name}」，无法定位要修改的行。`);
    }
  }
}

export function buildUpdateStatement(
  type: DatabaseType,
  table: string,
  meta: TableMeta,
  edit: TableEdit,
): BuiltStatement {
  const values = requirePlainObject(edit.values, '更新值');
  const keys = requirePlainObject(edit.keys, '主键');
  const original = requirePlainObject(edit.original, '原始值');

  const valueColumns = Object.keys(values);
  const keyColumns = Object.keys(keys);
  const originalColumns = Object.keys(original);

  assertKnownColumns(meta, [...valueColumns, ...keyColumns, ...originalColumns], '更新');
  assertPrimaryKey(meta, keys);

  const readOnly = new Set(
    meta.columns.filter((column) => column.readOnly).map((column) => column.name),
  );
  for (const name of valueColumns) {
    if (readOnly.has(name)) {
      throw new Error(`列「${name}」不可编辑（主键或生成列）。`);
    }
  }
  for (const name of originalColumns) {
    if (!(name in values)) {
      throw new Error(`原始值列「${name}」不在本次更新范围内。`);
    }
  }

  const params: QueryCell[] = [];
  const assignments = valueColumns.map((name) => {
    params.push(values[name] ?? null);
    return `${quoteIdent(type, name)} = ${placeholder(type, params.length - 1)}`;
  });

  const conditions = keyColumns.map((name) => {
    params.push(keys[name] ?? null);
    return `${quoteIdent(type, name)} = ${placeholder(type, params.length - 1)}`;
  });

  for (const name of originalColumns) {
    params.push(original[name] ?? null);
    const index = params.length - 1;
    conditions.push(sameValue(type, name, placeholder(type, index)));
  }

  return {
    sql: `UPDATE ${quoteIdent(type, table)} SET ${assignments.join(', ')} WHERE ${conditions.join(' AND ')}`,
    params,
  };
}

export function buildDeleteStatement(
  type: DatabaseType,
  table: string,
  meta: TableMeta,
  edit: TableEdit,
): BuiltStatement {
  const keys = requirePlainObject(edit.keys, '主键');
  assertKnownColumns(meta, Object.keys(keys), '删除');
  assertPrimaryKey(meta, keys);

  const params: QueryCell[] = [];
  const conditions = Object.keys(keys).map((name) => {
    params.push(keys[name] ?? null);
    return `${quoteIdent(type, name)} = ${placeholder(type, params.length - 1)}`;
  });

  return {
    sql: `DELETE FROM ${quoteIdent(type, table)} WHERE ${conditions.join(' AND ')}`,
    params,
  };
}

export function buildInsertStatement(
  type: DatabaseType,
  table: string,
  meta: TableMeta,
  edit: TableEdit,
): BuiltStatement {
  const values = edit.values ?? {};
  const columns = Object.keys(values);
  assertKnownColumns(meta, columns, '新增');

  const readOnly = new Set(
    meta.columns.filter((column) => column.readOnly).map((column) => column.name),
  );
  for (const name of columns) {
    if (readOnly.has(name)) {
      throw new Error(`列「${name}」不可编辑（主键或生成列）。`);
    }
  }

  if (columns.length === 0) {
    const sql =
      type === 'sqlite'
        ? `INSERT INTO ${quoteIdent(type, table)} DEFAULT VALUES`
        : `INSERT INTO ${quoteIdent(type, table)} () VALUES ()`;
    return { sql, params: [] };
  }

  const params = columns.map((name) => values[name] ?? null);
  const placeholders = columns.map((_name, index) => placeholder(type, index));

  return {
    sql: `INSERT INTO ${quoteIdent(type, table)} (${columns
      .map((name) => quoteIdent(type, name))
      .join(', ')}) VALUES (${placeholders.join(', ')})`,
    params,
  };
}

/**
 * 把 UI 的待提交编辑编译成参数化语句。
 * 只接受元数据库里真实存在的列，避免把渲染层传来的列名拼进 SQL。
 */
export function buildTableEditStatements(
  type: DatabaseType,
  table: string,
  meta: TableMeta,
  edits: TableEdit[],
): BuiltStatement[] {
  if (table !== meta.name) {
    throw new Error('表名与元数据不一致，请刷新后重试。');
  }

  return edits.map((edit, index) => {
    try {
      switch (edit.kind) {
        case 'update':
          return buildUpdateStatement(type, table, meta, edit);
        case 'delete':
          return buildDeleteStatement(type, table, meta, edit);
        case 'insert':
          return buildInsertStatement(type, table, meta, edit);
        default:
          throw new Error(`未知的编辑类型「${String((edit as { kind?: unknown }).kind)}」。`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`第 ${index + 1} 项编辑无效：${message}`);
    }
  });
}
