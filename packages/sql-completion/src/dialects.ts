import {
  normalizeCompletionNameCase,
  splitQualifier,
  type TableReference,
} from './core.ts';
import type { CompletionObject, MetadataTarget } from './provider.ts';
import type { SqlDialect } from './types.ts';

export type DialectFamily = 'mssql' | 'mysql' | 'sqlite';

export interface DialectEnvironment {
  /** 当前会话库；MSSQL/MySQL 的未限定对象默认落在该库。 */
  database: string;
  /** 对象树当前加载到的对象，用于把未限定表名还原成带 schema 的名字。 */
  activeSchema: CompletionObject[];
}

/**
 * 方言策略：只放“名字怎么解释、哪些对象算系统对象”这类差异。
 * 候选生成/排序/匹配由 core 统一处理。
 */
export interface DialectProfile {
  readonly id: SqlDialect;
  readonly family: DialectFamily;
  /** 系统库（MSSQL master；MySQL 的 information_schema/mysql/performance_schema/sys）。 */
  isSystemDatabase(database: string): boolean;
  /** 系统 schema/对象（MSSQL sys/INFORMATION_SCHEMA；SQLite sqlite_*）。 */
  isSystemSchemaObject(object: CompletionObject): boolean;
  /** FROM/JOIN 里始终额外提供的 schema 名。 */
  extraSchemas(): string[];
  /** EXEC 时额外加载系统存储过程的库；没有返回 null。 */
  execFallbackDatabase(): string | null;
  /** 限定表名 -> 元数据缓存 key。 */
  tableIdentity(qualified: string, env: DialectEnvironment): MetadataTarget;
  /** 语句里的表引用 -> 驱动可识别的完整对象名。 */
  resolveTable(reference: TableReference | undefined, env: DialectEnvironment): string | null;
  /** 外键查询使用的表名；返回 null 表示跳过（例如 MySQL 跨库）。 */
  foreignKeyTableName(
    reference: TableReference,
    env: DialectEnvironment,
  ): string | null;
  /** 对象名大小写归一（MySQL lower_case_table_names）。 */
  normalizeTableName(name: string, lowerCaseTableNames?: number | null): string;
}

const MSSQL_SYSTEM_SCHEMAS = new Set(['sys', 'information_schema']);
const MYSQL_SYSTEM_DATABASES = new Set([
  'information_schema',
  'mysql',
  'performance_schema',
  'sys',
]);

function tableIsSystem(
  profile: Pick<DialectProfile, 'family' | 'isSystemDatabase'>,
  database: string,
  schema: string | null,
  table: string,
): boolean {
  if (profile.family === 'sqlite') return table.toLowerCase().startsWith('sqlite_');
  if (profile.family === 'mssql') {
    return (
      profile.isSystemDatabase(database) ||
      (schema ? MSSQL_SYSTEM_SCHEMAS.has(schema.toLowerCase()) : false)
    );
  }
  return profile.isSystemDatabase(database);
}

function mssqlFamilyBase(): Omit<
  DialectProfile,
  'id' | 'tableIdentity' | 'resolveTable' | 'foreignKeyTableName'
> {
  return {
    family: 'mssql',
    isSystemDatabase: (database) => database.toLowerCase() === 'master',
    isSystemSchemaObject: (object) => {
      const schema = (object.schema ?? '').toLowerCase();
      const name = object.name.toLowerCase();
      return (
        MSSQL_SYSTEM_SCHEMAS.has(schema) ||
        name.startsWith('sys.') ||
        name.startsWith('information_schema.')
      );
    },
    extraSchemas: () => ['sys', 'INFORMATION_SCHEMA'],
    execFallbackDatabase: () => 'master',
    normalizeTableName: (name) => name,
  };
}

