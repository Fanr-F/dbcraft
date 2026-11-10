export type DatabaseType = 'sqlite' | 'mysql' | 'percona' | 'mariadb' | 'mssql';
export type MysqlFamilyType = Extract<DatabaseType, 'mysql' | 'percona' | 'mariadb'>;
export type EnvironmentTag = 'dev' | 'test' | 'prod';
export type SslMode = 'disable' | 'prefer' | 'require' | 'verify-ca' | 'verify-full';
export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

export interface ConnectionCommon {
  name: string;
  group: string;
  env: EnvironmentTag;
}

export interface SqliteConnectionInput extends ConnectionCommon {
  type: 'sqlite';
  filePath: string;
}

export interface MysqlFamilyConnectionInput extends ConnectionCommon {
  type: MysqlFamilyType;
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
  sslMode: SslMode;
  /** 可选字符集（如 utf8mb4）；留空使用驱动默认值。 */
  charset?: string;
}

export interface MssqlConnectionInput extends ConnectionCommon {
  type: 'mssql';
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
  encrypt: boolean;
  trustServerCertificate: boolean;
  /** 命名实例；填写后忽略 port，通过 SQL Browser（UDP 1434）解析实际端口。 */
  instanceName?: string;
}

export type ConnectionInput = SqliteConnectionInput | MysqlFamilyConnectionInput | MssqlConnectionInput;

export type ConnectionTestStatus = 'ok' | 'failed' | 'not-implemented';

export interface ConnectionTestResult {
  status: ConnectionTestStatus;
  ok: boolean;
  message: string;
  elapsedMs: number;
  /** SQLite 文件被占用/无写权限时，测试连接会以只读方式成功。 */
  readonly?: boolean;
}

export interface SessionOpenResult {
  ok: boolean;
  message: string;
  elapsedMs: number;
  serverVersion?: string;
  /** SQLite 文件被占用/不可写时以只读方式打开。 */
  readonly?: boolean;
}

export interface ConnectionSaveOptions {
  /**
   * 是否把密码保存到本地。默认 true。
   * false 会清除已保存的密码；本次会话仍可使用输入框中的密码测试连接。
   */
  rememberPassword?: boolean;
}

/** 已持久化的连接；`input.password` 永远是空串，密码只在主进程内解密使用。 */
export interface ConnectionRecord {
  id: string;
  input: ConnectionInput;
  passwordStored: boolean;
  createdAt: string;
  updatedAt: string;
  /** 所属服务器 id；服务器是连接配置的归属（PRD v0.20 Q21 A）。 */
  serverId?: string;
  /** 服务器展示名（host:port / instance / SQLite 文件路径）。 */
  serverName?: string;
}

export type ConnectionListResult =
  | { ok: true; connections: ConnectionRecord[] }
  | { ok: false; message: string };

export type ConnectionSaveResult =
  | { ok: true; connection: ConnectionRecord; warning?: string }
  | { ok: false; message: string };

export type ConnectionDeleteResult = { ok: true } | { ok: false; message: string };

export type ConnectionRemoveAllResult =
  | { ok: true; removed: number }
  | { ok: false; message: string };

export type ConnectionImportResult =
  | {
      ok: true;
      imported: ConnectionRecord[];
      skipped: number;
      /** 因「同服务器 + 同名」而跳过的重复配置数量。 */
      duplicates?: number;
    }
  | { ok: false; canceled?: boolean; message: string };

export type QueryCell = string | number | boolean | null;

export interface QueryColumn {
  name: string;
  declaredType: string | null;
}

export interface QueryMessage {
  level: 'info' | 'warn' | 'error';
  text: string;
}

export interface QueryResult {
  columns: QueryColumn[];
  rows: QueryCell[][];
  rowCount: number;
  elapsedMs: number;
  statementType: 'select' | 'change';
  changes: number | null;
  truncated: boolean;
  /** 驱动消息（MSSQL PRINT/RAISERROR、MySQL warning 等）。 */
  messages?: QueryMessage[];
}

