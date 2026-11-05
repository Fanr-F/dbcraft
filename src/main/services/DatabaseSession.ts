import type { QueryResult, SchemaObject } from '../../shared/ipc-contract';

export interface DatabaseSession {
  readonly label: string;
  readonly serverVersion: string;
  readonly note?: string;
  query(sql: string): Promise<QueryResult>;
  schema(): Promise<SchemaObject[]>;
  close(): Promise<void>;
}
