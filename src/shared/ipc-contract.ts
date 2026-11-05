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
}

export const IPC_CHANNELS = {
  appGetInfo: 'app:get-info',
  dialogSelectSqliteFile: 'dialog:select-sqlite-file',
  connectionTest: 'connection:test',
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