export interface QueryError {
  message: string;
  code: string | null;
  /** 数据库返回的 SQLSTATE；SQLite 等没有该概念时保持 null，不伪造。 */
  sqlState: string | null;
  /** 驱动/SQLite 的数字错误码；拿不到时为 null。 */
  errno: number | null;
  /** 是否属于可重试错误（锁等待、连接重置等）。 */
  retryable: boolean;
  connectionClosed?: boolean;
}

export type QueryResponse =
  | { ok: true; result: QueryResult }
  | { ok: false; error: QueryError };

export interface QueryRequest {
  requestId: string;
  sessionId: string;
  sql: string;
  /** 与 SQL 中 `?` 占位符一一对应的参数（表数据页过滤等内部路径使用）。 */
  params?: QueryCell[];
  /** 本次查询最多保留的行数；0 表示不限制，省略时用驱动默认上限。 */
  maxRows?: number;
  /** 本次查询超时（毫秒），覆盖默认值；0 表示不自动取消。 */
  timeoutMs?: number;
  /** 历史记录用的连接快照；旧调用可省略。 */
  connectionId?: string;
  connectionName?: string;
  dialect?: DatabaseType;
  database?: string;
  source?: QuerySource;
}

export type QuerySource =
  | 'editor'
  | 'ddl-preview'
  | 'grid-edit'
  | 'agent-control'
  | 'table-page'
  | 'export';
export type QueryStatus = 'success' | 'failed' | 'cancelled';

/** 多语句执行中的单条语句结果；失败后脚本停止。 */
export interface QueryScriptStatement {
  /** 从 0 开始的语句序号。 */
  index: number;
  sql: string;
  ok: boolean;
  result?: QueryResult;
  error?: QueryError;
  elapsedMs: number;
  canceled?: boolean;
  timedOut?: boolean;
}

export interface QueryScriptResult {
  statements: QueryScriptStatement[];
  /** 请求中的语句总数；失败/取消时可能大于实际执行数。 */
  total: number;
  elapsedMs: number;
  canceled: boolean;
  timedOut: boolean;
}

export type QueryScriptResponse =
  | { ok: true; result: QueryScriptResult }
  | { ok: false; error: QueryError };

export interface QueryScriptRequest {
  requestId: string;
  sessionId: string;
  /** 渲染层已按方言分句；主进程按顺序逐条执行，遇错停止。 */
  statements: string[];
  /** 每条语句最多保留的行数；0 表示不限制。 */
  maxRows?: number;
  timeoutMs?: number;
  connectionId?: string;
  connectionName?: string;
  dialect?: DatabaseType;
  database?: string;
  source?: QuerySource;
}

export interface HistoryRecord {
  id: number;
  sqlText: string;
  dialect: DatabaseType;
  connectionId: string;
  connectionName: string;
  databaseName: string;
  status: QueryStatus;
  errorMessage: string | null;
  durationMs: number;
  affectedRows: number | null;
  returnedRows: number | null;
  source: QuerySource;
  execCount: number;
  lastExecutedAt: string;
}

export type HistoryListResult =
  | { ok: true; records: HistoryRecord[] }
  | { ok: false; message: string };

export interface HistoryListOptions {
  /** SQL 内容包含匹配；`%`/`_` 按字面量。 */
  query?: string;
  dialect?: DatabaseType;
  status?: QueryStatus;
  source?: QuerySource;
  connectionId?: string;
  /** 数据库名包含匹配。 */
  databaseName?: string;
  /** ISO 时间；只返回该时间之后执行的记录。 */
  since?: string;
  /** ISO 时间；只返回该时间之前执行的记录。 */
  until?: string;
  sortBy?: 'time' | 'duration';
  sortDir?: 'asc' | 'desc';
  limit?: number;
}

export interface SchemaObject {
  /** 后端使用的对象名；MSSQL 为 `schema.table`。 */
  name: string;
  type: 'table' | 'view' | 'procedure';
  /** MSSQL 的对象 schema；其他方言为空。 */
  schema?: string;
}

export interface DatabaseInfo {
  name: string;
  /** 当前会话 USE 的数据库。 */
  current: boolean;
}

export type DatabaseListResult =
  | { ok: true; databases: DatabaseInfo[] }
  | { ok: false; message: string };

