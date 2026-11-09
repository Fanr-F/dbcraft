import type { DatabaseType, QueryCell, QueryColumn } from '../ipc-contract';
import { quoteIdent } from '../dialect/identifiers.ts';

const BOM = '\uFEFF';

export interface CsvOptions {
  /** 默认逗号；可选 `;`、Tab 等。 */
  delimiter?: string;
  /** 是否输出表头，默认 true。 */
  header?: boolean;
  /** NULL 的输出文本；默认空字符串，可选 `\\N`。 */
  nullMarker?: string;
}

function csvCell(value: QueryCell, delimiter: string): string {
  const text = value === null ? '' : String(value);
  if (text.includes(delimiter) || /["\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

/** CSV：UTF-8 BOM、默认逗号分隔、CRLF、双引号转义；NULL 默认输出空字段。 */
export function toCsv(
  columns: QueryColumn[],
  rows: QueryCell[][],
  options: CsvOptions = {},
): string {
  const delimiter = options.delimiter ?? ',';
  const header = options.header !== false;
  const nullMarker = options.nullMarker ?? '';
  const lines: string[] = [];
  if (header) {
    lines.push(columns.map((column) => csvCell(column.name, delimiter)).join(delimiter));
  }

  for (const row of rows) {
    lines.push(
      columns
        .map((_, index) => {
          const value = row[index] ?? null;
          return csvCell(value === null ? nullMarker : value, delimiter);
        })
        .join(delimiter),
    );
  }

  return `${BOM}${lines.join('\r\n')}${lines.length > 0 ? '\r\n' : ''}`;
}

/** JSON：列名做键，保留 `null` 与空串的区别。 */
export function toJson(columns: QueryColumn[], rows: QueryCell[][]): string {
  const records = rows.map((row) => {
    const record: Record<string, QueryCell> = {};
    columns.forEach((column, index) => {
      record[column.name] = row[index] ?? null;
    });
    return record;
  });

  return `${JSON.stringify(records, null, 2)}\n`;
}

function sqlValue(value: QueryCell, dialect: DatabaseType): string {
  if (value === null) return 'NULL';
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : 'NULL';
  }
  if (typeof value === 'boolean') {
    if (dialect === 'mssql') return value ? '1' : '0';
    return value ? 'TRUE' : 'FALSE';
  }

  const text = String(value).replace(/'/g, "''");
  return dialect === 'mssql' ? `N'${text}'` : `'${text}'`;
}

/** SQL Insert：按方言引用标识符与字符串，NULL 原样输出。 */
export function toSqlInsert(
  dialect: DatabaseType,
  tableName: string,
  columns: QueryColumn[],
  rows: QueryCell[][],
): string {
  const table = quoteIdent(dialect, tableName.trim());
  const columnList = columns.map((column) => quoteIdent(dialect, column.name)).join(', ');

  const statements = rows.map((row) => {
    const values = columns
      .map((_, index) => sqlValue(row[index] ?? null, dialect))
      .join(', ');
    return `INSERT INTO ${table} (${columnList}) VALUES (${values});`;
  });

  return statements.length > 0 ? `${statements.join('\n')}\n` : '';
}
