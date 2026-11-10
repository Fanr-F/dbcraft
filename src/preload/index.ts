import { contextBridge, ipcRenderer } from 'electron';
import {
  IPC_CHANNELS,
  type ConnectionInput,
  type ConnectionSaveOptions,
  type DBCraftApi,
} from '../shared/ipc-contract';

const api: DBCraftApi = {
  app: {
    getInfo: () => ipcRenderer.invoke(IPC_CHANNELS.appGetInfo),
    onCloseRequested: (handler: () => void) => {
      const listener = () => handler();
      ipcRenderer.on(IPC_CHANNELS.appCloseRequested, listener);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.appCloseRequested, listener);
    },
    confirmClose: () => ipcRenderer.invoke(IPC_CHANNELS.appConfirmClose),
  },
  dialog: {
    selectSqliteFile: () => ipcRenderer.invoke(IPC_CHANNELS.dialogSelectSqliteFile),
  },
  connection: {
    test: (input: ConnectionInput, id?: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.connectionTest, { input, id }),
    list: () => ipcRenderer.invoke(IPC_CHANNELS.connectionList),
    save: (input: ConnectionInput, id?: string, options?: ConnectionSaveOptions) =>
      ipcRenderer.invoke(IPC_CHANNELS.connectionSave, {
        input,
        id,
        rememberPassword: options?.rememberPassword,
      }),
    remove: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.connectionDelete, id),
    removeAll: () => ipcRenderer.invoke(IPC_CHANNELS.connectionRemoveAll),
    open: (sessionId: string, connectionId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.connectionOpen, { sessionId, connectionId }),
    import: () => ipcRenderer.invoke(IPC_CHANNELS.connectionImport),
  },
  session: {
    close: (sessionId: string) => ipcRenderer.invoke(IPC_CHANNELS.sessionClose, sessionId),
  },
  query: {
    execute: (request) => ipcRenderer.invoke(IPC_CHANNELS.queryExecute, request),
    executeScript: (request) =>
      ipcRenderer.invoke(IPC_CHANNELS.queryExecuteScript, request),
    cancel: (requestId: string) => ipcRenderer.invoke(IPC_CHANNELS.queryCancel, requestId),
  },
  schema: {
    get: (sessionId: string, options) =>
      ipcRenderer.invoke(IPC_CHANNELS.schemaGet, { sessionId, ...options }),
    databases: (sessionId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.schemaDatabases, { sessionId }),
    useDatabase: (sessionId: string, database: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.schemaUseDatabase, { sessionId, database }),
    tableExtras: (sessionId: string, database: string, table: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.schemaTableExtras, { sessionId, database, table }),
    table: (sessionId: string, name: string, kind) =>
      ipcRenderer.invoke(IPC_CHANNELS.schemaTable, { sessionId, name, kind }),
    describe: (sessionId: string, name: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.schemaDescribe, { sessionId, name }),
  },
  table: {
    apply: (request) => ipcRenderer.invoke(IPC_CHANNELS.tableApply, request),
  },
  agent: {
    list: (sessionId: string, search = '') =>
      ipcRenderer.invoke(IPC_CHANNELS.agentList, { sessionId, search }),
    detail: (sessionId: string, jobName: string, historyLimit?: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.agentDetail, { sessionId, jobName, historyLimit }),
    action: (sessionId, jobName, action, context = {}) =>
      ipcRenderer.invoke(IPC_CHANNELS.agentAction, {
        sessionId,
        jobName,
        action,
        ...context,
      }),
    script: (sessionId: string, jobName: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.agentScript, { sessionId, jobName }),
  },
  ddl: {
    get: (sessionId: string, name: string, kind) =>
      ipcRenderer.invoke(IPC_CHANNELS.ddlGet, { sessionId, name, kind }),
    execute: (sessionId: string, statements: string[], options?) =>
      ipcRenderer.invoke(IPC_CHANNELS.ddlExecute, { sessionId, statements, options }),
  },
  export: {
    save: (request) => ipcRenderer.invoke(IPC_CHANNELS.exportSave, request),
    saveXlsx: (request) => ipcRenderer.invoke(IPC_CHANNELS.exportSaveXlsx, request),
  },
  history: {
    list: (options = {}) => ipcRenderer.invoke(IPC_CHANNELS.historyList, options),
    remove: (id: number) => ipcRenderer.invoke(IPC_CHANNELS.historyDelete, id),
    clear: () => ipcRenderer.invoke(IPC_CHANNELS.historyClear),
    clearConnection: (connectionId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.historyClearConnection, connectionId),
  },
  settings: {
    get: () => ipcRenderer.invoke(IPC_CHANNELS.settingsGet),
    save: (settings) => ipcRenderer.invoke(IPC_CHANNELS.settingsSave, settings),
  },
  stats: {
    get: () => ipcRenderer.invoke(IPC_CHANNELS.statsGet),
  },
  diagnostics: {
    exportLogs: () => ipcRenderer.invoke(IPC_CHANNELS.diagnosticsExportLogs),
    openLogDir: () => ipcRenderer.invoke(IPC_CHANNELS.diagnosticsOpenLogDir),
    backupDatabase: () => ipcRenderer.invoke(IPC_CHANNELS.diagnosticsBackupDatabase),
    restoreDatabase: () => ipcRenderer.invoke(IPC_CHANNELS.diagnosticsRestoreDatabase),
  },
  file: {
    openSql: () => ipcRenderer.invoke(IPC_CHANNELS.fileOpenSql),
    readSql: (path: string) => ipcRenderer.invoke(IPC_CHANNELS.fileReadSql, { path }),
    saveSql: (request) => ipcRenderer.invoke(IPC_CHANNELS.fileSaveSql, request),
  },
  log: {
    write: (level, scope, message, meta) =>
      ipcRenderer.send(IPC_CHANNELS.logWrite, { level, scope, message, meta }),
  },
};

contextBridge.exposeInMainWorld('dbcraft', api);
