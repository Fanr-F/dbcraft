import { useEffect, useRef, useState } from 'react';
import type {
  DatabaseInfo,
  DatabaseType,
  DdlObjectKind,
  SchemaObject,
  TableExtras,
} from '@shared/ipc-contract';
import { Icon } from './Icon';

/** 树中除表/视图/存储过程外，可以弹右键菜单的节点。 */
export type ObjectTreeContextTarget =
  | { type: 'database'; database: string; current: boolean }
  | {
      type: 'folder';
      database: string;
      folder: 'tables' | 'views' | 'procedures';
    }
  | { type: 'schema'; database: string; schema: string }
  | {
      type: 'extras';
      database: string;
      table: string;
      folder: 'constraints' | 'triggers' | 'indexes';
    }
  | {
      type: 'detail';
      database: string;
      table: string;
      detailKind: 'constraint' | 'trigger' | 'index';
      name: string;
      /** 触发器在非 dbo schema 下的限定名；显示/复制仍用 name。 */
      qualifiedName?: string;
      /** 触发器当前是否禁用（MSSQL）。 */
      disabled?: boolean;
      /** 当前方言是否支持单独启用/禁用触发器。 */
      canToggle?: boolean;
    };

interface ObjectTreeProps {
  dialect: DatabaseType;
  query: string;
  databases: DatabaseInfo[];
  currentDatabase: string | null;
  objectsByDatabase: Record<string, SchemaObject[]>;
  /** 当前库对象的兜底（数据库列表还没返回时）。 */
  schemaObjects: SchemaObject[];
  loadingDatabase: string | null;
  /** 数据库列表或当前库对象正在加载。 */
  loading: boolean;
  tableExtras: Record<string, TableExtras>;
  tableExtrasLoadingKey: string | null;
  /** 展开状态由 Sidebar 按连接保存，收起再展开时不会丢。 */
  expanded: Record<string, boolean>;
  onToggleExpanded: (key: string, defaultValue?: boolean) => void;
  onSelectDatabase: (database: string) => void;
  /** 搜索时按需加载其他数据库的对象。 */
  onLoadDatabase?: (database: string) => void;
  onLoadTableExtras: (database: string, table: string) => void;
  onOpenTable: (name: string, database?: string) => void;
  onOpenTableData: (name: string, kind: 'table' | 'view', database?: string) => void;
  onOpenProcedure: (name: string, database?: string) => void;
  onTableContextMenu: (
    event: React.MouseEvent,
    name: string,
    kind: DdlObjectKind,
    database?: string,
    schema?: string,
    extended?: boolean,
  ) => void;
  onNodeContextMenu: (event: React.MouseEvent, target: ObjectTreeContextTarget) => void;
}

/** 与 App 的缓存键保持一致：数据库名 + 表名。 */
function extrasKey(database: string, table: string): string {
  return `${database}\u0000${table}`;
}

function isMultiDatabase(dialect: DatabaseType): boolean {
  return dialect === 'mssql' || dialect === 'mysql' || dialect === 'percona' || dialect === 'mariadb';
}

const SYSTEM_DATABASES: Partial<Record<DatabaseType, string[]>> = {
  mssql: ['master', 'model', 'msdb', 'tempdb'],
  mysql: ['information_schema', 'mysql', 'performance_schema', 'sys'],
  percona: ['information_schema', 'mysql', 'performance_schema', 'sys'],
  mariadb: ['information_schema', 'mysql', 'performance_schema', 'sys'],
};

