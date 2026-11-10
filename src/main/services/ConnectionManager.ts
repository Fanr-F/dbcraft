import Database from 'better-sqlite3';
import type {
  ConnectionInput,
  ConnectionTestResult,
  DatabaseListResult,
  DdlExecuteOptions,
  DdlExecuteResult,
  DdlGetResult,
  DdlObjectKind,
  DdlStatementResult,
  QueryError,
  QueryRequest,
  QueryResponse,
  QueryScriptRequest,
  QueryScriptResponse,
  QueryScriptStatement,
  SchemaGetOptions,
  SchemaGetResult,
  SchemaUseDatabaseResult,
  SessionOpenResult,
  TableApplyRequest,
  TableApplyResult,
  TableDetailResult,
  TableExtrasResult,
  TableMetaResult,
} from '../../shared/ipc-contract';
import { buildTableEditStatements } from '../../shared/dialect/dml';
import type { DatabaseSession } from './DatabaseSession';
import { MariaSession } from './mariadb/MariaSession';
import { MssqlSession } from './mssql/MssqlSession';
import { MysqlSession } from './mysql/MysqlSession';
import { SqliteSession } from './sqlite/SqliteSession';
import { createLogger } from '../logging/logger';
import { getConnectionInput, getAppSettings, recordQueryHistory, touchConnection } from '../storage/metadata';
import { parseTimeoutMs } from '../../shared/timeouts';

const sessions = new Map<string, DatabaseSession>();
const log = createLogger('session');

interface RunningQuery {
  sessionId: string;
  session: DatabaseSession;
  canceled: boolean;
  timedOut: boolean;
}

const runningQueries = new Map<string, RunningQuery>();

/** 默认 30 秒；`DBCRAFT_QUERY_TIMEOUT_MS=0` 可关闭，便于调试或长任务。 */
function resolveQueryTimeoutMs(): number {
  return parseTimeoutMs(process.env['DBCRAFT_QUERY_TIMEOUT_MS'], 30_000);
}

/**
 * 连接/测试连接超时：环境变量优先（便于调试与 E2E），否则用设置面板的值。
 * 设置读取失败时回退 8 秒，不阻塞连接。
 */
function resolveConnectTimeoutMs(): number {
  const raw = process.env['DBCRAFT_CONNECT_TIMEOUT_MS'];
  if (raw !== undefined && raw.trim() !== '') {
    return parseTimeoutMs(raw, 8_000);
  }
  const settings = getAppSettings();
  return settings.ok ? settings.settings.connectTimeoutMs : 8_000;
}

interface DriverError extends Error {
  code?: string | number;
  errno?: number;
  number?: number;
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
    // MSSQL/tedious 把 SQL Server 错误码放在 number 上；统一映射到 errno 供 UI 展示。
    const errno =
      typeof driver.errno === 'number'
        ? driver.errno
        : typeof driver.number === 'number'
          ? driver.number
          : null;

    return {
      message: driver.sqlMessage ?? driver.message,
      code: code ?? (errno === null ? null : String(errno)),
      sqlState: typeof driver.sqlState === 'string' ? driver.sqlState : null,
      errno,
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

function isSqliteLockOrPermissionError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as Error & { code?: string }).code ?? '';
  return (
    /SQLITE_BUSY|SQLITE_CANTOPEN|SQLITE_READONLY|EACCES|EBUSY|permission denied|unable to open|database is locked/i.test(
      `${code} ${error.message}`,
    )
  );
}

function testSqliteFile(filePath: string): { version: string; readonly: boolean } {
  let database: Database.Database;
  let readonly = false;
  try {
    database = new Database(filePath, { fileMustExist: true });
  } catch (error) {
    // 与 sqlite-worker 的打开逻辑保持一致：锁/权限问题回退为只读。
    if (!isSqliteLockOrPermissionError(error)) throw error;
    database = new Database(filePath, { fileMustExist: true, readonly: true });
    readonly = true;
  }

  try {
    const row = database.prepare('select sqlite_version() as version').get() as
      | { version: string }
      | undefined;
    return { version: row?.version ?? 'unknown', readonly };
  } finally {
    database.close();
  }
}

