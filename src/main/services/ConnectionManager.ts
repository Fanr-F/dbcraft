import Database from 'better-sqlite3';
import type {
  ConnectionInput,
  ConnectionTestResult,
  DdlExecuteOptions,
  DdlExecuteResult,
  DdlGetResult,
  DdlObjectKind,
  DdlStatementResult,
  QueryError,
  QueryRequest,
  QueryResponse,
  SchemaGetOptions,
  SchemaGetResult,
  SessionOpenResult,
  TableApplyRequest,
  TableApplyResult,
  TableDetailResult,
  TableMetaResult,
} from '../../shared/ipc-contract';
import { buildTableEditStatements } from '../../shared/dialect/dml';
import type { DatabaseSession } from './DatabaseSession';
import { MariaSession } from './mariadb/MariaSession';
import { MysqlSession } from './mysql/MysqlSession';
import { SqliteSession } from './sqlite/SqliteSession';
import { createLogger } from '../logging/logger';
import { getConnectionInput, recordQueryHistory, touchConnection } from '../storage/metadata';
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

async function openSession(
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
      return {
        ok: false,
        message: `事务结束失败：${details.message}`,
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

  const elapsedMs = Date.now() - startedAt;
  if (failed) {
    return { ok: false, message: failureMessage || 'DDL 执行失败。', results, elapsedMs };
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
    statements = buildTableEditStatements(session.dialect, request.table, meta, request.edits);
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
