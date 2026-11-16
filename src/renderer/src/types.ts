import type {
  ConnectionRecord,
  DatabaseInfo,
  QueryCell,
  QueryColumn,
  QueryMessage,
  SchemaObject,
  TableDetail,
  TableExtras,
} from '@shared/ipc-contract';
import type { TableFilter } from '@shared/dialect/identifiers';

/** 已持久化连接；密码留在主进程，渲染层只拿到不含密码的配置。 */
export type SavedConnection = ConnectionRecord;

/** 单个连接的对象树视图数据（来自它的 browse-<connectionId> 会话）。 */
export interface BrowseConnectionView {
  status: SessionStatus;
  schemaObjects: SchemaObject[];
  databases: DatabaseInfo[];
  objectsByDatabase: Record<string, SchemaObject[]>;
  currentDatabase: string | null;
  databaseLoading: string | null;
  tableExtras: Record<string, TableExtras>;
  showSystemObjects: boolean;
  schemaLoading: boolean;
}

export interface QueryTab {
  id: string;
  title: string;
  /** 用户重命名后的标题；空时使用自动标题。 */
  customTitle?: string;
  sql: string;
  connectionId: string | null;
  /** 保存连接被删除后，tab 继续使用这份快照执行/展示。 */
  connectionSnapshot?: SavedConnection;
  /** 主区域页签类型；缺省为 SQL 编辑器页。作业列表在左侧对象树中展开。 */
  kind?: 'agent-detail' | 'table-design';
  /** 作业详情页对应的作业名。 */
  agentJob?: string;
  /** 新建表 / 编辑表结构页签。 */
  tableDesign?: {
    mode: 'create' | 'edit';
    name: string;
    database?: string;
    /** MSSQL 的对象 schema。 */
    schema?: string;
    /** 编辑模式从数据库读取的原始结构。 */
    detail?: TableDetail;
    /** 从哪个 SQL 标签打开，执行完成后回到该标签。 */
    sourceTabId: string;
  };
  /** 最近一次编辑尚未写入草稿；关闭标签时提示。 */
  dirty?: boolean;
  /** 从磁盘打开的 SQL 文件；保存时直接覆盖。 */
  filePath?: string;
  /** 表数据页：记录分页上下文；普通 SQL 标签为空。 */
  table?: {
    name: string;
    kind?: 'table' | 'view';
    /** 表所属数据库；多库连接切换标签后仍能回到正确库。 */
    database?: string;
    page: number;
    pageSize: number;
    sort?: {
      column: string;
      direction: 'asc' | 'desc';
    };
    /** 多列排序；存在时优先于 sort。数组顺序即 ORDER BY 优先级。 */
    sorts?: Array<{
      column: string;
      direction: 'asc' | 'desc';
    }>;
    filter?: {
      column: string;
      value: string;
    };
    /** 多条件过滤（AND）；存在时优先于 filter。 */
    filters?: TableFilter[];
    /** 与当前 SQL 中的 `?` 对应，重跑时原样带回。 */
    params?: QueryCell[];
  };
}

/** 没有打开任何标签时的占位；不进入 tabs 状态，也不绑定连接。 */
export const EMPTY_TAB: QueryTab = { id: '', title: '', sql: '', connectionId: null };

export interface RunStatement {
  sql: string;
  columns: QueryColumn[];
  rows: QueryCell[][];
  rowCount: number;
  elapsedMs: number;
  statementType: 'select' | 'change' | null;
  changes: number | null;
  truncated: boolean;
  error: string | null;
  errorMeta: string | null;
  errorHint: string | null;
  canceled?: boolean;
  timedOut?: boolean;
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
  /** 多语句执行的逐条结果；单语句执行时为空。 */
  statements?: RunStatement[];
  /** 请求中的语句总数；失败或取消时可能大于已执行数。 */
  scriptTotal?: number;
  /** 当前结果页签索引；`-1` 表示消息面板。 */
  activeResult?: number;
  /** 单条查询的驱动消息。 */
  messages?: QueryMessage[];
}

export type SessionStatus = 'idle' | 'opening' | 'ready' | 'error';

export interface SessionRuntime {
  status: SessionStatus;
  message?: string;
  version?: string;
  lowerCaseTableNames?: 0 | 1 | 2;
  readonly?: boolean;
}

export interface TransactionRuntime {
  state: 'idle' | 'active' | 'unknown';
  startedAt: number | null;
  statements: number;
}

export interface Notice {
  id: number;
  kind: 'info' | 'error';
  text: string;
}
