import type { SchemaObject, TableForeignKeyInfo } from '../../../shared/ipc-contract';

/**
 * 补全用的内存元数据缓存。
 *
 * - 用户/系统元数据分命名空间，失效与回收策略不同；
 * - `loading` 期间复用同一个 Promise，避免连续按键重复发 IPC；
 * - `error` 按指数退避，坏连接上不会每次按键都重试；
 * - 失效用 generation 隔离：切换库/DDL 后旧请求的结果直接丢弃。
 */

export type MetadataScope = 'user' | 'system';

export interface MetadataColumn {
  name: string;
  type: string;
  primaryKey?: boolean;
}

export type MetadataStatus = 'loading' | 'ready' | 'error';

export interface MetadataStoreStats {
  objects: number;
  columns: number;
  foreignKeys: number;
  loading: number;
  errors: number;
}

export interface MetadataStoreOptions {
  /** 测试用时钟。 */
  now?: () => number;
  maxObjects?: number;
  maxColumns?: number;
  maxForeignKeys?: number;
  errorBackoffBaseMs?: number;
  errorBackoffMaxMs?: number;
}

interface Entry<T> {
  status: MetadataStatus;
  data?: T;
  promise?: Promise<T | null>;
  error?: string;
  attempts: number;
  retryAt: number;
  updatedAt: number;
  lastUsed: number;
}

const SEP = '\u0000';
const objectKey = (scope: MetadataScope, database: string) =>
  ['objects', scope, database].map((part) => part.toLowerCase()).join(SEP);
const columnKey = (
  scope: MetadataScope,
  database: string,
  schema: string | null,
  table: string,
) =>
  ['columns', scope, database, schema ?? '', table]
    .map((part) => part.toLowerCase())
    .join(SEP);
const foreignKeyKey = (database: string, table: string) =>
  ['fks', database, table].map((part) => part.toLowerCase()).join(SEP);

export class MetadataStore {
  private readonly now: () => number;
  private readonly maxObjects: number;
  private readonly maxColumns: number;
  private readonly maxForeignKeys: number;
  private readonly backoffBase: number;
  private readonly backoffMax: number;

  private objects = new Map<string, Entry<SchemaObject[]>>();
  private columns = new Map<string, Entry<MetadataColumn[]>>();
  private foreignKeys = new Map<string, Entry<TableForeignKeyInfo[]>>();
  private generation = 0;

  constructor(options: MetadataStoreOptions = {}) {
    this.now = options.now ?? Date.now;
    this.maxObjects = options.maxObjects ?? 60;
    this.maxColumns = options.maxColumns ?? 500;
    this.maxForeignKeys = options.maxForeignKeys ?? 500;
    this.backoffBase = options.errorBackoffBaseMs ?? 2000;
    this.backoffMax = options.errorBackoffMaxMs ?? 30_000;
  }

  get currentGeneration(): number {
    return this.generation;
  }

  peekObjects(scope: MetadataScope, database: string): SchemaObject[] | null {
    return this.peek(this.objects, objectKey(scope, database));
  }

  loadObjects(
    scope: MetadataScope,
    database: string,
    loader: () => Promise<SchemaObject[]>,
  ): Promise<SchemaObject[] | null> {
    return this.load(
      this.objects,
      objectKey(scope, database),
      loader,
      true,
      this.maxObjects,
    );
  }

  peekColumns(
    scope: MetadataScope,
    database: string,
    schema: string | null,
    table: string,
  ): MetadataColumn[] | null {
    return this.peek(this.columns, columnKey(scope, database, schema, table));
  }

  loadColumns(
    scope: MetadataScope,
    database: string,
    schema: string | null,
    table: string,
    loader: () => Promise<MetadataColumn[]>,
  ): Promise<MetadataColumn[] | null> {
    return this.load(
      this.columns,
      columnKey(scope, database, schema, table),
      loader,
      false,
      this.maxColumns,
    );
  }

  peekForeignKeys(database: string, table: string): TableForeignKeyInfo[] | null {
    return this.peek(this.foreignKeys, foreignKeyKey(database, table));
  }

  loadForeignKeys(
    database: string,
    table: string,
    loader: () => Promise<TableForeignKeyInfo[]>,
  ): Promise<TableForeignKeyInfo[] | null> {
    return this.load(
      this.foreignKeys,
      foreignKeyKey(database, table),
      loader,
      true,
      this.maxForeignKeys,
    );
  }

