import Database from 'better-sqlite3';
import type {
  ConnectionInput,
  ConnectionOpenResult,
  QueryError,
  QueryResponse,
  SchemaObject,
} from '../../../shared/ipc-contract';
import { SqliteSession } from './SqliteSession';

const sessions = new Map<string, SqliteSession>();

function errorDetails(error: unknown): QueryError {
  if (error instanceof Error) {
    return {
      message: error.message,
      code: (error as Error & { code?: string }).code ?? null,
    };
  }
  return { message: String(error), code: null };
}

export function testSqliteFile(filePath: string): string {
  const database = new Database(filePath, { fileMustExist: true });
  try {
    const row = database.prepare('select sqlite_version() as version').get() as
      | { version: string }
      | undefined;
    return row?.version ?? 'unknown';
  } finally {
    database.close();
  }
}

export async function openConnection(
  connectionId: string,
  input: ConnectionInput,
): Promise<ConnectionOpenResult> {
  const startedAt = Date.now();

  if (input.type !== 'sqlite') {
    return {
      ok: false,
      message: '当前版本只接入 SQLite 驱动，其他数据库类型将在后续里程碑接入。',
      elapsedMs: Date.now() - startedAt,
    };
  }

  await closeConnection(connectionId);

  try {
    const session = await SqliteSession.create(input.filePath);
    sessions.set(connectionId, session);

    return {
      ok: true,
      message: `已连接 SQLite ${session.serverVersion}`,
      elapsedMs: Date.now() - startedAt,
      serverVersion: session.serverVersion,
    };
  } catch (error) {
    const details = errorDetails(error);
    return {
      ok: false,
      message: details.message,
      elapsedMs: Date.now() - startedAt,
    };
  }
}

export async function executeQuery(
  connectionId: string,
  sql: string,
): Promise<QueryResponse> {
  const session = sessions.get(connectionId);
  if (!session) {
    return {
      ok: false,
      error: {
        message: '连接未打开，请重新连接后再执行。',
        code: 'NOT_CONNECTED',
      },
    };
  }

  try {
    return { ok: true, result: await session.query(sql) };
  } catch (error) {
    return { ok: false, error: errorDetails(error) };
  }
}

export async function closeConnection(connectionId: string): Promise<void> {
  const session = sessions.get(connectionId);
  if (!session) return;

  sessions.delete(connectionId);
  await session.close();
}

export async function closeAllConnections(): Promise<void> {
  const ids = [...sessions.keys()];
  await Promise.all(ids.map((id) => closeConnection(id)));
}

export async function getSchema(connectionId: string): Promise<SchemaObject[]> {
  const session = sessions.get(connectionId);
  if (!session) return [];

  const result = await session.query(
    `SELECT name, type
     FROM sqlite_master
     WHERE type IN ('table', 'view')
       AND name NOT LIKE 'sqlite_%'
     ORDER BY type, name`,
  );

  return result.rows.map((row) => ({
    name: String(row[0] ?? ''),
    type: row[1] === 'view' ? 'view' : 'table',
  }));
}
