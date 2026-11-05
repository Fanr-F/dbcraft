import { DATABASE_TYPE_LABELS, ENVIRONMENT_LABELS } from '@shared/ipc-contract';
import type { ConnectionInput, SchemaObject } from '@shared/ipc-contract';
import type { SavedConnection } from '../types';
import { Icon } from './Icon';

interface SidebarProps {
  connections: SavedConnection[];
  activeConnectionId: string | null;
  activeConnection: SavedConnection | null;
  schemaObjects: SchemaObject[];
  schemaLoading: boolean;
  onSelectConnection: (id: string) => void;
  onNewConnection: () => void;
  onRefreshSchema: () => void;
  onOpenTable: (name: string) => void;
}

function fileName(filePath: string): string {
  return filePath.split(/[\\/]/).pop() || filePath;
}

function summarize(input: ConnectionInput): string {
  if (input.type === 'sqlite') return fileName(input.filePath);
  return input.database || '未选择数据库';
}

export function Sidebar({
  connections,
  activeConnectionId,
  activeConnection,
  schemaObjects,
  schemaLoading,
  onSelectConnection,
  onNewConnection,
  onRefreshSchema,
  onOpenTable,
}: SidebarProps) {
  const tables = schemaObjects.filter((object) => object.type === 'table');
  const views = schemaObjects.filter((object) => object.type === 'view');

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
          connections.map((connection) => (
            <button
              key={connection.id}
              type="button"
              className={`connection-item ${connection.id === activeConnectionId ? 'is-active' : ''}`}
              onClick={() => onSelectConnection(connection.id)}
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
          ))
        )}
      </div>

      <div className="sidebar-section">
        <div className="sidebar-heading">
          <span>对象</span>
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

        {activeConnection ? (
          <div className="object-tree">
            <div className="tree-row tree-root">
              <Icon name="database" size={15} />
              <span>{summarize(activeConnection.input)}</span>
            </div>

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
                  <div className="tree-empty tree-child">无表</div>
                ) : (
                  tables.map((table) => (
                    <button
                      key={`table-${table.name}`}
                      type="button"
                      className="tree-row tree-item tree-child"
                      title={`查询 ${table.name}`}
                      onClick={() => onOpenTable(table.name)}
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
                  <div className="tree-empty tree-child">无视图</div>
                ) : (
                  views.map((view) => (
                    <button
                      key={`view-${view.name}`}
                      type="button"
                      className="tree-row tree-item tree-child"
                      title={`查询 ${view.name}`}
                      onClick={() => onOpenTable(view.name)}
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
    </aside>
  );
}
