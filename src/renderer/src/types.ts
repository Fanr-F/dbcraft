import type { ConnectionRecord, QueryCell, QueryColumn } from '@shared/ipc-contract';

/** 已持久化连接；密码留在主进程，渲染层只拿到不含密码的配置。 */
export type SavedConnection = ConnectionRecord;

export interface QueryTab {
  id: string;
  title: string;
  sql: string;
  connectionId: string | null;
  /** 最近一次编辑尚未写入草稿；关闭标签时提示。 */
  dirty?: boolean;
  /** 从磁盘打开的 SQL 文件；保存时直接覆盖。 */
  filePath?: string;
  /** 表数据页：记录分页上下文；普通 SQL 标签为空。 */
  table?: {
    name: string;
    kind?: 'table' | 'view';
    page: number;
    pageSize: number;
    sort?: {
      column: string;
      direction: 'asc' | 'desc';
    };
    filter?: {
      column: string;
      value: string;
    };
    /** 与当前 SQL 中的 `?` 对应，重跑时原样带回。 */
    params?: QueryCell[];
  };
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
  errorMeta: string | null;
  errorHint: string | null;
}

export type SessionStatus = 'idle' | 'opening' | 'ready' | 'error';

export interface SessionRuntime {
  status: SessionStatus;
  message?: string;
  version?: string;
  readonly?: boolean;
}

export interface Notice {
  id: number;
  kind: 'info' | 'error';
  text: string;
}