export type SchemaUseDatabaseResult =
  | { ok: true; database: string }
  | { ok: false; message: string };

/** 表下的约束（主键/唯一/外键/CHECK/默认值）。 */
export interface TableConstraintInfo {
  name: string;
  /** 展示用类型：PRIMARY KEY / UNIQUE / FOREIGN KEY / CHECK / DEFAULT。 */
  kind: string;
}

export interface TableTriggerInfo {
  name: string;
  disabled: boolean;
  /** 原始创建语句；SQLite 重建时用于恢复触发器。 */
  sql?: string;
}

/** 对象树表节点展开时按需加载的子对象。 */
export interface TableExtras {
  constraints: TableConstraintInfo[];
  triggers: TableTriggerInfo[];
  indexes: TableIndexInfo[];
}

export type TableExtrasResult =
  | { ok: true; extras: TableExtras }
  | { ok: false; message: string };

export type SchemaGetResult =
  | { ok: true; objects: SchemaObject[] }
  | { ok: false; message: string };

export type DdlObjectKind = 'table' | 'view' | 'procedure';

/** 表数据编辑所需的列信息（来自 information_schema / PRAGMA）。 */
export interface TableColumnMeta {
  name: string;
  declaredType: string;
  notNull: boolean;
  primaryKey: boolean;
  autoIncrement: boolean;
  defaultValue: string | null;
  /** MSSQL 默认值约束名；其他方言为 null/省略。 */
  defaultConstraint?: string | null;
  /** 主键与生成列不允许在网格中直接编辑。 */
  readOnly: boolean;
  /** MSSQL rowversion/timestamp；用于乐观锁。 */
  rowversion?: boolean;
}

export interface TableMeta {
  name: string;
  kind: DdlObjectKind;
  columns: TableColumnMeta[];
  primaryKey: string[];
  /** SQLite 无显式主键但可用的 rowid 别名（rowid/_rowid_/oid）。 */
  rowidAlias?: string;
  /** 视图、无主键表、只读会话均为 false。 */
  editable: boolean;
  /** editable 为 false 的机器可读原因，UI 据此决定是否提供高风险开关。 */
  reasonCode?: 'view' | 'no-primary-key' | 'readonly-session';
  /** editable 为 false 时给用户看的原因。 */
  reason?: string;
}

export type TableMetaResult =
  | { ok: true; meta: TableMeta }
  | { ok: false; message: string };

export interface TableIndexInfo {
  name: string;
  unique: boolean;
  columns: string[];
}

export interface TableForeignKeyInfo {
  name: string;
  columns: string[];
  referencedTable: string;
  referencedColumns: string[];
  onDelete: string | null;
  onUpdate: string | null;
}

export interface TableCheckInfo {
  name: string | null;
  expression: string;
}

export interface TableDetail extends TableMeta {
  indexes: TableIndexInfo[];
  foreignKeys: TableForeignKeyInfo[];
  checks: TableCheckInfo[];
  /** 表上的触发器；部分驱动可能不返回。 */
  triggers?: TableTriggerInfo[];
  /** 依赖该表的视图（SQLite 重建时用于恢复）。 */
  dependentViews?: Array<{ name: string; sql: string }>;
  /** 原始 CREATE TABLE 文本（SQLite 用于识别 WITHOUT ROWID/STRICT/生成列等）。 */
  tableSql?: string;
  /** MSSQL 主键约束名；其他方言可能省略。 */
  primaryKeyName?: string;
  /** MySQL 系表注释；SQLite 没有表注释，固定为 null。 */
  comment: string | null;
}

export type TableDetailResult =
  | { ok: true; detail: TableDetail }
  | { ok: false; message: string };

export type TableEditKind = 'update' | 'insert' | 'delete';

export interface TableEdit {
  kind: TableEditKind;
  /** 主键列与原始值；update/delete 必需。 */
  keys?: Record<string, QueryCell>;
  /** update 的新值 / insert 的列值。 */
  values?: Record<string, QueryCell>;
  /** update 的乐观锁：被修改列的原始值。 */
  original?: Record<string, QueryCell>;
}

