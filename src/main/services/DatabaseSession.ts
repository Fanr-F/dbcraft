import type {
  DatabaseType,
  DdlObjectKind,
  QueryCell,
  QueryResult,
  SchemaGetOptions,
  SchemaObject,
  TableDetail,
  TableMeta,
} from '../../shared/ipc-contract';

export interface DatabaseSession {
  readonly dialect: DatabaseType;
  readonly label: string;
  readonly isReadOnly: boolean;
  readonly serverVersion: string;
  readonly note?: string;
  /** 取消查询后会话是否失效（SQLite Worker 只能终止）。 */
  readonly cancelDisconnects: boolean;
  /** 会话是否仍可执行查询；Worker 退出/被终止后为 false。 */
  readonly alive: boolean;
  /** `params` 使用驱动占位符（SQLite/MySQL 系均为 `?`）；`maxRows` 控制保留行数。 */
  query(sql: string, params?: QueryCell[], maxRows?: number): Promise<QueryResult>;
  schema(options?: SchemaGetOptions): Promise<SchemaObject[]>;
  /** 返回对象当前的建表/建视图 SQL；找不到时抛错。 */
  getDdl(name: string, kind: DdlObjectKind): Promise<string>;
  /** 表/视图的列、主键与可编辑性；视图也会返回列信息。 */
  getTableMeta(name: string, kind: DdlObjectKind): Promise<TableMeta>;
  /** 表结构详情：列 + 索引 + 外键。 */
  getTableDetail(name: string): Promise<TableDetail>;
  cancel(): Promise<void>;
  close(): Promise<void>;
}
