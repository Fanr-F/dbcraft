import { useEffect, useState } from 'react';
import type { DatabaseType, QueryCell, TableMeta } from '@shared/ipc-contract';
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
  theme: 'dark' | 'light';
  tableMeta: TableMeta | null;
  tableEditable: boolean;
  canEnableNoPk: boolean;
  noPkMode: boolean;
  editableFromRow?: number;
  onToggleNoPk: (next: boolean) => void;
  pendingEdits: number;
  committing: boolean;
  selectedRow: number | null;
  canUndo: boolean;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onAddTab: () => void;
  onSqlChange: (value: string) => void;
  onRun: (sql?: string) => void;
  onOpenSqlFile: () => void;
  onSaveSqlFile: () => void;
  onFormatSql: () => void;
  completionItems: string[];
  onCancel: () => void;
  onReconnect: () => void;
  onExport: () => void;
  onCopyColumnNames: () => void;
  focusedCell: { rowIndex: number; columnIndex: number } | null;
  onCellFocus: (rowIndex: number, columnIndex: number) => void;
  onViewCell: () => void;
  onTablePageChange: (page: number) => void;
  onTablePageSizeChange: (pageSize: number) => void;
  onTableSortChange: (column: string, direction: 'asc' | 'desc') => void;
  onTableFilterChange: (column: string, value: string) => void;
  onCellChange: (rowIndex: number, columnIndex: number, value: QueryCell) => void;
  onCellsChange: (
    changes: Array<{ rowIndex: number; columnIndex: number; value: QueryCell }>,
  ) => void;
  onRowFocus: (rowIndex: number) => void;
  onAddRow: () => void;
  onDeleteRow: () => void;
  onUndo: () => void;
  onCommitEdits: () => void;
  onRollbackEdits: () => void;
}