export interface TableApplyRequest {
  requestId: string;
  sessionId: string;
  table: string;
  edits: TableEdit[];
  /** 无主键表的高风险模式：仅允许 INSERT，由主进程再次校验。 */
  allowNoPrimaryKeyInsert?: boolean;
  /** 允许显式修改/插入主键列；UI 需二次确认。 */
  allowPrimaryKeyChange?: boolean;
  /** 允许 INSERT 显式写入自增/IDENTITY 列；MSSQL 会包裹 SET IDENTITY_INSERT。 */
  allowIdentityInsert?: boolean;
  /** 冲突行跳过并继续提交其余修改；默认 false 时整体回滚。 */
  skipConflicts?: boolean;
  connectionId?: string;
  connectionName?: string;
  database?: string;
}

export type TableApplyResult =
  | { ok: true; applied: number; skipped?: number; elapsedMs: number }
  | {
      ok: false;
      message: string;
      /** 乐观锁冲突（目标行已被修改或删除）。 */
      conflict: boolean;
      applied: number;
      elapsedMs: number;
    };

export type DdlGetResult =
  | { ok: true; dialect: DatabaseType; ddl: string }
  | { ok: false; message: string };

export interface DdlColumnDefinition {
  name: string;
  type: string;
  primaryKey?: boolean;
  autoIncrement?: boolean;
  notNull?: boolean;
  unique?: boolean;
  /** 原样拼进 DEFAULT 后的 SQL 表达式（例如 `0`、`'x'`、`CURRENT_TIMESTAMP`）。 */
  defaultValue?: string;
}

export interface DdlTableDefinition {
  name: string;
  columns: DdlColumnDefinition[];
  /** MSSQL 的 schema；其他方言忽略。 */
  schema?: string;
  foreignKeys?: Array<{
    name?: string;
    columns: string[];
    referencedTable: string;
    referencedColumns: string[];
    onDelete?: string;
    onUpdate?: string;
  }>;
  checks?: Array<{ name?: string; expression: string }>;
  /** MySQL 系的表选项；其他方言忽略。 */
  options?: { engine?: string; charset?: string };
}

export interface DdlStatementResult {
  index: number;
  ok: boolean;
  message: string;
  changes: number | null;
}

export type DdlExecuteResult =
  | { ok: true; results: DdlStatementResult[]; elapsedMs: number }
  | { ok: false; message: string; results: DdlStatementResult[]; elapsedMs: number };

export interface DdlExecuteOptions {
  /** SQLite 重建表时需要临时关闭外键；执行结束后恢复。 */
  sqliteForeignKeysOff?: boolean;
  /** 历史记录用的连接快照；UI 调用会传入，旧调用可省略。 */
  connectionId?: string;
  connectionName?: string;
  database?: string;
}

export type ExportFormat = 'csv' | 'json' | 'sql' | 'xlsx';

export type AgentJobAction = 'start' | 'stop' | 'enable' | 'disable';

/** SQL Server Agent 作业列表行（PRD 4.8.3 的 8 列）。 */
export interface AgentJobSummary {
  jobId: string;
  name: string;
  enabled: boolean;
  category: string;
  owner: string;
  /** sysjobhistory.run_status（step_id = 0 的最近一条）；从未运行为 null。 */
  lastRunStatus: number | null;
  lastRunAt: string | null;
  lastRunDurationSeconds: number | null;
  nextRunAt: string | null;
  /** 多服务器作业只读展示，禁用启停按钮。 */
  multiServer: boolean;
}

export interface AgentJobStep {
  stepId: number;
  stepName: string;
  subsystem: string;
  command: string;
  onSuccessAction: number;
  onSuccessStepId: number;
  onFailAction: number;
  onFailStepId: number;
  retryAttempts: number;
  retryInterval: number;
}

export interface AgentJobSchedule {
  scheduleId: number;
  name: string;
  enabled: boolean;
  /** 由 freq_* 字段生成的可读描述；复杂组合显示原始字段提示。 */
  frequency: string;
  nextRunAt: string | null;
  /** 被多个作业共享时脚本修改会影响其他作业。 */
  shared: boolean;
  freqType: number;
  freqInterval: number;
  freqSubdayType: number;
  freqSubdayInterval: number;
  freqRelativeInterval: number;
  freqRecurrenceFactor: number;
}

