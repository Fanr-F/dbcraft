import { useMemo, useState } from 'react';
import { DATABASE_TYPE_LABELS, ENVIRONMENT_LABELS } from '@shared/ipc-contract';
import type { ConnectionInput, DdlObjectKind, SchemaObject } from '@shared/ipc-contract';
import type { SavedConnection } from '../types';
import { buildGroupTree, countGroup, type GroupNode } from '../utils/groups';
import { ContextMenu } from './ContextMenu';
import { Icon } from './Icon';

interface SidebarProps {
  connections: SavedConnection[];
  activeConnectionId: string | null;
  activeConnection: SavedConnection | null;
  schemaObjects: SchemaObject[];
  schemaLoading: boolean;
  showSystemObjects: boolean;
  systemObjectsSupported: boolean;
  sessionReadOnly: boolean;
  onSelectConnection: (id: string) => void;
  onNewConnection: () => void;
  onRefreshSchema: () => void;
  onToggleSystemObjects: (next: boolean) => void;
  onOpenTable: (name: string) => void;
  onOpenTableData: (name: string, kind: 'table' | 'view') => void;
  onDeleteConnection: (id: string) => void;
  onEditConnection: (id: string) => void;
  onDuplicateConnection: (id: string) => void;
  onDisconnectConnection: (id: string) => void;
  onNewQueryForConnection: (id: string) => void;
  onRenameGroup: (oldPath: string, newPath: string) => void;
  onDeleteGroup: (path: string) => void;
  onMoveConnection: (id: string, group: string) => void;
  onViewDdl: (name: string, kind: DdlObjectKind) => void;
  onCopyDdl: (name: string, kind: DdlObjectKind) => void;
  onRenameTable: (name: string) => void;
  onDropTable: (name: string) => void;
  onDropView: (name: string) => void;
  onAddColumn: (name: string) => void;
  onRenameColumn: (name: string) => void;
  onModifyColumn: (name: string) => void;
  onShowStructure: (name: string) => void;
  onCreateIndex: (name: string) => void;
  onDropIndex: (name: string) => void;
  onDropColumn: (name: string) => void;
  onNewTable: () => void;
  onNewView: () => void;
  onRunScript: () => void;
  onGenerateDatabaseDdl: (connectionId: string) => void;
  onExportConnection: (connectionId: string) => void;
  onExportAllConnections: () => void;
  onImportConnections: () => void;
}

function fileName(filePath: string): string {
  return filePath.split(/[\\/]/).pop() || filePath;
}

function summarize(input: ConnectionInput): string {
  if (input.type === 'sqlite') return fileName(input.filePath);
  return input.database || '未选择数据库';
}

function searchText(connection: SavedConnection): string {
  const input = connection.input;
  const parts = [input.name, input.group, DATABASE_TYPE_LABELS[input.type]];
  if (input.type === 'sqlite') {
    parts.push(input.filePath);
  } else {
    parts.push(input.host, String(input.port), input.database);
  }
  return parts.join(' ').toLowerCase();
}

