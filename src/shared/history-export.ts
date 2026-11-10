import type { HistoryRecord } from './ipc-contract';
import { toCsv } from './export/formats.ts';

function header(record: HistoryRecord): string {
  const parts = [
    record.lastExecutedAt,
    record.dialect,
    record.connectionName || '(unknown)',
    record.databaseName || '(none)',
    record.status,
    record.source,
  ];
  return `-- ${parts.join(' · ')}`;
}

/** 历史导出为 .sql：每条记录带一行来源注释，SQL 原文保持不变。 */
export function historyToSql(records: HistoryRecord[]): string {
  return records
    .map((record) => `${header(record)}\n${record.sqlText.trim()}\n`)
    .join('\n');
}

/** 历史导出为 CSV：包含元数据列与完整 SQL 文本。 */
export function historyToCsv(records: HistoryRecord[]): string {
  const columns = [
    { name: 'executedAt', declaredType: 'TEXT' },
    { name: 'dialect', declaredType: 'TEXT' },
    { name: 'connection', declaredType: 'TEXT' },
    { name: 'database', declaredType: 'TEXT' },
    { name: 'status', declaredType: 'TEXT' },
    { name: 'source', declaredType: 'TEXT' },
    { name: 'durationMs', declaredType: 'INTEGER' },
    { name: 'affectedRows', declaredType: 'INTEGER' },
    { name: 'returnedRows', declaredType: 'INTEGER' },
    { name: 'execCount', declaredType: 'INTEGER' },
    { name: 'sqlText', declaredType: 'TEXT' },
  ];
  const rows = records.map((record) => [
    record.lastExecutedAt,
    record.dialect,
    record.connectionName,
    record.databaseName,
    record.status,
    record.source,
    record.durationMs,
    record.affectedRows,
    record.returnedRows,
    record.execCount,
    record.sqlText,
  ]);
  return toCsv(columns, rows, { nullMarker: '' });
}
