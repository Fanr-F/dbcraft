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
};

contextBridge.exposeInMainWorld('dbcraft', api);