  /** 用户对象/列/外键失效；系统分区保留，避免 DDL 后重载上千个系统对象。 */
  invalidateUser(database?: string): void {
    this.generation += 1;
    const db = database ? database.toLowerCase() + SEP : '';
    this.dropByPrefix(this.objects, [`objects${SEP}user${SEP}${db}`]);
    this.dropByPrefix(this.columns, [`columns${SEP}user${SEP}${db}`]);
    this.dropByPrefix(this.foreignKeys, [`fks${SEP}${db}`]);
  }

  /** 系统对象/列失效；用户分区不受影响。 */
  invalidateSystem(database?: string): void {
    this.generation += 1;
    const db = database ? database.toLowerCase() + SEP : '';
    this.dropByPrefix(this.objects, [`objects${SEP}system${SEP}${db}`]);
    this.dropByPrefix(this.columns, [`columns${SEP}system${SEP}${db}`]);
  }

  invalidateAll(): void {
    this.generation += 1;
    this.objects.clear();
    this.columns.clear();
    this.foreignKeys.clear();
  }

  dispose(): void {
    this.invalidateAll();
  }

  stats(): MetadataStoreStats {
    let loading = 0;
    let errors = 0;
    for (const map of [this.objects, this.columns, this.foreignKeys]) {
      for (const entry of map.values()) {
        if (entry.status === 'loading') loading += 1;
        else if (entry.status === 'error') errors += 1;
      }
    }
    return {
      objects: this.objects.size,
      columns: this.columns.size,
      foreignKeys: this.foreignKeys.size,
      loading,
      errors,
    };
  }

  private peek<T>(map: Map<string, Entry<T>>, key: string): T | null {
    const entry = map.get(key);
    if (!entry) return null;
    entry.lastUsed = this.now();
    return entry.status === 'ready' ? (entry.data ?? null) : null;
  }

  private load<T>(
    map: Map<string, Entry<T[]>>,
    key: string,
    loader: () => Promise<T[]>,
    acceptEmpty: boolean,
    limit: number,
  ): Promise<T[] | null> {
    const now = this.now();
    let entry = map.get(key);
    if (entry) {
      entry.lastUsed = now;
      if (entry.status === 'ready') return Promise.resolve(entry.data ?? null);
      if (entry.status === 'loading' && entry.promise) return entry.promise;
      if (entry.status === 'error' && now < entry.retryAt) return Promise.resolve(null);
    } else {
      entry = {
        status: 'loading',
        attempts: 0,
        retryAt: 0,
        updatedAt: 0,
        lastUsed: now,
      };
      map.set(key, entry);
    }

    const target = entry;
    const generation = this.generation;
    target.status = 'loading';
    const promise = Promise.resolve()
      .then(loader)
      .then((data) => {
        // 失效后旧响应直接丢弃，避免切库/DDL 后把旧数据写回。
        if (generation !== this.generation) return null;
        if (!acceptEmpty && data.length === 0) {
          target.status = 'error';
          target.error = 'empty';
          target.attempts += 1;
          target.retryAt = this.now() + this.backoff(target.attempts);
          return null;
        }
        target.status = 'ready';
        target.data = data;
        target.error = undefined;
        target.attempts = 0;
        target.retryAt = 0;
        target.updatedAt = this.now();
        this.evict(map, limit);
        return data;
      })
      .catch((error: unknown) => {
        if (generation === this.generation) {
          target.status = 'error';
          target.error = error instanceof Error ? error.message : String(error);
          target.attempts += 1;
          target.retryAt = this.now() + this.backoff(target.attempts);
        }
        return null;
      })
      .finally(() => {
        target.promise = undefined;
      });
    target.promise = promise;
    this.evict(map, limit);
    return promise;
  }

  private backoff(attempts: number): number {
    return Math.min(this.backoffBase * 2 ** Math.max(0, attempts - 1), this.backoffMax);
  }

  private evict<T>(map: Map<string, Entry<T>>, limit: number): void {
    if (map.size <= limit) return;
    const idle = [...map.entries()]
      .filter(([, entry]) => entry.status !== 'loading')
      .sort((left, right) => left[1].lastUsed - right[1].lastUsed);
    for (const [key] of idle) {
      if (map.size <= limit) break;
      map.delete(key);
    }
  }

  private dropByPrefix<T>(map: Map<string, Entry<T>>, prefixes: string[]): void {
    for (const key of [...map.keys()]) {
      if (prefixes.some((prefix) => key.startsWith(prefix))) map.delete(key);
    }
  }
}
