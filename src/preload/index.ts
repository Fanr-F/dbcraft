import { contextBridge, ipcRenderer } from 'electron';
import {
  IPC_CHANNELS,
  type ConnectionInput,
  type DBCraftApi,
} from '../shared/ipc-contract';

const api: DBCraftApi = {
  app: {
    getInfo: () => ipcRenderer.invoke(IPC_CHANNELS.appGetInfo),
  },
  dialog: {
    selectSqliteFile: () => ipcRenderer.invoke(IPC_CHANNELS.dialogSelectSqliteFile),
  },
  connection: {
    test: (input: ConnectionInput) => ipcRenderer.invoke(IPC_CHANNELS.connectionTest, input),
  },
  session: {
    open: (sessionId: string, input: ConnectionInput) =>
      ipcRenderer.invoke(IPC_CHANNELS.sessionOpen, { sessionId, config: input }),
    close: (sessionId: string) => ipcRenderer.invoke(IPC_CHANNELS.sessionClose, sessionId),
  },
  query: {
    execute: (request) => ipcRenderer.invoke(IPC_CHANNELS.queryExecute, request),
    cancel: (requestId: string) => ipcRenderer.invoke(IPC_CHANNELS.queryCancel, requestId),
  },
  schema: {
    get: (sessionId: string) => ipcRenderer.invoke(IPC_CHANNELS.schemaGet, sessionId),
  },
  log: {
    write: (level, scope, message, meta) =>
      ipcRenderer.send(IPC_CHANNELS.logWrite, { level, scope, message, meta }),
  },
};

contextBridge.exposeInMainWorld('dbcraft', api);
