import type { QueryResult, SchemaObject } from '../../shared/ipc-contract';

export interface DatabaseSession {
  readonly label: string;
  readonly serverVersion: string;
  readonly note?: string;
  /** 取消查询后会话是否失效（SQLite Worker 只能终止）。 */
  readonly cancelDisconnects: boolean;
  /** 会话是否仍可执行查询；Worker 退出/被终止后为 false。 */
  readonly alive: boolean;
  query(sql: string): Promise<QueryResult>;
  schema(): Promise<SchemaObject[]>;
  cancel(): Promise<void>;
  close(): Promise<void>;
}