function createSession(
  input: ConnectionInput,
  connectTimeoutMs: number,
): Promise<DatabaseSession> {
  switch (input.type) {
    case 'sqlite':
      return SqliteSession.create(input.filePath);
    case 'mysql':
    case 'percona':
      return MysqlSession.create(input, { connectTimeoutMs });
    case 'mariadb':
      return MariaSession.create(input, { connectTimeoutMs });
    case 'mssql':
      return MssqlSession.create(input, { connectTimeoutMs });
    default:
      return Promise.reject(new Error('不支持的连接类型。'));
  }
}

function sessionMessage(session: DatabaseSession): string {
  const base = `已连接 ${session.label} ${session.serverVersion}`;
  return session.note ? `${base}（${session.note}）` : base;
}

export async function testConnection(
  input: ConnectionInput,
  id?: string,
): Promise<ConnectionTestResult> {
  const startedAt = Date.now();

  // 编辑已保存连接时，渲染层拿不到密码；允许主进程用已存密码测试。
  let effectiveInput = input;
  if (id && input.type !== 'sqlite' && !input.password) {
    const stored = getConnectionInput(id);
    if (stored && stored.type === input.type && stored.password) {
      effectiveInput = { ...input, password: stored.password };
    }
  }

  log.debug('测试连接', { type: effectiveInput.type });

  if (effectiveInput.type === 'sqlite') {
    try {
      const info = testSqliteFile(effectiveInput.filePath);
      return {
        status: 'ok',
        ok: true,
        message: info.readonly
          ? `SQLite ${info.version} · 只读模式（文件被占用或无写权限）`
          : `SQLite ${info.version} · 文件可读`,
        readonly: info.readonly,
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

  let session: DatabaseSession | null = null;
  try {
    session = await createSession(effectiveInput, resolveConnectTimeoutMs());
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

async function openSession(
  sessionId: string,
  input: ConnectionInput,
): Promise<SessionOpenResult> {
  const startedAt = Date.now();

  // 先关闭同 id 的旧会话，避免重连失败时留下悬空会话。
  await closeSession(sessionId);

  try {
    const session = await createSession(input, resolveConnectTimeoutMs());
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
      readonly: session.isReadOnly,
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

function historyBase(request: QueryRequest, session: DatabaseSession) {
  return {
    sqlText: request.sql,
    connectionId: request.connectionId ?? request.sessionId,
    connectionName: request.connectionName ?? '',
    databaseName: request.database ?? '',
    dialect: request.dialect ?? session.dialect,
    source: request.source ?? ('editor' as const),
  };
}

function recordHistoryAsync(entry: Parameters<typeof recordQueryHistory>[0]): void {
  // 元数据库内部有写入队列，退出前会 flush；这里不再包 setImmediate。
  recordQueryHistory(entry);
}

/**
 * 渲染进程只持有连接 id；密码在主进程解密后直接交给驱动，
 * 不回传渲染层，也不写日志。
 */
export async function openSessionById(
  sessionId: string,
  connectionId: string,
): Promise<SessionOpenResult> {
  const input = getConnectionInput(connectionId);
  if (!input) {
    return {
      ok: false,
      message: '连接不存在或已被删除，请重新创建连接。',
      elapsedMs: 0,
    };
  }

  const result = await openSession(sessionId, input);
  if (result.ok) {
    touchConnection(connectionId);
  }
  return result;
}

export async function executeQuery(request: QueryRequest): Promise<QueryResponse> {
  const startedAt = Date.now();
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
    timedOut: false,
  };
  runningQueries.set(request.requestId, entry);

  const timeoutMs =
    request.timeoutMs !== undefined ? request.timeoutMs : resolveQueryTimeoutMs();
  const timer =
    timeoutMs > 0
      ? setTimeout(() => {
          entry.timedOut = true;
          log.warn('查询超时，请求取消', { requestId: request.requestId, timeoutMs });
          void session.cancel().catch(() => undefined);
        }, timeoutMs)
      : null;

  log.debug('开始执行查询', {
    requestId: request.requestId,
    sessionId: request.sessionId,
    sqlLength: request.sql.length,
  });

  try {
    const result = await session.query(request.sql, request.params, request.maxRows);
    if (entry.canceled) {
      log.info('查询已取消', {
        requestId: request.requestId,
        sessionId: request.sessionId,
      });
      recordCanceled(request, session, startedAt);
      return canceledResponse(request.sessionId, session);
    }
    if (entry.timedOut) {
      recordTimedOut(request, session, startedAt, timeoutMs);
      return timeoutResponse(request.sessionId, session, timeoutMs);
    }
    log.info('查询完成', {
      requestId: request.requestId,
      rows: result.rowCount,
      elapsedMs: result.elapsedMs,
      truncated: result.truncated,
      statementType: result.statementType,
    });
    const historyRecord = historyBase(request, session);
    recordHistoryAsync({
      ...historyRecord,
      status: 'success',
      errorMessage: null,
      durationMs: Date.now() - startedAt,
      affectedRows: result.statementType === 'change' ? result.changes : null,
      returnedRows: result.statementType === 'select' ? result.rowCount : null,
      executedAt: new Date().toISOString(),
    });
    return { ok: true, result };
  } catch (error) {
    if (entry.canceled) {
      log.info('查询已取消', {
        requestId: request.requestId,
        sessionId: request.sessionId,
      });
      recordCanceled(request, session, startedAt);
      return canceledResponse(request.sessionId, session);
    }

    if (entry.timedOut) {
      recordTimedOut(request, session, startedAt, timeoutMs);
      return timeoutResponse(request.sessionId, session, timeoutMs);
    }

    const details = errorDetails(error);
    log.warn('查询失败', {
      requestId: request.requestId,
      code: details.code,
      sqlState: details.sqlState,
      errno: details.errno,
      retryable: details.retryable,
    });
    recordHistoryAsync({
      ...historyBase(request, session),
      status: 'failed',
      errorMessage: details.message.slice(0, 500),
      durationMs: Date.now() - startedAt,
      affectedRows: null,
      returnedRows: null,
      executedAt: new Date().toISOString(),
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
    if (timer) clearTimeout(timer);
    runningQueries.delete(request.requestId);
  }
}

/**
 * 编辑器内多语句：按渲染层已分好的语句顺序执行，遇错停止。
 * 每条语句独立记录历史；取消/超时也停在该语句。
 */
export async function executeQueryScript(
  request: QueryScriptRequest,
): Promise<QueryScriptResponse> {
  const startedAt = Date.now();
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
    timedOut: false,
  };
  runningQueries.set(request.requestId, entry);
  const timeoutMs =
    request.timeoutMs !== undefined ? request.timeoutMs : resolveQueryTimeoutMs();
  const statements: QueryScriptStatement[] = [];
  let canceled = false;
  let timedOut = false;

  log.debug('开始执行 SQL 脚本', {
    requestId: request.requestId,
    sessionId: request.sessionId,
    statementCount: request.statements.length,
  });

  try {
    for (let index = 0; index < request.statements.length; index += 1) {
      if (entry.canceled) {
        canceled = true;
        break;
      }

      const sql = request.statements[index]!;
      const statementRequest = scriptStatementRequest(request, sql);
      const statementStartedAt = Date.now();
      const timer =
        timeoutMs > 0
          ? setTimeout(() => {
              entry.timedOut = true;
              log.warn('脚本语句超时，请求取消', {
                requestId: request.requestId,
                index,
                timeoutMs,
              });
              void session.cancel().catch(() => undefined);
            }, timeoutMs)
          : null;

      try {
        const result = await session.query(sql, undefined, request.maxRows);
        if (timer) clearTimeout(timer);

        if (entry.canceled) {
          canceled = true;
          recordCanceled(statementRequest, session, statementStartedAt);
          statements.push({
            index,
            sql,
            ok: false,
            canceled: true,
            elapsedMs: Date.now() - statementStartedAt,
            error: canceledError(session),
          });
          break;
        }
        if (entry.timedOut) {
          timedOut = true;
          recordTimedOut(statementRequest, session, statementStartedAt, timeoutMs);
          statements.push({
            index,
            sql,
            ok: false,
            timedOut: true,
            elapsedMs: Date.now() - statementStartedAt,
            error: timeoutError(session, timeoutMs),
          });
          break;
        }

        recordHistoryAsync({
          ...historyBase(statementRequest, session),
          status: 'success',
          errorMessage: null,
          durationMs: Date.now() - statementStartedAt,
          affectedRows: result.statementType === 'change' ? result.changes : null,
          returnedRows: result.statementType === 'select' ? result.rowCount : null,
          executedAt: new Date().toISOString(),
        });
        statements.push({
          index,
          sql,
          ok: true,
          result,
          elapsedMs: result.elapsedMs,
        });
      } catch (error) {
        if (timer) clearTimeout(timer);

        if (entry.canceled) {
          canceled = true;
          recordCanceled(statementRequest, session, statementStartedAt);
          statements.push({
            index,
            sql,
            ok: false,
            canceled: true,
            elapsedMs: Date.now() - statementStartedAt,
            error: canceledError(session),
          });
          break;
        }
        if (entry.timedOut) {
          timedOut = true;
          recordTimedOut(statementRequest, session, statementStartedAt, timeoutMs);
          statements.push({
            index,
            sql,
            ok: false,
            timedOut: true,
            elapsedMs: Date.now() - statementStartedAt,
            error: timeoutError(session, timeoutMs),
          });
          break;
        }

        const details = errorDetails(error);
        log.warn('脚本语句失败', {
          requestId: request.requestId,
          index,
          code: details.code,
          sqlState: details.sqlState,
          errno: details.errno,
        });
        recordHistoryAsync({
          ...historyBase(statementRequest, session),
          status: 'failed',
          errorMessage: details.message.slice(0, 500),
          durationMs: Date.now() - statementStartedAt,
          affectedRows: null,
          returnedRows: null,
          executedAt: new Date().toISOString(),
        });
        if (!session.alive) {
          sessions.delete(request.sessionId);
        }
        statements.push({
          index,
          sql,
          ok: false,
          elapsedMs: Date.now() - statementStartedAt,
          error: session.alive ? details : { ...details, connectionClosed: true },
        });
        break;
      }
    }
  } finally {
    runningQueries.delete(request.requestId);
  }

  if ((canceled || timedOut) && session.cancelDisconnects) {
    sessions.delete(request.sessionId);
  }

  log.info('SQL 脚本执行完成', {
    requestId: request.requestId,
    executed: statements.length,
    total: request.statements.length,
    canceled,
    timedOut,
    elapsedMs: Date.now() - startedAt,
  });

  return {
    ok: true,
    result: {
      statements,
      total: request.statements.length,
      elapsedMs: Date.now() - startedAt,
      canceled,
      timedOut,
    },
  };
}

function scriptStatementRequest(request: QueryScriptRequest, sql: string): QueryRequest {
  return {
    requestId: request.requestId,
    sessionId: request.sessionId,
    sql,
    maxRows: request.maxRows,
    timeoutMs: request.timeoutMs,
    connectionId: request.connectionId,
    connectionName: request.connectionName,
    dialect: request.dialect,
    database: request.database,
    source: request.source,
  };
}

function canceledError(session: DatabaseSession): QueryError {
  return {
    message: '查询已取消。',
    code: 'QUERY_CANCELED',
    ...NOT_RETRYABLE,
    connectionClosed: session.cancelDisconnects,
  };
}

function timeoutError(session: DatabaseSession, timeoutMs: number): QueryError {
  return {
    message: timeoutMessage(timeoutMs),
    code: 'QUERY_TIMEOUT',
    ...NOT_RETRYABLE,
    connectionClosed: session.cancelDisconnects,
  };
}

function timeoutMessage(timeoutMs: number): string {
  const seconds = Math.max(1, Math.round(timeoutMs / 1000));
  return `查询超时（${seconds} 秒），已请求取消。`;
}

function recordTimedOut(
  request: QueryRequest,
  session: DatabaseSession,
  startedAt: number,
  timeoutMs: number,
): void {
  recordHistoryAsync({
    ...historyBase(request, session),
    status: 'failed',
    errorMessage: timeoutMessage(timeoutMs),
    durationMs: Date.now() - startedAt,
    affectedRows: null,
    returnedRows: null,
    executedAt: new Date().toISOString(),
  });
}

function timeoutResponse(
  sessionId: string,
  session: DatabaseSession,
  timeoutMs: number,
): QueryResponse {
  if (session.cancelDisconnects) {
    sessions.delete(sessionId);
  }
  return {
    ok: false,
    error: {
      message: timeoutMessage(timeoutMs),
      code: 'QUERY_TIMEOUT',
      ...NOT_RETRYABLE,
      connectionClosed: session.cancelDisconnects,
    },
  };
}

function recordCanceled(
  request: QueryRequest,
  session: DatabaseSession,
  startedAt: number,
): void {
  recordHistoryAsync({
    ...historyBase(request, session),
    status: 'cancelled',
    errorMessage: '查询已取消。',
    durationMs: Date.now() - startedAt,
    affectedRows: null,
    returnedRows: null,
    executedAt: new Date().toISOString(),
  });
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

/**
 * UI 预览后执行的 DDL 也写入查询历史（PRD 4.4.1：source = ddl-preview）。
 * 一次执行合并为一条记录；失败时保留错误摘要，便于历史面板复现。
 */
function recordDdlHistory(
  session: DatabaseSession,
  statements: string[],
  options: DdlExecuteOptions,
  failed: boolean,
  failureMessage: string,
  startedAt: number,
): void {
  recordHistoryAsync({
    sqlText: statements.join(';\n'),
    connectionId: options.connectionId ?? '',
    connectionName: options.connectionName ?? '',
    databaseName: options.database ?? '',
    dialect: session.dialect,
    status: failed ? 'failed' : 'success',
    errorMessage: failed ? failureMessage.slice(0, 500) : null,
    durationMs: Date.now() - startedAt,
    affectedRows: null,
    returnedRows: null,
    source: 'ddl-preview',
    executedAt: new Date().toISOString(),
  });
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

export async function getSchema(
  sessionId: string,
  options: SchemaGetOptions = {},
): Promise<SchemaGetResult> {
  const session = sessions.get(sessionId);
  if (!session) {
    return { ok: false, message: '会话未打开，请重新连接。' };
  }

  if (!session.alive) {
    sessions.delete(sessionId);
    return { ok: false, message: '会话已失效，请重新连接。' };
  }

  try {
    return { ok: true, objects: await session.schema(options) };
  } catch (error) {
    const details = errorDetails(error);
    log.warn('加载对象树失败', { sessionId, code: details.code, errno: details.errno });
    return { ok: false, message: details.message };
  }
}

export async function listDatabases(sessionId: string): Promise<DatabaseListResult> {
  const session = sessions.get(sessionId);
  if (!session) return { ok: false, message: '会话未打开，请重新连接。' };
  if (!session.alive) {
    sessions.delete(sessionId);
    return { ok: false, message: '会话已失效，请重新连接。' };
  }
  try {
    return { ok: true, databases: await session.databases() };
  } catch (error) {
    const details = errorDetails(error);
    log.warn('加载数据库列表失败', { sessionId, code: details.code, errno: details.errno });
    return { ok: false, message: details.message };
  }
}

export async function useDatabase(
  sessionId: string,
  database: string,
): Promise<SchemaUseDatabaseResult> {
  const session = sessions.get(sessionId);
  if (!session) return { ok: false, message: '会话未打开，请重新连接。' };
  if (!session.alive) {
    sessions.delete(sessionId);
    return { ok: false, message: '会话已失效，请重新连接。' };
  }
  try {
    await session.useDatabase(database);
    return { ok: true, database };
  } catch (error) {
    const details = errorDetails(error);
    log.warn('切换数据库失败', {
      sessionId,
      database,
      code: details.code,
      errno: details.errno,
    });
    return { ok: false, message: details.message };
  }
}

export async function getTableExtras(
  sessionId: string,
  database: string,
  table: string,
): Promise<TableExtrasResult> {
  const session = sessions.get(sessionId);
  if (!session) return { ok: false, message: '会话未打开，请重新连接。' };
  if (!session.alive) {
    sessions.delete(sessionId);
    return { ok: false, message: '会话已失效，请重新连接。' };
  }
  try {
    return { ok: true, extras: await session.tableExtras(database, table) };
  } catch (error) {
    const details = errorDetails(error);
    log.warn('加载表子对象失败', {
      sessionId,
      database,
      table,
      code: details.code,
      errno: details.errno,
    });
    return { ok: false, message: details.message };
  }
}

export async function getDdl(
  sessionId: string,
  name: string,
  kind: DdlObjectKind,
): Promise<DdlGetResult> {
  const session = sessions.get(sessionId);
  if (!session) {
    return { ok: false, message: '会话未打开，请重新连接。' };
  }

  if (!session.alive) {
    sessions.delete(sessionId);
    return { ok: false, message: '会话已失效，请重新连接。' };
  }

  try {
    const ddl = await session.getDdl(name, kind);
    log.debug('读取对象 DDL', { sessionId, kind });
    return { ok: true, dialect: session.dialect, ddl };
  } catch (error) {
    const details = errorDetails(error);
    log.warn('读取对象 DDL 失败', { sessionId, kind, code: details.code, errno: details.errno });
    return { ok: false, message: details.message };
  }
}

export async function executeDdl(
  sessionId: string,
  statements: string[],
  options: DdlExecuteOptions = {},
): Promise<DdlExecuteResult> {
  const startedAt = Date.now();
  const session = sessions.get(sessionId);

  if (!session) {
    return {
      ok: false,
      message: '会话未打开，请重新连接。',
      results: [],
      elapsedMs: 0,
    };
  }

  if (!session.alive) {
    sessions.delete(sessionId);
    return {
      ok: false,
      message: '会话已失效，请重新连接。',
      results: [],
      elapsedMs: 0,
    };
  }

  const results: DdlStatementResult[] = [];
  let inTransaction = false;
  let failed = false;
  let failureMessage = '';
  const disableForeignKeys =
    session.dialect === 'sqlite' && options.sqliteForeignKeysOff === true;

  if (disableForeignKeys) {
    try {
      await session.query('PRAGMA foreign_keys = OFF');
    } catch {
      // 无法关闭时继续执行；重建语句可能因外键失败并回滚。
    }
  }

  // SQLite 的 DDL 可回滚；MySQL 系 DDL 隐式提交，只逐条执行并汇报。
  if (session.dialect === 'sqlite') {
    try {
      await session.query('BEGIN');
      inTransaction = true;
    } catch {
      inTransaction = false;
    }
  }

  for (let index = 0; index < statements.length; index += 1) {
    const sql = statements[index]?.trim() ?? '';
    try {
      if (!sql) throw new Error('语句为空。');
      const result = await session.query(sql);
      results.push({
        index,
        ok: true,
        message:
          result.statementType === 'change'
            ? `影响 ${result.changes ?? 0} 行`
            : `返回 ${result.rowCount} 行`,
        changes: result.changes,
      });
    } catch (error) {
      const details = errorDetails(error);
      results.push({ index, ok: false, message: details.message, changes: null });
      failed = true;
      failureMessage = details.message;
      if (session.dialect === 'sqlite') break;
    }
  }

  if (inTransaction && !failed && disableForeignKeys) {
    try {
      const check = await session.query('PRAGMA foreign_key_check');
      if (check.rows.length > 0) {
        failed = true;
        failureMessage = `外键检查失败：${check.rows.length} 行存在悬空引用，已回滚。`;
      }
    } catch (error) {
      failed = true;
      failureMessage = `外键检查失败：${
        error instanceof Error ? error.message : String(error)
      }`;
    }
  }

  if (inTransaction) {
    try {
      await session.query(failed ? 'ROLLBACK' : 'COMMIT');
    } catch (error) {
      const details = errorDetails(error);
      if (disableForeignKeys) {
        await session.query('PRAGMA foreign_keys = ON').catch(() => undefined);
      }
      const message = `事务结束失败：${details.message}`;
      recordDdlHistory(session, statements, options, true, message, startedAt);
      return {
        ok: false,
        message,
        results,
        elapsedMs: Date.now() - startedAt,
      };
    }
  }

  if (disableForeignKeys) {
    await session.query('PRAGMA foreign_keys = ON').catch(() => undefined);
  }

  log.info('DDL 执行完成', {
    sessionId,
    statements: statements.length,
    failed,
    dialect: session.dialect,
  });

  const failureText = failureMessage || 'DDL 执行失败。';
  recordDdlHistory(session, statements, options, failed, failureText, startedAt);

  const elapsedMs = Date.now() - startedAt;
  if (failed) {
    return { ok: false, message: failureText, results, elapsedMs };
  }
  return { ok: true, results, elapsedMs };
}

export async function getTableMeta(
  sessionId: string,
  name: string,
  kind: DdlObjectKind,
): Promise<TableMetaResult> {
  const session = sessions.get(sessionId);
  if (!session) {
    return { ok: false, message: '会话未打开，请重新连接。' };
  }

  if (!session.alive) {
    sessions.delete(sessionId);
    return { ok: false, message: '会话已失效，请重新连接。' };
  }

  try {
    const meta = await session.getTableMeta(name, kind);
    return { ok: true, meta };
  } catch (error) {
    const details = errorDetails(error);
    log.warn('读取表元数据失败', {
      sessionId,
      kind,
      code: details.code,
      errno: details.errno,
    });
    return { ok: false, message: details.message };
  }
}

export async function getTableDetail(
  sessionId: string,
  name: string,
): Promise<TableDetailResult> {
  const session = sessions.get(sessionId);
  if (!session) {
    return { ok: false, message: '会话未打开，请重新连接。' };
  }
  if (!session.alive) {
    sessions.delete(sessionId);
    return { ok: false, message: '会话已失效，请重新连接。' };
  }

  try {
    return { ok: true, detail: await session.getTableDetail(name) };
  } catch (error) {
    const details = errorDetails(error);
    log.warn('读取表结构详情失败', { sessionId, code: details.code });
    return { ok: false, message: details.message };
  }
}

/** 表格编辑在一个事务内提交；任一行乐观锁失败则整体回滚。 */
export async function applyTableEdits(request: TableApplyRequest): Promise<TableApplyResult> {
  const startedAt = Date.now();
  const session = sessions.get(request.sessionId);

  const failed = (message: string, applied = 0, conflict = false): TableApplyResult => ({
    ok: false,
    message,
    conflict,
    applied,
    elapsedMs: Date.now() - startedAt,
  });

  if (!session) return failed('会话未打开，请重新连接。');
  if (!session.alive) {
    sessions.delete(request.sessionId);
    return failed('会话已失效，请重新连接。');
  }
  if (session.isReadOnly) return failed('当前为只读会话，无法提交修改。');
  if (request.edits.length === 0) return failed('没有待提交的修改。');

  let statements;
  try {
    const meta = await session.getTableMeta(request.table, 'table');
    // 无主键表默认只读；高风险开关只允许 INSERT，UPDATE/DELETE 无法安全定位行。
    const insertOnly =
      request.allowNoPrimaryKeyInsert === true &&
      meta.reasonCode === 'no-primary-key' &&
      request.edits.every((edit) => edit.kind === 'insert');

    if (!meta.editable && !insertOnly) {
      return failed(meta.reason ?? '该表不可编辑。');
    }
    statements = buildTableEditStatements(session.dialect, request.table, meta, request.edits, {
      allowPrimaryKeyChange: request.allowPrimaryKeyChange === true,
    });
  } catch (error) {
    return failed(error instanceof Error ? error.message : String(error));
  }

  const beginSql =
    session.dialect === 'sqlite'
      ? 'BEGIN'
      : session.dialect === 'mssql'
        ? 'BEGIN TRANSACTION'
        : 'START TRANSACTION';

  try {
    await session.query(beginSql);
  } catch (error) {
    return failed(
      `无法开启事务：${error instanceof Error ? error.message : String(error)}`,
    );
  }

  let applied = 0;
  let conflict = false;

  try {
    for (let index = 0; index < statements.length; index += 1) {
      const statement = statements[index]!;
      const edit = request.edits[index]!;
      const result = await session.query(statement.sql, statement.params);

      // UPDATE/DELETE 影响 0 行说明目标行已变化（或已删除），按冲突处理。
      if (edit.kind !== 'insert' && (result.changes ?? 0) === 0) {
        conflict = true;
        throw new Error(
          `第 ${index + 1} 项修改未命中任何行：数据可能已被其他会话修改或删除。`,
        );
      }
      applied += 1;
    }

    await session.query('COMMIT');
  } catch (error) {
    await session.query('ROLLBACK').catch(() => undefined);
    const message = error instanceof Error ? error.message : String(error);
    log.warn('表格编辑回滚', {
      sessionId: request.sessionId,
      applied,
      conflict,
      message,
    });
    return failed(message, applied, conflict);
  }

  const elapsedMs = Date.now() - startedAt;
  log.info('表格编辑已提交', {
    sessionId: request.sessionId,
    edits: request.edits.length,
    elapsedMs,
  });

  recordHistoryAsync({
    sqlText: statements.map((statement) => statement.sql).join(';\n'),
    connectionId: request.connectionId ?? request.sessionId,
    connectionName: request.connectionName ?? '',
    databaseName: request.database ?? '',
    dialect: session.dialect,
    source: 'grid-edit',
    status: 'success',
    errorMessage: null,
    durationMs: elapsedMs,
    affectedRows: applied,
    returnedRows: null,
    executedAt: new Date().toISOString(),
  });

  return { ok: true, applied, elapsedMs };
}

export function getMssqlSession(sessionId: string): MssqlSession | null {
  const session = sessions.get(sessionId);
  return session instanceof MssqlSession ? session : null;
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
