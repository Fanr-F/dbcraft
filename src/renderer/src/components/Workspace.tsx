import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type {
  DatabaseInfo,
  DatabaseType,
  QueryCell,
  ShortcutMap,
  TableMeta,
} from '@shared/ipc-contract';
import type { QueryTab, RunState, SessionRuntime, TransactionRuntime } from '../types';
import { EMPTY_TAB } from '../types';
import type {
  CompletionCandidate,
  CompletionContext,
  CompletionGroups,
} from '../utils/sql-completion';
import type { TableFilter, TableFilterOperator } from '@shared/dialect/identifiers';
import { SqlEditor } from '../features/editor/SqlEditor';
import { ResultGrid } from '../features/grid/ResultGrid';
import { ContextMenu } from './ContextMenu';
import { Icon } from './Icon';
import { TableDesignTab } from './TableDesignTab';

const DIALECT_LABELS: Record<DatabaseType, string> = {
  sqlite: 'SQLite',
  mysql: 'MySQL',
  percona: 'Percona',
  mariadb: 'MariaDB',
  mssql: 'T-SQL',
};

interface FilterOperatorOption {
  value: TableFilterOperator;
  label: string;
}

const TEXT_OPERATORS: FilterOperatorOption[] = [
  { value: 'contains', label: '包含' },
  { value: 'equals', label: '等于' },
  { value: 'notEquals', label: '不等于' },
  { value: 'startsWith', label: '开头是' },
  { value: 'endsWith', label: '结尾是' },
  { value: 'isNull', label: '为 NULL' },
  { value: 'isNotNull', label: '不为 NULL' },
];

const ORDERED_OPERATORS: FilterOperatorOption[] = [
  { value: 'equals', label: '等于' },
  { value: 'notEquals', label: '不等于' },
  { value: 'gt', label: '大于' },
  { value: 'gte', label: '大于等于' },
  { value: 'lt', label: '小于' },
  { value: 'lte', label: '小于等于' },
  { value: 'isNull', label: '为 NULL' },
  { value: 'isNotNull', label: '不为 NULL' },
];

const BOOLEAN_OPERATORS: FilterOperatorOption[] = [
  { value: 'equals', label: '等于' },
  { value: 'notEquals', label: '不等于' },
  { value: 'isNull', label: '为 NULL' },
  { value: 'isNotNull', label: '不为 NULL' },
];

/** 按数据库返回的声明类型给出可用操作符；类型未知时按文本处理。 */
function filterOperators(declaredType: string | null | undefined): FilterOperatorOption[] {
  const type = declaredType ?? '';
  if (/bit|bool|boolean/i.test(type)) return BOOLEAN_OPERATORS;
  if (/int|numeric|decimal|number|real|float|double|money|serial/i.test(type)) {
    return ORDERED_OPERATORS;
  }
  if (/date|time|year/i.test(type)) return ORDERED_OPERATORS;
  return TEXT_OPERATORS;
}

function filterOperatorLabel(operator: TableFilterOperator | undefined): string {
  return (
    [...TEXT_OPERATORS, ...ORDERED_OPERATORS, ...BOOLEAN_OPERATORS].find(
      (item) => item.value === operator,
    )?.label ?? '包含'
  );
}

