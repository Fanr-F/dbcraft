import { parentPort } from 'node:worker_threads';
import Database from 'better-sqlite3';
import type { QueryCell, QueryColumn, QueryResult } from '../../shared/ipc-contract';
import { resolveRowLimit } from '../../shared/settings';
import { encodeCell } from '../services/query-values';

type WorkerRequest =
  | { id: number; type: 'open'; filePath: string; readOnly?: boolean }
  | { id: number; type: 'query'; sql: string; params?: QueryCell[]; maxRows?: number }
  | { id: number; type: 'close' };

type WorkerFailure = {
  message: string;
  code: string | null;
};

type WorkerResponse =
  | { id: number; ok: true; value: unknown }
  | { id: number; ok: false; error: WorkerFailure };

const port = parentPort;
if (!port) {
  throw new Error('sqlite worker requires a parent port');
}

const MAX_ROWS = 2000;

let database: Database.Database | null = null;
function errorInfo(error: unknown): WorkerFailure {
  if (error instanceof Error) {
    return {
      message: error.message,
      code: (error as Error & { code?: string }).code ?? null,
    };
  }
  return { message: String(error), code: null };
}

function isLockOrPermissionError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as Error & { code?: string }).code ?? '';
  return (
    /SQLITE_BUSY|SQLITE_CANTOPEN|SQLITE_READONLY|EACCES|EBUSY|permission denied|unable to open|database is locked/i.test(
      `${code} ${error.message}`,
    )
  );
}

function open(
  filePath: string,
  forceReadOnly = false,
): { version: string; readonly: boolean } {
  if (database) {
    database.close();
    database = null;
  }

  let readonly = false;
  if (forceReadOnly) {
    database = new Database(filePath, { fileMustExist: true, readonly: true });
    readonly = true;
  } else {
    try {
      database = new Database(filePath, { fileMustExist: true });
    } catch (error) {
      if (!isLockOrPermissionError(error)) throw error;
      database = new Database(filePath, { fileMustExist: true, readonly: true });
      readonly = true;
    }
  }

  if (!readonly) {
    database.pragma('journal_mode = WAL');
  }
  database.pragma('busy_timeout = 5000');
  database.pragma('foreign_keys = ON');
  // 整数默认以 BigInt 读出，避免超过 2^53 时被静默四舍五入。
  database.defaultSafeIntegers(true);

  const row = database.prepare('select sqlite_version() as version').get() as
    | { version: string }
    | undefined;

  return { version: row?.version ?? 'unknown', readonly };
}

/** better-sqlite3 不接受 boolean；布尔按 SQLite 约定转成 1/0。 */
function bindParams(params?: QueryCell[]): Array<string | number | null> {
  return (params ?? []).map((value) => {
    if (typeof value === 'boolean') return value ? 1 : 0;
    return value ?? null;
  });
}

function execute(sql: string, params?: QueryCell[], maxRows?: number): QueryResult {
  if (!database) {
    throw new Error('SQLite 连接尚未打开');
  }

  const rowLimit = resolveRowLimit(maxRows, MAX_ROWS);
  const startedAt = Date.now();
  const bindings = bindParams(params);
  let statement: Database.Statement;
  try {
    statement = database.prepare(sql);
  } catch (error) {
    if (error instanceof Error && /more than one statement/i.test(error.message)) {
      throw new Error('一次只能执行一条 SQL；编辑器内多语句会先分句后逐条执行。');
    }
    throw error;
  }

  if (!statement.reader) {
    const info = statement.run(...bindings);
    return {
      columns: [],
      rows: [],
      rowCount: Number(info.changes),
      elapsedMs: Date.now() - startedAt,
      statementType: 'change',
      changes: Number(info.changes),
      truncated: false,
    };
  }

  const columns: QueryColumn[] = statement.columns().map((column) => ({
    name: column.name,
    declaredType: column.type,
  }));

  const rows: QueryCell[][] = [];
  let truncated = false;

  for (const row of statement.raw().iterate(...bindings) as IterableIterator<unknown[]>) {
    if (rows.length >= rowLimit) {
      truncated = true;
      break;
    }
    rows.push(row.map(encodeCell));
  }

  return {
    columns,
    rows,
    rowCount: rows.length,
    elapsedMs: Date.now() - startedAt,
    statementType: 'select',
    changes: null,
    truncated,
  };
}

function close(): void {
  if (database) {
    database.close();
    database = null;
  }
}

port.on('message', (request: WorkerRequest) => {
  const reply = (response: WorkerResponse) => port.postMessage(response);

  try {
    switch (request.type) {
      case 'open':
        reply({
          id: request.id,
          ok: true,
          value: open(request.filePath, request.readOnly === true),
        });
        break;
      case 'query':
        reply({
          id: request.id,
          ok: true,
          value: execute(request.sql, request.params, request.maxRows),
        });
        break;
      case 'close':
        close();
        reply({ id: request.id, ok: true, value: null });
        port.close();
        break;
    }
  } catch (error) {
    reply({ id: request.id, ok: false, error: errorInfo(error) });
  }
});
