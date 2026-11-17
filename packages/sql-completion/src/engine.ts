import {
  buildJoinCondition,
  completionKindPriority,
  extractVirtualTables,
  foreignKeyEqualities,
  foreignKeyJoinTargets,
  quoteCompletionIdentifier,
  splitQualifier,
  stripSchemaPrefix,
  suggestJoinAlias,
  type CompletionCandidate,
  type CompletionContext,
  type CompletionKind,
  type StatementAnalyzer,
} from './core.ts';
import { dialectProfile, type DialectProfile } from './dialects.ts';
import type {
  CompletionForeignKey,
  CompletionMetadataProvider,
  CompletionObject,
} from './provider.ts';
import type { SqlDialect } from './types.ts';

export interface CompletionEnvironment {
  /** 当前会话库。 */
  database: string;
  /** 当前连接可见的库名。 */
  databases: string[];
  /** 对象树/当前库已加载的对象，用于未限定名解析与基础候选。 */
  activeSchema: CompletionObject[];
  /** MySQL lower_case_table_names（0/1/2）。 */
  lowerCaseTableNames?: 0 | 1 | 2;
  /** FROM/JOIN 选表后自动补 `AS alias`。 */
  completionTableAlias?: boolean;
  /** 宿主可选的 AST 分析器（node-sql-parser 等）。 */
  analyze?: StatementAnalyzer;
}

/**
 * 补全引擎：把“光标上下文 + 方言策略 + 元数据 provider”组装成候选列表。
 *
 * 方言差异集中在 `DialectProfile` 和 provider 实现；这里只保留一套候选生成
 * 和加权逻辑。宿主负责在 SQL 编辑器里调用 `extractCompletionContext` 后把
 * context 传进来，并自行做 CodeMirror 插入/排序展示。
 */
export class CompletionService {
  private readonly dialect: SqlDialect;
  private readonly provider: CompletionMetadataProvider;
  private readonly profile: DialectProfile;
  private prefetchTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(dialect: SqlDialect, provider: CompletionMetadataProvider) {
    this.dialect = dialect;
    this.provider = provider;
    this.profile = dialectProfile(dialect);
  }

  dispose(): void {
    if (this.prefetchTimer !== null) {
      clearTimeout(this.prefetchTimer);
      this.prefetchTimer = null;
    }
  }

  private virtualTablesFor(
    context: CompletionContext,
    env: CompletionEnvironment,
  ) {
    return extractVirtualTables(context.statement, this.dialect, env.analyze);
  }

  private virtualColumnsFor(
    tableName: string,
    virtualTables: ReturnType<typeof extractVirtualTables>,
  ): string[] | null {
    const last = tableName.split('.').pop()?.toLowerCase() ?? '';
    const match = virtualTables.find(
      (table) =>
        table.name.toLowerCase() === last ||
        table.name.toLowerCase() === tableName.toLowerCase(),
    );
    return match?.columns ?? null;
  }

