import type { ConnectionInput, QueryCell, QueryColumn } from '@shared/ipc-contract';

export interface SavedConnection {
  id: string;
  input: ConnectionInput;
}

export interface QueryTab {
  id: string;
  title: string;
  sql: string;
  connectionId: string | null;
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

export type SessionStatus = 'idle' | 'opening' | 'ready' | 'error';

export interface SessionRuntime {
  status: SessionStatus;
  message?: string;
  version?: string;
}

export interface Notice {
  id: number;
  kind: 'info' | 'error';
  text: string;
}
