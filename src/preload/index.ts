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
    open: (connectionId: string, input: ConnectionInput) =>
      ipcRenderer.invoke(IPC_CHANNELS.connectionOpen, { connectionId, config: input }),
    close: (connectionId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.connectionClose, connectionId),
  },
  query: {
    execute: (request) => ipcRenderer.invoke(IPC_CHANNELS.queryExecute, request),
  },
  schema: {
    get: (connectionId: string) => ipcRenderer.invoke(IPC_CHANNELS.schemaGet, connectionId),
  },
};

contextBridge.exposeInMainWorld('dbcraft', api);
