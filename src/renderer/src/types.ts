import type { ConnectionInput } from '@shared/ipc-contract';
import type { DemoRow } from './data/mock';

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
  rows: DemoRow[];
  elapsedMs: number;
  executedAt: number | null;
  simulated: boolean;
}
