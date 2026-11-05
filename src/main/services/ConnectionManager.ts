import Database from 'better-sqlite3';
import type {
  ConnectionInput,
  ConnectionOpenResult,
  ConnectionTestResult,
  QueryError,
  QueryRequest,
  QueryResponse,
  SchemaObject,
} from '../../shared/ipc-contract';
import type { DatabaseSession } from './DatabaseSession';
import { MariaSession } from './mariadb/MariaSession';
import { MysqlSession } from './mysql/MysqlSession';
import { SqliteSession } from './sqlite/SqliteSession';

const sessions = new Map<string, DatabaseSession>();

interface RunningQuery {
  connectionId: string;
  session: DatabaseSession;
  canceled: boolean;
}

const runningQueries = new Map<string, RunningQuery>();

function errorDetails(error: unknown): QueryError {
  if (error instanceof Error) {
    return {
      message: error.message,
      code: (error as Error & { code?: string }).code ?? null,
    };
  }
  return { message: String(error), code: null };
}

function testSqliteFile(filePath: string): string {
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

function createSession(input: ConnectionInput): Promise<DatabaseSession> {
  switch (input.type) {
    case 'sqlite':
      return SqliteSession.create(input.filePath);
    case 'mysql':
    case 'percona':
      return MysqlSession.create(input);
    case 'mariadb':
      return MariaSession.create(input);
    default:
      return Promise.reject(
        new Error('MSSQL 驱动将在后续里程碑接入。'),
      );
  }
}

function connectionMessage(session: DatabaseSession): string {
  const base = `已连接 ${session.label} ${session.serverVersion}`;
  return session.note ? `${base}（${session.note}）` : base;
}

export async function testConnection(input: ConnectionInput): Promise<ConnectionTestResult> {
  const startedAt = Date.now();

  if (input.type === 'sqlite') {
    try {
      const version = testSqliteFile(input.filePath);
      return {
        status: 'ok',
        ok: true,
        message: `SQLite ${version} · 文件可读`,
        elapsedMs: Date.now() - startedAt,
      };
    } catch (error) {
      return {
        status: 'failed',
        ok: false,
        message: errorDetails(error).message,
        elapsedMs: Date.now() - startedAt,
      };
    }
  }

  if (input.type === 'mssql') {
    return {
      status: 'not-implemented',
      ok: false,
      message: 'MSSQL 驱动将在后续里程碑接入。',
      elapsedMs: Date.now() - startedAt,
    };
  }

  let session: DatabaseSession | null = null;
  try {
    session = await createSession(input);
    return {
      status: 'ok',
      ok: true,
      message: connectionMessage(session),
      elapsedMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      status: 'failed',
      ok: false,
      message: errorDetails(error).message,
      elapsedMs: Date.now() - startedAt,
    };
  } finally {
    if (session) {
      await session.close().catch(() => undefined);
    }
  }
}

export async function openConnection(
  connectionId: string,
  input: ConnectionInput,
): Promise<ConnectionOpenResult> {
  const startedAt = Date.now();

  if (input.type === 'mssql') {
    return {
      ok: false,
      message: 'MSSQL 驱动将在后续里程碑接入。',
      elapsedMs: Date.now() - startedAt,
    };
  }

  await closeConnection(connectionId);

  try {
    const session = await createSession(input);
    sessions.set(connectionId, session);

    return {
      ok: true,
      message: connectionMessage(session),
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

export async function executeQuery(request: QueryRequest): Promise<QueryResponse> {
  if (runningQueries.has(request.requestId)) {
    return {
      ok: false,
      error: {
        message: '重复的查询请求 ID。',
        code: 'DUPLICATE_REQUEST',
      },
    };
  }

  const session = sessions.get(request.connectionId);
  if (!session) {
    return {
      ok: false,
      error: {
        message: '连接未打开，请重新连接后再执行。',
        code: 'NOT_CONNECTED',
      },
    };
  }

  const entry: RunningQuery = {
    connectionId: request.connectionId,
    session,
    canceled: false,
  };
  runningQueries.set(request.requestId, entry);

  try {
    const result = await session.query(request.sql);
    if (entry.canceled) {
      return canceledResponse(request.connectionId, session);
    }
    return { ok: true, result };
  } catch (error) {
    if (entry.canceled) {
      return canceledResponse(request.connectionId, session);
    }
    return { ok: false, error: errorDetails(error) };
  } finally {
    runningQueries.delete(request.requestId);
  }
}

function canceledResponse(connectionId: string, session: DatabaseSession): QueryResponse {
  if (session.cancelDisconnects) {
    sessions.delete(connectionId);
  }
  return {
    ok: false,
    error: {
      message: '查询已取消。',
      code: 'QUERY_CANCELED',
      connectionClosed: session.cancelDisconnects,
    },
  };
}

export async function cancelQuery(requestId: string): Promise<boolean> {
  const entry = runningQueries.get(requestId);
  if (!entry) return false;

  try {
    await entry.session.cancel();
    entry.canceled = true;
    return true;
  } catch {
    return false;
  }
}

export async function getSchema(connectionId: string): Promise<SchemaObject[]> {
  const session = sessions.get(connectionId);
  if (!session) return [];

  try {
    return await session.schema();
  } catch {
    return [];
  }
}

export async function closeConnection(connectionId: string): Promise<void> {
  const session = sessions.get(connectionId);
  if (!session) return;

  sessions.delete(connectionId);
  await session.close().catch(() => undefined);
}

export async function closeAllConnections(): Promise<void> {
  const ids = [...sessions.keys()];
  await Promise.all(ids.map((id) => closeConnection(id)));
}