const mssqlDialect: DialectProfile = {
  ...mssqlFamilyBase(),
  id: 'mssql',
  tableIdentity(qualified, env): MetadataTarget {
    const parts = splitQualifier(qualified);
    const table = parts[parts.length - 1] ?? qualified;
    const system = (database: string, schema: string | null) =>
      tableIsSystem(mssqlDialect, database, schema, table);
    if (parts.length >= 3) {
      const database = parts[0]!;
      const schema = parts[1]!;
      return {
        scope: system(database, schema) ? 'system' : 'user',
        database,
        schema,
        table,
      };
    }
    if (parts.length === 2) {
      const schema = parts[0]!;
      return {
        scope: system(env.database, schema) ? 'system' : 'user',
        database: env.database,
        schema,
        table,
      };
    }
    const known = env.activeSchema.find(
      (object) =>
        object.name.toLowerCase() === table.toLowerCase() ||
        object.name.toLowerCase().endsWith(`.${table.toLowerCase()}`),
    );
    const schema = known?.schema ?? null;
    return {
      scope: system(env.database, schema) ? 'system' : 'user',
      database: env.database,
      schema,
      table,
    };
  },
  resolveTable(reference, env): string | null {
    if (!reference) return null;
    const parts = reference.parts ?? [];
    if (parts.length >= 3) return `${parts[0]}.${parts[1]}.${parts[2]}`;
    if (parts.length === 2) return `${parts[0]}.${parts[1]}`;
    const match = env.activeSchema.find(
      (object) =>
        object.name.toLowerCase() === reference.table.toLowerCase() ||
        object.name.toLowerCase().endsWith(`.${reference.table.toLowerCase()}`),
    );
    return match?.name ?? reference.table;
  },
  foreignKeyTableName(reference, env): string | null {
    return mssqlDialect.resolveTable(reference, env);
  },
};

function mysqlFamilyProfile(id: SqlDialect): DialectProfile {
  const profile = {
    id,
    family: 'mysql' as const,
    isSystemDatabase: (database: string) =>
      MYSQL_SYSTEM_DATABASES.has(database.toLowerCase()),
    isSystemSchemaObject: (object: CompletionObject) =>
      MYSQL_SYSTEM_DATABASES.has((object.schema ?? '').toLowerCase()),
    extraSchemas: () => [],
    execFallbackDatabase: () => null,
    normalizeTableName: (name: string, lowerCaseTableNames?: number | null) =>
      normalizeCompletionNameCase(name, lowerCaseTableNames),
  };
  return {
    ...profile,
    tableIdentity(qualified, env): MetadataTarget {
      const parts = splitQualifier(qualified);
      const table = parts[parts.length - 1] ?? qualified;
      const database = parts.length >= 2 ? parts[0]! : env.database;
      return {
        scope: tableIsSystem(profile, database, null, table) ? 'system' : 'user',
        database,
        schema: null,
        table,
      };
    },
    resolveTable(reference): string | null {
      if (!reference) return null;
      const parts = reference.parts ?? [];
      if (parts.length === 2) return `${parts[0]}.${parts[1]}`;
      return reference.table;
    },
    foreignKeyTableName(reference, env): string | null {
      // MySQL 的 describe 按 DATABASE() 过滤，跨库表跳过，避免补全抛错。
      if (
        reference.database &&
        env.database &&
        reference.database.toLowerCase() !== env.database.toLowerCase()
      ) {
        return null;
      }
      return reference.table;
    },
  };
}

const sqliteProfileBase = {
  family: 'sqlite' as const,
  isSystemDatabase: () => false,
  isSystemSchemaObject: (object: CompletionObject) =>
    object.name.toLowerCase().startsWith('sqlite_'),
  extraSchemas: () => [],
  execFallbackDatabase: () => null,
  normalizeTableName: (name: string) => name,
};

const sqliteDialect: DialectProfile = {
  ...sqliteProfileBase,
  id: 'sqlite',
  tableIdentity(qualified, env): MetadataTarget {
    const parts = splitQualifier(qualified);
    const table = parts[parts.length - 1] ?? qualified;
    const database = parts.length >= 2 ? parts[0]! : env.database;
    return {
      scope: table.toLowerCase().startsWith('sqlite_') ? 'system' : 'user',
      database,
      schema: null,
      table,
    };
  },
  resolveTable(reference): string | null {
    if (!reference) return null;
    const parts = reference.parts ?? [];
    if (parts.length === 2) return `${parts[0]}.${parts[1]}`;
    return reference.table;
  },
  foreignKeyTableName(reference): string | null {
    return reference.table;
  },
};

const PROFILES: Record<SqlDialect, DialectProfile> = {
  mssql: mssqlDialect,
  mysql: mysqlFamilyProfile('mysql'),
  percona: mysqlFamilyProfile('percona'),
  mariadb: mysqlFamilyProfile('mariadb'),
  sqlite: sqliteDialect,
};

/** 取得方言策略；调用方保证 dialect 属于支持集合。 */
export function dialectProfile(dialect: SqlDialect): DialectProfile {
  return PROFILES[dialect];
}
