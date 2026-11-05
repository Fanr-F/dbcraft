import type { DatabaseType } from '../ipc-contract';

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
