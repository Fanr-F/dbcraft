import { DATABASE_TYPE_LABELS, ENVIRONMENT_LABELS } from '@shared/ipc-contract';
import type { ConnectionInput } from '@shared/ipc-contract';
import type { SavedConnection } from '../types';
import { Icon } from './Icon';

interface SidebarProps {
  connections: SavedConnection[];
  activeConnectionId: string | null;
  activeConnection: SavedConnection | null;
  onSelectConnection: (id: string) => void;
  onNewConnection: () => void;
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
  onSelectConnection,
  onNewConnection,
}: SidebarProps) {
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
          <button type="button" className="icon-btn" title="刷新（M1 接入）" disabled>
            <Icon name="refresh" size={14} />
          </button>
        </div>

        {activeConnection ? (
          <div className="object-tree">
            <div className="tree-row tree-root">
              <Icon name="database" size={15} />
              <span>{summarize(activeConnection.input)}</span>
            </div>
            <div className="tree-group">
              <div className="tree-row tree-muted">
                <Icon name="folder" size={14} />
                <span>表</span>
              </div>
              <div className="tree-row tree-muted tree-child">
                <Icon name="table" size={14} />
                <span>M1 接入元数据</span>
              </div>
              <div className="tree-row tree-muted">
                <Icon name="folder" size={14} />
                <span>视图</span>
              </div>
            </div>
          </div>
        ) : (
          <div className="sidebar-empty compact">
            <p>选择或新建连接后显示对象树</p>
          </div>
        )}
      </div>

      <div className="sidebar-footer">
        <span className="muted">M0 · 界面与 IPC 原型</span>
      </div>
    </aside>
  );
}
