import { DATABASE_TYPE_LABELS } from '@shared/ipc-contract';
import type { SavedConnection } from '../types';
import { Icon } from './Icon';

interface ToolbarProps {
  connections: SavedConnection[];
  activeConnectionId: string | null;
  onSelectConnection: (id: string) => void;
  onNewConnection: () => void;
}

export function Toolbar({
  connections,
  activeConnectionId,
  onSelectConnection,
  onNewConnection,
}: ToolbarProps) {
  return (
    <header className="toolbar">
      <div className="brand">
        <span className="brand-mark">D</span>
        <span className="brand-text">
          <strong>DBCraft</strong>
          <span>M0 原型</span>
        </span>
      </div>

      <div className="connection-switcher">
        <select
          className="connection-select"
          aria-label="当前连接"
          value={activeConnectionId ?? ''}
          onChange={(event) => {
            if (event.target.value) onSelectConnection(event.target.value);
          }}
        >
          <option value="">未选择连接</option>
          {connections.map((connection) => (
            <option key={connection.id} value={connection.id}>
              {connection.input.name} · {DATABASE_TYPE_LABELS[connection.input.type]}
            </option>
          ))}
        </select>

        <button type="button" className="btn btn-primary" onClick={onNewConnection}>
          <Icon name="plus" size={15} />
          新建连接
        </button>
      </div>

      <div className="toolbar-actions">
        <button type="button" className="icon-btn" title="历史（M1 接入）" disabled>
          <Icon name="history" />
        </button>
        <button type="button" className="icon-btn" title="设置（M1 接入）" disabled>
          <Icon name="settings" />
        </button>
      </div>
    </header>
  );
}
