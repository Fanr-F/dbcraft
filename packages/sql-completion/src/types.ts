/**
 * 补全包支持的方言标识。
 *
 * 与 DBCraft 的 `DatabaseType` 保持一致，但补全包不依赖应用类型。
 */
export type SqlDialect = 'sqlite' | 'mysql' | 'percona' | 'mariadb' | 'mssql';
