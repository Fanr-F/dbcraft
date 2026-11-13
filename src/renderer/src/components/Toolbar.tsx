import { Icon } from './Icon';

interface ToolbarProps {
  onNewConnection: () => void;
  onReconnectAll: () => void;
  onOpenHistory: () => void;
  onOpenSettings: () => void;
}

export function Toolbar({
  onNewConnection,
  onReconnectAll,
  onOpenHistory,
  onOpenSettings,
}: ToolbarProps) {
  return (
    <header className="toolbar">
      <div className="brand">
        <span className="brand-mark">D</span>
        <span className="brand-text">
          <strong>DBCraft</strong>
          <span>M1 · MySQL 系</span>
        </span>
      </div>

      <div className="connection-switcher">
        <button type="button" className="btn btn-primary" onClick={onNewConnection}>
          <Icon name="plus" size={15} />
          新建连接
        </button>
      </div>

      <div className="toolbar-actions">
        <button
          type="button"
          className="icon-btn"
          title="重连全部绑定标签"
          onClick={onReconnectAll}
        >
          <Icon name="refresh" />
        </button>
        <button
          type="button"
          className="icon-btn"
          title="查询历史（Ctrl+E）"
          onClick={onOpenHistory}
        >
          <Icon name="history" />
        </button>
        <button type="button" className="icon-btn" title="设置" onClick={onOpenSettings}>
          <Icon name="settings" />
        </button>
      </div>
    </header>
  );
}
