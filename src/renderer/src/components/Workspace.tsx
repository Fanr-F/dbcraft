import type { DatabaseType } from '@shared/ipc-contract';
import type { QueryTab, RunState, SessionRuntime } from '../types';
import { SqlEditor } from '../features/editor/SqlEditor';
import { ResultGrid } from '../features/grid/ResultGrid';
import { Icon } from './Icon';

const DIALECT_LABELS: Record<DatabaseType, string> = {
  sqlite: 'SQLite',
  mysql: 'MySQL',
  percona: 'Percona',
  mariadb: 'MariaDB',
  mssql: 'T-SQL',
};

function runtimeBadge(
  runtime: SessionRuntime | null,
  connectionType: DatabaseType | null,
): { text: string; tone: string } {
  if (!runtime || runtime.status === 'idle') return { text: '无会话', tone: 'badge-warn' };
  if (runtime.status === 'opening') return { text: '打开会话…', tone: 'badge-warn' };
  if (runtime.status === 'error') return { text: '会话失败', tone: 'badge-danger' };
  return {
    text: `${connectionType ? DIALECT_LABELS[connectionType] : 'SQL'} 会话`,
    tone: 'badge-ok',
  };
}

interface WorkspaceProps {
  tabs: QueryTab[];
  activeTabId: string;
  run: RunState;
  running: boolean;
  connectionType: DatabaseType | null;
  sessionRuntime: SessionRuntime | null;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onAddTab: () => void;
  onSqlChange: (value: string) => void;
  onRun: () => void;
  onCancel: () => void;
}

export function Workspace({
  tabs,
  activeTabId,
  run,
  running,
  connectionType,
  sessionRuntime,
  onSelectTab,
  onCloseTab,
  onAddTab,
  onSqlChange,
  onRun,
  onCancel,
}: WorkspaceProps) {
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];
  const ready = sessionRuntime?.status === 'ready';
  const badge = runtimeBadge(sessionRuntime, connectionType);

  return (
    <section className="workspace">
      <div className="tabbar" role="tablist" aria-label="查询标签页">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            role="tab"
            aria-selected={tab.id === activeTabId}
            tabIndex={0}
            className={`tab ${tab.id === activeTabId ? 'is-active' : ''}`}
            onClick={() => onSelectTab(tab.id)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onSelectTab(tab.id);
              }
            }}
          >
            <span>{tab.title}</span>
            {tabs.length > 1 && (
              <button
                type="button"
                className="tab-close"
                aria-label={`关闭 ${tab.title}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onCloseTab(tab.id);
                }}
              >
                <Icon name="close" size={12} />
              </button>
            )}
          </div>
        ))}

        <button type="button" className="tab-add" title="新建查询" onClick={onAddTab}>
          <Icon name="plus" size={14} />
        </button>
      </div>

      <div className="editor-pane">
        <div className="pane-toolbar">
          <button
            type="button"
            className="btn btn-run"
            onClick={onRun}
            disabled={running || !ready}
            title={ready ? '执行 SQL（Ctrl+Enter）' : '先连接数据库'}
          >
            <Icon name="play" size={14} />
            {running ? '执行中…' : '执行'}
          </button>
          <button
            type="button"
            className="btn"
            onClick={onCancel}
            disabled={!running}
            title="取消当前查询"
          >
            <Icon name="stop" size={13} />
            取消
          </button>
          <span className="chip">{connectionType ? DIALECT_LABELS[connectionType] : 'SQL'}</span>
          <span className="pane-hint">Ctrl+Enter 执行</span>
          <span className="spacer" />
          <span className={`badge ${badge.tone}`}>{badge.text}</span>
        </div>

        <SqlEditor value={activeTab.sql} onChange={onSqlChange} onRun={onRun} />
      </div>

      <div className="result-pane">
        <div className="pane-toolbar">
          <strong>结果</strong>
          {run.error ? (
            <span className="badge badge-danger">执行失败</span>
          ) : run.statementType === 'change' ? (
            <span className="pane-hint">
              {run.changes ?? 0} 行受影响 · {run.elapsedMs} ms
            </span>
          ) : run.executedAt ? (
            <span className="pane-hint">
              {run.rowCount} 行 · {run.elapsedMs} ms
            </span>
          ) : (
            <span className="pane-hint">尚未执行</span>
          )}
          {run.truncated && <span className="badge badge-warn">已截断</span>}
          <span className="spacer" />
          <button type="button" className="btn" disabled title="导出在后续里程碑接入">
            导出
          </button>
        </div>

        {run.error && (
          <div className="result-error" role="alert">
            {run.error}
          </div>
        )}

        <ResultGrid columns={run.columns} rows={run.rows} />
      </div>
    </section>
  );
}
