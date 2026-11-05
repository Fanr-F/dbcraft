import type { ConnectionInput, QueryCell, QueryColumn } from '@shared/ipc-contract';

export interface SavedConnection {
  id: string;
  input: ConnectionInput;
}

export interface QueryTab {
  id: string;
  title: string;
  sql: string;
}

export interface RunState {
  columns: QueryColumn[];
  rows: QueryCell[][];
  rowCount: number;
  elapsedMs: number;
  statementType: 'select' | 'change' | null;
  changes: number | null;
  truncated: boolean;
  executedAt: number | null;
  error: string | null;
}

export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'error';

export interface ConnectionRuntime {
  status: ConnectionStatus;
  message?: string;
  version?: string;
}

export interface Notice {
  id: number;
  kind: 'info' | 'error';
  text: string;
}