export interface AgentJobHistory {
  instanceId: number;
  stepId: number;
  stepName: string;
  runStatus: number;
  runAt: string;
  durationSeconds: number;
  message: string;
}

export interface AgentJobDetail extends AgentJobSummary {
  description: string;
  createdAt: string | null;
  modifiedAt: string | null;
  steps: AgentJobStep[];
  schedules: AgentJobSchedule[];
  history: AgentJobHistory[];
}

export type AgentListResult =
  | { ok: true; jobs: AgentJobSummary[] }
  | { ok: false; message: string };

export type AgentDetailResult =
  | { ok: true; detail: AgentJobDetail }
  | { ok: false; message: string };

export type AgentActionResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

export type AgentScriptResult =
  | { ok: true; script: string; warnings: string[] }
  | { ok: false; message: string };
export interface ExportXlsxRequest {
  suggestedName: string;
  columns: string[];
  rows: QueryCell[][];
}

export interface ExportSaveRequest {
  suggestedName: string;
  content: string;
}

export type ExportSaveResult =
  | { ok: true; path: string }
  | { ok: false; canceled?: boolean; message: string };

export interface SchemaGetOptions {
  /** 是否包含数据库系统对象（SQLite 的 sqlite_* 等）；默认 false。 */
  includeSystemObjects?: boolean;
  /** 目标数据库；MSSQL / MySQL 系不传时使用当前会话数据库。 */
  database?: string;
}

export interface AppInfo {
  name: string;
  version: string;
  electron: string;
  chrome: string;
  node: string;
  platform: string;
  /** 元数据库与日志所在的用户数据目录。 */
  userDataPath: string;
}

export type ShortcutAction = 'run' | 'complete' | 'format' | 'save' | 'history';
export type ShortcutMap = Record<ShortcutAction, string>;

export interface AppSettings {
  /** 单次查询最多保留的结果行数。 */
  resultRowLimit: number;
  theme: 'dark' | 'light' | 'system';
  /** SQL 编辑器字号。 */
  editorFontSize: number;
  /** 查询历史保留条数。 */
  historyRetention: number;
  /** 单次查询超时（毫秒）；0 表示不自动取消。 */
  queryTimeoutMs: number;
  /** 建立连接/测试连接超时（毫秒）；环境变量 `DBCRAFT_CONNECT_TIMEOUT_MS` 优先。 */
  connectTimeoutMs: number;
  /** 是否记录查询历史。 */
  historyEnabled: boolean;
  /** 60 秒内同连接同 SQL 是否合并为一条。 */
  historyDedupe: boolean;
  /** 历史列表/详情默认脱敏显示。 */
  historyMask: boolean;
  /** 表数据页默认开启自动提交。 */
  gridAutoCommit: boolean;
  /** 表数据页提交前默认二次确认。 */
  gridConfirmCommit: boolean;
  /** SQL 编辑器字体族键。 */
  editorFontFamily: string;
  /** SQL 编辑器 Tab 宽度。 */
  editorTabSize: number;
  /** 格式化时关键字大小写。 */
  sqlKeywordCase: 'upper' | 'lower' | 'preserve';
  /** 是否启用补全（含自动与快捷键触发）。 */
  completionEnabled: boolean;
  /** 自动补全延迟（毫秒）。 */
  completionDelayMs: number;
  /** 可自定义快捷键；与设置面板共用同一映射。 */
  shortcuts: ShortcutMap;
}

export type SettingsGetResult =
  | { ok: true; settings: AppSettings }
  | { ok: false; message: string };

export type SettingsSaveResult =
  | { ok: true; settings: AppSettings }
  | { ok: false; message: string };

export type DiagnosticsExportResult =
  | { ok: true; path: string }
  | { ok: false; canceled?: boolean; message: string };

export type DiagnosticsOpenResult =
  | { ok: true }
  | { ok: false; message: string };

export type DiagnosticsRestoreResult =
  | { ok: true; preRestoreBackup: string }
  | { ok: false; canceled?: boolean; message: string };

