import type Database from 'better-sqlite3';
import type {
  DatabaseType,
  HistoryListOptions,
  HistoryRecord,
  QuerySource,
  QueryStatus,
} from '../../shared/ipc-contract';

const DIALECTS = new Set(['sqlite', 'mysql', 'percona', 'mariadb', 'mssql']);
const STATUSES = new Set(['success', 'failed', 'cancelled', 'saved']);
const SOURCES = new Set([
  'editor',
  'ddl-preview',
  'grid-edit',
  'agent-control',
  'table-page',
  'export',
  'closed-tab',
]);

type DB = Database.Database;

export const HISTORY_SCHEMA = `
  CREATE TABLE IF NOT EXISTS history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sql_text TEXT NOT NULL,
    dialect TEXT NOT NULL,
    connection_id TEXT NOT NULL,
    connection_name TEXT NOT NULL,
    database_name TEXT NOT NULL,
    status TEXT NOT NULL,
    error_message TEXT,
    duration_ms INTEGER NOT NULL,
    affected_rows INTEGER,
    returned_rows INTEGER,
    source TEXT NOT NULL,
    exec_count INTEGER NOT NULL DEFAULT 1,
    last_executed_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_history_last_executed ON history(last_executed_at DESC);
  CREATE INDEX IF NOT EXISTS idx_history_conn_sql ON history(connection_id, sql_text);
`;

/** FTS5 trigram 索引；创建失败时由调用方回退 LIKE。 */
export const HISTORY_FTS_SCHEMA = `
  CREATE VIRTUAL TABLE IF NOT EXISTS history_fts USING fts5(
    sql_text,
    content='history',
    content_rowid='id',
    tokenize='trigram'
  );
  CREATE TRIGGER IF NOT EXISTS history_fts_ai AFTER INSERT ON history BEGIN
    INSERT INTO history_fts(rowid, sql_text) VALUES (new.id, new.sql_text);
  END;
  CREATE TRIGGER IF NOT EXISTS history_fts_ad AFTER DELETE ON history BEGIN
    INSERT INTO history_fts(history_fts, rowid, sql_text) VALUES ('delete', old.id, old.sql_text);
  END;
  CREATE TRIGGER IF NOT EXISTS history_fts_au AFTER UPDATE ON history BEGIN
    INSERT INTO history_fts(history_fts, rowid, sql_text) VALUES ('delete', old.id, old.sql_text);
    INSERT INTO history_fts(rowid, sql_text) VALUES (new.id, new.sql_text);
  END;
`;

/**
 * 创建 FTS5 trigram 索引并重建一次，保证已有历史也被索引。
 * 返回 false 表示当前 SQLite 构建不支持 trigram，调用方继续用 LIKE。
 */
export function ensureHistoryFts(db: DB): boolean {
  try {
    db.exec(HISTORY_FTS_SCHEMA);
    return rebuildHistoryFts(db);
  } catch {
    return false;
  }
}

/** 重建 FTS 索引；索引损坏时用于自愈。返回 false 表示重建失败。 */
export function rebuildHistoryFts(db: DB): boolean {
  try {
    db.exec("INSERT INTO history_fts(history_fts) VALUES ('rebuild')");
    return true;
  } catch {
    return false;
  }
}

function hasHistoryFts(db: DB): boolean {
  try {
    return Boolean(
      db
        .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'history_fts'")
        .get(),
    );
  } catch {
    return false;
  }
}

/** 把用户输入包成 FTS 短语，避免 `AND`/`NOT` 等被当成语法。 */
function ftsQuery(query: string): string {
  return `"${query.replace(/"/g, '""')}"`;
}

export interface HistoryEntry {
  sqlText: string;
  dialect: DatabaseType;
  connectionId: string;
  connectionName: string;
  databaseName: string;
  status: QueryStatus;
  errorMessage: string | null;
  durationMs: number;
  affectedRows: number | null;
  returnedRows: number | null;
  source: QuerySource;
  executedAt: string;
}

