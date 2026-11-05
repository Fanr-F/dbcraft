import type { DatabaseType } from '@shared/ipc-contract';
import type { QueryTab, RunState } from '../types';
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

interface WorkspaceProps {
  tabs: QueryTab[];
  activeTabId: string;
  run: RunState;
  running: boolean;
  connectionType: DatabaseType | null;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onAddTab: () => void;
  onSqlChange: (value: string) => void;
  onRun: () => void;
}

export function Workspace({
  tabs,
  activeTabId,
  run,
  running,
  connectionType,
  onSelectTab,
  onCloseTab,
  onAddTab,
  onSqlChange,
  onRun,
}: WorkspaceProps) {
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];

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
          <button type="button" className="btn btn-run" onClick={onRun} disabled={running}>
            <Icon name="play" size={14} />
            {running ? '执行中…' : '执行'}
          </button>
          <button type="button" className="btn" disabled>
            <Icon name="stop" size={13} />
            停止
          </button>
          <span className="chip">{connectionType ? DIALECT_LABELS[connectionType] : 'SQL'}</span>
          <span className="pane-hint">Ctrl+Enter 执行</span>
          <span className="spacer" />
          <span className="badge badge-warn">M0 模拟执行</span>
        </div>

        <SqlEditor value={activeTab.sql} onChange={onSqlChange} onRun={onRun} />
      </div>

      <div className="result-pane">
        <div className="pane-toolbar">
          <strong>结果</strong>
          <span className="pane-hint">
            {run.rows.length} 行 · {run.elapsedMs} ms
          </span>
          {run.simulated && <span className="badge badge-warn">示例数据</span>}
          <span className="spacer" />
          <button type="button" className="btn" disabled title="Excel / CSV 导出在 M1 接入">
            导出
          </button>
        </div>

        <ResultGrid rows={run.rows} />
      </div>
    </section>
  );
}
