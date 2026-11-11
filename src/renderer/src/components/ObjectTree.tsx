import { useEffect, useRef, useState } from 'react';
import type {
  DatabaseInfo,
  DatabaseType,
  DdlObjectKind,
  SchemaObject,
  TableExtras,
} from '@shared/ipc-contract';
import { Icon } from './Icon';

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
  ) => void;
}

/** 与 App 的缓存键保持一致：数据库名 + 表名。 */
function extrasKey(database: string, table: string): string {
  return `${database}\u0000${table}`;
}

function isMultiDatabase(dialect: DatabaseType): boolean {
  return dialect === 'mssql' || dialect === 'mysql' || dialect === 'percona' || dialect === 'mariadb';
}

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
  onSelectDatabase,
  onLoadDatabase,
  onLoadTableExtras,
  onOpenTable,
  onOpenTableData,
  onOpenProcedure,
  onTableContextMenu,
}: ObjectTreeProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [objectLimits, setObjectLimits] = useState<Record<string, number>>({});
  const normalizedQuery = query.trim().toLowerCase();
  const requestedDatabases = useRef(new Set<string>());

  const matches = (name: string) =>
    normalizedQuery.length === 0 || name.toLowerCase().includes(normalizedQuery);

  const open = (key: string, defaultValue = false) => expanded[key] ?? defaultValue;
  const toggle = (key: string, defaultValue = false) => {
    setExpanded((current) => ({ ...current, [key]: !(current[key] ?? defaultValue) }));
  };

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

  const objectsOf = (database: string): SchemaObject[] =>
    objectsByDatabase[database] ?? (database === current ? schemaObjects : []);

  const tableContextMenu = (
    event: React.MouseEvent,
    name: string,
    kind: DdlObjectKind,
    database: string,
    schema?: string,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    onTableContextMenu(event, name, kind, database, schema);
  };

  const objectLabel = (table: SchemaObject) => {
    if (table.schema && table.name.startsWith(`${table.schema}.`)) {
      return table.name.slice(table.schema.length + 1);
    }
    return table.name;
  };

  const renderTableRow = (table: SchemaObject, database: string, depth = 2) => {
    if (table.type === 'procedure') {
      return (
        <button
          key={`proc-${database}-${table.name}`}
          type="button"
          className={`tree-row tree-item tree-child-${depth}`}
          title={`打开存储过程 ${table.name}（生成调用 SQL）`}
          onClick={() => onOpenProcedure(table.name, database)}
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
        <div className={`tree-row tree-item tree-child-${depth} tree-table-row`}>
          {isTable && (
            <button
              type="button"
              className="tree-chevron-btn"
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
            title={`查询 ${table.name}（双击查看数据）`}
            onClick={() => onOpenTable(table.name, database)}
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
                    aria-expanded={openFolder}
                    onClick={() => toggle(folder.key, true)}
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
                aria-expanded={schemaOpen}
                title={`schema ${schema}`}
                onClick={() =>
                  toggle(schemaKey, normalizedQuery.length > 0 || groups.size === 1)
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

    const folder = (key: string, label: string, count: number, items: SchemaObject[]) => {
      const folderKey = `${key}:${database}`;
      const openFolder = open(folderKey, true);
      const limit = objectLimits[folderKey] ?? 200;
      const visibleItems = items.slice(0, limit);
      return (
        <div className="tree-branch" key={folderKey}>
          <button
            type="button"
            className={`tree-row tree-item tree-child tree-muted`}
            aria-expanded={openFolder}
            onClick={() => toggle(folderKey, true)}
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
        {folder(`tables`, '表', tables.length, tables)}
        {folder(`views`, '视图', views.length, views)}
        {dialect !== 'sqlite' &&
          folder(`procedures`, '存储过程', procedures.length, procedures)}
      </>
    );
  };

  if (!showDatabaseLayer) {
    if (loading && objectsOf(current).length === 0) {
      return <div className="tree-empty">正在加载对象…</div>;
    }
    return <div className="object-tree-body">{renderObjectFolders(current, objectsOf(current))}</div>;
  }

  // 搜索时展示所有数据库；未加载的库按需加载后参与过滤。
  const visibleDatabases = databases;

  return (
    <div className="object-tree-body">
      {visibleDatabases.length === 0 ? (
        <div className="tree-empty">{loading ? '正在加载数据库…' : '没有可访问的数据库'}</div>
      ) : (
        visibleDatabases.map((database) => {
          const dbKey = `db:${database.name}`;
          const dbOpen = open(dbKey, database.current || normalizedQuery.length > 0);
          const objects = objectsOf(database.name);
          const isLoading = loadingDatabase === database.name;
          return (
            <div className="tree-branch" key={database.name}>
              <button
                type="button"
                className={`tree-row tree-item ${database.current ? 'is-current' : ''}`}
                aria-expanded={dbOpen}
                title={database.name}
                onClick={() => {
                  toggle(dbKey, database.current || normalizedQuery.length > 0);
                  onSelectDatabase(database.name);
                }}
              >
                <Icon
                  name="chevron"
                  size={11}
                  className={dbOpen ? 'chevron' : 'chevron collapsed'}
                />
                <Icon name="database" size={14} />
                <span>{database.name}</span>
                {database.current && <span className="tree-count">当前</span>}
              </button>
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
