import type { SqlDialect } from './types.ts';

/**
 * 按方言引用标识符。
 *
 * - MySQL / MariaDB / Percona：反引号；
 * - MSSQL：方括号，`schema.table` 逐段引用；
 * - SQLite / 其他：双引号。
 */
export function quoteIdentifier(dialect: SqlDialect, name: string): string {
  switch (dialect) {
    case 'mysql':
    case 'percona':
    case 'mariadb':
      return `\`${name.replace(/`/g, '``')}\``;
    case 'mssql':
      return name
        .split('.')
        .map((part) => `[${part.replace(/]/g, ']]')}]`)
        .join('.');
    case 'sqlite':
    default:
      return `"${name.replace(/"/g, '""')}"`;
  }
}
