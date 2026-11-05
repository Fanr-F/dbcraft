import type { AppInfo, DatabaseType } from '@shared/ipc-contract';
import type { RunState, SavedConnection } from '../types';

const DIALECT_LABELS: Record<DatabaseType, string> = {
  sqlite: 'SQLite',
  mysql: 'MySQL',
  percona: 'Percona',
  mariadb: 'MariaDB',
  mssql: 'T-SQL',
};

interface StatusBarProps {
  activeConnection: SavedConnection | null;
  run: RunState;
  running: boolean;
  appInfo: AppInfo | null;
}

export function StatusBar({ activeConnection, run, running, appInfo }: StatusBarProps) {
  return (
    <footer className="statusbar">
      <span className={`status-dot ${activeConnection ? 'is-online' : ''}`} />
      <span>{activeConnection ? activeConnection.input.name : '未连接'}</span>
      {activeConnection && (
        <span className="status-strong">{DIALECT_LABELS[activeConnection.input.type]}</span>
      )}

      <span className="status-sep" />
      <span>{running ? '执行中…' : `${run.rows.length} 行`}</span>
      <span>{run.elapsedMs} ms</span>
      {run.simulated && <span className="status-warn">模拟结果</span>}
      <span className="status-sep" />
      <span>自动提交</span>

      <span className="status-spacer" />
      <span>{appInfo ? `v${appInfo.version} · Electron ${appInfo.electron}` : 'DBCraft'}</span>
      <span className="status-badge">M0</span>
    </footer>
  );
}
