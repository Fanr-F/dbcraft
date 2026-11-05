import Database from 'better-sqlite3';
import type {
  ConnectionInput,
  ConnectionTestResult,
  QueryError,
  QueryRequest,
  QueryResponse,
  SchemaGetResult,
  SessionOpenResult,
} from '../../shared/ipc-contract';
import type { DatabaseSession } from './DatabaseSession';
import { MariaSession } from './mariadb/MariaSession';
import { MysqlSession } from './mysql/MysqlSession';
import { SqliteSession } from './sqlite/SqliteSession';
import { createLogger } from '../logging/logger';

const sessions = new Map<string, DatabaseSession>();
const log = createLogger('session');

interface RunningQuery {
  sessionId: string;
  session: DatabaseSession;
  canceled: boolean;
}

const runningQueries = new Map<string, RunningQuery>();

interface DriverError extends Error {
  code?: string | number;
  errno?: number;
  sqlState?: string;
  sqlMessage?: string;
  fatal?: boolean;
}

const RETRYABLE_CODES = new Set([
  'PROTOCOL_CONNECTION_LOST',
  'ECONNRESET',
  'ETIMEDOUT',
  'EPIPE',
  'ER_CON_COUNT_ERROR',
  'ER_LOCK_DEADLOCK',
  'ER_LOCK_WAIT_TIMEOUT',
]);

function errorDetails(error: unknown): QueryError {
  if (error instanceof Error) {
    const driver = error as DriverError;
    const code =
      typeof driver.code === 'string'
        ? driver.code
        : driver.code === undefined
          ? null
          : String(driver.code);

    return {
      message: driver.sqlMessage ?? driver.message,
      code,
      sqlState: typeof driver.sqlState === 'string' ? driver.sqlState : null,
      errno: typeof driver.errno === 'number' ? driver.errno : null,
      retryable: Boolean(driver.fatal) || (code ? RETRYABLE_CODES.has(code) : false),
    };
  }

  return {
    message: String(error),
    code: null,
    sqlState: null,
    errno: null,
    retryable: false,
  };
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
      return Promise.reject(new Error('MSSQL 驱动将在后续里程碑接入。'));
  }
}

function sessionMessage(session: DatabaseSession): string {
  const base = `已连接 ${session.label} ${session.serverVersion}`;
  return session.note ? `${base}（${session.note}）` : base;
}

export async function testConnection(input: ConnectionInput): Promise<ConnectionTestResult> {
  const startedAt = Date.now();
  log.debug('测试连接', { type: input.type });

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
      message: sessionMessage(session),
      elapsedMs: Date.now() - startedAt,
    };
  } catch (error) {
    const details = errorDetails(error);
    log.warn('测试连接失败', {
      type: input.type,
      code: details.code,
      errno: details.errno,
    });
    return {
      status: 'failed',
      ok: false,
      message: details.message,
      elapsedMs: Date.now() - startedAt,
    };
  } finally {
    if (session) {
      await session.close().catch(() => undefined);
    }
  }
}

export async function openSession(
  sessionId: string,
  input: ConnectionInput,
): Promise<SessionOpenResult> {
  const startedAt = Date.now();

  // 先关闭同 id 的旧会话，避免 MSSQL 提前返回时泄漏。
  await closeSession(sessionId);

  if (input.type === 'mssql') {
    return {
      ok: false,
      message: 'MSSQL 驱动将在后续里程碑接入。',
      elapsedMs: Date.now() - startedAt,
    };
  }

  try {
    const session = await createSession(input);
    sessions.set(sessionId, session);

    log.info('会话已打开', {
      sessionId,
      type: input.type,
      version: session.serverVersion,
      elapsedMs: Date.now() - startedAt,
    });

    return {
      ok: true,
      message: sessionMessage(session),
      elapsedMs: Date.now() - startedAt,
      serverVersion: session.serverVersion,
    };
  } catch (error) {
    const details = errorDetails(error);
    log.warn('会话打开失败', {
      sessionId,
      type: input.type,
      code: details.code,
      errno: details.errno,
    });
    return {
      ok: false,
      message: details.message,
      elapsedMs: Date.now() - startedAt,
    };
  }
}

const NOT_RETRYABLE = { sqlState: null, errno: null, retryable: false } as const;