function backendFilters(table: QueryTab['table'] | undefined): TableFilter[] {
  if (!table) return [];
  if (table.filters && table.filters.length > 0) return table.filters;
  return table.filter ? [table.filter] : [];
}

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
  /** 自动标题：连接/库 + 标签标题。 */
  tabLabels: Record<string, string>;
  tabStatuses: Record<string, { running: boolean; error: boolean; dirty: boolean }>;
  run: RunState;
  running: boolean;
  connectionType: DatabaseType | null;
  sessionRuntime: SessionRuntime | null;
  transaction: TransactionRuntime;
  onBeginTransaction: () => void;
  onCommitTransaction: () => void;
  onRollbackTransaction: () => void;
  theme: 'dark' | 'light';
  tableMeta: TableMeta | null;
  tableEditable: boolean;
  canEnableNoPk: boolean;
  noPkMode: boolean;
  allowPrimaryKeyEdit: boolean;
  onTogglePrimaryKeyEdit: (next: boolean) => void;
  canEnableIdentityInsert: boolean;
  allowIdentityInsert: boolean;
  onToggleIdentityInsert: (next: boolean) => void;
  editableFromRow?: number;
  onToggleNoPk: (next: boolean) => void;
  pendingEdits: number;
  committing: boolean;
  autoCommit: boolean;
  confirmCommit: boolean;
  skipConflicts: boolean;
  onToggleAutoCommit: (next: boolean) => void;
  onToggleConfirmCommit: (next: boolean) => void;
  onToggleSkipConflicts: (next: boolean) => void;
  selectedRow: number | null;
  selectedRowRange?: { start: number; end: number } | null;
  onRowRangeChange: (start: number, end: number) => void;
  canUndo: boolean;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onCloseOtherTabs: (id: string) => void;
  onCloseTabsToRight: (id: string) => void;
  onCloseAllTabs: () => void;
  onDuplicateTab: (id: string) => void;
  onRenameTab: (id: string) => void;
  onCancelTab: (id: string) => void;
  onReconnectTab: (id: string) => void;
  onAddTab: () => void;
  onSqlChange: (value: string) => void;
  onRun: (sql?: string) => void;
  /** 多语句执行：点击结果页签。 */
  onSelectResult: (index: number) => void;
  /** 多语句执行：切换到消息面板。 */
  onShowMessages: () => void;
  onOpenSqlFile: () => void;
  onSaveSqlFile: () => void;
  onNewSqlFile: () => void;
  onSaveSqlFileAs: () => void;
  recentSqlFiles: string[];
  onOpenRecentSqlFile: (path: string) => void;
  onFormatSql: () => void;
  /** 编辑器右键「从历史插入」。 */
  onOpenHistory: () => void;
  completionGroups: CompletionGroups;
  completionDetails?: Record<string, string>;
  completionEnabled: boolean;
  completionDelayMs: number;
  shortcuts: ShortcutMap;
  onRequestCompletion: (context: CompletionContext) => Promise<CompletionCandidate[]>;
  onCancel: () => void;
  onReconnect: () => void;
  onExport: () => void;
  onCopyColumnNames: () => void;
  focusedCell: { rowIndex: number; columnIndex: number } | null;
  /** 待新增行号，用于右键「使用默认值」。 */
  insertRows?: number[];
  onSetCellNull: (rowIndex: number, columnIndex: number) => void;
  onSetCellDefault: (rowIndex: number, columnIndex: number) => void;
  onExportRange: (columns: import('@shared/ipc-contract').QueryColumn[], rows: QueryCell[][]) => void;
  onCellFocus: (rowIndex: number, columnIndex: number) => void;
  onViewCell: () => void;
  onCopyCell: () => void;
  onTablePageChange: (page: number) => void;
  onTablePageSizeChange: (pageSize: number) => void;
  onTableSortChange: (column: string, direction: 'asc' | 'desc', additive?: boolean) => void;
  onTableFilterChange: (filters: TableFilter[]) => void;
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
  /** Agent 作业列表/详情页签内容；由 App 注入，避免 Workspace 了解 IPC 细节。 */
  agentContent?: ReactNode;
  onExecuteTableDesign: (
    statements: string[],
    options?: { sqliteForeignKeysOff?: boolean },
  ) => Promise<{ ok: boolean; message: string }>;
  onTableDesignSaved: () => void;
  /** 设计页签可选的数据库（SQLite 为空）。 */
  databases: DatabaseInfo[];
  currentDatabase: string | null;
  onTableDesignDatabaseChange: (database: string) => Promise<boolean> | void;
  /** SQL 标签执行按钮旁的数据库下拉。 */
  showDatabaseSelect: boolean;
  onDatabaseChange: (database: string) => Promise<boolean> | void;
}

