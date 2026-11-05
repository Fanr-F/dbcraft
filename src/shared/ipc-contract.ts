export type DatabaseType = 'sqlite' | 'mysql' | 'percona' | 'mariadb' | 'mssql';
export type MysqlFamilyType = Extract<DatabaseType, 'mysql' | 'percona' | 'mariadb'>;
export type EnvironmentTag = 'dev' | 'test' | 'prod';
export type SslMode = 'disable' | 'prefer' | 'require' | 'verify-ca' | 'verify-full';

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
}

export type ConnectionInput = SqliteConnectionInput | MysqlFamilyConnectionInput | MssqlConnectionInput;

export type ConnectionTestStatus = 'ok' | 'failed' | 'not-implemented';

export interface ConnectionTestResult {
  status: ConnectionTestStatus;
  ok: boolean;
  message: string;
  elapsedMs: number;
}

export interface SessionOpenResult {
  ok: boolean;
  message: string;
  elapsedMs: number;
  serverVersion?: string;
}

export type QueryCell = string | number | boolean | null;

export interface QueryColumn {
  name: string;
  declaredType: string | null;
}

export interface QueryResult {
  columns: QueryColumn[];
  rows: QueryCell[][];
  rowCount: number;
  elapsedMs: number;
  statementType: 'select' | 'change';
  changes: number | null;
  truncated: boolean;
}

export interface QueryError {
  message: string;
  code: string | null;
  connectionClosed?: boolean;
}

export type QueryResponse =
  | { ok: true; result: QueryResult }
  | { ok: false; error: QueryError };

export interface QueryRequest {
  requestId: string;
  sessionId: string;
  sql: string;
}

export interface SchemaObject {
  name: string;
  type: 'table' | 'view';
}

export interface AppInfo {
  name: string;
  version: string;
  electron: string;
  chrome: string;
  node: string;
  platform: string;
}

export interface DBCraftApi {
  app: {
    getInfo: () => Promise<AppInfo>;
  };
  dialog: {
    selectSqliteFile: () => Promise<string | null>;
  };
  connection: {
    test: (input: ConnectionInput) => Promise<ConnectionTestResult>;
  };
  session: {
    open: (sessionId: string, input: ConnectionInput) => Promise<SessionOpenResult>;
    close: (sessionId: string) => Promise<void>;
  };
  query: {
    execute: (request: QueryRequest) => Promise<QueryResponse>;
    cancel: (requestId: string) => Promise<boolean>;
  };
  schema: {
    get: (sessionId: string) => Promise<SchemaObject[]>;
  };
}

export const IPC_CHANNELS = {
  appGetInfo: 'app:get-info',
  dialogSelectSqliteFile: 'dialog:select-sqlite-file',
  connectionTest: 'connection:test',
  sessionOpen: 'session:open',
  sessionClose: 'session:close',
  queryExecute: 'query:execute',
  queryCancel: 'query:cancel',
  schemaGet: 'schema:get',
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
