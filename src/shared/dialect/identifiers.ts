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
      // MSSQL 对象名可能是 `schema.table`；逐段引用，避免整段被当成一个标识符。
      return name
        .split('.')
        .map((part) => `[${part.replace(/]/g, ']]')}]`)
        .join('.');
    case 'sqlite':
    default:
      return `"${name.replace(/"/g, '""')}"`;
  }
}

/** MSSQL 的 N 字符串字面量；Agent 脚本与存储过程调用使用。 */
export function sqlNString(value: string): string {
  return `N'${value.replace(/'/g, "''")}'`;
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

/** 单列排序与多列排序共用；数组顺序就是 ORDER BY 的优先级。 */
export function normalizeTableSorts(sort?: TableSort | TableSort[] | null): TableSort[] {
  if (!sort) return [];
  const list = Array.isArray(sort) ? sort : [sort];
  return list
    .filter((item) => item && item.column)
    .map((item) => ({ column: item.column, direction: item.direction === 'desc' ? 'desc' : 'asc' }));
}

/** 表数据页查询：分页 + 服务端多列排序 + 服务端 LIKE 过滤（参数化）。 */
export function buildTablePageQuery(
  type: DatabaseType,
  name: string,
  limit: number,
  offset: number,
  sort?: TableSort | TableSort[] | null,
  filter?: TableFilter | null,
): TablePageQuery {
  const target = quoteIdent(type, name);
  const params: QueryCell[] = [];
  let where = '';

  if (filter?.column && filter.value !== '') {
    const placeholder = type === 'mssql' ? '@p1' : '?';
    where = ` WHERE ${quoteIdent(type, filter.column)} LIKE ${placeholder} ESCAPE '!'`;
    params.push(`%${escapeLikeValue(filter.value)}%`);
  }

  const sorts = normalizeTableSorts(sort);
  const order = sorts.length
    ? ` ORDER BY ${sorts
        .map(
          (item) =>
            `${quoteIdent(type, item.column)} ${item.direction === 'desc' ? 'DESC' : 'ASC'}`,
        )
        .join(', ')}`
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
  sort?: TableSort | TableSort[] | null,
  filter?: TableFilter | null,
): string {
  return buildTablePageQuery(type, name, limit, offset, sort, filter).sql;
}