interface HistoryRow {
  id: number;
  sql_text: string;
  dialect: string;
  connection_id: string;
  connection_name: string;
  database_name: string;
  status: string;
  error_message: string | null;
  duration_ms: number;
  affected_rows: number | null;
  returned_rows: number | null;
  source: string;
  exec_count: number;
  last_executed_at: string;
}

export interface HistoryOptions {
  dedupeWindowMs?: number;
  /** false 时关闭 60 秒合并，每次执行都单独记录。 */
  dedupe?: boolean;
  retentionLimit?: number;
}

function toRecord(row: HistoryRow): HistoryRecord {
  return {
    id: row.id,
    sqlText: row.sql_text,
    dialect: row.dialect as DatabaseType,
    connectionId: row.connection_id,
    connectionName: row.connection_name,
    databaseName: row.database_name,
    status: row.status as QueryStatus,
    errorMessage: row.error_message,
    durationMs: row.duration_ms,
    affectedRows: row.affected_rows,
    returnedRows: row.returned_rows,
    source: row.source as QuerySource,
    execCount: row.exec_count,
    lastExecutedAt: row.last_executed_at,
  };
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/** 记录一次执行；60 秒内同连接同 SQL 合并为一条并累计 exec_count。 */
export function recordHistory(db: DB, entry: HistoryEntry, options: HistoryOptions = {}): void {
  const dedupeWindowMs = options.dedupeWindowMs ?? 60_000;
  const retentionLimit = options.retentionLimit ?? 10_000;
  const executedAt = entry.executedAt;

  const cutoff = new Date(new Date(executedAt).getTime() - dedupeWindowMs).toISOString();
  let recent: { id: number; exec_count: number } | undefined;
  if (options.dedupe !== false) {
    recent = db
      .prepare(
        `SELECT id, exec_count FROM history
         WHERE connection_id = ? AND sql_text = ? AND last_executed_at >= ?
         ORDER BY id DESC LIMIT 1`,
      )
      .get(entry.connectionId, entry.sqlText, cutoff) as
      | { id: number; exec_count: number }
      | undefined;
  }

  if (recent) {
    db.prepare(
      `UPDATE history SET
         sql_text = @sqlText,
         dialect = @dialect,
         connection_name = @connectionName,
         database_name = @databaseName,
         status = @status,
         error_message = @errorMessage,
         duration_ms = @durationMs,
         affected_rows = @affectedRows,
         returned_rows = @returnedRows,
         source = @source,
         exec_count = exec_count + 1,
         last_executed_at = @executedAt
       WHERE id = @id`,
    ).run({
      id: recent.id,
      sqlText: entry.sqlText,
      dialect: entry.dialect,
      connectionName: entry.connectionName,
      databaseName: entry.databaseName,
      status: entry.status,
      errorMessage: entry.errorMessage,
      durationMs: entry.durationMs,
      affectedRows: entry.affectedRows,
      returnedRows: entry.returnedRows,
      source: entry.source,
      executedAt,
    });
  } else {
    db.prepare(
      `INSERT INTO history (
         sql_text, dialect, connection_id, connection_name, database_name, status,
         error_message, duration_ms, affected_rows, returned_rows, source, exec_count, last_executed_at
       ) VALUES (
         @sqlText, @dialect, @connectionId, @connectionName, @databaseName, @status,
         @errorMessage, @durationMs, @affectedRows, @returnedRows, @source, 1, @executedAt
       )`,
    ).run({
      sqlText: entry.sqlText,
      dialect: entry.dialect,
      connectionId: entry.connectionId,
      connectionName: entry.connectionName,
      databaseName: entry.databaseName,
      status: entry.status,
      errorMessage: entry.errorMessage,
      durationMs: entry.durationMs,
      affectedRows: entry.affectedRows,
      returnedRows: entry.returnedRows,
      source: entry.source,
      executedAt,
    });
  }

  // 超出保留上限时按最后执行时间淘汰最旧记录；0 表示不限制。
  if (retentionLimit > 0) {
    db.prepare(
      `DELETE FROM history WHERE id NOT IN (
         SELECT id FROM history ORDER BY last_executed_at DESC, id DESC LIMIT ?
       )`,
    ).run(retentionLimit);
  }
}

/** 组合过滤 + 排序；所有值走参数，排序字段走白名单。 */
export function listHistory(db: DB, options: HistoryListOptions = {}): HistoryRecord[] {
  const safeLimit = Math.max(1, Math.min(1000, Math.floor(options.limit ?? 100)));
  const clauses: string[] = [];
  const params: Array<string | number> = [];

  const query = options.query?.trim() ?? '';
  // trigram 至少需要 3 个字符；更短的查询与不支持 FTS 的库继续用 LIKE。
  const useFts = query.length >= 3 && hasHistoryFts(db);
  if (query) {
    if (useFts) {
      clauses.push('id IN (SELECT rowid FROM history_fts WHERE history_fts MATCH ?)');
      params.push(ftsQuery(query));
    } else {
      clauses.push("sql_text LIKE ? ESCAPE '\\'");
      params.push(`%${escapeLike(query)}%`);
    }
  }
  if (options.dialect && DIALECTS.has(options.dialect)) {
    clauses.push('dialect = ?');
    params.push(options.dialect);
  }
  if (options.status && STATUSES.has(options.status)) {
    clauses.push('status = ?');
    params.push(options.status);
  }
  if (options.source && SOURCES.has(options.source)) {
    clauses.push('source = ?');
    params.push(options.source);
  }
  if (options.connectionId) {
    clauses.push('connection_id = ?');
    params.push(options.connectionId);
  }
  if (options.databaseName?.trim()) {
    clauses.push("database_name LIKE ? ESCAPE '\\'");
    params.push(`%${escapeLike(options.databaseName.trim())}%`);
  }
  if (options.since) {
    clauses.push('last_executed_at >= ?');
    params.push(options.since);
  }
  if (options.until) {
    clauses.push('last_executed_at <= ?');
    params.push(options.until);
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const order = options.sortBy === 'duration' ? 'duration_ms' : 'last_executed_at';
  const direction = options.sortDir === 'asc' ? 'ASC' : 'DESC';
  params.push(safeLimit);

  const sql = `SELECT * FROM history
       ${where}
       ORDER BY ${order} ${direction}, id DESC
       LIMIT ?`;

  try {
    const rows = db.prepare(sql).all(...params) as HistoryRow[];
    return rows.map(toRecord);
  } catch (error) {
    if (!useFts) throw error;
    // 索引损坏时先原地重建再重试一次，避免整段搜索降级为全表 LIKE。
    if (rebuildHistoryFts(db)) {
      try {
        const rows = db.prepare(sql).all(...params) as HistoryRow[];
        return rows.map(toRecord);
      } catch {
        // 重建后仍失败，继续走 LIKE 回退。
      }
    }
    // FTS 查询异常（例如损坏的索引）时回退到 LIKE，保证搜索可用。
    const fallbackClauses = clauses.map((clause) =>
      clause.includes('history_fts') ? "sql_text LIKE ? ESCAPE '\\'" : clause,
    );
    const fallbackParams = [...params];
    fallbackParams[0] = `%${escapeLike(query)}%`;
    const fallbackWhere =
      fallbackClauses.length > 0 ? `WHERE ${fallbackClauses.join(' AND ')}` : '';
    const rows = db
      .prepare(
        `SELECT * FROM history
         ${fallbackWhere}
         ORDER BY ${order} ${direction}, id DESC
         LIMIT ?`,
      )
      .all(...fallbackParams) as HistoryRow[];
    return rows.map(toRecord);
  }
}

export function deleteHistory(db: DB, id: number): number {
  return db.prepare('DELETE FROM history WHERE id = ?').run(id).changes;
}

export function clearHistory(db: DB): number {
  return db.prepare('DELETE FROM history').run().changes;
}

export function clearConnectionHistory(db: DB, connectionId: string): number {
  return db.prepare('DELETE FROM history WHERE connection_id = ?').run(connectionId).changes;
}