export function Workspace({
  tabs,
  activeTabId,
  tabLabels,
  tabStatuses,
  run,
  running,
  connectionType,
  sessionRuntime,
  transaction,
  onBeginTransaction,
  onCommitTransaction,
  onRollbackTransaction,
  theme,
  tableMeta,
  tableEditable,
  canEnableNoPk,
  noPkMode,
  allowPrimaryKeyEdit,
  onTogglePrimaryKeyEdit,
  canEnableIdentityInsert,
  allowIdentityInsert,
  onToggleIdentityInsert,
  editableFromRow,
  onToggleNoPk,
  pendingEdits,
  committing,
  autoCommit,
  confirmCommit,
  skipConflicts,
  onToggleAutoCommit,
  onToggleConfirmCommit,
  onToggleSkipConflicts,
  selectedRow,
  selectedRowRange,
  onRowRangeChange,
  canUndo,
  onSelectTab,
  onCloseTab,
  onCloseOtherTabs,
  onCloseTabsToRight,
  onCloseAllTabs,
  onDuplicateTab,
  onRenameTab,
  onCancelTab,
  onReconnectTab,
  onAddTab,
  onSqlChange,
  onRun,
  onSelectResult,
  onShowMessages,
  onOpenSqlFile,
  onSaveSqlFile,
  onNewSqlFile,
  onSaveSqlFileAs,
  recentSqlFiles,
  onOpenRecentSqlFile,
  onFormatSql,
  onOpenHistory,
  completionGroups,
  completionDetails,
  completionEnabled,
  completionDelayMs,
  shortcuts,
  onRequestCompletion,
  onCancel,
  onReconnect,
  onExport,
  onCopyColumnNames,
  focusedCell,
  insertRows,
  onSetCellNull,
  onSetCellDefault,
  onExportRange,
  onCellFocus,
  onViewCell,
  onCopyCell,
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
  agentContent,
  onExecuteTableDesign,
  onTableDesignSaved,
  databases,
  currentDatabase,
  onTableDesignDatabaseChange,
  showDatabaseSelect,
  onDatabaseChange,
}: WorkspaceProps) {
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0] ?? EMPTY_TAB;
  const isAgentTab = activeTab.kind === 'agent-detail';
  const isTableDesignTab = activeTab.kind === 'table-design';
  const isSqlTab = !activeTab.kind && !activeTab.table;
  const transactionActive = transaction.state === 'active';
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
  const scriptStatements = run.statements ?? null;
  const activeResultIndex = run.activeResult ?? null;
  const messagesView = scriptStatements !== null && activeResultIndex === -1;
  const resultTabs = scriptStatements
    ? scriptStatements
        .map((statement, index) => ({ statement, index }))
        .filter(({ statement }) => statement.statementType === 'select' && !statement.error)
    : [];
  const scriptErrorCount =
    scriptStatements?.filter((statement) => Boolean(statement.error)).length ?? 0;
  const scriptSuccessCount = scriptStatements
    ? scriptStatements.length - scriptErrorCount
    : 0;
  const [filterDraft, setFilterDraft] = useState<{
    column: string;
    operator: TableFilterOperator;
    value: string;
  }>({ column: '', operator: 'contains', value: '' });
  /** 编辑器当前选区；执行按钮据此决定只跑选中内容。 */
  const [selectedSql, setSelectedSql] = useState('');
  const [tabMenu, setTabMenu] = useState<{ x: number; y: number; tabId: string } | null>(
    null,
  );
  const activeSorts =
    activeTab.table?.sorts ?? (activeTab.table?.sort ? [activeTab.table.sort] : []);
  const primarySort = activeSorts[0];
  const activeFilters = backendFilters(activeTab.table);
  const draftColumn = run.columns.find((column) => column.name === filterDraft.column);
  const draftOperators = filterOperators(draftColumn?.declaredType);
  const draftNeedsValue =
    filterDraft.operator !== 'isNull' && filterDraft.operator !== 'isNotNull';
  const draftBoolean = /bit|bool|boolean/i.test(draftColumn?.declaredType ?? '');
  const draftDate = /date|time|year/i.test(draftColumn?.declaredType ?? '');
  const draftNumber = /int|numeric|decimal|number|real|float|double|money|serial/i.test(
    draftColumn?.declaredType ?? '',
  );

  useEffect(() => {
    setFilterDraft({ column: '', operator: 'contains', value: '' });
    setSelectedSql('');
  }, [activeTab.id]);

  const addFilter = () => {
    if (!filterDraft.column) return;
    const operator = filterDraft.operator;
    const needsValue = operator !== 'isNull' && operator !== 'isNotNull';
    if (needsValue && filterDraft.value === '') return;
    onTableFilterChange([
      ...activeFilters,
      {
        column: filterDraft.column,
        operator,
        value: needsValue ? filterDraft.value : '',
      },
    ]);
    setFilterDraft((current) => ({ ...current, value: '' }));
  };
  const tlsFallback =
    sessionRuntime?.status === 'ready' && sessionMessage !== null && /TLS|回退/.test(sessionMessage);
  const menuTab = tabMenu ? tabs.find((tab) => tab.id === tabMenu.tabId) ?? null : null;
  const menuStatus = menuTab ? tabStatuses[menuTab.id] : null;
  const menuIndex = menuTab ? tabs.findIndex((tab) => tab.id === menuTab.id) : -1;

  if (tabs.length === 0) {
    return (
      <section className="workspace">
        <div className="tabbar" role="tablist" aria-label="查询标签页">
          <button type="button" className="tab-add" title="新建查询" onClick={() => onAddTab()}>
            <Icon name="plus" size={14} />
          </button>
        </div>
        <div className="workspace-empty">
          <p>没有打开的标签</p>
          <button type="button" className="btn btn-primary" onClick={() => onAddTab()}>
            新建查询
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="workspace">
      <div className="tabbar" role="tablist" aria-label="查询标签页">
        {tabs.map((tab) => {
          const status = tabStatuses[tab.id];
          return (
            <div
              key={tab.id}
              role="tab"
              aria-selected={tab.id === activeTabId}
              tabIndex={0}
              className={`tab ${tab.id === activeTabId ? 'is-active' : ''}`}
              onClick={() => onSelectTab(tab.id)}
              onContextMenu={(event) => {
                event.preventDefault();
                setTabMenu({ x: event.clientX, y: event.clientY, tabId: tab.id });
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onSelectTab(tab.id);
                }
              }}
            >
              {status?.running && <span className="tab-state is-running" title="查询运行中" />}
              {!status?.running && status?.error && (
                <span className="tab-state is-error" title="标签会话或查询失败" />
              )}
              {!status?.running && !status?.error && status?.dirty && (
                <span className="tab-state is-dirty" title="有未保存的 SQL 或未提交修改" />
              )}
              <span>{tabLabels[tab.id] ?? tab.title}</span>
              <button
                type="button"
                className="tab-close"
                aria-label={`关闭 ${tabLabels[tab.id] ?? tab.title}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onCloseTab(tab.id);
                }}
              >
                <Icon name="close" size={12} />
              </button>
            </div>
          );
        })}

        <button type="button" className="tab-add" title="新建查询" onClick={() => onAddTab()}>
          <Icon name="plus" size={14} />
        </button>
      </div>

      {tabMenu && menuTab && (
        <ContextMenu
          x={tabMenu.x}
          y={tabMenu.y}
          onClose={() => setTabMenu(null)}
          items={[
            {
              label: '关闭',
              onSelect: () => onCloseTab(menuTab.id),
            },
            {
              label: '关闭其他',
              disabled: tabs.length <= 1,
              onSelect: () => onCloseOtherTabs(menuTab.id),
            },
            {
              label: '关闭右侧',
              disabled: menuIndex < 0 || menuIndex >= tabs.length - 1,
              onSelect: () => onCloseTabsToRight(menuTab.id),
            },
            {
              label: '全部关闭',
              danger: true,
              onSelect: () => onCloseAllTabs(),
            },
            {
              label: '复制标签',
              disabled: Boolean(menuTab.kind || menuTab.table),
              onSelect: () => onDuplicateTab(menuTab.id),
            },
            {
              label: '重命名',
              onSelect: () => onRenameTab(menuTab.id),
            },
            ...(menuStatus?.running
              ? [
                  {
                    label: '取消查询',
                    danger: true,
                    onSelect: () => onCancelTab(menuTab.id),
                  },
                ]
              : []),
            ...(menuStatus?.error
              ? [
                  {
                    label: '重连',
                    onSelect: () => onReconnectTab(menuTab.id),
                  },
                ]
              : []),
          ]}
        />
      )}

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

      {isAgentTab ? (
        <div className="agent-tab-pane">{agentContent}</div>
      ) : isTableDesignTab ? (
        <div className="table-design-pane">
          {activeTab.tableDesign &&
          (activeTab.tableDesign.mode === 'create' || activeTab.tableDesign.detail) ? (
            <TableDesignTab
              key={activeTab.id}
              dialect={connectionType ?? 'sqlite'}
              mode={activeTab.tableDesign.mode}
              initialName={activeTab.tableDesign.name}
              initialSchema={activeTab.tableDesign.schema}
              detail={activeTab.tableDesign.detail}
              sessionReady={ready}
              databases={databases}
              currentDatabase={currentDatabase}
              onDatabaseChange={onTableDesignDatabaseChange}
              onExecute={onExecuteTableDesign}
              onSaved={onTableDesignSaved}
              onCancel={() => onCloseTab(activeTab.id)}
            />
          ) : (
            <div className="tree-empty">正在读取表结构…</div>
          )}
        </div>
      ) : (
        <>
      <div className="editor-pane">
        <div className="pane-toolbar">
          <button
            type="button"
            className="btn btn-run"
            onClick={() => onRun(selectedSql.trim() ? selectedSql : undefined)}
            disabled={running || !ready}
            title={ready ? '执行 SQL（Ctrl+Enter）' : '先连接数据库'}
          >
            <Icon name="play" size={14} />
            {running ? '执行中…' : '执行'}
          </button>
          {showDatabaseSelect && (
            <label className="db-select-inline" title="切换当前标签的数据库">
              <select
                aria-label="当前数据库"
                value={currentDatabase ?? ''}
                disabled={!ready}
                onChange={(event) => void onDatabaseChange(event.target.value)}
              >
                {!currentDatabase && <option value="">（未选择数据库）</option>}
                {databases.length === 0 && currentDatabase && (
                  <option value={currentDatabase}>{currentDatabase}</option>
                )}
                {databases.map((database) => (
                  <option key={database.name} value={database.name}>
                    {database.name}
                  </option>
                ))}
              </select>
            </label>
          )}
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
            onClick={onNewSqlFile}
            title="新建 SQL 文件"
          >
            新建 SQL
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
            onClick={onSaveSqlFileAs}
            title="另存为 SQL 文件"
          >
            另存为
          </button>
          {recentSqlFiles.length > 0 && (
            <select
              className="db-select-inline"
              aria-label="最近打开的 SQL 文件"
              value=""
              onChange={(event) => {
                if (event.target.value) onOpenRecentSqlFile(event.target.value);
              }}
            >
              <option value="">最近文件…</option>
              {recentSqlFiles.map((path) => (
                <option key={path} value={path}>
                  {path.split(/[\\/]/).pop() || path}
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            className="btn"
            onClick={onFormatSql}
            title="格式化 SQL（Ctrl+Shift+F）"
          >
            格式化
          </button>
          {isSqlTab && (
            <>
              <span
                className={`badge ${transactionActive ? 'badge-warn' : 'badge-ok'}`}
                title={
                  transactionActive && transaction.startedAt
                    ? `事务开始于 ${new Date(transaction.startedAt).toLocaleTimeString()}`
                    : undefined
                }
              >
                {transactionActive ? `事务中 · ${transaction.statements} 条` : '无事务'}
              </span>
              {transactionActive ? (
                <>
                  <button
                    type="button"
                    className="btn"
                    disabled={running}
                    onClick={onCommitTransaction}
                    title="提交当前事务"
                  >
                    提交
                  </button>
                  <button
                    type="button"
                    className="btn btn-danger"
                    disabled={running}
                    onClick={onRollbackTransaction}
                    title="回滚当前事务"
                  >
                    回滚
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="btn"
                  disabled={running || !ready}
                  onClick={onBeginTransaction}
                  title="开始事务"
                >
                  开始事务
                </button>
              )}
            </>
          )}
          <span className="chip">{connectionType ? DIALECT_LABELS[connectionType] : 'SQL'}</span>
          <span className="pane-hint">Ctrl+Enter 执行；Ctrl+Space 补全；有选区时只执行选区</span>
          <span className="spacer" />
          <span className={`badge ${badge.tone}`}>{badge.text}</span>
        </div>

        <SqlEditor
          value={activeTab.sql}
          onChange={onSqlChange}
          onRun={onRun}
          onSelectionChange={setSelectedSql}
          onSave={onSaveSqlFile}
          onFormat={onFormatSql}
          onOpenHistory={onOpenHistory}
          completionGroups={completionGroups}
          completionDetails={completionDetails}
          completionEnabled={completionEnabled}
          completionDelayMs={completionDelayMs}
          shortcuts={shortcuts}
          onRequestCompletion={onRequestCompletion}
          dialect={connectionType}
        />
      </div>

      <div className="result-pane">
        <div className="pane-toolbar">
          <strong>结果</strong>
          {scriptStatements ? (
            <span className="pane-hint">
              {scriptStatements.length} / {run.scriptTotal ?? scriptStatements.length} 条 · 成功{' '}
              {scriptSuccessCount}
              {scriptErrorCount > 0 ? ` · 失败 ${scriptErrorCount}` : ''} ·{' '}
              {scriptStatements.reduce((total, statement) => total + statement.elapsedMs, 0)} ms
            </span>
          ) : run.error ? (
            <span className="badge badge-danger">执行失败</span>
          ) : run.statementType === 'change' ? (
            <span className="pane-hint">
              执行成功 · {run.changes ?? 0} 行受影响 · {run.elapsedMs} ms
            </span>
          ) : run.executedAt ? (
            <span className="pane-hint">
              {run.rowCount} 行 · {run.elapsedMs} ms
            </span>
          ) : (
            <span className="pane-hint">尚未执行</span>
          )}
          {run.truncated && !messagesView && (
            <span className="badge badge-warn">仅显示前 {run.rowCount} 行</span>
          )}
          <span className="spacer" />
          <button
            type="button"
            className="btn"
            disabled={messagesView || !focusedCell || run.columns.length === 0}
            title="查看选中单元格的完整内容"
            onClick={onViewCell}
          >
            查看单元格
          </button>
          <button
            type="button"
            className="btn"
            disabled={messagesView || !focusedCell || run.columns.length === 0}
            title="复制选中单元格的内容（NULL 复制为空）"
            onClick={onCopyCell}
          >
            复制单元格
          </button>
          <button
            type="button"
            className="btn"
            disabled={messagesView || run.columns.length === 0}
            title="复制全部列名（制表符分隔）"
            onClick={onCopyColumnNames}
          >
            复制列名
          </button>
          <button
            type="button"
            className="btn"
            disabled={
              messagesView ||
              run.columns.length === 0 ||
              (!scriptStatements && run.error !== null)
            }
            title="导出当前结果"
            onClick={onExport}
          >
            导出
          </button>
        </div>

        {scriptStatements && scriptStatements.length > 0 && (
          <div className="result-tabs" role="tablist" aria-label="结果集">
            {resultTabs.map(({ statement, index }) => (
              <button
                key={`result-${index}`}
                type="button"
                role="tab"
                aria-selected={activeResultIndex === index}
                className={`result-tab ${activeResultIndex === index ? 'is-active' : ''}`}
                onClick={() => onSelectResult(index)}
              >
                结果 {index + 1}
                <span className="result-tab-meta">{statement.rowCount} 行</span>
              </button>
            ))}
            <button
              type="button"
              role="tab"
              aria-selected={messagesView}
              className={`result-tab ${messagesView ? 'is-active' : ''}`}
              onClick={onShowMessages}
            >
              消息
              {scriptErrorCount > 0 && (
                <span className="result-tab-error">{scriptErrorCount}</span>
              )}
            </button>
          </div>
        )}

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
              {[50, 200, 500, 1000].map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>

            <span className="pane-hint">排序</span>
            <select
              className="page-size"
              aria-label="排序字段"
              value={primarySort?.column ?? ''}
              disabled={running || lockedByEdits || run.columns.length === 0}
              onChange={(event) =>
                onTableSortChange(
                  event.target.value,
                  primarySort?.direction ?? 'asc',
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

            {primarySort && (
              <button
                type="button"
                className="btn"
                disabled={running || lockedByEdits}
                onClick={() =>
                  onTableSortChange(
                    primarySort.column,
                    primarySort.direction === 'asc' ? 'desc' : 'asc',
                  )
                }
              >
                {primarySort.direction === 'asc' ? '升序' : '降序'}
              </button>
            )}
            {activeSorts.map((item, index) => (
              <span key={`sort-${item.column}`} className="badge badge-ok">
                {index + 1}. {item.column} {item.direction === 'asc' ? '↑' : '↓'}
              </span>
            ))}
            {activeSorts.length > 1 && (
              <span className="pane-hint">Shift+点击列头追加排序</span>
            )}
            {activeSorts.length > 0 && (
              <button
                type="button"
                className="btn"
                disabled={running || lockedByEdits}
                onClick={() => onTableSortChange('', 'asc')}
              >
                清除排序
              </button>
            )}

            <span className="pane-hint">过滤</span>
            <select
              className="page-size"
              aria-label="过滤列"
              value={filterDraft.column}
              disabled={running || lockedByEdits || run.columns.length === 0}
              onChange={(event) => {
                const column = event.target.value;
                const declaredType = run.columns.find((item) => item.name === column)
                  ?.declaredType;
                const operators = filterOperators(declaredType);
                setFilterDraft({
                  column,
                  operator: operators[0]?.value ?? 'contains',
                  value: '',
                });
              }}
            >
              <option value="">选择列</option>
              {run.columns.map((column) => (
                <option key={column.name} value={column.name}>
                  {column.name}
                </option>
              ))}
            </select>
            {filterDraft.column && (
              <select
                className="page-size"
                aria-label="过滤操作符"
                value={filterDraft.operator}
                disabled={running || lockedByEdits}
                onChange={(event) =>
                  setFilterDraft((current) => ({
                    ...current,
                    operator: event.target.value as TableFilterOperator,
                  }))
                }
              >
                {draftOperators.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            )}
            {filterDraft.column && draftNeedsValue && (
              draftBoolean ? (
                <select
                  className="page-size"
                  aria-label="过滤值"
                  value={filterDraft.value}
                  disabled={running || lockedByEdits}
                  onChange={(event) =>
                    setFilterDraft((current) => ({ ...current, value: event.target.value }))
                  }
                >
                  <option value="">选择</option>
                  <option value="1">true / 1</option>
                  <option value="0">false / 0</option>
                </select>
              ) : (
                <input
                  className="table-filter-input"
                  type={draftDate ? 'date' : draftNumber ? 'number' : 'text'}
                  aria-label="过滤值"
                  placeholder={draftDate ? '日期' : draftNumber ? '数值' : '包含内容'}
                  value={filterDraft.value}
                  disabled={running || lockedByEdits}
                  onChange={(event) =>
                    setFilterDraft((current) => ({ ...current, value: event.target.value }))
                  }
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      addFilter();
                    }
                  }}
                />
              )
            )}
            <button
              type="button"
              className="btn"
              disabled={
                !filterDraft.column ||
                running ||
                lockedByEdits ||
                (draftNeedsValue && filterDraft.value === '')
              }
              title="添加条件（多个条件之间是 AND）"
              onClick={addFilter}
            >
              添加条件
            </button>
            {activeFilters.map((item, index) => (
              <span
                key={`filter-${item.column}-${index}`}
                className="badge badge-ok"
                title={`${item.column} ${filterOperatorLabel(item.operator)} ${item.value}`}
              >
                {item.column} {filterOperatorLabel(item.operator)}
                {item.value ? ` ${item.value}` : ''}
                <button
                  type="button"
                  className="tab-close"
                  aria-label="移除条件"
                  disabled={running || lockedByEdits}
                  onClick={() =>
                    onTableFilterChange(
                      activeFilters.filter((_filter, filterIndex) => filterIndex !== index),
                    )
                  }
                >
                  <Icon name="close" size={10} />
                </button>
              </span>
            ))}
            {activeFilters.length > 0 && (
              <button
                type="button"
                className="btn"
                disabled={running || lockedByEdits}
                onClick={() => onTableFilterChange([])}
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
                  disabled={
                    running ||
                    (selectedRow === null &&
                      (!selectedRowRange || selectedRowRange.end < selectedRowRange.start))
                  }
                  title={
                    selectedRowRange && selectedRowRange.end > selectedRowRange.start
                      ? `删除选中的 ${selectedRowRange.end - selectedRowRange.start + 1} 行，提交时执行 DELETE`
                      : selectedRow === null
                        ? '先点击要删除的行，或拖拽/Shift 选择多行'
                        : '删除当前选中行，提交时执行 DELETE'
                  }
                  onClick={onDeleteRow}
                >
                  删除选中行
                </button>
                <span className="pane-hint">
                  {allowPrimaryKeyEdit
                    ? '双击单元格编辑；主键修改会在提交前再次确认'
                    : '双击单元格编辑，主键列不可改'}
                </span>
                {tableMeta && tableMeta.primaryKey.length > 0 && (
                  <button
                    type="button"
                    className={allowPrimaryKeyEdit ? 'btn btn-danger' : 'btn'}
                    disabled={running}
                    title="允许修改主键列（提交时会再次确认）"
                    onClick={() => onTogglePrimaryKeyEdit(!allowPrimaryKeyEdit)}
                  >
                    {allowPrimaryKeyEdit ? '主键可改（谨慎）' : '允许修改主键'}
                  </button>
                )}
                {canEnableIdentityInsert && (
                  <button
                    type="button"
                    className={allowIdentityInsert ? 'btn btn-danger' : 'btn'}
                    disabled={running}
                    title="新增行可显式填写自增列；MSSQL 使用 IDENTITY_INSERT"
                    onClick={() => onToggleIdentityInsert(!allowIdentityInsert)}
                  >
                    {allowIdentityInsert ? '自增列可写（谨慎）' : '允许写自增列'}
                  </button>
                )}
              </>
            )}
            {lockedByEdits && (
              <span className="badge badge-warn">待提交 {pendingEdits} 项</span>
            )}
            <label className="pane-hint" title="编辑停止 800ms 后自动提交；新增行仍需手动提交">
              <input
                type="checkbox"
                checked={autoCommit}
                disabled={running}
                onChange={(event) => onToggleAutoCommit(event.target.checked)}
              />
              自动提交
            </label>
            <label className="pane-hint" title="提交前再次确认">
              <input
                type="checkbox"
                checked={confirmCommit}
                disabled={running}
                onChange={(event) => onToggleConfirmCommit(event.target.checked)}
              />
              提交前确认
            </label>
            <label className="pane-hint" title="冲突行跳过并继续提交其余修改；关闭时整体回滚">
              <input
                type="checkbox"
                checked={skipConflicts}
                disabled={running}
                onChange={(event) => onToggleSkipConflicts(event.target.checked)}
              />
              跳过冲突行
            </label>
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

        {run.error && !scriptStatements && (
          <div className="result-error" role="alert">
            <span>{run.error}</span>
            {run.errorMeta && <span className="result-error-meta">{run.errorMeta}</span>}
            {run.errorHint && (
              <span className="result-error-hint">建议：{run.errorHint}</span>
            )}
          </div>
        )}

        {run.messages && run.messages.length > 0 && (
          <div className="result-messages" role="status" aria-label="驱动消息">
            {run.messages.map((message, index) => (
              <div
                key={`driver-message-${index}`}
                className={`result-message-note ${
                  message.level === 'error' ? 'is-error' : message.level === 'warn' ? 'is-warn' : ''
                }`}
              >
                {message.text}
              </div>
            ))}
          </div>
        )}

        {messagesView && scriptStatements ? (
          <div className="result-messages" role="list" aria-label="执行消息">
            {scriptStatements.map((statement, index) => {
              const failed = Boolean(statement.error);
              const status = statement.timedOut
                ? '超时'
                : statement.canceled
                  ? '已取消'
                  : failed
                    ? '失败'
                    : '成功';
              const tone = failed
                ? 'badge-danger'
                : statement.timedOut || statement.canceled
                  ? 'badge-warn'
                  : 'badge-ok';
              const meta =
                statement.statementType === 'change'
                  ? `${statement.changes ?? 0} 行受影响 · ${statement.elapsedMs} ms`
                  : statement.statementType === 'select'
                    ? `${statement.rowCount} 行 · ${statement.elapsedMs} ms`
                    : `${statement.elapsedMs} ms`;
              return (
                <div
                  key={`message-${index}`}
                  role="listitem"
                  className={`result-message ${
                    failed ? 'is-error' : statement.timedOut || statement.canceled ? 'is-warn' : ''
                  }`}
                >
                  <div className="result-message-head">
                    <span className="result-message-index">#{index + 1}</span>
                    <span className={`badge ${tone}`}>{status}</span>
                    <span className="result-message-meta">{meta}</span>
                  </div>
                  <code className="result-message-sql">
                    {statement.sql.replace(/\s+/g, ' ').slice(0, 180)}
                  </code>
                  {statement.error && (
                    <div className="result-message-error">
                      <span>{statement.error}</span>
                      {statement.errorMeta && (
                        <span className="result-error-meta">{statement.errorMeta}</span>
                      )}
                      {statement.errorHint && (
                        <span className="result-error-hint">
                          建议：{statement.errorHint}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            {run.scriptTotal !== undefined &&
              scriptStatements.length < run.scriptTotal && (
                <div className="result-message-note">
                  已在第 {scriptStatements.length} 条后停止，后续{' '}
                  {run.scriptTotal - scriptStatements.length} 条未执行。
                </div>
              )}
          </div>
        ) : !scriptStatements &&
          !run.error &&
          run.executedAt !== null &&
          run.statementType === 'change' &&
          run.columns.length === 0 ? (
          <div className="grid-host">
            <div className="grid-empty">
              <strong>执行成功</strong>
              <span>
                {run.changes ?? 0} 行受影响 · {run.elapsedMs} ms
              </span>
            </div>
          </div>
        ) : (
          <ResultGrid
            columns={run.columns}
            rows={run.rows}
            editable={editable}
            editableFromRow={editableFromRow}
            readOnlyColumns={
              tableMeta?.columns
                .filter(
                  (column) =>
                    column.readOnly &&
                    !(allowPrimaryKeyEdit && column.primaryKey) &&
                    !(allowIdentityInsert && column.autoIncrement),
                )
                .map((column) => column.name)
                .concat(tableMeta?.rowidAlias ? [tableMeta.rowidAlias] : []) ?? []
            }
            requiredColumns={
              tableMeta?.columns
                .filter((column) => column.notNull && !column.autoIncrement)
                .map((column) => column.name) ?? []
            }
            sorts={activeSorts}
            layoutKey={
              activeTab.table
                ? `${activeTab.connectionId ?? 'none'}:${activeTab.table.database ?? ''}:${activeTab.table.name}`
                : undefined
            }
            theme={theme}
            onCellChange={onCellChange}
            onCellsChange={onCellsChange}
            onRowFocus={(rowIndex) => {
              onRowFocus(rowIndex);
              onRowRangeChange(rowIndex, rowIndex);
            }}
            onCellFocus={onCellFocus}
            focusedCell={focusedCell}
            insertRows={insertRows}
            onSetCellNull={onSetCellNull}
            onSetCellDefault={onSetCellDefault}
            onExportRange={onExportRange}
            onRowRangeChange={onRowRangeChange}
            onHeaderClick={(column, additive) => {
              if (!activeTab.table || lockedByEdits) return;
              const current = activeSorts.find((item) => item.column === column);
              onTableSortChange(
                column,
                current
                  ? current.direction === 'asc'
                    ? 'desc'
                    : 'asc'
                  : 'asc',
                additive,
              );
            }}
          />
        )}
      </div>
        </>
      )}
    </section>
  );
}