export async function executeQuery(request: QueryRequest): Promise<QueryResponse> {
  if (runningQueries.has(request.requestId)) {
    return {
      ok: false,
      error: {
        message: '重复的查询请求 ID。',
        code: 'DUPLICATE_REQUEST',
        ...NOT_RETRYABLE,
      },
    };
  }

  const session = sessions.get(request.sessionId);
  if (!session) {
    return {
      ok: false,
      error: {
        message: '会话未打开，请重新执行或切换标签页。',
        code: 'NOT_CONNECTED',
        ...NOT_RETRYABLE,
      },
    };
  }

  if (!session.alive) {
    sessions.delete(request.sessionId);
    return {
      ok: false,
      error: {
        message: '会话已失效，请重新连接。',
        code: 'NOT_CONNECTED',
        ...NOT_RETRYABLE,
        connectionClosed: true,
      },
    };
  }

  const entry: RunningQuery = {
    sessionId: request.sessionId,
    session,
    canceled: false,
  };
  runningQueries.set(request.requestId, entry);

  log.debug('开始执行查询', {
    requestId: request.requestId,
    sessionId: request.sessionId,
    sqlLength: request.sql.length,
  });

  try {
    const result = await session.query(request.sql);
    if (entry.canceled) {
      log.info('查询已取消', {
        requestId: request.requestId,
        sessionId: request.sessionId,
      });
      return canceledResponse(request.sessionId, session);
    }
    log.info('查询完成', {
      requestId: request.requestId,
      rows: result.rowCount,
      elapsedMs: result.elapsedMs,
      truncated: result.truncated,
      statementType: result.statementType,
    });
    return { ok: true, result };
  } catch (error) {
    if (entry.canceled) {
      log.info('查询已取消', {
        requestId: request.requestId,
        sessionId: request.sessionId,
      });
      return canceledResponse(request.sessionId, session);
    }

    const details = errorDetails(error);
    log.warn('查询失败', {
      requestId: request.requestId,
      code: details.code,
      sqlState: details.sqlState,
      errno: details.errno,
      retryable: details.retryable,
    });
    if (!session.alive) {
      sessions.delete(request.sessionId);
      return {
        ok: false,
        error: { ...details, connectionClosed: true },
      };
    }
    return { ok: false, error: details };
  } finally {
    runningQueries.delete(request.requestId);
  }
}

function canceledResponse(sessionId: string, session: DatabaseSession): QueryResponse {
  if (session.cancelDisconnects) {
    sessions.delete(sessionId);
  }
  return {
    ok: false,
    error: {
      message: '查询已取消。',
      code: 'QUERY_CANCELED',
      ...NOT_RETRYABLE,
      connectionClosed: session.cancelDisconnects,
    },
  };
}

export async function cancelQuery(requestId: string): Promise<boolean> {
  const entry = runningQueries.get(requestId);
  if (!entry || entry.canceled) return false;

  // 必须先标记再取消：SQLite 的 cancel() 会立即 reject 正在执行的查询，
  // 若等 cancel() 返回后再标记，响应会漏掉 connectionClosed。
  entry.canceled = true;

  try {
    await entry.session.cancel();
    log.info('查询取消请求已发送', { requestId });
    return true;
  } catch {
    entry.canceled = false;
    return false;
  }
}

export async function getSchema(sessionId: string): Promise<SchemaGetResult> {
  const session = sessions.get(sessionId);
  if (!session) {
    return { ok: false, message: '会话未打开，请重新连接。' };
  }

  if (!session.alive) {
    sessions.delete(sessionId);
    return { ok: false, message: '会话已失效，请重新连接。' };
  }

  try {
    return { ok: true, objects: await session.schema() };
  } catch (error) {
    const details = errorDetails(error);
    log.warn('加载对象树失败', { sessionId, code: details.code, errno: details.errno });
    return { ok: false, message: details.message };
  }
}

export async function closeSession(sessionId: string): Promise<void> {
  const session = sessions.get(sessionId);
  if (!session) return;

  sessions.delete(sessionId);
  await session.close().catch(() => undefined);
  log.debug('会话已关闭', { sessionId });
}

export async function closeAllSessions(): Promise<void> {
  const ids = [...sessions.keys()];
  await Promise.all(ids.map((id) => closeSession(id)));
}
