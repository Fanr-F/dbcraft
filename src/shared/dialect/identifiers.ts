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
  /**
   * 过滤操作符；省略时按旧的「包含」LIKE 处理，兼容已有草稿。
   * `isNull` / `isNotNull` 不需要值。
   */
  operator?: TableFilterOperator;
}

export type TableFilterOperator =
  | 'contains'
  | 'equals'
  | 'notEquals'
  | 'startsWith'
  | 'endsWith'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'isNull'
  | 'isNotNull';

/** LIKE 通配符转义；用 `!` 而不是反斜杠，避免 MySQL 字符串字面量再转义一层。 */
export function escapeLikeValue(value: string): string {
  return value.replace(/[!%_]/g, '!$&');
}

export interface TablePageQuery {
  sql: string;
  params: QueryCell[];
}

export interface TablePageQueryOptions {
  /** SQLite 无主键表：把 rowid 别名一并选出，供乐观锁定位。 */
  rowidAlias?: string;
}

/** 单列排序与多列排序共用；数组顺序就是 ORDER BY 的优先级。 */
export function normalizeTableSorts(sort?: TableSort | TableSort[] | null): TableSort[] {
  if (!sort) return [];
  const list = Array.isArray(sort) ? sort : [sort];
  return list
    .filter((item) => item && item.column)
    .map((item) => ({ column: item.column, direction: item.direction === 'desc' ? 'desc' : 'asc' }));
}

/** 兼容单条件与多条件过滤；多条件之间是 AND。 */
export function normalizeTableFilters(
  filter?: TableFilter | TableFilter[] | null,
): TableFilter[] {
  if (!filter) return [];
  return (Array.isArray(filter) ? filter : [filter]).filter((item) => item && item.column);
}

function filterPlaceholder(type: DatabaseType, index: number): string {
  return type === 'mssql' ? `@p${index + 1}` : '?';
}

/** 单个过滤条件；返回 null 表示该条件无效（例如空值文本过滤）。 */
function buildFilterClause(
  type: DatabaseType,
  filter: TableFilter,
  params: QueryCell[],
): string | null {
  const column = quoteIdent(type, filter.column);
  const operator = filter.operator ?? 'contains';

  if (operator === 'isNull') return `${column} IS NULL`;
  if (operator === 'isNotNull') return `${column} IS NOT NULL`;
  if (filter.value === '') return null;

  const placeholder = filterPlaceholder(type, params.length);
  switch (operator) {
    case 'equals':
      params.push(filter.value);
      return `${column} = ${placeholder}`;
    case 'notEquals':
      params.push(filter.value);
      return `${column} <> ${placeholder}`;
    case 'gt':
      params.push(filter.value);
      return `${column} > ${placeholder}`;
    case 'gte':
      params.push(filter.value);
      return `${column} >= ${placeholder}`;
    case 'lt':
      params.push(filter.value);
      return `${column} < ${placeholder}`;
    case 'lte':
      params.push(filter.value);
      return `${column} <= ${placeholder}`;
    case 'startsWith':
      params.push(`${escapeLikeValue(filter.value)}%`);
      return `${column} LIKE ${placeholder} ESCAPE '!'`;
    case 'endsWith':
      params.push(`%${escapeLikeValue(filter.value)}`);
      return `${column} LIKE ${placeholder} ESCAPE '!'`;
    case 'contains':
    default:
      params.push(`%${escapeLikeValue(filter.value)}%`);
      return `${column} LIKE ${placeholder} ESCAPE '!'`;
  }
}

/** 表数据页查询：分页 + 服务端多列排序 + 服务端多条件过滤（全部参数化）。 */
export function buildTablePageQuery(
  type: DatabaseType,
  name: string,
  limit: number,
  offset: number,
  sort?: TableSort | TableSort[] | null,
  filter?: TableFilter | TableFilter[] | null,
  options?: TablePageQueryOptions,
): TablePageQuery {
  const target = quoteIdent(type, name);
  const selectList =
    type === 'sqlite' && options?.rowidAlias
      ? `${quoteIdent(type, options.rowidAlias)} AS ${quoteIdent(
          type,
          options.rowidAlias,
        )}, *`
      : '*';
  const params: QueryCell[] = [];
  const conditions = normalizeTableFilters(filter)
    .map((item) => buildFilterClause(type, item, params))
    .filter((clause): clause is string => clause !== null);
  const where = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';

  const sorts = normalizeTableSorts(sort);
  const order = sorts.length
    ? ` ORDER BY ${sorts
        .map(
          (item) =>
            `${quoteIdent(type, item.column)} ${item.direction === 'desc' ? 'DESC' : 'ASC'}`,
        )
        .join(', ')}`
    : '';

  // limit <= 0 表示不分页（导出全部）：不拼 LIMIT/OFFSET。
  if (limit <= 0) {
    return {
      sql: `SELECT ${selectList} FROM ${target}${where}${order};`,
      params,
    };
  }

  if (type === 'mssql') {
    const mssqlOrder = order || ' ORDER BY (SELECT NULL)';
    return {
      sql: `SELECT ${selectList} FROM ${target}${where}${mssqlOrder} OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY;`,
      params,
    };
  }

  return {
    sql: `SELECT ${selectList} FROM ${target}${where}${order} LIMIT ${limit} OFFSET ${offset};`,
    params,
  };
}

/** 任意单条 SELECT 的流式分页包装；MSSQL 的 ORDER BY 限制可能导致部分 SQL 失败。 */
export function buildSubqueryPageSql(
  type: DatabaseType,
  sql: string,
  limit: number,
  offset: number,
): string {
  const inner = sql.trim().replace(/;\s*$/, '');
  if (type === 'mssql') {
    return `SELECT * FROM (${inner}) AS [dbcraft_stream] ORDER BY (SELECT NULL) OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY`;
  }
  return `SELECT * FROM (${inner}) AS dbcraft_stream LIMIT ${limit} OFFSET ${offset}`;
}

/** 表数据页的显式分页查询。 */
export function buildTablePageSql(
  type: DatabaseType,
  name: string,
  limit: number,
  offset: number,
  sort?: TableSort | TableSort[] | null,
  filter?: TableFilter | TableFilter[] | null,
  options?: TablePageQueryOptions,
): string {
  return buildTablePageQuery(type, name, limit, offset, sort, filter, options).sql;
}