export function Sidebar({
  connections,
  activeConnectionId,
  activeConnection,
  schemaObjects,
  schemaLoading,
  showSystemObjects,
  systemObjectsSupported,
  sessionReadOnly,
  onSelectConnection,
  onNewConnection,
  onRefreshSchema,
  onToggleSystemObjects,
  onOpenTable,
  onOpenTableData,
  onDeleteConnection,
  onEditConnection,
  onDuplicateConnection,
  onDisconnectConnection,
  onNewQueryForConnection,
  onRenameGroup,
  onDeleteGroup,
  onMoveConnection,
  onViewDdl,
  onCopyDdl,
  onRenameTable,
  onDropTable,
  onDropView,
  onAddColumn,
  onRenameColumn,
  onModifyColumn,
  onShowStructure,
  onCreateIndex,
  onDropIndex,
  onDropColumn,
  onNewTable,
  onNewView,
  onRunScript,
  onGenerateDatabaseDdl,
  onExportConnection,
  onExportAllConnections,
  onImportConnections,
}: SidebarProps) {
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [connectionQuery, setConnectionQuery] = useState('');
  const [objectQuery, setObjectQuery] = useState('');
  const [renaming, setRenaming] = useState<{ path: string; value: string } | null>(null);
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    connection: SavedConnection;
  } | null>(null);
  const [groupMenu, setGroupMenu] = useState<{
    x: number;
    y: number;
    path: string;
    name: string;
  } | null>(null);
  const [objectMenu, setObjectMenu] = useState<{
    x: number;
    y: number;
    name: string;
    kind: DdlObjectKind;
  } | null>(null);

  const normalizedConnectionQuery = connectionQuery.trim().toLowerCase();
  const filteredConnections = normalizedConnectionQuery
    ? connections.filter((connection) => searchText(connection).includes(normalizedConnectionQuery))
    : connections;

  const normalizedObjectQuery = objectQuery.trim().toLowerCase();
  const matchesObject = (object: SchemaObject) =>
    normalizedObjectQuery.length === 0 || object.name.toLowerCase().includes(normalizedObjectQuery);
  const tables = schemaObjects.filter((object) => object.type === 'table' && matchesObject(object));
  const views = schemaObjects.filter((object) => object.type === 'view' && matchesObject(object));

  const tree = useMemo(() => buildGroupTree(filteredConnections), [filteredConnections]);
  const hasGroups = filteredConnections.some(
    (connection) => connection.input.group.trim().length > 0,
  );

  const toggleGroup = (path: string) => {
    setCollapsedGroups((current) => ({ ...current, [path]: !current[path] }));
  };

  const commitRename = () => {
    const current = renaming;
    if (!current) return;
    const value = current.value.trim();
    setRenaming(null);

    if (!value || value === current.path.split('/').pop()) return;
    if (value.includes('/')) {
      window.alert('分组名不能包含 “/”；多级分组请在新建连接时用 “/” 分隔填写。');
      return;
    }

    const parent = current.path.split('/').slice(0, -1).join('/');
    onRenameGroup(current.path, parent ? `${parent}/${value}` : value);
  };

  const renderConnection = (connection: SavedConnection) => (
    <div
      className="connection-row"
      key={connection.id}
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData('text/plain', connection.id);
        event.dataTransfer.effectAllowed = 'move';
      }}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
      }}
      onDrop={(event) => {
        event.preventDefault();
        event.stopPropagation();
        const draggedId = event.dataTransfer.getData('text/plain');
        if (draggedId && draggedId !== connection.id) {
          onMoveConnection(draggedId, connection.input.group);
        }
      }}
    >
      <button
        type="button"
        className={`connection-item ${connection.id === activeConnectionId ? 'is-active' : ''}`}
        title="右键查看更多操作"
        onClick={() => onSelectConnection(connection.id)}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setMenu({ x: event.clientX, y: event.clientY, connection });
        }}
      >
        <span className={`db-dot db-${connection.input.type}`} />
        <span className="connection-meta">
          <span className="connection-name">{connection.input.name}</span>
          <span className="connection-sub">
            {DATABASE_TYPE_LABELS[connection.input.type]} · {summarize(connection.input)}
          </span>
        </span>
        <span className={`env-badge env-${connection.input.env}`}>
          {ENVIRONMENT_LABELS[connection.input.env]}
        </span>
      </button>
      <button
        type="button"
        className="connection-delete"
        title={`删除连接「${connection.input.name}」`}
        aria-label={`删除连接 ${connection.input.name}`}
        onClick={(event) => {
          event.stopPropagation();
          onDeleteConnection(connection.id);
        }}
      >
        <Icon name="close" size={12} />
      </button>
    </div>
  );

  const renderGroupHeader = (node: GroupNode, depth: number, editable: boolean) => {
    const collapsed =
      normalizedConnectionQuery.length === 0 && Boolean(collapsedGroups[node.path]);

    return (
      <div
        className="connection-group-head"
        style={{ paddingLeft: 8 + depth * 12 }}
        role="button"
        tabIndex={0}
        aria-expanded={!collapsed}
        onClick={() => toggleGroup(node.path)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            toggleGroup(node.path);
          }
        }}
        onContextMenu={
          editable
            ? (event) => {
                event.preventDefault();
                event.stopPropagation();
                setGroupMenu({
                  x: event.clientX,
                  y: event.clientY,
                  path: node.path,
                  name: node.name,
                });
              }
            : undefined
        }
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = 'move';
        }}
        onDrop={(event) => {
          event.preventDefault();
          event.stopPropagation();
          const draggedId = event.dataTransfer.getData('text/plain');
          if (draggedId) onMoveConnection(draggedId, node.path);
        }}
      >
        <Icon
          name="chevron"
          size={12}
          className={collapsed ? 'chevron collapsed' : 'chevron'}
        />

        {renaming?.path === node.path ? (
          <input
            className="group-rename"
            autoFocus
            value={renaming.value}
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => setRenaming({ path: node.path, value: event.target.value })}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === 'Enter') commitRename();
              if (event.key === 'Escape') setRenaming(null);
            }}
            onBlur={() => setRenaming(null)}
          />
        ) : (
          <span>{node.name}</span>
        )}

        <span className="tree-count">{countGroup(node)}</span>
      </div>
    );
  };

  const renderGroupNode = (node: GroupNode, depth: number) => {
    const collapsed =
      normalizedConnectionQuery.length === 0 && Boolean(collapsedGroups[node.path]);

    return (
      <div className="connection-group" key={node.path}>
        {renderGroupHeader(node, depth, true)}
        {!collapsed && (
          <>
            {node.connections.map(renderConnection)}
            {node.children.map((child) => renderGroupNode(child, depth + 1))}
          </>
        )}
      </div>
    );
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-heading">
        <span>连接</span>
        <button type="button" className="icon-btn" title="新建连接" onClick={onNewConnection}>
          <Icon name="plus" size={15} />
        </button>
      </div>

      <div className="connection-list">
        {connections.length === 0 ? (
          <div className="sidebar-empty">
            <Icon name="plug" size={20} />
            <p>还没有连接</p>
            <button type="button" className="btn btn-ghost" onClick={onNewConnection}>
              新建第一个连接
            </button>
          </div>
        ) : (
          <>
            <div className="sidebar-search">
              <Icon name="search" size={13} />
              <input
                value={connectionQuery}
                placeholder="搜索连接…"
                aria-label="搜索连接"
                onChange={(event) => setConnectionQuery(event.target.value)}
              />
            </div>

            {filteredConnections.length === 0 ? (
              <div className="sidebar-empty compact">
                <p>没有匹配的连接</p>
              </div>
            ) : hasGroups ? (
              <>
                {tree.connections.length > 0 && (
                  <div className="connection-group">
                    <div
                      className="connection-group-head is-ungrouped"
                      role="button"
                      tabIndex={0}
                      aria-expanded={
                        !(normalizedConnectionQuery.length === 0 && collapsedGroups[''])
                      }
                      onClick={() => toggleGroup('')}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          toggleGroup('');
                        }
                      }}
                      onDragOver={(event) => {
                        event.preventDefault();
                        event.dataTransfer.dropEffect = 'move';
                      }}
                      onDrop={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        const draggedId = event.dataTransfer.getData('text/plain');
                        if (draggedId) onMoveConnection(draggedId, '');
                      }}
                    >
                      <Icon
                        name="chevron"
                        size={12}
                        className={
                          normalizedConnectionQuery.length === 0 && collapsedGroups['']
                            ? 'chevron collapsed'
                            : 'chevron'
                        }
                      />
                      <span>未分组</span>
                      <span className="tree-count">{tree.connections.length}</span>
                    </div>
                    {!(normalizedConnectionQuery.length === 0 && collapsedGroups['']) &&
                      tree.connections.map(renderConnection)}
                  </div>
                )}
                {tree.children.map((child) => renderGroupNode(child, 0))}
              </>
            ) : (
              filteredConnections.map(renderConnection)
            )}
          </>
        )}
      </div>

      <div className="sidebar-section">
        <div className="sidebar-heading">
          <span>对象</span>
          <div className="heading-actions">
            <button
              type="button"
              className="icon-btn"
              title={
                activeConnection?.input.type === 'mssql'
                  ? 'MSSQL 驱动尚未接入'
                  : sessionReadOnly
                    ? '当前为只读会话，无法建表'
                    : '新建表'
              }
              onClick={onNewTable}
              disabled={
                !activeConnection ||
                activeConnection.input.type === 'mssql' ||
                sessionReadOnly
              }
            >
              <Icon name="plus" size={14} />
            </button>
            <button
              type="button"
              className="icon-btn"
              title={
                activeConnection?.input.type === 'mssql'
                  ? 'MSSQL 驱动尚未接入'
                  : sessionReadOnly
                    ? '当前为只读会话，无法建视图'
                    : '新建视图'
              }
              onClick={onNewView}
              disabled={
                !activeConnection ||
                activeConnection.input.type === 'mssql' ||
                sessionReadOnly
              }
            >
              <Icon name="view" size={14} />
            </button>
            <button
              type="button"
              className="icon-btn"
              title="执行 SQL 脚本（多语句）"
              onClick={onRunScript}
              disabled={
                !activeConnection ||
                activeConnection.input.type === 'mssql' ||
                sessionReadOnly
              }
            >
              <Icon name="script" size={14} />
            </button>
            <button
              type="button"
              className="icon-btn"
              title="刷新对象"
              onClick={onRefreshSchema}
              disabled={!activeConnection || schemaLoading}
            >
              <Icon name="refresh" size={14} />
            </button>
          </div>
        </div>

        {activeConnection ? (
          <div className="object-tree">
            <div className="tree-row tree-root">
              <Icon name="database" size={15} />
              <span>{summarize(activeConnection.input)}</span>
            </div>

            <div className="sidebar-search object-search">
              <Icon name="search" size={13} />
              <input
                value={objectQuery}
                placeholder="搜索表/视图…"
                aria-label="搜索对象"
                onChange={(event) => setObjectQuery(event.target.value)}
              />
            </div>

            <label
              className={`tree-row tree-toggle ${systemObjectsSupported ? '' : 'is-disabled'}`}
              title={
                systemObjectsSupported
                  ? '显示或隐藏数据库系统对象（如 sqlite_*）'
                  : '当前连接类型没有可显示的系统对象'
              }
            >
              <input
                type="checkbox"
                checked={showSystemObjects}
                disabled={!systemObjectsSupported || schemaLoading}
                onChange={(event) => onToggleSystemObjects(event.target.checked)}
              />
              <span>显示系统对象</span>
            </label>

            {schemaLoading ? (
              <div className="tree-empty">正在加载对象…</div>
            ) : (
              <>
                <div className="tree-row tree-muted">
                  <Icon name="folder" size={14} />
                  <span>表</span>
                  <span className="tree-count">{tables.length}</span>
                </div>
                {tables.length === 0 ? (
                  <div className="tree-empty tree-child">
                    {normalizedObjectQuery ? '无匹配表' : '无表'}
                  </div>
                ) : (
                  tables.map((table) => (
                    <button
                      key={`table-${table.name}`}
                      type="button"
                      className="tree-row tree-item tree-child"
                      title={`查询 ${table.name}（双击查看数据）`}
                      onClick={() => onOpenTable(table.name)}
                      onDoubleClick={() => onOpenTableData(table.name, 'table')}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        setObjectMenu({
                          x: event.clientX,
                          y: event.clientY,
                          name: table.name,
                          kind: 'table',
                        });
                      }}
                    >
                      <Icon name="table" size={14} />
                      <span>{table.name}</span>
                    </button>
                  ))
                )}

                <div className="tree-row tree-muted">
                  <Icon name="folder" size={14} />
                  <span>视图</span>
                  <span className="tree-count">{views.length}</span>
                </div>
                {views.length === 0 ? (
                  <div className="tree-empty tree-child">
                    {normalizedObjectQuery ? '无匹配视图' : '无视图'}
                  </div>
                ) : (
                  views.map((view) => (
                    <button
                      key={`view-${view.name}`}
                      type="button"
                      className="tree-row tree-item tree-child"
                      title={`查询 ${view.name}（双击查看数据）`}
                      onClick={() => onOpenTable(view.name)}
                      onDoubleClick={() => onOpenTableData(view.name, 'view')}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        setObjectMenu({
                          x: event.clientX,
                          y: event.clientY,
                          name: view.name,
                          kind: 'view',
                        });
                      }}
                    >
                      <Icon name="table" size={14} />
                      <span>{view.name}</span>
                    </button>
                  ))
                )}
              </>
            )}
          </div>
        ) : (
          <div className="sidebar-empty compact">
            <p>选择或新建连接后显示对象树</p>
          </div>
        )}
      </div>

      <div className="sidebar-footer">
        <span className="muted">M1 · SQLite / MySQL 系</span>
      </div>

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            {
              label: '编辑连接',
              onSelect: () => onEditConnection(menu.connection.id),
            },
            {
              label: '复制连接',
              onSelect: () => onDuplicateConnection(menu.connection.id),
            },
            {
              label: '新建查询',
              onSelect: () => onNewQueryForConnection(menu.connection.id),
            },
            {
              label: '生成库级 DDL',
              disabled: menu.connection.id !== activeConnectionId,
              onSelect: () => onGenerateDatabaseDdl(menu.connection.id),
            },
            {
              label: '导出连接配置',
              onSelect: () => onExportConnection(menu.connection.id),
            },
            {
              label: '导出全部连接',
              onSelect: onExportAllConnections,
            },
            {
              label: '导入连接…',
              onSelect: onImportConnections,
            },
            {
              label: '断开连接',
              onSelect: () => onDisconnectConnection(menu.connection.id),
            },
            {
              label: '移到未分组',
              disabled: menu.connection.input.group.trim().length === 0,
              onSelect: () => onMoveConnection(menu.connection.id, ''),
            },
            {
              label: '删除连接',
              danger: true,
              onSelect: () => onDeleteConnection(menu.connection.id),
            },
          ]}
        />
      )}

      {groupMenu && (
        <ContextMenu
          x={groupMenu.x}
          y={groupMenu.y}
          onClose={() => setGroupMenu(null)}
          items={[
            {
              label: '重命名分组',
              onSelect: () => setRenaming({ path: groupMenu.path, value: groupMenu.name }),
            },
            {
              label: '删除分组',
              danger: true,
              onSelect: () => {
                if (
                  window.confirm(
                    `删除分组「${groupMenu.name}」？组内连接会移到「未分组」，连接本身不会被删除。`,
                  )
                ) {
                  onDeleteGroup(groupMenu.path);
                }
              },
            },
          ]}
        />
      )}

      {objectMenu && (
        <ContextMenu
          x={objectMenu.x}
          y={objectMenu.y}
          onClose={() => setObjectMenu(null)}
          items={[
            {
              label: '查询数据',
              onSelect: () => onOpenTable(objectMenu.name),
            },
            {
              label: '查看 DDL',
              onSelect: () => onViewDdl(objectMenu.name, objectMenu.kind),
            },
            {
              label: '复制 DDL',
              onSelect: () => onCopyDdl(objectMenu.name, objectMenu.kind),
            },
            ...(objectMenu.kind === 'table'
              ? [
                  {
                    label: '表结构…',
                    onSelect: () => onShowStructure(objectMenu.name),
                  },
                  {
                    label: '添加列…',
                    onSelect: () => onAddColumn(objectMenu.name),
                  },
                  {
                    label: '重命名列…',
                    onSelect: () => onRenameColumn(objectMenu.name),
                  },
                  {
                    label: '修改列…',
                    onSelect: () => onModifyColumn(objectMenu.name),
                  },
                  {
                    label: '删除列…',
                    danger: true,
                    onSelect: () => onDropColumn(objectMenu.name),
                  },
                  {
                    label: '创建索引…',
                    onSelect: () => onCreateIndex(objectMenu.name),
                  },
                  {
                    label: '删除索引…',
                    onSelect: () => onDropIndex(objectMenu.name),
                  },
                  {
                    label: '重命名表…',
                    onSelect: () => onRenameTable(objectMenu.name),
                  },
                  {
                    label: '删除表…',
                    danger: true,
                    onSelect: () => onDropTable(objectMenu.name),
                  },
                ]
              : [
                  {
                    label: '删除视图…',
                    danger: true,
                    onSelect: () => onDropView(objectMenu.name),
                  },
                ]),
          ]}
        />
      )}
    </aside>
  );
}
