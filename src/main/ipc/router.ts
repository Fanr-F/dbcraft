import { app, dialog, ipcMain } from 'electron';
import type { BrowserWindow, IpcMainEvent, IpcMainInvokeEvent } from 'electron';
import {
  IPC_CHANNELS,
  type AppInfo,
  type ConnectionTestResult,
  type QueryResponse,
  type SchemaGetResult,
  type SessionOpenResult,
} from '../../shared/ipc-contract';
import {
  connectionInputSchema,
  formatConnectionIssues,
  logWriteSchema,
  queryExecuteSchema,
  sessionOpenSchema,
} from './schemas';
import {
  cancelQuery,
  closeSession,
  executeQuery,
  getSchema,
  openSession,
  testConnection,
} from '../services/ConnectionManager';
import { createLogger } from '../logging/logger';

let mainWindow: BrowserWindow | null = null;
const log = createLogger('ipc');

/** 只接受主窗口主框架发起的 IPC，避免子帧/其他 WebContents 触碰数据库。 */
export function bindMainWindow(window: BrowserWindow): void {
  mainWindow = window;
}

export function releaseMainWindow(window: BrowserWindow): void {
  if (mainWindow === window) {
    mainWindow = null;
  }
}

function isTrustedSender(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  return (
    event.sender === mainWindow.webContents &&
    event.senderFrame === event.sender.mainFrame
  );
}

type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown;

function handle(channel: string, handler: Handler): void {
  ipcMain.handle(channel, (event, ...args) => {
    if (!isTrustedSender(event)) {
      log.warn('拒绝 IPC：来源不可信', { channel });
      throw new Error('拒绝来自未知窗口的 IPC 请求。');
    }
    return handler(event, ...args);
  });
}

export function registerIpcHandlers(): void {
  handle(IPC_CHANNELS.appGetInfo, (): AppInfo => {
    return {
      name: app.getName(),
      version: app.getVersion(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      platform: process.platform,
    };
  });

  handle(IPC_CHANNELS.dialogSelectSqliteFile, async (): Promise<string | null> => {
    const result = await dialog.showOpenDialog({
      title: '选择 SQLite 数据库文件',
      properties: ['openFile'],
      filters: [
        { name: 'SQLite 数据库', extensions: ['db', 'sqlite', 'sqlite3', 'db3'] },
        { name: '所有文件', extensions: ['*'] },
      ],
    });

    return result.canceled ? null : (result.filePaths[0] ?? null);
  });

  handle(
    IPC_CHANNELS.connectionTest,
    async (_event, rawInput: unknown): Promise<ConnectionTestResult> => {
      const startedAt = Date.now();
      const parsed = connectionInputSchema.safeParse(rawInput);

      if (!parsed.success) {
        return {
          status: 'failed',
          ok: false,
          message: `连接配置不完整：${formatConnectionIssues(parsed.error)}`,
          elapsedMs: Date.now() - startedAt,
        };
      }

      return testConnection(parsed.data);
    },
  );

  handle(
    IPC_CHANNELS.sessionOpen,
    async (_event, rawInput: unknown): Promise<SessionOpenResult> => {
      const startedAt = Date.now();
      const parsed = sessionOpenSchema.safeParse(rawInput);

      if (!parsed.success) {
        return {
          ok: false,
          message: `会话参数无效：${formatConnectionIssues(parsed.error)}`,
          elapsedMs: Date.now() - startedAt,
        };
      }

      return openSession(parsed.data.sessionId, parsed.data.config);
    },
  );

  handle(IPC_CHANNELS.sessionClose, async (_event, rawInput: unknown): Promise<void> => {
    if (typeof rawInput === 'string' && rawInput.length > 0) {
      await closeSession(rawInput);
    }
  });

  handle(
    IPC_CHANNELS.queryExecute,
    async (_event, rawInput: unknown): Promise<QueryResponse> => {
      const parsed = queryExecuteSchema.safeParse(rawInput);

      if (!parsed.success) {
        return {
          ok: false,
          error: {
            message: `SQL 无效：${formatConnectionIssues(parsed.error)}`,
            code: 'INVALID_REQUEST',
            sqlState: null,
            errno: null,
            retryable: false,
          },
        };
      }

      return executeQuery(parsed.data);
    },
  );

  handle(IPC_CHANNELS.queryCancel, async (_event, rawInput: unknown): Promise<boolean> => {
    if (typeof rawInput !== 'string' || rawInput.length === 0) {
      return false;
    }
    return cancelQuery(rawInput);
  });

  handle(
    IPC_CHANNELS.schemaGet,
    async (_event, rawInput: unknown): Promise<SchemaGetResult> => {
      if (typeof rawInput !== 'string' || rawInput.length === 0) {
        return { ok: false, message: '会话参数无效。' };
      }
      return getSchema(rawInput);
    },
  );

  // 渲染进程日志：只接受主窗口、限制长度，统一落到主进程日志文件。
  ipcMain.on(IPC_CHANNELS.logWrite, (event, rawInput: unknown) => {
    if (!isTrustedSender(event)) return;

    const parsed = logWriteSchema.safeParse(rawInput);
    if (!parsed.success) return;

    const { level, scope, message, meta } = parsed.data;
    createLogger(`renderer:${scope}`)[level](message, meta ? { meta } : undefined);
  });
}