export function Workspace({
  tabs,
  activeTabId,
  run,
  running,
  connectionType,
  sessionRuntime,
  theme,
  tableMeta,
  tableEditable,
  canEnableNoPk,
  noPkMode,
  editableFromRow,
  onToggleNoPk,
  pendingEdits,
  committing,
  selectedRow,
  canUndo,
  onSelectTab,
  onCloseTab,
  onAddTab,
  onSqlChange,
  onRun,
  onOpenSqlFile,
  onSaveSqlFile,
  onFormatSql,
  completionItems,
  onCancel,
  onReconnect,
  onExport,
  onCopyColumnNames,
  focusedCell,
  onCellFocus,
  onViewCell,
  onTablePageChange,
  onTablePageSizeChange,
  onTableSortChange,
  onTableFilterChange,
  onCellChange,
  onCellsChange,
  onRowFocus,
  onAddRow,
  onDeleteRow,
  onUndo,
  onCommitEdits,
  onRollbackEdits,
}: WorkspaceProps) {
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];
  const ready = sessionRuntime?.status === 'ready';
  const badge = runtimeBadge(sessionRuntime, connectionType);
  const sessionMessage = sessionRuntime?.message ?? null;
  const editable = Boolean(activeTab.table && tableEditable && !running);
  const tableReason = activeTab.table
    ? tableMeta
      ? tableMeta.editable
        ? null
        : (tableMeta.reason ?? null)
      : '正在读取表结构…'
    : null;
  const lockedByEdits = pendingEdits > 0;
  const [filterColumn, setFilterColumn] = useState(
    activeTab.table?.filter?.column ?? '',
  );
  const [filterValue, setFilterValue] = useState(activeTab.table?.filter?.value ?? '');

  useEffect(() => {
    setFilterColumn(activeTab.table?.filter?.column ?? '');
    setFilterValue(activeTab.table?.filter?.value ?? '');
  }, [activeTab.id, activeTab.table?.filter?.column, activeTab.table?.filter?.value]);

  const applyFilter = () => {
    if (!filterColumn) return;
    onTableFilterChange(filterColumn, filterValue);
  };
  const tlsFallback =
    sessionRuntime?.status === 'ready' && sessionMessage !== null && /TLS|回退/.test(sessionMessage);

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

      {sessionRuntime?.status === 'error' && (
        <div className="session-alert session-alert-error" role="alert">
          <span className="session-alert-text">
            {sessionMessage ?? '会话已断开，请重新连接。'}
          </span>
          <button type="button" className="btn" onClick={onReconnect}>
            <Icon name="refresh" size={13} />
            重连
          </button>
        </div>
      )}

      {tlsFallback && (
        <div className="session-alert session-alert-warn" role="status">
          <span className="session-alert-text">{sessionMessage}</span>
        </div>
      )}

      {sessionRuntime?.readonly && (
        <div className="session-alert session-alert-warn" role="status">
          <span className="session-alert-text">
            当前为只读模式：数据库文件被占用或不可写，写入操作会被拒绝。
          </span>
        </div>
      )}

      {activeTab.table && canEnableNoPk && (
        <div
          className={
            noPkMode ? 'session-alert session-alert-error' : 'session-alert session-alert-warn'
          }
          role="status"
        >
          <span className="session-alert-text">
            {noPkMode
              ? '高风险模式：无主键表只允许新增行；已有行保持只读，无法更新或删除。'
              : '该表没有主键，无法安全定位已有行，默认只读。'}
          </span>
          <button type="button" className="btn" onClick={() => onToggleNoPk(!noPkMode)}>
            {noPkMode ? '关闭高风险模式' : '允许新增行（高风险）'}
          </button>
        </div>
      )}

      {activeTab.table && tableMeta && !tableMeta.editable && !canEnableNoPk && tableReason && (
        <div className="session-alert session-alert-warn" role="status">
          <span className="session-alert-text">
            表数据只读：{tableReason}。可继续查询与导出，但不会写回数据库。
          </span>
        </div>
      )}

      <div className="editor-pane">
        <div className="pane-toolbar">
          <button
            type="button"
            className="btn btn-run"
            onClick={() => onRun()}
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
          <button
            type="button"
            className="btn"
            onClick={onOpenSqlFile}
            title="打开 SQL 文件"
          >
            打开 SQL
          </button>
          <button
            type="button"
            className="btn"
            onClick={onSaveSqlFile}
            title="保存 SQL 文件（Ctrl+S）"
          >
            保存 SQL
          </button>
          <button
            type="button"
            className="btn"
            onClick={onFormatSql}
            title="格式化 SQL（Ctrl+Shift+F）"
          >
            格式化
          </button>
          <span className="chip">{connectionType ? DIALECT_LABELS[connectionType] : 'SQL'}</span>
          <span className="pane-hint">Ctrl+Enter 执行；Ctrl+Space 补全；有选区时只执行选区</span>
          <span className="spacer" />
          <span className={`badge ${badge.tone}`}>{badge.text}</span>
        </div>

        <SqlEditor
          value={activeTab.sql}
          onChange={onSqlChange}
          onRun={onRun}
          onSave={onSaveSqlFile}
          onFormat={onFormatSql}
          completionItems={completionItems}
        />
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
          {run.truncated && (
            <span className="badge badge-warn">仅显示前 {run.rowCount} 行</span>
          )}
          <span className="spacer" />
          <button
            type="button"
            className="btn"
            disabled={!focusedCell || run.columns.length === 0}
            title="查看选中单元格的完整内容"
            onClick={onViewCell}
          >
            查看单元格
          </button>
          <button
            type="button"
            className="btn"
            disabled={run.columns.length === 0}
            title="复制全部列名（制表符分隔）"
            onClick={onCopyColumnNames}
          >
            复制列名
          </button>
          <button
            type="button"
            className="btn"
            disabled={run.columns.length === 0 || run.error !== null}
            title="导出当前结果"
            onClick={onExport}
          >
            导出
          </button>
        </div>

        {activeTab.table && (
          <div className="table-pager">
            <span className="pane-hint">表 {activeTab.table.name}</span>
            <button
              type="button"
              className="btn"
              disabled={running || lockedByEdits || activeTab.table.page === 0}
              title={lockedByEdits ? '先提交或回滚当前修改' : '上一页'}
              onClick={() => onTablePageChange(activeTab.table!.page - 1)}
            >
              上一页
            </button>
            <span className="pane-hint">第 {activeTab.table.page + 1} 页</span>
            <button
              type="button"
              className="btn"
              disabled={
                running || lockedByEdits || run.rowCount < activeTab.table.pageSize
              }
              title={lockedByEdits ? '先提交或回滚当前修改' : '下一页'}
              onClick={() => onTablePageChange(activeTab.table!.page + 1)}
            >
              下一页
            </button>
            <span className="pane-hint">每页</span>
            <select
              className="page-size"
              value={activeTab.table.pageSize}
              disabled={running || lockedByEdits}
              aria-label="每页行数"
              onChange={(event) => onTablePageSizeChange(Number(event.target.value))}
            >
              {[50, 200, 500].map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>

            <span className="pane-hint">排序</span>
            <select
              className="page-size"
              aria-label="排序字段"
              value={activeTab.table.sort?.column ?? ''}
              disabled={running || lockedByEdits || run.columns.length === 0}
              onChange={(event) =>
                onTableSortChange(
                  event.target.value,
                  activeTab.table!.sort?.direction ?? 'asc',
                )
              }
            >
              <option value="">不排序</option>
              {run.columns.map((column) => (
                <option key={column.name} value={column.name}>
                  {column.name}
                </option>
              ))}
            </select>

            {activeTab.table.sort && (
              <button
                type="button"
                className="btn"
                disabled={running || lockedByEdits}
                onClick={() =>
                  onTableSortChange(
                    activeTab.table!.sort!.column,
                    activeTab.table!.sort!.direction === 'asc' ? 'desc' : 'asc',
                  )
                }
              >
                {activeTab.table.sort.direction === 'asc' ? '升序' : '降序'}
              </button>
            )}

            <span className="pane-hint">过滤</span>
            <select
              className="page-size"
              aria-label="过滤列"
              value={filterColumn}
              disabled={running || lockedByEdits || run.columns.length === 0}
              onChange={(event) => setFilterColumn(event.target.value)}
            >
              <option value="">选择列</option>
              {run.columns.map((column) => (
                <option key={column.name} value={column.name}>
                  {column.name}
                </option>
              ))}
            </select>
            <input
              className="table-filter-input"
              aria-label="过滤值"
              placeholder="包含内容"
              value={filterValue}
              disabled={running || lockedByEdits || !filterColumn}
              onChange={(event) => setFilterValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  applyFilter();
                }
              }}
            />
            <button
              type="button"
              className="btn"
              disabled={!filterColumn || running || lockedByEdits}
              title="按当前列做 LIKE 过滤（服务端 WHERE）"
              onClick={applyFilter}
            >
              应用
            </button>
            {activeTab.table.filter && (
              <button
                type="button"
                className="btn"
                disabled={running || lockedByEdits}
                onClick={() => {
                  setFilterValue('');
                  onTableFilterChange(activeTab.table!.filter!.column, '');
                }}
              >
                清除
              </button>
            )}

            <span className="spacer" />
            {editable && (
              <>
                <button
                  type="button"
                  className="btn"
                  disabled={running}
                  title="在结果末尾追加一行，提交时执行 INSERT"
                  onClick={onAddRow}
                >
                  新增行
                </button>
                <button
                  type="button"
                  className="btn"
                  disabled={running || !canUndo}
                  title="撤销最近一步本地编辑"
                  onClick={onUndo}
                >
                  撤销
                </button>
                <button
                  type="button"
                  className="btn"
                  disabled={running || selectedRow === null}
                  title={
                    selectedRow === null
                      ? '先点击要删除的行'
                      : '删除当前选中行，提交时执行 DELETE'
                  }
                  onClick={onDeleteRow}
                >
                  删除选中行
                </button>
                <span className="pane-hint">
                  双击单元格编辑，主键列不可改
                </span>
              </>
            )}
            {lockedByEdits && (
              <span className="badge badge-warn">待提交 {pendingEdits} 项</span>
            )}
            <button
              type="button"
              className="btn btn-run"
              disabled={!lockedByEdits || committing || running}
              title="在一个事务中提交全部修改"
              onClick={onCommitEdits}
            >
              {committing ? '提交中…' : '提交修改'}
            </button>
            <button
              type="button"
              className="btn"
              disabled={!lockedByEdits || committing || running}
              title="丢弃本次修改并重新加载"
              onClick={onRollbackEdits}
            >
              回滚
            </button>
          </div>
        )}

        {run.error && (
          <div className="result-error" role="alert">
            <span>{run.error}</span>
            {run.errorMeta && <span className="result-error-meta">{run.errorMeta}</span>}
            {run.errorHint && (
              <span className="result-error-hint">建议：{run.errorHint}</span>
            )}
          </div>
        )}

        <ResultGrid
          columns={run.columns}
          rows={run.rows}
          editable={editable}
          editableFromRow={editableFromRow}
          readOnlyColumns={
            tableMeta?.columns.filter((column) => column.readOnly).map((column) => column.name) ??
            []
          }
          sort={activeTab.table?.sort ?? null}
          theme={theme}
          onCellChange={onCellChange}
          onCellsChange={onCellsChange}
          onRowFocus={onRowFocus}
          onCellFocus={onCellFocus}
          onHeaderClick={(column) => {
            if (!activeTab.table || lockedByEdits) return;
            const current = activeTab.table.sort;
            onTableSortChange(
              column,
              current?.column === column
                ? current.direction === 'asc'
                  ? 'desc'
                  : 'asc'
                : 'asc',
            );
          }}
        />
      </div>
    </section>
  );
}
