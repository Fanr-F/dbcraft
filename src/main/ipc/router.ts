import { app, dialog, ipcMain, shell } from 'electron';
import type {
  BrowserWindow,
  IpcMainEvent,
  IpcMainInvokeEvent,
  OpenDialogOptions,
} from 'electron';
import { writeFile, readFile, readdir, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  IPC_CHANNELS,
  type AgentActionResult,
  type AgentDetailResult,
  type AgentListResult,
  type AgentScriptResult,
  type AppDataDirectoryResult,
  type AppInfo,
  type ConnectionDeleteResult,
  type ConnectionImportResult,
  type ConnectionListResult,
  type ConnectionRecord,
  type ConnectionRemoveAllResult,
  type ConnectionSaveResult,
  type ConnectionTestResult,
  type DdlExecuteResult,
  type DdlGetResult,
  type DiagnosticsExportResult,
  type DiagnosticsOpenResult,
  type DiagnosticsRestoreResult,
  type ExportSaveResult,
  type ExportStreamResult,
  type HistoryListResult,
  type QueryResponse,
  type QueryScriptResponse,
  type SchemaGetResult,
  type SessionOpenResult,
  type SettingsGetResult,
  type SettingsSaveResult,
  type SqlFileOpenResult,
  type SqlFileSaveResult,
  type StatsGetResult,
  type TableApplyResult,
  type TableDetailResult,
  type TableMetaResult,
} from '../../shared/ipc-contract';
import {
  getDataLocation,
  resetDataDirectory,
  setDataDirectory,
} from '../storage/data-location';
import {
  agentActionSchema,
  agentDetailSchema,
  agentListSchema,
  agentScriptSchema,
  connectionOpenSchema,
  connectionSaveSchema,
  connectionTestSchema,
  ddlExecuteSchema,
  ddlGetSchema,
  exportSaveSchema,
  exportStreamSchema,
  exportStreamCancelSchema,
  exportXlsxSchema,
  fileSaveSqlSchema,
  fileReadSqlSchema,
  formatConnectionIssues,
  historyListSchema,
  logWriteSchema,
  queryExecuteSchema,
  queryExecuteScriptSchema,
  schemaDescribeSchema,
  schemaDatabasesSchema,
  schemaGetSchema,
  schemaTableExtrasSchema,
  schemaTableSchema,
  schemaUseDatabaseSchema,
  settingsSaveSchema,
  tableApplySchema,
} from './schemas';
import {
  applyTableEdits,
  cancelQuery,
  closeAllSessions,
  closeSession,
  executeQuery,
  executeQueryScript,
  executeDdl,
  getSchema,
  getTableDetail,
  getTableExtras,
  getTableMeta,
  getDdl,
  getMssqlSession,
  listDatabases,
  openSessionById,
  testConnection,
  useDatabase,
} from '../services/ConnectionManager';
import {
  getAgentEditScript,
  getAgentJobDetail,
  listAgentJobs,
  runAgentJobAction,
} from '../services/mssql/agent';
import { parseConnectionExport } from '../../shared/connection-export';
import { connectionProfileKey } from '../../shared/server-identity';
import {
  listConnections,
  removeAllConnections,
  removeConnection,
  saveConnection,
  listQueryHistory,
  removeQueryHistory,
  clearQueryHistory,
  clearConnectionQueryHistory,
  getAppSettings,
  getLocalStats,
  saveAppSettings,
  backupMetadataDatabase,
  restoreMetadataDatabase,
} from '../storage/metadata';
import { createLogger } from '../logging/logger';
import { resolveLogDirectory } from '../logging/logger';
import { buildXlsx } from '../export/xlsx';
import { streamTableCsv } from '../export/stream-csv';

let mainWindow: BrowserWindow | null = null;
let closeApproved = false;
const canceledExports = new Set<string>();
const log = createLogger('ipc');

/** 只接受主窗口主框架发起的 IPC，避免子帧/其他 WebContents 触碰数据库。 */
export function bindMainWindow(window: BrowserWindow): void {
  mainWindow = window;
  closeApproved = false;
}

