import { app, dialog, ipcMain } from 'electron';
import {
  IPC_CHANNELS,
  type AppInfo,
  type ConnectionTestResult,
} from '../../shared/ipc-contract';
import { connectionInputSchema, formatConnectionIssues } from './schemas';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

      // M0 只验证 IPC 契约与表单流程，真实驱动在 M1 接入。
      await delay(250);

      return {
        status: 'not-implemented',
        ok: false,
        message: 'M0 原型：连接测试接口已打通，真实驱动将在 M1 接入。',
        elapsedMs: Date.now() - startedAt,
      };
    },
  );
}