export function ObjectTree({
  dialect,
  query,
  databases,
  currentDatabase,
  objectsByDatabase,
  schemaObjects,
  loadingDatabase,
  loading,
  tableExtras,
  tableExtrasLoadingKey,
  expanded,
  onToggleExpanded,
  onSelectDatabase,
  onLoadDatabase,
  onLoadTableExtras,
  onOpenTable,
  onOpenTableData,
  onOpenProcedure,
  onTableContextMenu,
  onNodeContextMenu,
}: ObjectTreeProps) {
  const [objectLimits, setObjectLimits] = useState<Record<string, number>>({});
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const normalizedQuery = query.trim().toLowerCase();
  const requestedDatabases = useRef(new Set<string>());
  const lazyRequested = useRef(new Set<string>());

  const matches = (name: string) =>
    normalizedQuery.length === 0 || name.toLowerCase().includes(normalizedQuery);

  const open = (key: string, defaultValue = false) => expanded[key] ?? defaultValue;
  const toggle = (key: string, defaultValue = false) => onToggleExpanded(key, defaultValue);

  const systemDatabaseNames = new Set(
    (SYSTEM_DATABASES[dialect] ?? []).map((name) => name.toLowerCase()),
  );
  const isSystemDatabase = (name: string) => systemDatabaseNames.has(name.toLowerCase());

  /** 默认只展开当前库；系统库即使当前也默认收起，搜索时全部展开。 */
  const defaultDatabaseOpen = (database: DatabaseInfo) =>
    normalizedQuery.length > 0 || (database.current && !isSystemDatabase(database.name));

  const showDatabaseLayer = isMultiDatabase(dialect);
  const current = currentDatabase ?? databases.find((item) => item.current)?.name ?? 'main';

  useEffect(() => {
    if (!normalizedQuery) {
      requestedDatabases.current.clear();
      return;
    }
    if (!onLoadDatabase) return;
    for (const database of databases) {
      if (database.name === current) continue;
      if (objectsByDatabase[database.name]) continue;
      if (requestedDatabases.current.has(database.name)) continue;
      requestedDatabases.current.add(database.name);
      onLoadDatabase(database.name);
    }
  }, [normalizedQuery, databases, objectsByDatabase, current, onLoadDatabase]);

  /**
   * 默认展开或从上次会话恢复为展开的数据库也要加载对象，
   * 否则树处于展开状态却显示「表 0」，看起来像表丢了。
   * 显式展开/点击仍会绕过这里的去重，允许失败后重试。
   */
  useEffect(() => {
    if (!onLoadDatabase) return;
    for (const database of databases) {
      const dbKey = `db:${database.name}`;
      if (!(expanded[dbKey] ?? defaultDatabaseOpen(database))) continue;
      if (objectsByDatabase[database.name]) continue;
      if (loadingDatabase === database.name) continue;
      if (lazyRequested.current.has(database.name)) continue;
      lazyRequested.current.add(database.name);
      onLoadDatabase(database.name);
    }
    // defaultDatabaseOpen 由下面这些状态派生，随依赖一起更新。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    databases,
    objectsByDatabase,
    loadingDatabase,
    expanded,
    normalizedQuery,
    current,
    onLoadDatabase,
  ]);

  /** 键盘导航只在这棵树内移动，不跨连接。 */
  const visibleRows = (): HTMLElement[] => {
    const container = containerRef.current;
    if (!container) return [];
    return Array.from(container.querySelectorAll<HTMLElement>('[data-tree-row]')).filter(
      (row) => row.offsetParent !== null,
    );
  };

  const focusRow = (row: HTMLElement | undefined, event: React.KeyboardEvent) => {
    if (!row) return;
    event.preventDefault();
    row.focus();
    row.scrollIntoView({ block: 'nearest' });
  };

  const expandControl = (row: HTMLElement): HTMLElement | null =>
    row.querySelector<HTMLElement>('[data-tree-chevron]') ??
    row.closest('.tree-row')?.querySelector<HTMLElement>('[data-tree-chevron]') ??
    null;

  const handleTreeKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (
      ![
        'ArrowDown',
        'ArrowUp',
        'ArrowLeft',
        'ArrowRight',
        'Home',
        'End',
        'Enter',
        ' ',
      ].includes(event.key)
    ) {
      return;
    }
    const rows = visibleRows();
    if (rows.length === 0) return;
    const active = document.activeElement as HTMLElement | null;
    const index = active ? rows.indexOf(active) : -1;

    switch (event.key) {
      case 'ArrowDown':
        focusRow(rows[index < 0 ? 0 : Math.min(index + 1, rows.length - 1)], event);
        return;
      case 'ArrowUp':
        focusRow(rows[index < 0 ? 0 : Math.max(index - 1, 0)], event);
        return;
      case 'Home':
        focusRow(rows[0], event);
        return;
      case 'End':
        focusRow(rows[rows.length - 1], event);
        return;
      case 'ArrowRight': {
        if (index < 0) {
          focusRow(rows[0], event);
          return;
        }
        const row = rows[index];
        const state = row.getAttribute('aria-expanded');
        if (state === 'false') {
          event.preventDefault();
          (expandControl(row) ?? row).click();
          return;
        }
        if (state === 'true') {
          const depth = Number(row.dataset.depth ?? '0');
          const child = rows
            .slice(index + 1)
            .find((item) => Number(item.dataset.depth ?? '0') > depth);
          focusRow(child, event);
        }
        return;
      }
      case 'ArrowLeft': {
        if (index < 0) {
          focusRow(rows[0], event);
          return;
        }
        const row = rows[index];
        if (row.getAttribute('aria-expanded') === 'true') {
          event.preventDefault();
          (expandControl(row) ?? row).click();
          return;
        }
        const depth = Number(row.dataset.depth ?? '0');
        const parent = [...rows.slice(0, index)]
          .reverse()
          .find((item) => Number(item.dataset.depth ?? '0') < depth);
        focusRow(parent, event);
        return;
      }
      case 'Enter':
      case ' ': {
        if (index >= 0) {
          event.preventDefault();
          rows[index].click();
        }
        return;
      }
    }
  };

  const objectsOf = (database: string): SchemaObject[] =>
    objectsByDatabase[database] ?? (database === current ? schemaObjects : []);

  const tableContextMenu = (
    event: React.MouseEvent,
    name: string,
    kind: DdlObjectKind,
    database: string,
    schema?: string,
    extended?: boolean,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    onTableContextMenu(event, name, kind, database, schema, extended);
  };

  const nodeContextMenu = (event: React.MouseEvent, target: ObjectTreeContextTarget) => {
    event.preventDefault();
    event.stopPropagation();
    onNodeContextMenu(event, target);
  };

  const objectLabel = (table: SchemaObject) => {
    if (table.schema && table.name.startsWith(`${table.schema}.`)) {
      return table.name.slice(table.schema.length + 1);
    }
    return table.name;
  };

  const selectObject = (key: string) => setSelectedKey(key);

  const renderTableRow = (table: SchemaObject, database: string, depth = 2) => {
    const rowKey = `${database}\u0000${table.type}\u0000${table.name}`;
    const selected = selectedKey === rowKey;

    if (table.type === 'procedure') {
      return (
        <button
          key={`proc-${database}-${table.name}`}
          type="button"
          data-tree-row
          data-depth={depth}
          tabIndex={-1}
          className={`tree-row tree-item tree-child-${depth} ${
            selected ? 'is-selected' : ''
          }`}
          title={`打开存储过程 ${table.name}（生成调用 SQL）`}
          onClick={() => {
            selectObject(rowKey);
            onOpenProcedure(table.name, database);
          }}
          onContextMenu={(event) =>
            tableContextMenu(
              event,
              table.name,
              'procedure',
              database,
              table.schema,
              table.extended,
            )
          }
        >
          <Icon name="script" size={14} />
          <span>{objectLabel(table)}</span>
        </button>
      );
    }

    const isTable = table.type === 'table';
    const key = extrasKey(database, table.name);
    const extras = tableExtras[key];
    const extrasOpen = isTable && open(`extras:${key}`);
    const extrasLoading = tableExtrasLoadingKey === key;
    const folders = [
      { key: `constraints:${key}`, label: '约束', count: extras?.constraints.length ?? 0 },
      { key: `triggers:${key}`, label: '触发器', count: extras?.triggers.length ?? 0 },
      { key: `indexes:${key}`, label: '索引', count: extras?.indexes.length ?? 0 },
    ];

    return (
      <div key={`${table.type}-${database}-${table.name}`} className="tree-branch">
        <div
          className={`tree-row tree-item tree-child-${depth} tree-table-row ${
            selected ? 'is-selected' : ''
          }`}
        >
          {isTable && (
            <button
              type="button"
              className="tree-chevron-btn"
              tabIndex={-1}
              data-tree-chevron
              aria-label={`展开 ${table.name} 的约束、触发器和索引`}
              aria-expanded={extrasOpen}
              title="约束 / 触发器 / 索引"
              onClick={() => {
                const willOpen = !open(`extras:${key}`);
                toggle(`extras:${key}`);
                if (willOpen && !extras && !extrasLoading) onLoadTableExtras(database, table.name);
              }}
            >
              <Icon
                name="chevron"
                size={11}
                className={extrasOpen ? 'chevron' : 'chevron collapsed'}
              />
            </button>
          )}
          <button
            type="button"
            className="tree-label-btn"
            tabIndex={-1}
            data-tree-row
            data-depth={depth}
            aria-expanded={isTable ? extrasOpen : undefined}
            title={`查询 ${table.name}（双击查看数据）`}
            onClick={() => {
              selectObject(rowKey);
              onOpenTable(table.name, database);
            }}
            onDoubleClick={() => onOpenTableData(table.name, table.type as 'table' | 'view', database)}
            onContextMenu={(event) =>
              tableContextMenu(
                event,
                table.name,
                table.type as DdlObjectKind,
                database,
                table.schema,
              )
            }
          >
            <Icon name={table.type === 'view' ? 'view' : 'table'} size={14} />
            <span>{objectLabel(table)}</span>
          </button>
        </div>

        {isTable && extrasOpen && (
          <div className="tree-branch">
            {extrasLoading && (
              <div className={`tree-empty tree-child-${depth + 1}`}>正在加载表子对象…</div>
            )}
            {folders.map((folder) => {
              if (!extras) return null;
              const openFolder = open(folder.key, true);
              return (
                <div key={folder.key}>
                  <button
                    type="button"
                    className={`tree-row tree-item tree-child-${depth + 1} tree-muted`}
                    data-tree-row
                    data-depth={depth + 1}
                    tabIndex={-1}
                    aria-expanded={openFolder}
                    onClick={() => toggle(folder.key, true)}
                    onContextMenu={(event) =>
                      nodeContextMenu(event, {
                        type: 'extras',
                        database,
                        table: table.name,
                        folder: folder.key.startsWith('constraints:')
                          ? 'constraints'
                          : folder.key.startsWith('triggers:')
                            ? 'triggers'
                            : 'indexes',
                      })
                    }
                  >
                    <Icon
                      name="chevron"
                      size={11}
                      className={openFolder ? 'chevron' : 'chevron collapsed'}
                    />
                    <Icon name="folder" size={13} />
                    <span>{folder.label}</span>
                    <span className="tree-count">{folder.count}</span>
                  </button>
                  {openFolder &&
                    folder.key.startsWith('constraints:') &&
                    extras.constraints.map((constraint) => (
                      <div
                        key={`${folder.key}-${constraint.name}`}
                        className={`tree-row tree-child-${depth + 2} tree-detail-row`}
                        title={`${constraint.kind} ${constraint.name}`}
                        onContextMenu={(event) =>
                          nodeContextMenu(event, {
                            type: 'detail',
                            database,
                            table: table.name,
                            detailKind: 'constraint',
                            name: constraint.name,
                          })
                        }
                      >
                        <span>{constraint.name}</span>
                        <span className="tree-count">{constraint.kind}</span>
                      </div>
                    ))}
                  {openFolder &&
                    folder.key.startsWith('triggers:') &&
                    extras.triggers.map((trigger) => (
                      <div
                        key={`${folder.key}-${trigger.name}`}
                        className={`tree-row tree-child-${depth + 2} tree-detail-row`}
                        onContextMenu={(event) =>
                          nodeContextMenu(event, {
                            type: 'detail',
                            database,
                            table: table.name,
                            detailKind: 'trigger',
                            name: trigger.name,
                            ...(table.schema &&
                            trigger.name.indexOf('.') < 0 &&
                            table.schema !== 'dbo'
                              ? { qualifiedName: `${table.schema}.${trigger.name}` }
                              : {}),
                            disabled: trigger.disabled,
                            canToggle: dialect === 'mssql',
                          })
                        }
                      >
                        <span>{trigger.name}</span>
                        {trigger.disabled && <span className="agent-job-tag">禁用</span>}
                      </div>
                    ))}
                  {openFolder &&
                    folder.key.startsWith('indexes:') &&
                    extras.indexes.map((index) => (
                      <div
                        key={`${folder.key}-${index.name}`}
                        className={`tree-row tree-child-${depth + 2} tree-detail-row`}
                        title={index.columns.join(', ')}
                        onContextMenu={(event) =>
                          nodeContextMenu(event, {
                            type: 'detail',
                            database,
                            table: table.name,
                            detailKind: 'index',
                            name: index.name,
                          })
                        }
                      >
                        <span>{index.name}</span>
                        <span className="tree-count">
                          {index.unique ? 'UNIQUE' : 'INDEX'}
                        </span>
                      </div>
                    ))}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  const renderObjectFolders = (database: string, objects: SchemaObject[]) => {
    const filtered = objects.filter((object) => matches(object.name));
    const tables = filtered.filter((object) => object.type === 'table');
    const views = filtered.filter((object) => object.type === 'view');
    const procedures = filtered.filter((object) => object.type === 'procedure');

    /** MSSQL 按 schema 分组；其他方言保持原有平铺结构。 */
    const renderItems = (folderKey: string, items: SchemaObject[]) => {
      if (dialect !== 'mssql') {
        return items.map((item) => renderTableRow(item, database));
      }

      const groups = new Map<string, SchemaObject[]>();
      for (const item of items) {
        const schema = item.schema || 'dbo';
        groups.set(schema, [...(groups.get(schema) ?? []), item]);
      }

      return [...groups.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([schema, schemaItems]) => {
          const schemaKey = `schema:${folderKey}:${database}:${schema}`;
          const schemaOpen = open(
            schemaKey,
            normalizedQuery.length > 0 || groups.size === 1,
          );
          return (
            <div className="tree-branch" key={schemaKey}>
              <button
                type="button"
                className="tree-row tree-item tree-child-2 tree-muted"
                data-tree-row
                data-depth={2}
                tabIndex={-1}
                aria-expanded={schemaOpen}
                title={`schema ${schema}`}
                onClick={() =>
                  toggle(schemaKey, normalizedQuery.length > 0 || groups.size === 1)
                }
                onContextMenu={(event) =>
                  nodeContextMenu(event, { type: 'schema', database, schema })
                }
              >
                <Icon
                  name="chevron"
                  size={11}
                  className={schemaOpen ? 'chevron' : 'chevron collapsed'}
                />
                <Icon name="folder" size={12} />
                <span>{schema}</span>
                <span className="tree-count">{schemaItems.length}</span>
              </button>
              {schemaOpen &&
                schemaItems.map((item) => renderTableRow(item, database, 3))}
            </div>
          );
        });
    };

    const folder = (
      key: 'tables' | 'views' | 'procedures',
      label: string,
      count: number,
      items: SchemaObject[],
    ) => {
      const folderKey = `${key}:${database}`;
      const openFolder = open(folderKey, true);
      const limit = objectLimits[folderKey] ?? 200;
      const visibleItems = items.slice(0, limit);
      return (
        <div className="tree-branch" key={folderKey}>
          <button
            type="button"
            className="tree-row tree-item tree-child tree-muted"
            data-tree-row
            data-depth={1}
            tabIndex={-1}
            aria-expanded={openFolder}
            onClick={() => toggle(folderKey, true)}
            onContextMenu={(event) =>
              nodeContextMenu(event, { type: 'folder', database, folder: key })
            }
          >
            <Icon
              name="chevron"
              size={11}
              className={openFolder ? 'chevron' : 'chevron collapsed'}
            />
            <Icon name="folder" size={13} />
            <span>{label}</span>
            <span className="tree-count">{count}</span>
          </button>
          {openFolder && (
            <>
              {renderItems(folderKey, visibleItems)}
              {items.length > visibleItems.length && (
                <button
                  type="button"
                  className="tree-row tree-item tree-child-2 tree-muted"
                  onClick={() =>
                    setObjectLimits((current) => ({
                      ...current,
                      [folderKey]: limit + 200,
                    }))
                  }
                >
                  显示更多（剩余 {items.length - visibleItems.length}）
                </button>
              )}
            </>
          )}
        </div>
      );
    };

    return (
      <>
        {folder('tables', '表', tables.length, tables)}
        {folder('views', '视图', views.length, views)}
        {dialect !== 'sqlite' &&
          folder('procedures', '存储过程', procedures.length, procedures)}
      </>
    );
  };

  if (!showDatabaseLayer) {
    if (loading && objectsOf(current).length === 0) {
      return <div className="tree-empty">正在加载对象…</div>;
    }
    return (
      <div
        className="object-tree-body"
        role="tree"
        aria-label="数据库对象树"
        tabIndex={0}
        ref={containerRef}
        onKeyDown={handleTreeKeyDown}
        onFocus={(event) => {
          if (event.target === containerRef.current) {
            const first = visibleRows()[0];
            first?.focus();
          }
        }}
      >
        {renderObjectFolders(current, objectsOf(current))}
      </div>
    );
  }

  // 搜索时展示所有数据库；未加载的库按需加载后参与过滤。
  const visibleDatabases = databases;

  return (
    <div
      className="object-tree-body"
      role="tree"
      aria-label="数据库对象树"
      tabIndex={0}
      ref={containerRef}
      onKeyDown={handleTreeKeyDown}
      onFocus={(event) => {
        if (event.target === containerRef.current) {
          const first = visibleRows()[0];
          first?.focus();
        }
      }}
    >
      {visibleDatabases.length === 0 ? (
        <div className="tree-empty">{loading ? '正在加载数据库…' : '没有可访问的数据库'}</div>
      ) : (
        visibleDatabases.map((database) => {
          const dbKey = `db:${database.name}`;
          const system = isSystemDatabase(database.name);
          // 只默认展开当前库；系统库默认收起，避免 master/mysql/sys 一打开就淹没用户库。
          const defaultOpen = defaultDatabaseOpen(database);
          const dbOpen = open(dbKey, defaultOpen);
          const objects = objectsOf(database.name);
          const isLoading = loadingDatabase === database.name;
          // 展开箭头只负责展开；非当前库可能还没缓存对象，需要按需跨库加载，
          // 否则会显示成“表 0 / 视图 0”，看起来像库里的表丢了。
          const ensureDatabaseObjects = () => {
            if (objectsByDatabase[database.name]) return;
            if (loadingDatabase === database.name) return;
            onLoadDatabase?.(database.name);
          };
          return (
            <div className="tree-branch" key={database.name}>
              <div
                className={`tree-row tree-item ${database.current ? 'is-current' : ''} ${
                  system && !database.current ? 'tree-system' : ''
                }`}
              >
                <button
                  type="button"
                  className="tree-chevron-btn"
                  tabIndex={-1}
                  data-tree-chevron
                  aria-label={`${dbOpen ? '收起' : '展开'} ${database.name}`}
                  aria-expanded={dbOpen}
                  onClick={() => {
                    toggle(dbKey, defaultOpen);
                    if (!dbOpen) ensureDatabaseObjects();
                  }}
                >
                  <Icon
                    name="chevron"
                    size={11}
                    className={dbOpen ? 'chevron' : 'chevron collapsed'}
                  />
                </button>
                <button
                  type="button"
                  className="tree-label-btn"
                  tabIndex={-1}
                  data-tree-row
                  data-depth={0}
                  aria-expanded={dbOpen}
                  title={
                    system
                      ? `${database.name}（系统数据库，默认收起）`
                      : database.name
                  }
                  onClick={() => {
                    if (!dbOpen) toggle(dbKey, defaultOpen);
                    if (!database.current) {
                      onSelectDatabase(database.name);
                    } else {
                      // 当前库也可能因为连接时还没加载到对象而缺缓存。
                      ensureDatabaseObjects();
                    }
                  }}
                  onContextMenu={(event) =>
                    nodeContextMenu(event, {
                      type: 'database',
                      database: database.name,
                      current: database.current,
                    })
                  }
                >
                  <Icon name="database" size={14} />
                  <span>{database.name}</span>
                  {database.current && <span className="tree-count">当前</span>}
                  {system && !database.current && (
                    <span className="tree-count">系统</span>
                  )}
                </button>
              </div>
              {dbOpen &&
                (isLoading ? (
                  <div className="tree-empty tree-child">正在加载对象…</div>
                ) : (
                  renderObjectFolders(database.name, objects)
                ))}
            </div>
          );
        })
      )}
    </div>
  );
}