export interface LocalStats {
  connections: number;
  history: number;
  settings: number;
  databaseBytes: number;
}

export type StatsGetResult =
  | { ok: true; stats: LocalStats }
  | { ok: false; message: string };

export type SqlFileOpenResult =
  | { ok: true; path: string; content: string }
  | { ok: false; canceled?: boolean; message: string };

export interface SqlFileSaveRequest {
  content: string;
  /** 已有文件路径时直接覆盖，不再弹保存对话框。 */
  path?: string;
  suggestedName: string;
}

export type SqlFileSaveResult =
  | { ok: true; path: string }
  | { ok: false; canceled?: boolean; message: string };

export interface DBCraftApi {
  app: {
    getInfo: () => Promise<AppInfo>;
    /** 主进程请求关闭窗口时触发；返回取消订阅函数。 */
    onCloseRequested: (handler: () => void) => () => void;
    /** 渲染层完成提交/丢弃后允许窗口关闭。 */
    confirmClose: () => Promise<void>;
  };
  dialog: {
    selectSqliteFile: () => Promise<string | null>;
  };
  connection: {
    test: (input: ConnectionInput, id?: string) => Promise<ConnectionTestResult>;
    list: () => Promise<ConnectionListResult>;
    save: (
      input: ConnectionInput,
      id?: string,
      options?: ConnectionSaveOptions,
    ) => Promise<ConnectionSaveResult>;
    remove: (id: string) => Promise<ConnectionDeleteResult>;
    removeAll: () => Promise<ConnectionRemoveAllResult>;
    open: (sessionId: string, connectionId: string) => Promise<SessionOpenResult>;
    import: () => Promise<ConnectionImportResult>;
  };
  session: {
    close: (sessionId: string) => Promise<void>;
  };
  query: {
    execute: (request: QueryRequest) => Promise<QueryResponse>;
    executeScript: (request: QueryScriptRequest) => Promise<QueryScriptResponse>;
    cancel: (requestId: string) => Promise<boolean>;
  };
  schema: {
    get: (sessionId: string, options?: SchemaGetOptions) => Promise<SchemaGetResult>;
    databases: (sessionId: string) => Promise<DatabaseListResult>;
    useDatabase: (sessionId: string, database: string) => Promise<SchemaUseDatabaseResult>;
    tableExtras: (
      sessionId: string,
      database: string,
      table: string,
    ) => Promise<TableExtrasResult>;
    table: (sessionId: string, name: string, kind: DdlObjectKind) => Promise<TableMetaResult>;
    describe: (sessionId: string, name: string) => Promise<TableDetailResult>;
  };
  table: {
    apply: (request: TableApplyRequest) => Promise<TableApplyResult>;
  };
  agent: {
    list: (sessionId: string, search?: string) => Promise<AgentListResult>;
    detail: (sessionId: string, jobName: string, historyLimit?: number) => Promise<AgentDetailResult>;
    action: (
      sessionId: string,
      jobName: string,
      action: AgentJobAction,
      context?: { connectionId?: string; connectionName?: string; database?: string },
    ) => Promise<AgentActionResult>;
    script: (sessionId: string, jobName: string) => Promise<AgentScriptResult>;
  };
  ddl: {
    get: (sessionId: string, name: string, kind: DdlObjectKind) => Promise<DdlGetResult>;
    execute: (
      sessionId: string,
      statements: string[],
      options?: DdlExecuteOptions,
    ) => Promise<DdlExecuteResult>;
  };
  export: {
    save: (request: ExportSaveRequest) => Promise<ExportSaveResult>;
    saveXlsx: (request: ExportXlsxRequest) => Promise<ExportSaveResult>;
  };
  history: {
    list: (options?: HistoryListOptions) => Promise<HistoryListResult>;
    remove: (id: number) => Promise<{ ok: boolean; message?: string }>;
    clear: () => Promise<{ ok: boolean; message?: string }>;
    clearConnection: (connectionId: string) => Promise<{ ok: boolean; message?: string }>;
  };
  settings: {
    get: () => Promise<SettingsGetResult>;
    save: (settings: AppSettings) => Promise<SettingsSaveResult>;
  };
  stats: {
    get: () => Promise<StatsGetResult>;
  };
  diagnostics: {
    exportLogs: () => Promise<DiagnosticsExportResult>;
    openLogDir: () => Promise<DiagnosticsOpenResult>;
    backupDatabase: () => Promise<DiagnosticsExportResult>;
    restoreDatabase: () => Promise<DiagnosticsRestoreResult>;
  };
  file: {
    openSql: () => Promise<SqlFileOpenResult>;
    readSql: (path: string) => Promise<SqlFileOpenResult>;
    saveSql: (request: SqlFileSaveRequest) => Promise<SqlFileSaveResult>;
  };
  log: {
    write: (level: LogLevel, scope: string, message: string, meta?: string) => void;
  };
}

