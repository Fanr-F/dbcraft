import type { AppInfo, DatabaseType } from '@shared/ipc-contract';
import type { ConnectionRuntime, RunState, SavedConnection } from '../types';

const DIALECT_LABELS: Record<DatabaseType, string> = {
  sqlite: 'SQLite',
  mysql: 'MySQL',
  percona: 'Percona',
  mariadb: 'MariaDB',
  mssql: 'T-SQL',
};

interface StatusBarProps {
  activeConnection: SavedConnection | null;
  connectionRuntime: ConnectionRuntime | null;
  run: RunState;
  running: boolean;
  appInfo: AppInfo | null;
}

export function StatusBar({
  activeConnection,
  connectionRuntime,
  run,
  running,
  appInfo,
}: StatusBarProps) {
  const online = connectionRuntime?.status === 'connected';

  return (
    <footer className="statusbar">
      <span className={`status-dot ${online ? 'is-online' : ''}`} />
      <span>{activeConnection ? activeConnection.input.name : '未连接'}</span>

      {connectionRuntime?.status === 'connecting' && <span className="status-warn">连接中…</span>}
      {connectionRuntime?.status === 'error' && <span className="status-error">连接失败</span>}
      {online && activeConnection && (
        <span className="status-strong">
          {DIALECT_LABELS[activeConnection.input.type]} {connectionRuntime.version ?? ''}
        </span>
      )}

      <span className="status-sep" />
      <span>{running ? '执行中…' : run.error ? '执行失败' : run.executedAt ? `${run.rowCount} 行` : '—'}</span>
      <span>{run.executedAt && !run.error ? `${run.elapsedMs} ms` : ''}</span>
      {run.truncated && <span className="status-warn">已截断</span>}
      <span className="status-sep" />
      <span>单会话</span>

      <span className="status-spacer" />
      <span>{appInfo ? `v${appInfo.version} · Electron ${appInfo.electron}` : 'DBCraft'}</span>
      <span className="status-badge">M1</span>
    </footer>
  );
}
