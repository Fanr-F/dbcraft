import type { AppInfo, DatabaseType } from '@shared/ipc-contract';
import type { RunState, SavedConnection, SessionRuntime } from '../types';

const DIALECT_LABELS: Record<DatabaseType, string> = {
  sqlite: 'SQLite',
  mysql: 'MySQL',
  percona: 'Percona',
  mariadb: 'MariaDB',
  mssql: 'T-SQL',
};

interface StatusBarProps {
  activeConnection: SavedConnection | null;
  sessionRuntime: SessionRuntime | null;
  run: RunState;
  running: boolean;
  appInfo: AppInfo | null;
}

export function StatusBar({
  activeConnection,
  sessionRuntime,
  run,
  running,
  appInfo,
}: StatusBarProps) {
  const online = sessionRuntime?.status === 'ready';

  return (
    <footer className="statusbar">
      <span className={`status-dot ${online ? 'is-online' : ''}`} />
      <span>{activeConnection ? activeConnection.input.name : '未连接'}</span>

      {sessionRuntime?.status === 'opening' && <span className="status-warn">打开会话…</span>}
      {sessionRuntime?.status === 'error' && <span className="status-error">会话失败</span>}
      {online && activeConnection && (
        <span className="status-strong">
          {DIALECT_LABELS[activeConnection.input.type]} {sessionRuntime.version ?? ''}
        </span>
      )}

      <span className="status-sep" />
      <span>{running ? '执行中…' : run.error ? '执行失败' : run.executedAt ? `${run.rowCount} 行` : '—'}</span>
      <span>{run.executedAt && !run.error ? `${run.elapsedMs} ms` : ''}</span>
      {run.truncated && <span className="status-warn">已截断</span>}
      <span className="status-sep" />
      <span>标签会话</span>

      <span className="status-spacer" />
      <span>{appInfo ? `v${appInfo.version} · Electron ${appInfo.electron}` : 'DBCraft'}</span>
      <span className="status-badge">M1</span>
    </footer>
  );
}