export const IPC_CHANNELS = {
  appGetInfo: 'app:get-info',
  appCloseRequested: 'app:close-requested',
  appConfirmClose: 'app:confirm-close',
  dialogSelectSqliteFile: 'dialog:select-sqlite-file',
  connectionTest: 'connection:test',
  connectionList: 'connection:list',
  connectionSave: 'connection:save',
  connectionDelete: 'connection:delete',
  connectionRemoveAll: 'connection:remove-all',
  connectionOpen: 'connection:open',
  connectionImport: 'connection:import',
  sessionClose: 'session:close',
  queryExecute: 'query:execute',
  queryExecuteScript: 'query:execute-script',
  queryCancel: 'query:cancel',
  schemaGet: 'schema:get',
  schemaDatabases: 'schema:databases',
  schemaUseDatabase: 'schema:use-database',
  schemaTableExtras: 'schema:table-extras',
  schemaTable: 'schema:table',
  schemaDescribe: 'schema:describe',
  tableApply: 'table:apply',
  agentList: 'agent:list',
  agentDetail: 'agent:detail',
  agentAction: 'agent:action',
  agentScript: 'agent:script',
  ddlGet: 'ddl:get',
  ddlExecute: 'ddl:execute',
  exportSave: 'export:save',
  exportSaveXlsx: 'export:save-xlsx',
  historyList: 'history:list',
  historyDelete: 'history:delete',
  historyClear: 'history:clear',
  historyClearConnection: 'history:clear-connection',
  settingsGet: 'settings:get',
  settingsSave: 'settings:save',
  statsGet: 'stats:get',
  diagnosticsExportLogs: 'diagnostics:export-logs',
  diagnosticsOpenLogDir: 'diagnostics:open-log-dir',
  diagnosticsBackupDatabase: 'diagnostics:backup-database',
  diagnosticsRestoreDatabase: 'diagnostics:restore-database',
  fileOpenSql: 'file:open-sql',
  fileReadSql: 'file:read-sql',
  fileSaveSql: 'file:save-sql',
  logWrite: 'log:write',
} as const;

export const DATABASE_TYPES: DatabaseType[] = ['sqlite', 'mysql', 'percona', 'mariadb', 'mssql'];

export const DATABASE_TYPE_LABELS: Record<DatabaseType, string> = {
  sqlite: 'SQLite',
  mysql: 'MySQL',
  percona: 'Percona',
  mariadb: 'MariaDB',
  mssql: 'MSSQL',
};

export const DATABASE_TYPE_HINTS: Record<DatabaseType, string> = {
  sqlite: '本地文件',
  mysql: 'MySQL 8.x',
  percona: 'Percona 8.x',
  mariadb: 'MariaDB 10.3+',
  mssql: 'SQL Server',
};

export const DEFAULT_PORTS: Record<DatabaseType, number | null> = {
  sqlite: null,
  mysql: 3306,
  percona: 3306,
  mariadb: 3306,
  mssql: 1433,
};

export const ENVIRONMENT_LABELS: Record<EnvironmentTag, string> = {
  dev: '开发',
  test: '测试',
  prod: '生产',
};

export const SSL_MODE_LABELS: Record<SslMode, string> = {
  disable: '禁用',
  prefer: '优先',
  require: '必须',
  'verify-ca': '校验 CA',
  'verify-full': '完整校验',
};
