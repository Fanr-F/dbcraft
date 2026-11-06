import type { DatabaseType, QueryCell } from '../ipc-contract';

/**
 * 按数据库方言引用标识符。
 * 这里是 Dialect 抽象落地前的第一块：先保证 UI 生成的 SQL 不再用错引号。
 */
export function quoteIdent(type: DatabaseType, name: string): string {
  switch (type) {
    case 'mysql':
    case 'percona':
    case 'mariadb':
      return `\`${name.replace(/`/g, '``')}\``;
    case 'mssql':
      return `[${name.replace(/]/g, ']]')}]`;
    case 'sqlite':
    default:
      return `"${name.replace(/"/g, '""')}"`;
  }
}

/** 对象树点击后填入的预览查询：方言感知的标识符与分页语法。 */
export function buildTablePreviewSql(type: DatabaseType, name: string, limit = 100): string {
  const target = quoteIdent(type, name);
  if (type === 'mssql') {
    return `SELECT TOP (${limit}) * FROM ${target};`;
  }
  return `SELECT * FROM ${target} LIMIT ${limit};`;
}

export interface TableSort {
  column: string;
  direction: 'asc' | 'desc';
}

export interface TableFilter {
  column: string;
  value: string;
}

/** LIKE 通配符转义；用 `!` 而不是反斜杠，避免 MySQL 字符串字面量再转义一层。 */
export function escapeLikeValue(value: string): string {
  return value.replace(/[!%_]/g, '!$&');
}

export interface TablePageQuery {
  sql: string;
  params: QueryCell[];
}

/** 表数据页查询：分页 + 服务端排序 + 服务端 LIKE 过滤（参数化）。 */
export function buildTablePageQuery(
  type: DatabaseType,
  name: string,
  limit: number,
  offset: number,
  sort?: TableSort | null,
  filter?: TableFilter | null,
): TablePageQuery {
  const target = quoteIdent(type, name);
  const params: QueryCell[] = [];
  let where = '';

  if (filter?.column && filter.value !== '') {
    where = ` WHERE ${quoteIdent(type, filter.column)} LIKE ? ESCAPE '!'`;
    params.push(`%${escapeLikeValue(filter.value)}%`);
  }

  const order = sort?.column
    ? ` ORDER BY ${quoteIdent(type, sort.column)} ${sort.direction === 'desc' ? 'DESC' : 'ASC'}`
    : '';

  if (type === 'mssql') {
    const mssqlOrder = order || ' ORDER BY (SELECT NULL)';
    return {
      sql: `SELECT * FROM ${target}${where}${mssqlOrder} OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY;`,
      params,
    };
  }

  return {
    sql: `SELECT * FROM ${target}${where}${order} LIMIT ${limit} OFFSET ${offset};`,
    params,
  };
}

/** 表数据页的显式分页查询。 */
export function buildTablePageSql(
  type: DatabaseType,
  name: string,
  limit: number,
  offset: number,
  sort?: TableSort | null,
  filter?: TableFilter | null,
): string {
  return buildTablePageQuery(type, name, limit, offset, sort, filter).sql;
}