  private async loadColumnsFor(
    tableName: string,
    env: CompletionEnvironment,
    virtualTables: ReturnType<typeof extractVirtualTables>,
  ): Promise<CompletionCandidate[]> {
    const owner =
      tableName
        .split('.')
        .pop()
        ?.replace(/^["`\[]|["`\]]$/g, '')
        .toLowerCase() ?? tableName.toLowerCase();
    // CTE / 派生表的列来自语句本身，优先于物理表元数据。
    const virtual = this.virtualColumnsFor(tableName, virtualTables);
    if (virtual) {
      return columnCandidates(
        virtual.map((name) => ({ name, type: '' })),
        0,
        owner,
        this.dialect,
      );
    }
    const identity = this.profile.tableIdentity(tableName, {
      database: env.database,
      activeSchema: env.activeSchema,
    });
    const columns = await this.provider.loadColumns(identity, tableName);
    return columns.length > 0
      ? columnCandidates(columns, 0, owner, this.dialect)
      : [];
  }

  private async loadForeignKeysFor(
    tableName: string,
    env: CompletionEnvironment,
  ): Promise<CompletionForeignKey[]> {
    const identity = this.profile.tableIdentity(tableName, {
      database: env.database,
      activeSchema: env.activeSchema,
    });
    if (identity.scope === 'system') return [];
    return this.provider.loadForeignKeys(identity, tableName);
  }

  /** 预取当前语句涉及表的列/外键；空闲 200ms，最多 6 张用户表。 */
  prefetch(context: CompletionContext, env: CompletionEnvironment): void {
    if (!PREFETCH_CLAUSES.has(context.clause)) return;
    const virtualTables = this.virtualTablesFor(context, env);
    const tables = Array.from(
      new Set(
        context.tables
          .map((reference) =>
            this.profile.resolveTable(reference, {
              database: env.database,
              activeSchema: env.activeSchema,
            }),
          )
          .filter((name): name is string => Boolean(name))
          .filter((name) => !this.virtualColumnsFor(name, virtualTables)),
      ),
    ).slice(0, 6);
    if (tables.length === 0) return;
    if (this.prefetchTimer !== null) clearTimeout(this.prefetchTimer);
    const wantForeignKeys = context.clause === 'join' || context.clause === 'on';
    this.prefetchTimer = setTimeout(() => {
      this.prefetchTimer = null;
      void (async () => {
        for (const table of tables) {
          if (this.virtualColumnsFor(table, virtualTables)) continue;
          await this.loadColumnsFor(table, env, virtualTables);
          if (wantForeignKeys) await this.loadForeignKeysFor(table, env);
        }
      })();
    }, 200);
  }

  async complete(
    context: CompletionContext,
    env: CompletionEnvironment,
  ): Promise<CompletionCandidate[]> {
    this.prefetch(context, env);
    const dialect = this.dialect;
    const profile = this.profile;
    const database = env.database;
    const databases = env.databases;
    const lowerCaseTableNames = env.lowerCaseTableNames;
    const contextKinds: CompletionKind[] = relationKindsForClause(context.clause);
    const allowSchemas = contextKinds.includes('table');
    const pick = (candidates: CompletionCandidate[]): CompletionCandidate[] =>
      contextKinds.length === 0
        ? candidates
        : candidates.filter((candidate) => contextKinds.includes(candidate.kind));
    const quoteObjectName = (label: string) =>
      quoteCompletionIdentifier(
        dialect,
        profile.normalizeTableName(label, lowerCaseTableNames),
      );
    const quoteColumnName = (label: string) => quoteCompletionIdentifier(dialect, label);
    const virtualTables = this.virtualTablesFor(context, env);
    const toCandidates = (
      names: string[],
      kind: CompletionKind,
      priority = completionKindPriority(kind),
    ): CompletionCandidate[] =>
      names.map((label) => ({
        label,
        kind,
        insertText: quoteObjectName(label),
        priority,
      }));
    const objectCandidates = (objects: CompletionObject[]): CompletionCandidate[] =>
      objects.map((object) => {
        const system = profile.isSystemSchemaObject(object);
        const kind = object.type === 'function' ? ('view' as const) : object.type;
        return {
          label: object.name,
          kind,
          insertText: quoteObjectName(object.name),
          // 系统对象仍然可用，但排在用户对象之后（例如 EXEC 时先给用户存储过程）。
          priority: completionKindPriority(kind) + (system ? 10 : 0),
          boost: system ? -20 : 0,
          schema: object.schema,
        };
      });
    const schemaCandidates = (schemas: string[]): CompletionCandidate[] =>
      toCandidates(schemas, 'schema');
    const databaseCandidates = (names: string[]): CompletionCandidate[] =>
      toCandidates(names, 'database');

    /** 读取用户对象；系统对象走独立分区，避免 DDL 后重载。 */
    const loadUserObjects = async (targetDatabase: string): Promise<CompletionObject[]> => {
      const objects = await this.provider.loadUserObjects(targetDatabase);
      return objects.filter(
        (object) =>
          !profile.isSystemSchemaObject(object) &&
          !profile.isSystemDatabase(targetDatabase),
      );
    };

    /** 读取系统对象；只保留系统对象，避免和用户分区重复。 */
    const loadSystemObjects = async (
      targetDatabase: string,
    ): Promise<CompletionObject[]> => {
      const objects = await this.provider.loadSystemObjects(targetDatabase);
      return objects.filter(
        (object) =>
          profile.isSystemSchemaObject(object) ||
          profile.isSystemDatabase(targetDatabase),
      );
    };

    /** 合并对象列表并按“名称+类型”去重，保证用户对象与系统对象都在。 */
    const mergeObjects = (...lists: CompletionObject[][]): CompletionObject[] => {
      const seen = new Set<string>();
      const objects: CompletionObject[] = [];
      for (const list of lists) {
        for (const object of list) {
          const key = `${object.name.toLowerCase()}:${object.type}`;
          if (seen.has(key)) continue;
          seen.add(key);
          objects.push(object);
        }
      }
      return objects;
    };

    /** EXEC / 库限定时用户与系统对象都要。 */
    const loadAllObjects = async (
      targetDatabase: string,
    ): Promise<CompletionObject[]> =>
      mergeObjects(
        await loadUserObjects(targetDatabase),
        await loadSystemObjects(targetDatabase),
      );

    const loadColumns = (tableName: string): Promise<CompletionCandidate[]> =>
      this.loadColumnsFor(tableName, env, virtualTables);

    const loadForeignKeys = (tableName: string): Promise<CompletionForeignKey[]> =>
      this.loadForeignKeysFor(tableName, env);

    /** 把语句里的表引用还原成驱动的完整对象名。 */
    const resolveTable = (
      reference: (typeof context.tables)[number] | undefined,
    ): string | null =>
      profile.resolveTable(reference, {
        database,
        activeSchema: env.activeSchema,
      });

    /** 读取当前语句涉及表的外键（仅当前库；describe 失败返回空）。 */
    const loadForeignKeyReferences = async (): Promise<
      Array<{
        reference: (typeof context.tables)[number];
        foreignKey: {
          table: string;
          columns: string[];
          referencedTable: string;
          referencedColumns: string[];
        };
      }>
    > => {
      const sources = context.tables
        .map((reference) => ({
          reference,
          name: profile.foreignKeyTableName(reference, {
            database,
            activeSchema: env.activeSchema,
          }),
        }))
        .filter(
          (entry): entry is { reference: (typeof context.tables)[number]; name: string } =>
            Boolean(entry.name),
        );
      if (sources.length === 0) return [];
      const lists = await Promise.all(
        sources.map(async ({ reference, name }) => {
          const foreignKeys = await loadForeignKeys(name);
          return foreignKeys.map((foreignKey) => ({
            reference,
            foreignKey: {
              table: reference.table,
              columns: foreignKey.columns,
              referencedTable: foreignKey.referencedTable,
              referencedColumns: foreignKey.referencedColumns,
            },
          }));
        }),
      );
      return lists.flat();
    };

    /** 取指定 schema 下的对象，并判断是否属于表/视图/存储过程。 */
    const objectsInSchema = (objects: CompletionObject[], schema: string) =>
      objects.filter(
        (object) => (object.schema ?? '').toLowerCase() === schema.toLowerCase(),
      );

    /**
     * 已经输入 `schema.` 时，候选只能带对象名，不能再带 `schema.` 前缀，
     * 否则会插成 `sys.sys.tables`。dbo 对象本来就不带前缀，这里是无操作。
     */
    const unqualifiedObjects = (objects: CompletionObject[], schema: string) =>
      objects.map((object) => ({
        ...object,
        name: stripSchemaPrefix(object.name, schema),
      }));

    /** 通配符展开：列出当前语句涉及的表的全部列，并额外给一个“一次展开”候选。 */
    if (context.wildcard) {
      const tableNames = Array.from(
        new Set(
          context.tables
            .map((reference) => resolveTable(reference))
            .filter((name): name is string => Boolean(name)),
        ),
      );
      if (tableNames.length === 0) return [];
      const lists = await Promise.all(tableNames.map((name) => loadColumns(name)));
      const seen = new Set<string>();
      const columns: CompletionCandidate[] = [];
      for (const list of lists) {
        for (const column of list) {
          const key = column.label.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          columns.push(column);
        }
      }
      if (columns.length === 0) return [];
      const insertAll = columns.map((column) => column.insertText ?? column.label).join(', ');
      const preview = columns.map((column) => column.label).join(', ');
      return [
        {
          label: `展开为 ${columns.length} 列`,
          kind: 'column',
          detail: preview.length > 90 ? `${preview.slice(0, 90)}…` : preview,
          insertText: insertAll,
          priority: -1,
          // 列候选会拿到“所属表在语句中”的上下文加权，展开项用 boost 保持置顶。
          boost: 100,
        },
        ...columns,
      ];
    }

    // INSERT INTO t (col1, col2) 的列清单：只给该表的列。
    if (context.insertColumnList && context.insertTable) {
      const tableName = resolveTable(context.insertTable);
      return tableName ? loadColumns(tableName) : [];
    }

    if (context.qualifier) {
      const parts = splitQualifier(context.qualifier);
      const last = (parts[parts.length - 1] ?? '').toLowerCase();
      const qualifier = context.qualifier.toLowerCase();
      const reference = context.tables.find(
        (table) =>
          table.alias?.toLowerCase() === last ||
          table.table.toLowerCase() === last ||
          table.raw.toLowerCase() === qualifier ||
          table.parts.join('.').toLowerCase() === qualifier,
      );

      // 一段限定符：优先按 schema/数据库解析，最后才当成表名/别名补列。
      if (parts.length === 1) {
        const columnsForReference = () => {
          if (!reference) return null;
          const tableName = resolveTable(reference);
          return tableName ? loadColumns(tableName) : [];
        };
        // 显式别名优先：`WHERE u.` 即使恰好存在同名 schema/库，也应该补该表的列。
        const aliasReference = context.tables.find(
          (table) => table.alias?.toLowerCase() === last,
        );
        if (aliasReference) {
          const tableName = resolveTable(aliasReference);
          return tableName ? loadColumns(tableName) : [];
        }

        if (profile.family === 'sqlite') {
          // main / temp / ATTACH 别名 -> 库内对象；否则按当前库的表名解析列。
          const databaseMatch = databases.find(
            (item) => item.toLowerCase() === last,
          );
          if (databaseMatch || last === 'main' || last === 'temp') {
            return pick(objectCandidates(await loadUserObjects(last)));
          }
          return columnsForReference() ?? loadColumns(last);
        }

        if (profile.family === 'mssql') {
          let objects = env.activeSchema;
          let hasSchema = objects.some(
            (object) => (object.schema ?? '').toLowerCase() === last,
          );
          // `sys.` 等系统 schema 可能没在左侧树里（系统对象开关关闭），补全时单独加载。
          if (!hasSchema) {
            objects = await loadAllObjects(database);
            hasSchema = objects.some(
              (object) => (object.schema ?? '').toLowerCase() === last,
            );
          }
          if (hasSchema) {
            return pick(
              objectCandidates(unqualifiedObjects(objectsInSchema(objects, last), last)),
            );
          }

          const databaseMatch = databases.find(
            (item) => item.toLowerCase() === last,
          );
          if (databaseMatch) {
            const objects = await loadAllObjects(databaseMatch);
            return schemaCandidates(
              Array.from(
                new Set(
                  objects
                    .map((object) => object.schema)
                    .filter((name): name is string => Boolean(name)),
                ),
              ),
            );
          }
          // 直接写 `表名.` / `别名.` 时按当前库解析列。
          return columnsForReference() ?? loadColumns(last);
        }

        if (profile.family === 'mysql') {
          const databaseMatch = databases.find(
            (item) => item.toLowerCase() === last,
          );
          if (databaseMatch) {
            const objects = await loadUserObjects(databaseMatch);
            return pick(objectCandidates(objects));
          }
          return columnsForReference() ?? loadColumns(last);
        }
        return columnsForReference() ?? [];
      }

      // 两段：MSSQL 可能是 `库.Schema.` 或 `Schema.表.`；MySQL/SQLite 是 `库.表.`
      if (parts.length === 2) {
        if (profile.family === 'mssql') {
          const databaseMatch = databases.find(
            (item) => item.toLowerCase() === parts[0]!.toLowerCase(),
          );
          if (databaseMatch) {
            const objects = await loadAllObjects(databaseMatch);
            return pick(
              objectCandidates(
                unqualifiedObjects(objectsInSchema(objects, parts[1]!), parts[1]!),
              ),
            );
          }
          return loadColumns(`${parts[0]}.${parts[1]}`);
        }
        if (profile.family === 'mysql' || profile.family === 'sqlite') {
          return loadColumns(`${parts[0]}.${parts[1]}`);
        }
        return [];
      }

      // 三段：MSSQL `库.Schema.表.`；其余方言交给驱动按对象名解析。
      if (parts.length >= 3) return loadColumns(parts.join('.'));
      return [];
    }

    const items: CompletionCandidate[] = [];
    if (
      ['select', 'where', 'on', 'set', 'order by', 'group by', 'having'].includes(
        context.clause,
      )
    ) {
      const tables = context.tables
        .map((reference) => resolveTable(reference))
        .filter((name): name is string => Boolean(name));
      const uniqueTables = Array.from(new Set(tables));
      const columnLists = await Promise.all(
        uniqueTables.map((name, index) =>
          loadColumns(name).then((list) =>
            list.map((item) => ({ ...item, priority: index })),
          ),
        ),
      );
      for (const columns of columnLists) items.push(...columns);
      for (const table of context.tables) {
        if (table.alias) {
          items.push({
            label: table.alias,
            kind: 'alias',
            insertText: quoteColumnName(table.alias),
            priority: completionKindPriority('alias'),
            table: table.table.toLowerCase(),
          });
        }
      }
      // JOIN ... ON 时直接给出外键等式，例如 `o.user_id = u.id`。
      if (context.clause === 'on' && context.tables.length > 0) {
        const loaded = await loadForeignKeyReferences();
        const equalities = foreignKeyEqualities(
          loaded.map((entry) => entry.foreignKey),
          context.tables.map((table) => table.table),
        );
        items.push(
          ...equalities.map((foreignKey) => {
            const sourceReference = loaded.find(
              (entry) => entry.foreignKey === foreignKey,
            )?.reference;
            const targetName = foreignKey.referencedTable.split('.').pop() ?? '';
            const targetReference = context.tables.find(
              (table) => table.table.toLowerCase() === targetName.toLowerCase(),
            );
            const sourceDisplay = sourceReference?.alias ?? foreignKey.table;
            const targetDisplay = targetReference?.alias ?? foreignKey.referencedTable;
            const sourceRef = sourceReference?.alias
              ? quoteColumnName(sourceReference.alias)
              : (sourceReference?.parts ?? [foreignKey.table])
                  .map((part) => quoteObjectName(part))
                  .join('.');
            const targetRef = targetReference?.alias
              ? quoteColumnName(targetReference.alias)
              : (targetReference?.parts ?? foreignKey.referencedTable.split('.'))
                  .map((part) => quoteObjectName(part))
                  .join('.');
            return {
              label: buildJoinCondition(
                sourceDisplay,
                targetDisplay,
                foreignKey.columns,
                foreignKey.referencedColumns,
              ),
              kind: 'column' as const,
              insertText: buildJoinCondition(
                sourceRef,
                targetRef,
                foreignKey.columns.map((column) => quoteColumnName(column)),
                foreignKey.referencedColumns.map((column) => quoteColumnName(column)),
              ),
              detail: `FOREIGN KEY ${foreignKey.table}(${foreignKey.columns.join(
                ', ',
              )}) → ${foreignKey.referencedTable}(${foreignKey.referencedColumns.join(', ')})`,
              priority: completionKindPriority('column'),
              boost: 80,
            };
          }),
        );
      }
    } else if (
      ['from', 'join', 'into', 'update', 'table', 'view', 'exec', 'execute'].includes(
        context.clause,
      )
    ) {
      const isExecContext = context.clause === 'exec' || context.clause === 'execute';
      // 普通 FROM/JOIN 只加载用户对象；EXEC 需要系统存储过程，保留系统对象。
      const loaded = isExecContext
        ? await loadAllObjects(database)
        : await loadUserObjects(database);
      const userSchema = env.activeSchema.filter(
        (object) => !profile.isSystemSchemaObject(object),
      );
      let objects = mergeObjects(userSchema, loaded);
      // MSSQL 的 sp_* 未限定名会回退到 master，补全时把 master 的系统存储过程也带上。
      const fallbackDatabase = profile.execFallbackDatabase();
      if (isExecContext && fallbackDatabase) {
        const masterObjects = await loadSystemObjects(fallbackDatabase);
        objects = mergeObjects(
          objects,
          masterObjects.filter((object) => object.type === 'procedure'),
        );
      }
      // 关系位置只保留表/视图（或 EXEC 的存储过程），不再混入函数与关键字。
      items.push(...pick(objectCandidates(objects)));
      // JOIN 时用外键推导关联表，并排在普通表前面；跨库表跳过 describe。
      if (context.clause === 'join' && context.tables.length > 0) {
        const loaded = await loadForeignKeyReferences();
        if (loaded.length > 0) {
          const targets = foreignKeyJoinTargets(
            loaded.map((entry) => entry.foreignKey),
            context.tables.map((table) => table.table),
          );
          const usedAliases = new Set(
            context.tables.flatMap((table) =>
              [table.alias, table.table].filter(
                (value): value is string => Boolean(value),
              ),
            ),
          );
          items.push(
            ...targets.flatMap((foreignKey) => {
              const target = foreignKey.referencedTable;
              const parts = target.split('.');
              const schema = parts.length >= 2 ? parts[parts.length - 2] : undefined;
              const detail = `FOREIGN KEY ${foreignKey.table}(${foreignKey.columns.join(
                ', ',
              )}) → ${target}(${foreignKey.referencedColumns.join(', ')})`;
              // 源表优先用语句里的别名，没有别名时按原限定名引用。
              const sourceReference = loaded.find(
                (entry) => entry.foreignKey === foreignKey,
              )?.reference;
              const sourceDisplay = sourceReference?.alias ?? foreignKey.table;
              const sourceRef = sourceReference?.alias
                ? quoteColumnName(sourceReference.alias)
                : (sourceReference?.parts ?? [foreignKey.table])
                    .map((part) => quoteObjectName(part))
                    .join('.');
              const targetAlias = suggestJoinAlias(target, usedAliases);
              usedAliases.add(targetAlias);
              const displayCondition = buildJoinCondition(
                sourceDisplay,
                targetAlias,
                foreignKey.columns,
                foreignKey.referencedColumns,
              );
              const insertCondition = buildJoinCondition(
                sourceRef,
                targetAlias,
                foreignKey.columns.map((column) => quoteColumnName(column)),
                foreignKey.referencedColumns.map((column) => quoteColumnName(column)),
              );
              return [
                {
                  label: `${target} ${targetAlias} ON ${displayCondition}`,
                  kind: 'table' as const,
                  insertText: `${parts
                    .map((part) => quoteObjectName(part))
                    .join('.')} ${targetAlias} ON ${insertCondition}`,
                  detail: `${detail} · JOIN ON`,
                  priority: completionKindPriority('table'),
                  boost: 60,
                  schema,
                },
                {
                  label: target,
                  kind: 'table' as const,
                  insertText: parts.map((part) => quoteObjectName(part)).join('.'),
                  detail,
                  priority: completionKindPriority('table'),
                  boost: 40,
                  schema,
                },
              ];
            }),
          );
        }
      }
      // 可选：FROM/JOIN 选表时自动补 `AS alias`；FK JOIN 片段已自带别名，跳过。
      if (
        env.completionTableAlias &&
        (context.clause === 'from' || context.clause === 'join')
      ) {
        const usedAliases = new Set(
          context.tables.flatMap((table) =>
            [table.alias, table.table].filter(
              (value): value is string => Boolean(value),
            ),
          ),
        );
        for (const item of items) {
          if (item.kind !== 'table' && item.kind !== 'view') continue;
          if (!item.insertText || item.insertText.includes(' ON ')) continue;
          if (/\bAS\b/i.test(item.insertText)) continue;
          const alias = suggestJoinAlias(item.label, usedAliases);
          usedAliases.add(alias);
          item.insertText = `${item.insertText} AS ${alias}`;
        }
      }
      if (allowSchemas) {
        // CTE / 派生表名也参与 FROM/JOIN 补全。
        items.push(
          ...virtualTables.map((table) => ({
            label: table.name,
            kind: 'table' as const,
            insertText: quoteObjectName(table.name),
            priority: completionKindPriority('table'),
          })),
        );
        const schemaNames = Array.from(
          new Set(
            objects
              .map((object) => object.schema)
              .filter((name): name is string => Boolean(name)),
          ),
        );
        for (const schema of profile.extraSchemas()) {
          if (!schemaNames.some((name) => name.toLowerCase() === schema.toLowerCase())) {
            schemaNames.push(schema);
          }
        }
        items.push(
          ...schemaCandidates(schemaNames),
          ...databaseCandidates(databases),
        );
      }
    }
    if (contextKinds.length === 0) return items;
    return items.filter(
      (candidate) =>
        contextKinds.includes(candidate.kind) ||
        (allowSchemas && (candidate.kind === 'schema' || candidate.kind === 'database')),
    );
  }
}

const PREFETCH_CLAUSES = new Set([
  'select',
  'where',
  'on',
  'set',
  'order by',
  'group by',
  'having',
  'from',
  'join',
  'into',
  'update',
]);

function columnCandidates(
  columns: Array<{ name: string; type?: string; primaryKey?: boolean }>,
  priority: number,
  table: string | undefined,
  dialect: SqlDialect,
): CompletionCandidate[] {
  return columns.map((column) => ({
    label: column.name,
    kind: 'column' as const,
    detail: column.type || undefined,
    insertText: quoteCompletionIdentifier(dialect, column.name),
    priority,
    table,
    primaryKey: column.primaryKey,
  }));
}

/** FROM/JOIN 等位置只接受表/视图；EXEC 只接受存储过程；USE 只接受数据库。 */
function relationKindsForClause(clause: string): CompletionKind[] {
  if (clause === 'exec' || clause === 'execute') return ['procedure'];
  if (clause === 'use') return ['database'];
  if (['from', 'join', 'into', 'update', 'table', 'view'].includes(clause)) {
    return ['table', 'view'];
  }
  return [];
}
