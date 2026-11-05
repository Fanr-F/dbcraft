import { app, dialog, ipcMain } from 'electron';
import {
  IPC_CHANNELS,
  type AppInfo,
  type ConnectionTestResult,
  type QueryResponse,
  type SessionOpenResult,
} from '../../shared/ipc-contract';
import {
  connectionInputSchema,
  formatConnectionIssues,
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

export function registerIpcHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.appGetInfo, (): AppInfo => {
    return {
      name: app.getName(),
      version: app.getVersion(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      platform: process.platform,
    };
  });

  ipcMain.handle(IPC_CHANNELS.dialogSelectSqliteFile, async (): Promise<string | null> => {
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

  ipcMain.handle(
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

  ipcMain.handle(
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

  ipcMain.handle(IPC_CHANNELS.sessionClose, async (_event, rawInput: unknown): Promise<void> => {
    if (typeof rawInput === 'string' && rawInput.length > 0) {
      await closeSession(rawInput);
    }
  });

  ipcMain.handle(
    IPC_CHANNELS.queryExecute,
    async (_event, rawInput: unknown): Promise<QueryResponse> => {
      const parsed = queryExecuteSchema.safeParse(rawInput);

      if (!parsed.success) {
        return {
          ok: false,
          error: {
            message: `SQL 无效：${formatConnectionIssues(parsed.error)}`,
            code: 'INVALID_REQUEST',
          },
        };
      }

      return executeQuery(parsed.data);
    },
  );

  ipcMain.handle(IPC_CHANNELS.queryCancel, async (_event, rawInput: unknown): Promise<boolean> => {
    if (typeof rawInput !== 'string' || rawInput.length === 0) {
      return false;
    }
    return cancelQuery(rawInput);
  });

  ipcMain.handle(IPC_CHANNELS.schemaGet, async (_event, rawInput: unknown) => {
    if (typeof rawInput !== 'string' || rawInput.length === 0) {
      return [];
    }
    return getSchema(rawInput);
  });
}
