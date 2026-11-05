import { parentPort } from 'node:worker_threads';
import Database from 'better-sqlite3';
import type { QueryCell, QueryColumn, QueryResult } from '../../shared/ipc-contract';

type WorkerRequest =
  | { id: number; type: 'open'; filePath: string }
  | { id: number; type: 'query'; sql: string }
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

function encodeCell(value: unknown): QueryCell {
  if (value === null || value === undefined) return null;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }
  if (value instanceof Uint8Array) {
    const buffer = Buffer.from(value);
    const head = buffer.subarray(0, 32).toString('hex');
    return `0x${head}${buffer.length > 32 ? '…' : ''}`;
  }
  return String(value);
}

function open(filePath: string): { version: string } {
  if (database) {
    database.close();
    database = null;
  }

  database = new Database(filePath, { fileMustExist: true });
  database.pragma('foreign_keys = ON');
  database.pragma('busy_timeout = 5000');

  const row = database.prepare('select sqlite_version() as version').get() as
    | { version: string }
    | undefined;

  return { version: row?.version ?? 'unknown' };
}

function execute(sql: string): QueryResult {
  if (!database) {
    throw new Error('SQLite 连接尚未打开');
  }

  const startedAt = Date.now();
  let statement: Database.Statement;
  try {
    statement = database.prepare(sql);
  } catch (error) {
    if (error instanceof Error && /more than one statement/i.test(error.message)) {
      throw new Error('一次只能执行一条 SQL；多语句执行将在后续版本支持。');
    }
    throw error;
  }

  if (!statement.reader) {
    const info = statement.run();
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

  for (const row of statement.raw().iterate() as IterableIterator<unknown[]>) {
    if (rows.length >= MAX_ROWS) {
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
        reply({ id: request.id, ok: true, value: open(request.filePath) });
        break;
      case 'query':
        reply({ id: request.id, ok: true, value: execute(request.sql) });
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
