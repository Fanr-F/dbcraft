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
  sessionCount: number;
  currentDatabase: string | null;
  transactionActive: boolean;
  run: RunState;
  running: boolean;
  appInfo: AppInfo | null;
}

export function StatusBar({
  activeConnection,
  sessionRuntime,
  sessionCount,
  currentDatabase,
  transactionActive,
  run,
  running,
  appInfo,
}: StatusBarProps) {
  const online = sessionRuntime?.status === 'ready';
  const scriptElapsed = run.statements
    ? run.statements.reduce((total, statement) => total + statement.elapsedMs, 0)
    : run.elapsedMs;

  return (
    <footer className="statusbar">
      <span
        className={`status-dot ${online ? 'is-online' : ''}`}
        title={sessionRuntime?.message ?? undefined}
      />
      <span>{activeConnection ? activeConnection.input.name : '未连接'}</span>

      {sessionRuntime?.status === 'opening' && <span className="status-warn">打开会话…</span>}
      {sessionRuntime?.status === 'error' && (
        <span className="status-error" title={sessionRuntime.message}>
          会话失败
        </span>
      )}
      {online && activeConnection && (
        <span className="status-strong">
          {DIALECT_LABELS[activeConnection.input.type]} {sessionRuntime.version ?? ''}
        </span>
      )}
      {online && currentDatabase && <span>库 {currentDatabase}</span>}
      {transactionActive && <span className="status-warn">事务中</span>}
      <span className="status-sep" />
      <span>
        {running
          ? '执行中…'
          : run.error
            ? '执行失败'
            : run.statements
              ? `${run.statements.length} 条语句`
              : run.executedAt
                ? `${run.rowCount} 行`
                : '—'}
      </span>
      <span>{run.executedAt && !run.error ? `${scriptElapsed} ms` : ''}</span>
      {run.truncated && <span className="status-warn">已截断</span>}
      <span className="status-sep" />
      <span>{sessionCount} 个会话</span>

      <span className="status-spacer" />
      <span>{appInfo ? `v${appInfo.version} · Electron ${appInfo.electron}` : 'DBCraft'}</span>
      <span className="status-badge">M1</span>
    </footer>
  );
}