/** 渲染层处理完未提交修改后放行窗口关闭。 */
export function isMainWindowCloseApproved(): boolean {
  return closeApproved;
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
  handle(IPC_CHANNELS.appConfirmClose, (): void => {
    closeApproved = true;
    mainWindow?.close();
  });

  handle(IPC_CHANNELS.appGetDataLocation, () => getDataLocation());
  handle(
    IPC_CHANNELS.appChooseDataDirectory,
    async (): Promise<AppDataDirectoryResult> => {
      const options: OpenDialogOptions = {
        title: '选择 DBCraft 数据目录',
        properties: ['openDirectory', 'createDirectory'],
      };
      const result = mainWindow
        ? await dialog.showOpenDialog(mainWindow, options)
        : await dialog.showOpenDialog(options);
      if (result.canceled || result.filePaths.length === 0) {
        return { ok: false, canceled: true, message: '已取消选择。' };
      }
      try {
        const location = setDataDirectory(result.filePaths[0]!);
        return {
          ok: true,
          message: '已记录新目录；重启应用后复制元数据库与日志并切换。',
          location,
        };
      } catch (error) {
        return {
          ok: false,
          message: error instanceof Error ? error.message : String(error),
        };
      }
    },
  );
  handle(IPC_CHANNELS.appResetDataDirectory, (): AppDataDirectoryResult => {
    const location = resetDataDirectory();
    return {
      ok: true,
      message: '已恢复默认目录；重启应用后生效。',
      location,
    };
  });

  handle(IPC_CHANNELS.appGetInfo, (): AppInfo => {
    return {
      name: app.getName(),
      version: app.getVersion(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      platform: process.platform,
      userDataPath: app.getPath('userData'),
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
      const parsed = connectionTestSchema.safeParse(rawInput);

      if (!parsed.success) {
        return {
          status: 'failed',
          ok: false,
          message: `连接配置不完整：${formatConnectionIssues(parsed.error)}`,
          elapsedMs: Date.now() - startedAt,
        };
      }

      return testConnection(parsed.data.input, parsed.data.id);
    },
  );

  handle(IPC_CHANNELS.connectionList, (): ConnectionListResult => listConnections());

  handle(
    IPC_CHANNELS.connectionSave,
    (_event, rawInput: unknown): ConnectionSaveResult => {
      const parsed = connectionSaveSchema.safeParse(rawInput);
      if (!parsed.success) {
        return {
          ok: false,
          message: `连接配置不完整：${formatConnectionIssues(parsed.error)}`,
        };
      }

      return saveConnection(parsed.data.input, parsed.data.id, {
        rememberPassword: parsed.data.rememberPassword,
      });
    },
  );

  handle(
    IPC_CHANNELS.connectionRemoveAll,
    async (): Promise<ConnectionRemoveAllResult> => {
      await closeAllSessions();
      return removeAllConnections();
    },
  );

  handle(
    IPC_CHANNELS.connectionDelete,
    (_event, rawInput: unknown): ConnectionDeleteResult => {
      if (typeof rawInput !== 'string' || rawInput.length === 0) {
        return { ok: false, message: '连接 ID 无效。' };
      }
      return removeConnection(rawInput);
    },
  );

  handle(
    IPC_CHANNELS.connectionOpen,
    async (_event, rawInput: unknown): Promise<SessionOpenResult> => {
      const startedAt = Date.now();
      const parsed = connectionOpenSchema.safeParse(rawInput);

      if (!parsed.success) {
        return {
          ok: false,
          message: `会话参数无效：${formatConnectionIssues(parsed.error)}`,
          elapsedMs: Date.now() - startedAt,
        };
      }

      return openSessionById(parsed.data.sessionId, parsed.data.connectionId);
    },
  );

  handle(IPC_CHANNELS.connectionImport, async (): Promise<ConnectionImportResult> => {
    const options: OpenDialogOptions = {
      title: '导入连接配置',
      properties: ['openFile'],
      filters: [{ name: 'DBCraft 连接配置', extensions: ['json'] }],
    };

    const picked = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options);

    if (picked.canceled || !picked.filePaths[0]) {
      return { ok: false, canceled: true, message: '已取消导入。' };
    }

    let text: string;
    try {
      text = await readFile(picked.filePaths[0], 'utf8');
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }

    if (text.length > 1_000_000) {
      return { ok: false, message: '文件过大：连接配置上限 1 MB。' };
    }

    const parsed = parseConnectionExport(text);
    if (!parsed.ok) {
      return { ok: false, message: parsed.message };
    }

    const imported: ConnectionRecord[] = [];
    let skipped = 0;
    let duplicates = 0;
    const existing = listConnections();
    const existingKeys = new Set(
      existing.ok
        ? existing.connections.map((connection) => connectionProfileKey(connection.input))
        : [],
    );

    for (const input of parsed.inputs) {
      const key = connectionProfileKey(input);
      if (existingKeys.has(key)) {
        duplicates += 1;
        continue;
      }
      const saved = saveConnection(input);
      if (saved.ok) {
        imported.push(saved.connection);
        existingKeys.add(key);
      } else {
        skipped += 1;
      }
    }

    if (imported.length === 0) {
      return {
        ok: false,
        message:
          duplicates > 0
            ? `${duplicates} 个连接已存在，未重复导入。`
            : '没有连接被导入。',
      };
    }

    log.info('连接配置已导入', { imported: imported.length, skipped, duplicates });
    return { ok: true, imported, skipped, duplicates };
  });

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

  handle(
    IPC_CHANNELS.queryExecuteScript,
    async (_event, rawInput: unknown): Promise<QueryScriptResponse> => {
      const parsed = queryExecuteScriptSchema.safeParse(rawInput);
      if (!parsed.success) {
        return {
          ok: false,
          error: {
            message: `SQL 脚本无效：${formatConnectionIssues(parsed.error)}`,
            code: 'INVALID_REQUEST',
            sqlState: null,
            errno: null,
            retryable: false,
          },
        };
      }
      return executeQueryScript(parsed.data);
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
      const parsed = schemaGetSchema.safeParse(rawInput);
      if (!parsed.success) {
        return { ok: false, message: '会话参数无效。' };
      }

      return getSchema(parsed.data.sessionId, {
        includeSystemObjects: parsed.data.includeSystemObjects,
        ...(parsed.data.database ? { database: parsed.data.database } : {}),
      });
    },
  );

  handle(
    IPC_CHANNELS.schemaDatabases,
    async (_event, rawInput: unknown) => {
      const parsed = schemaDatabasesSchema.safeParse(rawInput);
      if (!parsed.success) {
        return { ok: false as const, message: '会话参数无效。' };
      }
      return listDatabases(parsed.data.sessionId);
    },
  );

  handle(
    IPC_CHANNELS.schemaUseDatabase,
    async (_event, rawInput: unknown) => {
      const parsed = schemaUseDatabaseSchema.safeParse(rawInput);
      if (!parsed.success) {
        return { ok: false as const, message: '数据库参数无效。' };
      }
      return useDatabase(parsed.data.sessionId, parsed.data.database);
    },
  );

  handle(
    IPC_CHANNELS.schemaTableExtras,
    async (_event, rawInput: unknown) => {
      const parsed = schemaTableExtrasSchema.safeParse(rawInput);
      if (!parsed.success) {
        return { ok: false as const, message: '表子对象参数无效。' };
      }
      return getTableExtras(
        parsed.data.sessionId,
        parsed.data.database,
        parsed.data.table,
      );
    },
  );

  handle(
    IPC_CHANNELS.schemaTable,
    async (_event, rawInput: unknown): Promise<TableMetaResult> => {
      const parsed = schemaTableSchema.safeParse(rawInput);
      if (!parsed.success) {
        return { ok: false, message: '表元数据参数无效。' };
      }

      return getTableMeta(parsed.data.sessionId, parsed.data.name, parsed.data.kind);
    },
  );

  handle(
    IPC_CHANNELS.schemaDescribe,
    async (_event, rawInput: unknown): Promise<TableDetailResult> => {
      const parsed = schemaDescribeSchema.safeParse(rawInput);
      if (!parsed.success) {
        return { ok: false, message: '表结构参数无效。' };
      }
      return getTableDetail(parsed.data.sessionId, parsed.data.name);
    },
  );

  handle(
    IPC_CHANNELS.tableApply,
    async (_event, rawInput: unknown): Promise<TableApplyResult> => {
      const parsed = tableApplySchema.safeParse(rawInput);
      if (!parsed.success) {
        return {
          ok: false,
          message: `表格编辑参数无效：${formatConnectionIssues(parsed.error)}`,
          conflict: false,
          applied: 0,
          elapsedMs: 0,
        };
      }

      return applyTableEdits(parsed.data);
    },
  );

  handle(
    IPC_CHANNELS.agentList,
    async (_event, rawInput: unknown): Promise<AgentListResult> => {
      const parsed = agentListSchema.safeParse(rawInput);
      if (!parsed.success) {
        return { ok: false, message: 'Agent 参数无效。' };
      }
      const session = getMssqlSession(parsed.data.sessionId);
      if (!session) {
        return { ok: false, message: '当前标签不是 MSSQL 会话，请先连接 MSSQL。' };
      }
      return listAgentJobs(
        session,
        parsed.data.search,
        parsed.data.page,
        parsed.data.pageSize,
      );
    },
  );

  handle(
    IPC_CHANNELS.agentDetail,
    async (_event, rawInput: unknown): Promise<AgentDetailResult> => {
      const parsed = agentDetailSchema.safeParse(rawInput);
      if (!parsed.success) {
        return { ok: false, message: 'Agent 参数无效。' };
      }
      const session = getMssqlSession(parsed.data.sessionId);
      if (!session) {
        return { ok: false, message: '当前标签不是 MSSQL 会话，请先连接 MSSQL。' };
      }
      return getAgentJobDetail(
        session,
        parsed.data.jobName,
        parsed.data.historyLimit ?? 100,
      );
    },
  );

  handle(
    IPC_CHANNELS.agentAction,
    async (_event, rawInput: unknown): Promise<AgentActionResult> => {
      const parsed = agentActionSchema.safeParse(rawInput);
      if (!parsed.success) {
        return { ok: false, message: 'Agent 操作参数无效。' };
      }
      const session = getMssqlSession(parsed.data.sessionId);
      if (!session) {
        return { ok: false, message: '当前标签不是 MSSQL 会话，请先连接 MSSQL。' };
      }
      return runAgentJobAction(session, parsed.data.action, parsed.data.jobName, {
        connectionId: parsed.data.connectionId,
        connectionName: parsed.data.connectionName,
        database: parsed.data.database,
      });
    },
  );

  handle(
    IPC_CHANNELS.agentScript,
    async (_event, rawInput: unknown): Promise<AgentScriptResult> => {
      const parsed = agentScriptSchema.safeParse(rawInput);
      if (!parsed.success) {
        return { ok: false, message: 'Agent 参数无效。' };
      }
      const session = getMssqlSession(parsed.data.sessionId);
      if (!session) {
        return { ok: false, message: '当前标签不是 MSSQL 会话，请先连接 MSSQL。' };
      }
      return getAgentEditScript(session, parsed.data.jobName);
    },
  );

  handle(
    IPC_CHANNELS.ddlGet,
    async (_event, rawInput: unknown): Promise<DdlGetResult> => {
      const parsed = ddlGetSchema.safeParse(rawInput);
      if (!parsed.success) {
        return { ok: false, message: 'DDL 参数无效。' };
      }

      return getDdl(parsed.data.sessionId, parsed.data.name, parsed.data.kind);
    },
  );

  handle(
    IPC_CHANNELS.ddlExecute,
    async (_event, rawInput: unknown): Promise<DdlExecuteResult> => {
      const parsed = ddlExecuteSchema.safeParse(rawInput);
      if (!parsed.success) {
        return {
          ok: false,
          message: `DDL 参数无效：${formatConnectionIssues(parsed.error)}`,
          results: [],
          elapsedMs: 0,
        };
      }

      return executeDdl(
        parsed.data.sessionId,
        parsed.data.statements,
        parsed.data.options,
      );
    },
  );

  handle(
    IPC_CHANNELS.exportSave,
    async (_event, rawInput: unknown): Promise<ExportSaveResult> => {
      const parsed = exportSaveSchema.safeParse(rawInput);
      if (!parsed.success) {
        return { ok: false, message: '导出参数无效。' };
      }

      const { suggestedName, content } = parsed.data;
      const dot = suggestedName.lastIndexOf('.');
      const extension = dot >= 0 ? suggestedName.slice(dot + 1).toLowerCase() : 'txt';

      const options = {
        title: '导出结果',
        defaultPath: suggestedName,
        filters: [{ name: '导出文件', extensions: [extension] }],
      };

      const result = mainWindow
        ? await dialog.showSaveDialog(mainWindow, options)
        : await dialog.showSaveDialog(options);

      if (result.canceled || !result.filePath) {
        return { ok: false, canceled: true, message: '已取消导出。' };
      }

      let filePath = result.filePath;
      if (!/\.\w+$/i.test(filePath)) {
        filePath = `${filePath}.${extension}`;
      }

      try {
        await writeFile(filePath, content, 'utf8');
        log.info('结果已导出', { extension, bytes: content.length });
        return { ok: true, path: filePath };
      } catch (error) {
        return {
          ok: false,
          message: error instanceof Error ? error.message : String(error),
        };
      }
    },
  );

  handle(
    IPC_CHANNELS.exportStreamCsv,
    async (event, rawInput: unknown): Promise<ExportStreamResult> => {
      const parsed = exportStreamSchema.safeParse(rawInput);
      if (!parsed.success) {
        return { ok: false, message: '流式导出参数无效。' };
      }
      const request = parsed.data;
      const options = {
        title: '流式导出 CSV',
        defaultPath: request.suggestedName,
        filters: [{ name: 'CSV 文件', extensions: ['csv'] }],
      };
      const picked = mainWindow
        ? await dialog.showSaveDialog(mainWindow, options)
        : await dialog.showSaveDialog(options);
      if (picked.canceled || !picked.filePath) {
        return { ok: false, canceled: true, message: '已取消导出。' };
      }
      let filePath = picked.filePath;
      if (!/\.\w+$/i.test(filePath)) filePath = `${filePath}.csv`;

      canceledExports.delete(request.requestId);
      const result = await streamTableCsv(
        request,
        filePath,
        (progress) => {
          if (!event.sender.isDestroyed()) {
            event.sender.send(IPC_CHANNELS.exportStreamProgress, progress);
          }
        },
        () => canceledExports.has(request.requestId),
      );
      canceledExports.delete(request.requestId);
      if (result.ok) {
        log.info('流式 CSV 已导出', { rows: result.rows, bytes: result.bytes });
      }
      return result;
    },
  );

  handle(IPC_CHANNELS.exportStreamCancel, (_event, rawInput: unknown): void => {
    const parsed = exportStreamCancelSchema.safeParse(rawInput);
    if (parsed.success) canceledExports.add(parsed.data.requestId);
  });

  handle(
    IPC_CHANNELS.exportSaveXlsx,
    async (_event, rawInput: unknown): Promise<ExportSaveResult> => {
      const parsed = exportXlsxSchema.safeParse(rawInput);
      if (!parsed.success) {
        return { ok: false, message: 'Excel 导出参数无效。' };
      }

      const { suggestedName, columns, rows } = parsed.data;
      const options = {
        title: '导出 Excel',
        defaultPath: suggestedName,
        filters: [{ name: 'Excel 工作簿', extensions: ['xlsx'] }],
      };
      const picked = mainWindow
        ? await dialog.showSaveDialog(mainWindow, options)
        : await dialog.showSaveDialog(options);

      if (picked.canceled || !picked.filePath) {
        return { ok: false, canceled: true, message: '已取消导出。' };
      }

      let filePath = picked.filePath;
      if (!/\.\w+$/i.test(filePath)) {
        filePath = `${filePath}.xlsx`;
      }

      try {
        const workbook = buildXlsx({ columns, rows });
        await writeFile(filePath, workbook);
        log.info('Excel 已导出', { bytes: workbook.length, rows: rows.length });
        return { ok: true, path: filePath };
      } catch (error) {
        return {
          ok: false,
          message: error instanceof Error ? error.message : String(error),
        };
      }
    },
  );

  handle(
    IPC_CHANNELS.historyList,
    (_event, rawInput: unknown): HistoryListResult => {
      const parsed = historyListSchema.safeParse(rawInput ?? {});
      if (!parsed.success) {
        return { ok: false, message: '历史查询参数无效。' };
      }
      return listQueryHistory(parsed.data);
    },
  );

  handle(IPC_CHANNELS.historyDelete, (_event, rawInput: unknown) => {
    if (
      typeof rawInput !== 'number' ||
      !Number.isInteger(rawInput) ||
      rawInput <= 0
    ) {
      return { ok: false, message: '记录 ID 无效。' };
    }
    return removeQueryHistory(rawInput);
  });

  handle(IPC_CHANNELS.historyClear, () => clearQueryHistory());

  handle(IPC_CHANNELS.historyClearConnection, (_event, rawInput: unknown) => {
    if (typeof rawInput !== 'string' || rawInput.length === 0) {
      return { ok: false, message: '连接 ID 无效。' };
    }
    return clearConnectionQueryHistory(rawInput);
  });

  handle(IPC_CHANNELS.settingsGet, (): SettingsGetResult => getAppSettings());

  handle(IPC_CHANNELS.statsGet, (): StatsGetResult => getLocalStats());

  handle(
    IPC_CHANNELS.settingsSave,
    (_event, rawInput: unknown): SettingsSaveResult => {
      const parsed = settingsSaveSchema.safeParse(rawInput);
      if (!parsed.success) {
        return { ok: false, message: '设置参数无效。' };
      }
      return saveAppSettings(parsed.data);
    },
  );

  handle(
    IPC_CHANNELS.diagnosticsExportLogs,
    async (): Promise<DiagnosticsExportResult> => {
      const directory = resolveLogDirectory();
      let files: string[] = [];
      try {
        files = (await readdir(directory))
          .filter((name) => name.startsWith('dbcraft.log'))
          .sort();
      } catch {
        files = [];
      }

      if (files.length === 0) {
        return {
          ok: false,
          message: `日志目录中没有可导出的文件：${directory}`,
        };
      }

      const maxBytes = 10 * 1024 * 1024;
      const parts: string[] = [
        '# DBCraft 诊断日志',
        `导出时间: ${new Date().toISOString()}`,
        `应用版本: ${app.getVersion()} / Electron ${process.versions.electron}`,
        `平台: ${process.platform} ${process.arch}`,
        `日志目录: ${directory}`,
        '',
      ];
      let total = 0;
      for (const name of files) {
        if (total >= maxBytes) {
          parts.push('--- 日志总量超过 10 MB，后续文件未包含 ---');
          break;
        }
        try {
          const content = await readFile(join(directory, name), 'utf8');
          const slice = content.slice(0, Math.max(0, maxBytes - total));
          parts.push(`--- ${name} ---`, slice, '');
          total += slice.length;
        } catch (error) {
          parts.push(
            `--- ${name} 读取失败: ${error instanceof Error ? error.message : String(error)} ---`,
          );
        }
      }

      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const options = {
        title: '导出诊断日志',
        defaultPath: `dbcraft-diagnostics-${stamp}.log`,
        filters: [{ name: '日志文件', extensions: ['log'] }],
      };
      const picked = mainWindow
        ? await dialog.showSaveDialog(mainWindow, options)
        : await dialog.showSaveDialog(options);

      if (picked.canceled || !picked.filePath) {
        return { ok: false, canceled: true, message: '已取消导出。' };
      }

      let filePath = picked.filePath;
      if (!/\.\w+$/i.test(filePath)) {
        filePath = `${filePath}.log`;
      }

      try {
        await writeFile(filePath, parts.join('\n'), 'utf8');
        log.info('诊断日志已导出', { files: files.length, bytes: total });
        return { ok: true, path: filePath };
      } catch (error) {
        return {
          ok: false,
          message: error instanceof Error ? error.message : String(error),
        };
      }
    },
  );

  handle(
    IPC_CHANNELS.diagnosticsOpenLogDir,
    async (): Promise<DiagnosticsOpenResult> => {
      const directory = resolveLogDirectory();
      try {
        await mkdir(directory, { recursive: true });
      } catch (error) {
        return {
          ok: false,
          message: error instanceof Error ? error.message : String(error),
        };
      }
      const failure = await shell.openPath(directory);
      return failure ? { ok: false, message: failure } : { ok: true };
    },
  );

  handle(
    IPC_CHANNELS.fileOpenSql,
    async (): Promise<SqlFileOpenResult> => {
      const options: OpenDialogOptions = {
        title: '打开 SQL 文件',
        properties: ['openFile'],
        filters: [
          { name: 'SQL 文件', extensions: ['sql', 'txt'] },
          { name: '所有文件', extensions: ['*'] },
        ],
      };
      const picked = mainWindow
        ? await dialog.showOpenDialog(mainWindow, options)
        : await dialog.showOpenDialog(options);
      if (picked.canceled || !picked.filePaths[0]) {
        return { ok: false, canceled: true, message: '已取消打开。' };
      }

      try {
        const content = await readFile(picked.filePaths[0], 'utf8');
        if (content.length > 2_000_000) {
          return { ok: false, message: 'SQL 文件过大：上限 2 MB。' };
        }
        return { ok: true, path: picked.filePaths[0], content };
      } catch (error) {
        return {
          ok: false,
          message: error instanceof Error ? error.message : String(error),
        };
      }
    },
  );

  handle(
    IPC_CHANNELS.fileReadSql,
    async (_event, rawInput: unknown): Promise<SqlFileOpenResult> => {
      const parsed = fileReadSqlSchema.safeParse(rawInput);
      if (!parsed.success) return { ok: false, message: '文件路径无效。' };
      try {
        const content = await readFile(parsed.data.path, 'utf8');
        if (content.length > 2_000_000) {
          return { ok: false, message: 'SQL 文件过大：上限 2 MB。' };
        }
        return { ok: true, path: parsed.data.path, content };
      } catch (error) {
        return {
          ok: false,
          message: error instanceof Error ? error.message : String(error),
        };
      }
    },
  );

  handle(
    IPC_CHANNELS.fileSaveSql,
    async (_event, rawInput: unknown): Promise<SqlFileSaveResult> => {
      const parsed = fileSaveSqlSchema.safeParse(rawInput);
      if (!parsed.success) {
        return { ok: false, message: '保存参数无效。' };
      }
      const { content, path, suggestedName } = parsed.data;

      let filePath = path;
      if (!filePath) {
        const options = {
          title: '保存 SQL 文件',
          defaultPath: suggestedName,
          filters: [{ name: 'SQL 文件', extensions: ['sql'] }],
        };
        const picked = mainWindow
          ? await dialog.showSaveDialog(mainWindow, options)
          : await dialog.showSaveDialog(options);
        if (picked.canceled || !picked.filePath) {
          return { ok: false, canceled: true, message: '已取消保存。' };
        }
        filePath = picked.filePath;
      }

      if (!/\.\w+$/i.test(filePath)) {
        filePath = `${filePath}.sql`;
      }

      try {
        await writeFile(filePath, content, 'utf8');
        log.info('SQL 文件已保存', { bytes: content.length });
        return { ok: true, path: filePath };
      } catch (error) {
        return {
          ok: false,
          message: error instanceof Error ? error.message : String(error),
        };
      }
    },
  );

  handle(
    IPC_CHANNELS.diagnosticsBackupDatabase,
    async (): Promise<DiagnosticsExportResult> => {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const options = {
        title: '备份元数据库',
        defaultPath: `dbcraft-backup-${stamp}.db`,
        filters: [{ name: 'SQLite 数据库', extensions: ['db'] }],
      };
      const picked = mainWindow
        ? await dialog.showSaveDialog(mainWindow, options)
        : await dialog.showSaveDialog(options);

      if (picked.canceled || !picked.filePath) {
        return { ok: false, canceled: true, message: '已取消备份。' };
      }

      let filePath = picked.filePath;
      if (!/\.\w+$/i.test(filePath)) {
        filePath = `${filePath}.db`;
      }

      try {
        await backupMetadataDatabase(filePath);
        return { ok: true, path: filePath };
      } catch (error) {
        return {
          ok: false,
          message: error instanceof Error ? error.message : String(error),
        };
      }
    },
  );

  handle(
    IPC_CHANNELS.diagnosticsRestoreDatabase,
    async (): Promise<DiagnosticsRestoreResult> => {
      const options: OpenDialogOptions = {
        title: '恢复元数据库备份',
        properties: ['openFile'],
        filters: [
          { name: 'SQLite 数据库', extensions: ['db', 'sqlite', 'sqlite3'] },
          { name: '所有文件', extensions: ['*'] },
        ],
      };
      const picked = mainWindow
        ? await dialog.showOpenDialog(mainWindow, options)
        : await dialog.showOpenDialog(options);

      if (picked.canceled || !picked.filePaths[0]) {
        return { ok: false, canceled: true, message: '已取消恢复。' };
      }

      try {
        // 先关闭用户数据库会话，避免恢复后仍持有旧连接配置。
        await closeAllSessions();
        const result = restoreMetadataDatabase(picked.filePaths[0]);
        if (!result.ok) {
          return { ok: false, message: result.message };
        }
        return { ok: true, preRestoreBackup: result.preRestoreBackup };
      } catch (error) {
        return {
          ok: false,
          message: error instanceof Error ? error.message : String(error),
        };
      }
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
