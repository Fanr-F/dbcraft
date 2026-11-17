/** 补全用到的对象、列、外键模型；宿主可以映射到自己的驱动/DTO。 */
export interface CompletionObject {
  /** 驱动使用的对象名；MSSQL 通常是 `schema.table`。 */
  name: string;
  type: 'table' | 'view' | 'procedure' | 'function';
  /** MSSQL 的对象 schema；其他方言可为空。 */
  schema?: string;
  /** MSSQL 扩展存储过程（没有 SQL 定义）。 */
  extended?: boolean;
}

export interface CompletionColumn {
  name: string;
  /** 展示用类型，例如 `varchar(50)`；没有时只显示列名。 */
  type?: string;
  primaryKey?: boolean;
}

export interface CompletionForeignKey {
  /** 源表。 */
  table: string;
  columns: string[];
  referencedTable: string;
  referencedColumns: string[];
}

export interface MetadataTarget {
  /** 用户对象与系统对象分区，用于缓存隔离。 */
  scope: 'user' | 'system';
  database: string;
  schema: string | null;
  table: string;
}

/**
 * 补全元数据提供者。
 *
 * 补全包本身不连接数据库；宿主（DBCraft 的 IPC + MetadataStore、独立服务、
 * 测试桩）实现这个接口。实现方负责缓存/去重/错误退避，包只负责何时取数据。
 */
export interface CompletionMetadataProvider {
  /** 指定库的用户对象。 */
  loadUserObjects(database: string): Promise<CompletionObject[]>;
  /** 指定库的系统对象；方言没有系统对象概念时返回空数组。 */
  loadSystemObjects(database: string): Promise<CompletionObject[]>;
  /** 指定表的列；`qualifiedName` 是驱动可识别的完整对象名。 */
  loadColumns(
    target: MetadataTarget,
    qualifiedName: string,
  ): Promise<CompletionColumn[]>;
  /** 指定表的外键；不支持外键的方言返回空数组。 */
  loadForeignKeys(
    target: MetadataTarget,
    qualifiedName: string,
  ): Promise<CompletionForeignKey[]>;
}
