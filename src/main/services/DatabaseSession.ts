import type {
  DatabaseInfo,
  DatabaseType,
  DdlObjectKind,
  QueryCell,
  QueryResult,
  SchemaGetOptions,
  SchemaObject,
  TableDetail,
  TableExtras,
  TableMeta,
} from '../../shared/ipc-contract';

export interface DatabaseSession {
  readonly dialect: DatabaseType;
  readonly label: string;
  readonly isReadOnly: boolean;
  readonly serverVersion: string;
  /** MySQL 系 `lower_case_table_names`；用于补全插入大小写，其他驱动不设置。 */
  readonly lowerCaseTableNames?: 0 | 1 | 2;
  readonly note?: string;
  /** 取消查询后会话是否失效（SQLite Worker 只能终止）。 */
  readonly cancelDisconnects: boolean;
  /** 会话是否仍可执行查询；Worker 退出/被终止后为 false。 */
  readonly alive: boolean;
  /** `params` 使用驱动占位符（SQLite/MySQL 系均为 `?`）；`maxRows` 控制保留行数。 */
  query(sql: string, params?: QueryCell[], maxRows?: number): Promise<QueryResult>;
  schema(options?: SchemaGetOptions): Promise<SchemaObject[]>;
  /** 当前账号可见的数据库列表（SQLite 返回单库）。 */
  databases(): Promise<DatabaseInfo[]>;
  /** 切换会话当前数据库；SQLite 不支持时抛错。 */
  useDatabase(database: string): Promise<void>;
  /** 表下的约束/触发器/索引；database 用于跨库查询，不改变会话当前库。 */
  tableExtras(database: string, table: string): Promise<TableExtras>;
  /** 返回对象当前的建表/建视图 SQL；找不到时抛错。 */
  getDdl(name: string, kind: DdlObjectKind): Promise<string>;
  /** 表/视图的列、主键与可编辑性；视图也会返回列信息。 */
  getTableMeta(name: string, kind: DdlObjectKind): Promise<TableMeta>;
  /** 表结构详情：列 + 索引 + 外键。 */
  getTableDetail(name: string): Promise<TableDetail>;
  cancel(): Promise<void>;
  close(): Promise<void>;
}
