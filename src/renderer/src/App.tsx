import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  AppInfo,
  AppSettings,
  ConnectionInput,
  DatabaseType,
  DdlObjectKind,
  DdlStatementResult,
  QueryCell,
  QueryColumn,
  QueryError,
  SchemaObject,
  TableColumnMeta,
  TableDetail,
  TableEdit,
  TableMeta,
} from '@shared/ipc-contract';
import { DEFAULT_APP_SETTINGS } from '@shared/settings';
import { SQL_KEYWORD_LIST } from './utils/sql-highlight';
import { formatSql } from './utils/sql-format';
import { buildTablePageQuery, buildTablePreviewSql } from '@shared/dialect/identifiers';
import { inspectDangerousSql, type DangerMatch } from '@shared/dialect/safety';
import { explainErrorText, explainQueryError } from '@shared/errors';
import { serializeConnections } from '@shared/connection-export';
import { ConnectionDialog } from './features/connections/ConnectionDialog';
import { DangerConfirmDialog } from './components/DangerConfirmDialog';
import { TableDesigner } from './components/TableDesigner';
import { TableActionDialog, type TableActionMode } from './components/TableActionDialog';
import { TableStructureDialog } from './components/TableStructureDialog';
import { AddColumnDialog } from './components/AddColumnDialog';
import { AlterColumnDialog } from './components/AlterColumnDialog';
import { CellViewerDialog } from './components/CellViewerDialog';
import { CreateViewDialog } from './components/CreateViewDialog';
import { DropColumnDialog } from './components/DropColumnDialog';
import { IndexDialog, type IndexMode } from './components/IndexDialog';
import { ExportDialog } from './components/ExportDialog';
import { HistoryDialog } from './components/HistoryDialog';
import { Icon } from './components/Icon';
import { SettingsDialog } from './components/SettingsDialog';
import { SqlScriptDialog } from './components/SqlScriptDialog';
import { Sidebar } from './components/Sidebar';
import { StatusBar } from './components/StatusBar';
import { Toolbar } from './components/Toolbar';
import { Workspace } from './components/Workspace';
import type {
  Notice,
  QueryTab,
  RunState,
  SavedConnection,
  SessionRuntime,
} from './types';

const INITIAL_SQL = `SELECT name, type, sql
FROM sqlite_master
WHERE type IN ('table', 'view')
ORDER BY type, name;`;

const DEFAULT_SQL: Record<DatabaseType, string> = {
  sqlite: INITIAL_SQL,
  mysql: 'SHOW TABLES;',
  percona: 'SHOW TABLES;',
  mariadb: 'SHOW TABLES;',
  mssql: 'SELECT 1;',
};

const INITIAL_TAB: QueryTab = {
  id: 'query-1',
  title: '查询 1',
  sql: INITIAL_SQL,
  connectionId: null,
};

const DRAFT_STORAGE_KEY = 'dbcraft:drafts:v1';
const DRAFT_VERSION = 1;
const MAX_DRAFT_TABS = 20;

interface DraftPayload {
  version: number;
  activeTabId: string;
  tabs: Array<{
    id: string;
    title: string;
    sql: string;
    connectionId: string | null;
    filePath?: string;
  }>;
}

/** 读取上次会话的标签草稿；损坏或超限时回退到默认标签。 */
function loadDraftTabs(): { tabs: QueryTab[]; activeTabId: string } | null {
  try {
    const raw = window.localStorage.getItem(DRAFT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<DraftPayload>;
    if (parsed.version !== DRAFT_VERSION || !Array.isArray(parsed.tabs)) return null;

    const tabs: QueryTab[] = [];
    for (const item of parsed.tabs.slice(0, MAX_DRAFT_TABS)) {
      if (!item || typeof item.id !== 'string' || typeof item.sql !== 'string') continue;
      tabs.push({
        id: item.id.slice(0, 128),
        title: typeof item.title === 'string' ? item.title.slice(0, 80) : '查询',
        sql: item.sql.slice(0, 1_000_000),
        connectionId: typeof item.connectionId === 'string' ? item.connectionId : null,
        ...(typeof item.filePath === 'string' ? { filePath: item.filePath } : {}),
      });
    }
    if (tabs.length === 0) return null;

    const active =
      typeof parsed.activeTabId === 'string' &&
      tabs.some((tab) => tab.id === parsed.activeTabId)
        ? parsed.activeTabId
        : tabs[0].id;

    return { tabs, activeTabId: active };
  } catch {
    return null;
  }
}

/** 标签只持久化 SQL 与绑定关系；表数据页的分页上下文不跨会话恢复。 */
function persistDraftTabs(tabs: QueryTab[], activeTabId: string): boolean {
  try {
    const payload: DraftPayload = {
      version: DRAFT_VERSION,
      activeTabId,
      tabs: tabs.slice(0, MAX_DRAFT_TABS).map((tab) => ({
        id: tab.id,
        title: tab.title,
        sql: tab.sql,
        connectionId: tab.connectionId,
        ...(tab.filePath ? { filePath: tab.filePath } : {}),
      })),
    };
    window.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(payload));
    return true;
  } catch {
    // 草稿属于尽力而为；localStorage 不可用时不阻塞编辑。
    return false;
  }
}

const RESTORED_DRAFTS = loadDraftTabs();

function nextTabNumber(tabs: QueryTab[]): number {
  let max = 1;
  for (const tab of tabs) {
    const match = /^query-(\d+)$/.exec(tab.id);
    if (match) max = Math.max(max, Number(match[1]));
    const titleMatch = /^查询 (\d+)$/.exec(tab.title);
    if (titleMatch) max = Math.max(max, Number(titleMatch[1]));
  }
  return max + 1;
}

const EMPTY_RUN: RunState = {
  columns: [],
  rows: [],
  rowCount: 0,
  elapsedMs: 0,
  statementType: null,
  changes: null,
  truncated: false,
  executedAt: null,
  error: null,
  errorMeta: null,
  errorHint: null,
};

interface ConnectionDialogState {
  mode: 'create' | 'edit';
  id?: string;
  initial?: ConnectionInput;
  passwordStored?: boolean;
}

/** 表格编辑按行累积：values 是待写入的新值，original 是乐观锁用的数据库原值。 */
interface PendingUpdate {
  keys: Record<string, QueryCell>;
  values: Record<string, QueryCell>;
  original: Record<string, QueryCell>;
}

interface PendingTableEdits {
  updates: Record<number, PendingUpdate>;
  /** 新增行：行号 → 已填写的列值；未填写的列交给数据库默认值。 */
  inserts: Record<number, Record<string, QueryCell>>;
  /** 待删除行：行号 → 主键值。 */
  deletes: Record<number, Record<string, QueryCell>>;
}

interface EditSnapshot {
  rows: QueryCell[][];
  pending: PendingTableEdits;
}

function emptyPendingTableEdits(): PendingTableEdits {
  return { updates: {}, inserts: {}, deletes: {} };
}

function countPendingEdits(state: PendingTableEdits | undefined): number {
  if (!state) return 0;
  const updated = Object.values(state.updates).reduce(
    (total, update) => total + Object.keys(update.values).length,
    0,
  );
  return updated + Object.keys(state.inserts).length + Object.keys(state.deletes).length;
}

/** 删除一行后，后面待提交编辑的行号整体前移。 */
function shiftPendingRows(state: PendingTableEdits, removedIndex: number): PendingTableEdits {
  const shift = <T,>(record: Record<number, T>): Record<number, T> => {
    const next: Record<number, T> = {};
    for (const [key, value] of Object.entries(record)) {
      const index = Number(key);
      if (index < removedIndex) next[index] = value;
      else if (index > removedIndex) next[index - 1] = value;
    }
    return next;
  };

  return {
    updates: shift(state.updates),
    inserts: shift(state.inserts),
    deletes: shift(state.deletes),
  };
}

function createId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function formatErrorMeta(error: QueryError): string | null {
  const parts: string[] = [];
  if (error.code) parts.push(error.code);
  if (error.errno !== null) parts.push(`errno ${error.errno}`);
  if (error.sqlState) parts.push(`SQLSTATE ${error.sqlState}`);
  if (error.retryable) parts.push('可重试');
  return parts.length > 0 ? parts.join(' · ') : null;
}

export default function App() {
  const [connections, setConnections] = useState<SavedConnection[]>([]);
  const [tabs, setTabs] = useState<QueryTab[]>(
    () => RESTORED_DRAFTS?.tabs ?? [INITIAL_TAB],
  );
  const [activeTabId, setActiveTabId] = useState(
    () => RESTORED_DRAFTS?.activeTabId ?? INITIAL_TAB.id,
  );
  const [sessions, setSessions] = useState<Record<string, SessionRuntime>>({});
  const [schemas, setSchemas] = useState<Record<string, SchemaObject[]>>({});
  const [schemaLoadingId, setSchemaLoadingId] = useState<string | null>(null);
  const [showSystemObjects, setShowSystemObjects] = useState<Record<string, boolean>>({});
  const [runs, setRuns] = useState<Record<string, RunState>>({});
  const [runningTabs, setRunningTabs] = useState<Record<string, boolean>>({});
  const [tableMetas, setTableMetas] = useState<Record<string, TableMeta | null>>({});
  const [pendingTableEdits, setPendingTableEdits] = useState<Record<string, PendingTableEdits>>(
    {},
  );
  const [committingTabs, setCommittingTabs] = useState<Record<string, boolean>>({});
  const [tableSelection, setTableSelection] = useState<Record<string, number | null>>({});
  const [focusedCells, setFocusedCells] = useState<
    Record<string, { rowIndex: number; columnIndex: number } | null>
  >({});
  const [cellViewer, setCellViewer] = useState<{
    column: QueryColumn;
    value: QueryCell;
    rowIndex: number;
  } | null>(null);
  const [editHistory, setEditHistory] = useState<Record<string, EditSnapshot[]>>({});
  const [noPkMode, setNoPkMode] = useState<Record<string, boolean>>({});
  const [connectionDialog, setConnectionDialog] = useState<ConnectionDialogState | null>(null);
  const [pendingDanger, setPendingDanger] = useState<{
    sql: string;
    match: DangerMatch;
  } | null>(null);
  const [tableDesignerOpen, setTableDesignerOpen] = useState(false);
  const [createViewOpen, setCreateViewOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [tableAction, setTableAction] = useState<{
    mode: TableActionMode;
    name: string;
  } | null>(null);
  const [addColumnTarget, setAddColumnTarget] = useState<string | null>(null);
  const [alterColumnTarget, setAlterColumnTarget] = useState<{
    mode: 'rename' | 'modify';
    table: string;
    columns: TableColumnMeta[];
    detail?: TableDetail;
  } | null>(null);
  const [tableStructure, setTableStructure] = useState<TableDetail | null>(null);
  const [dropColumnTarget, setDropColumnTarget] = useState<string | null>(null);
  const [indexAction, setIndexAction] = useState<{
    mode: IndexMode;
    table: string;
  } | null>(null);
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_APP_SETTINGS);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [scriptOpen, setScriptOpen] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  const tabCounter = useRef(
    nextTabNumber(RESTORED_DRAFTS?.tabs ?? [INITIAL_TAB]),
  );
  const noticeTimer = useRef<number | null>(null);
  const runningRequests = useRef<Record<string, string>>({});
  const tabsRef = useRef(tabs);
  const activeTabIdRef = useRef(activeTabId);

  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);

  useEffect(() => {
    activeTabIdRef.current = activeTabId;
  }, [activeTabId]);

  // 每 30 秒把标签 SQL 写入 localStorage；退出前再保存一次，作为崩溃恢复草稿。
  useEffect(() => {
    const save = () => {
      if (!persistDraftTabs(tabsRef.current, activeTabIdRef.current)) return;
      setTabs((current) =>
        current.some((tab) => tab.dirty)
          ? current.map((tab) => (tab.dirty ? { ...tab, dirty: false } : tab))
          : current,
      );
    };

    const timer = window.setInterval(save, 30_000);
    window.addEventListener('beforeunload', save);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('beforeunload', save);
    };
  }, []);

  useEffect(() => {
    const api = window.dbcraft;
    if (!api) return;

    let cancelled = false;
    api.app
      .getInfo()
      .then((info) => {
        if (!cancelled) setAppInfo(info);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, []);

  // 启动时载入本地设置；失败时使用默认值，不阻塞应用。
  useEffect(() => {
    const api = window.dbcraft;
    if (!api) return;
    let cancelled = false;
    api.settings
      .get()
      .then((result) => {
        if (!cancelled && result.ok) setSettings(result.settings);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  // 主题只影响渲染层样式与 RevoGrid 主题，不写数据库。
  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
  }, [settings.theme]);

  // 编辑器字号通过 CSS 变量生效，避免每个组件单独传参。
  useEffect(() => {
    document.documentElement.style.setProperty(
      '--editor-font-size',
      `${settings.editorFontSize}px`,
    );
  }, [settings.editorFontSize]);

  // 启动时从主进程元数据库载入已保存连接；密码不会回到渲染层。
  useEffect(() => {
    const api = window.dbcraft;
    if (!api) return;

    let cancelled = false;
    api.connection
      .list()
      .then((result) => {
        if (cancelled) return;
        if (result.ok) {
          setConnections(result.connections);
        } else {
          setNotice({ id: Date.now(), kind: 'error', text: result.message });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setNotice({ id: Date.now(), kind: 'error', text: '读取已保存连接失败。' });
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (noticeTimer.current !== null) {
        window.clearTimeout(noticeTimer.current);
      }
    };
  }, []);

  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];
  const activeConnection =
    connections.find((connection) => connection.id === activeTab.connectionId) ?? null;
  const activeRuntime = sessions[activeTab.id] ?? null;
  const activeSchema = schemas[activeTab.id] ?? [];
  const activeRun = runs[activeTab.id] ?? EMPTY_RUN;
  const completionItems = useMemo(
    () => [...SQL_KEYWORD_LIST, ...activeSchema.map((object) => object.name)],
    [activeSchema],
  );
  const running = Boolean(runningTabs[activeTab.id]);
  const activeTableMeta = tableMetas[activeTab.id] ?? null;
  const pendingEditCount = countPendingEdits(pendingTableEdits[activeTab.id]);
  const committing = Boolean(committingTabs[activeTab.id]);
  const canUndoEdit = (editHistory[activeTab.id]?.length ?? 0) > 0;
  const canEnableNoPk = activeTableMeta?.reasonCode === 'no-primary-key';
  const activeNoPkMode = canEnableNoPk && noPkMode[activeTab.id] === true;
  const tableEditable = activeTableMeta?.editable === true || activeNoPkMode;
  const activeInsertCount = Object.keys(
    pendingTableEdits[activeTab.id]?.inserts ?? {},
  ).length;
  const editableFromRow = activeNoPkMode
    ? (runs[activeTab.id]?.rows.length ?? 0) - activeInsertCount
    : undefined;

  /** 每次修改前保存快照，撤销时恢复行数据与待提交状态（最多 30 步）。 */
  const snapshotTableEdit = (tabId: string) => {
    const run = runs[tabId];
    if (!run) return;
    const pending = pendingTableEdits[tabId] ?? emptyPendingTableEdits();
    setEditHistory((current) => {
      const list = [
        ...(current[tabId] ?? []),
        { rows: run.rows.map((row) => [...row]), pending: structuredClone(pending) },
      ];
      return { ...current, [tabId]: list.slice(-30) };
    });
  };

  const clearEditHistory = (tabId: string) => {
    setEditHistory((current) => {
      if (!current[tabId]) return current;
      const next = { ...current };
      delete next[tabId];
      return next;
    });
  };

  const showNotice = (kind: Notice['kind'], text: string) => {
    setNotice({ id: Date.now(), kind, text });
    if (noticeTimer.current !== null) {
      window.clearTimeout(noticeTimer.current);
    }
    noticeTimer.current = window.setTimeout(() => setNotice(null), 6000);
  };

  const loadSchema = async (sessionId: string, includeSystemObjects: boolean) => {
    const api = window.dbcraft;
    if (!api) return;

    setSchemaLoadingId(sessionId);
    try {
      const result = await api.schema.get(sessionId, { includeSystemObjects });
      if (!result.ok) {
        setSchemas((current) => ({ ...current, [sessionId]: [] }));
        showNotice('error', result.message);
        return;
      }
      setSchemas((current) => ({ ...current, [sessionId]: result.objects }));
    } catch (error) {
      setSchemas((current) => ({ ...current, [sessionId]: [] }));
      showNotice('error', error instanceof Error ? error.message : '加载对象树失败。');
    } finally {
      setSchemaLoadingId((current) => (current === sessionId ? null : current));
    }
  };

  /** 表数据页需要主键/列信息才能开启编辑；视图或无主键表保持只读。 */
  const loadTableMeta = async (tab: QueryTab) => {
    const api = window.dbcraft;
    if (!api || !tab.table) return;

    try {
      const result = await api.schema.table(
        tab.id,
        tab.table.name,
        tab.table.kind ?? 'table',
      );
      setTableMetas((current) => ({ ...current, [tab.id]: result.ok ? result.meta : null }));
      if (!result.ok) {
        showNotice('error', `读取表结构失败：${result.message}`);
      }
    } catch (error) {
      setTableMetas((current) => ({ ...current, [tab.id]: null }));
      showNotice(
        'error',
        error instanceof Error ? error.message : '读取表结构失败。',
      );
    }
  };

  const closeTabSession = async (tabId: string) => {
    const api = window.dbcraft;
    setSessions((current) => {
      const next = { ...current };
      delete next[tabId];
      return next;
    });
    setSchemas((current) => {
      const next = { ...current };
      delete next[tabId];
      return next;
    });

    if (!api) return;
    await api.session.close(tabId).catch(() => undefined);
  };

  const openTabSession = async (tab: QueryTab, connectionId: string): Promise<boolean> => {
    const api = window.dbcraft;
    if (!api) {
      setSessions((current) => ({
        ...current,
        [tab.id]: { status: 'error', message: 'IPC 未就绪' },
      }));
      showNotice('error', '未检测到 Electron IPC 桥接。');
      return false;
    }

    setSessions((current) => ({
      ...current,
      [tab.id]: { status: 'opening' },
    }));

    try {
      const result = await api.connection.open(tab.id, connectionId);
      if (result.ok) {
        setSessions((current) => ({
          ...current,
          [tab.id]: {
            status: 'ready',
            message: result.message,
            version: result.serverVersion,
            readonly: result.readonly === true,
          },
        }));
        setConnections((current) => {
          const target = current.find((item) => item.id === connectionId);
          if (!target) return current;
          return [target, ...current.filter((item) => item.id !== connectionId)];
        });
        void loadSchema(tab.id, showSystemObjects[tab.id] ?? false);
        if (tab.table) {
          void loadTableMeta(tab);
        }
        return true;
      }

      setSessions((current) => ({
        ...current,
        [tab.id]: { status: 'error', message: result.message },
      }));
      showNotice('error', result.message);
      return false;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setSessions((current) => ({
        ...current,
        [tab.id]: { status: 'error', message },
      }));
      showNotice('error', message);
      return false;
    }
  };

  const rebindActiveTab = (connectionId: string) => {
    const connection = connections.find((item) => item.id === connectionId);
    if (!connection) return;

    if (countPendingEdits(pendingTableEdits[activeTab.id]) > 0) {
      showNotice('error', '有未提交的表格修改，请先提交或回滚。');
      return;
    }

    if (activeTab.connectionId === connectionId) {
      if (sessions[activeTab.id]?.status === 'ready') return;
      void openTabSession(activeTab, connectionId);
      return;
    }

    const nextTab: QueryTab = { ...activeTab, connectionId };
    setTabs((current) => current.map((tab) => (tab.id === activeTab.id ? nextTab : tab)));
    setRuns((current) => {
      const next = { ...current };
      delete next[activeTab.id];
      return next;
    });
    setTableMetas((current) => {
      const next = { ...current };
      delete next[activeTab.id];
      return next;
    });
    setPendingTableEdits((current) => {
      const next = { ...current };
      delete next[activeTab.id];
      return next;
    });
    clearEditHistory(activeTab.id);
    setNoPkMode((current) => {
      const next = { ...current };
      delete next[activeTab.id];
      return next;
    });

    void (async () => {
      await closeTabSession(activeTab.id);
      await openTabSession(nextTab, connectionId);
    })();
  };

  const runQuery = async (
    overrideSql?: string,
    targetTab?: QueryTab,
    overrideParams?: QueryCell[],
    options?: { internal?: boolean },
  ) => {
    const tab = targetTab ?? activeTab;
    if (runningTabs[tab.id]) return;
    const connection = connections.find((item) => item.id === tab.connectionId);
    if (!connection) {
      showNotice('error', '当前标签没有绑定连接，请先选择连接。');
      return;
    }

    if (connection.input.type === 'mssql') {
      showNotice('error', 'MSSQL 驱动将在后续里程碑接入。');
      return;
    }

    const api = window.dbcraft;
    if (!api) {
      showNotice('error', '未检测到 Electron IPC 桥接。');
      return;
    }

    const sql = (overrideSql ?? tab.sql).trim();
    if (!sql) {
      showNotice('error', 'SQL 不能为空。');
      return;
    }

    // 表数据页有未提交修改时，直接执行会丢弃它们，先要求处理。
    if (
      !options?.internal &&
      tab.table &&
      countPendingEdits(pendingTableEdits[tab.id]) > 0
    ) {
      showNotice('error', '有未提交的表格修改，请先提交或回滚。');
      return;
    }

    // 生产连接：DROP/TRUNCATE/无 WHERE 的 UPDATE/DELETE 先弹确认。
    if (!options?.internal) {
      const danger = inspectDangerousSql(sql, connection.input.env);
      if (danger) {
        setPendingDanger({ sql, match: danger });
        return;
      }
    }

    let ready = sessions[tab.id]?.status === 'ready';
    if (!ready) {
      ready = await openTabSession(tab, connection.id);
    }
    if (!ready) return;

    const requestId = createId('query');
    runningRequests.current[tab.id] = requestId;
    setRunningTabs((current) => ({ ...current, [tab.id]: true }));

    try {
      const response = await api.query.execute({
        requestId,
        sessionId: tab.id,
        sql,
        params: overrideParams,
        maxRows: settings.resultRowLimit,
        timeoutMs: settings.queryTimeoutMs,
        connectionId: connection.id,
        connectionName: connection.input.name,
        dialect: connection.input.type,
        database: connection.input.type === 'sqlite' ? '' : connection.input.database,
        source: 'editor',
      });

      if (response.ok) {
        setRuns((current) => ({
          ...current,
          [tab.id]: {
            ...response.result,
            executedAt: Date.now(),
            error: null,
            errorMeta: null,
            errorHint: null,
          },
        }));
        if (response.result.truncated) {
          showNotice('info', `仅显示前 ${response.result.rowCount} 行，其余结果未加载。`);
        }
        clearEditHistory(tab.id);
      } else {
        setRuns((current) => ({
          ...current,
          [tab.id]: {
            ...(current[tab.id] ?? EMPTY_RUN),
            elapsedMs: 0,
            executedAt: Date.now(),
            error: response.error.message,
            errorMeta: formatErrorMeta(response.error),
            errorHint: explainQueryError(response.error),
          },
        }));
        if (response.error.connectionClosed) {
          setSessions((current) => ({
            ...current,
            [tab.id]: { status: 'error', message: response.error.message },
          }));
        }
        showNotice('error', response.error.message);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setRuns((current) => ({
        ...current,
        [tab.id]: {
          ...(current[tab.id] ?? EMPTY_RUN),
          elapsedMs: 0,
          executedAt: Date.now(),
          error: message,
          errorMeta: null,
          errorHint: explainErrorText(message),
        },
      }));
      showNotice('error', message);
    } finally {
      if (runningRequests.current[tab.id] === requestId) {
        delete runningRequests.current[tab.id];
      }
      setRunningTabs((current) => {
        const next = { ...current };
        delete next[tab.id];
        return next;
      });
    }
  };

  const cancelQuery = async () => {
    const requestId = runningRequests.current[activeTab.id];
    if (!requestId) return;

    const api = window.dbcraft;
    if (!api) return;

    const canceled = await api.query.cancel(requestId);
    showNotice(
      canceled ? 'info' : 'error',
      canceled ? '已请求取消查询。' : '查询已结束或无法取消。',
    );
  };

  /** 批量单元格修改（单格编辑与多行粘贴共用），累积为待提交 UPDATE/INSERT。 */
  const applyCellChanges = (
    changes: Array<{ rowIndex: number; columnIndex: number; value: QueryCell }>,
  ) => {
    const tab = activeTab;
    const meta = tableMetas[tab.id];
    const run = runs[tab.id];
    if (!tab.table || !meta || !run || changes.length === 0 || !tableEditable) return;

    const state: PendingTableEdits = structuredClone(
      pendingTableEdits[tab.id] ?? emptyPendingTableEdits(),
    );
    const rows = run.rows.map((row) => [...row]);
    let changed = false;

    for (const change of changes) {
      const { rowIndex, columnIndex } = change;
      const column = run.columns[columnIndex];
      const columnMeta = column
        ? meta.columns.find((item) => item.name === column.name)
        : undefined;
      const row = rows[rowIndex];
      if (!column || !columnMeta || columnMeta.readOnly || !row) continue;

      const isInsert = state.inserts[rowIndex] !== undefined;
      // 无主键高风险模式只允许新增行，已有行一律不可改。
      if (activeNoPkMode && !isInsert) continue;

      const previous = row[columnIndex] ?? null;
      // 编辑框把 NULL 显示为空串；原本就是 NULL 时不要把空串写回。
      const next: QueryCell = change.value === '' && previous === null ? null : change.value;
      if (previous === next) continue;

      const keys: Record<string, QueryCell> = {};
      if (!isInsert) {
        const keyIndexes = meta.primaryKey.map((name) =>
          run.columns.findIndex((item) => item.name === name),
        );
        if (keyIndexes.some((index) => index < 0)) {
          showNotice('error', '无法定位主键列，已取消本次编辑。');
          return;
        }
        meta.primaryKey.forEach((name, index) => {
          keys[name] = row[keyIndexes[index]!] ?? null;
        });
      }

      row[columnIndex] = next;
      changed = true;

      if (isInsert) {
        const values = { ...state.inserts[rowIndex], [columnMeta.name]: next };
        // 留空的新增列交给数据库默认值，而不是显式写 NULL。
        if (next === null) delete values[columnMeta.name];
        state.inserts[rowIndex] = values;
        continue;
      }

      const existing = state.updates[rowIndex];
      const original: Record<string, QueryCell> = { ...(existing?.original ?? {}) };
      if (!(columnMeta.name in original)) {
        original[columnMeta.name] = previous;
      }
      const values: Record<string, QueryCell> = { ...(existing?.values ?? {}) };

      if (original[columnMeta.name] === next) {
        delete values[columnMeta.name];
        delete original[columnMeta.name];
      } else {
        values[columnMeta.name] = next;
      }

      if (Object.keys(values).length === 0) {
        delete state.updates[rowIndex];
      } else {
        state.updates[rowIndex] = { keys, values, original };
      }
    }

    if (!changed) return;

    snapshotTableEdit(tab.id);
    setRuns((current) => {
      const target = current[tab.id];
      if (!target) return current;
      return { ...current, [tab.id]: { ...target, rows } };
    });
    setPendingTableEdits((current) => ({ ...current, [tab.id]: state }));
  };

  const editTableCell = (rowIndex: number, columnIndex: number, value: QueryCell) => {
    applyCellChanges([{ rowIndex, columnIndex, value }]);
  };

  const commitTableEdits = async () => {
    const tab = activeTab;
    const state = pendingTableEdits[tab.id];
    const connection = activeConnection;
    if (!tab.table || !state) return;

    const edits: TableEdit[] = [
      ...Object.values(state.updates).map(
        (update): TableEdit => ({
          kind: 'update',
          keys: update.keys,
          values: update.values,
          original: update.original,
        }),
      ),
      ...Object.values(state.inserts).map(
        (values): TableEdit => ({ kind: 'insert', values }),
      ),
      ...Object.values(state.deletes).map(
        (keys): TableEdit => ({ kind: 'delete', keys }),
      ),
    ];
    if (edits.length === 0) return;

    const api = window.dbcraft;
    if (!api) {
      showNotice('error', '未检测到 Electron IPC 桥接。');
      return;
    }

    setCommittingTabs((current) => ({ ...current, [tab.id]: true }));
    try {
      const result = await api.table.apply({
        requestId: createId('edit'),
        sessionId: tab.id,
        table: tab.table.name,
        edits,
        allowNoPrimaryKeyInsert: activeNoPkMode,
        connectionId: connection?.id,
        connectionName: connection?.input.name,
        database:
          connection && connection.input.type !== 'sqlite' ? connection.input.database : '',
      });

      if (!result.ok) {
        showNotice(
          'error',
          result.conflict
            ? `${result.message} 请回滚后重新加载数据。`
            : result.message,
        );
        return;
      }

      setPendingTableEdits((current) => {
        const next = { ...current };
        delete next[tab.id];
        return next;
      });
      showNotice('info', `已提交 ${result.applied} 行修改。`);
      await runQuery(tab.sql, tab, tab.table.params, { internal: true });
    } catch (error) {
      showNotice('error', error instanceof Error ? error.message : String(error));
    } finally {
      setCommittingTabs((current) => {
        const next = { ...current };
        delete next[tab.id];
        return next;
      });
    }
  };

  const rollbackTableEdits = async () => {
    const tab = activeTab;
    if (!tab.table) return;

    setPendingTableEdits((current) => {
      const next = { ...current };
      delete next[tab.id];
      return next;
    });
    setTableSelection((current) => ({ ...current, [tab.id]: null }));
    showNotice('info', '已丢弃未提交的修改。');
    await runQuery(tab.sql, tab, tab.table.params, { internal: true });
  };

  const addTableRow = () => {
    const tab = activeTab;
    const meta = tableMetas[tab.id];
    const run = runs[tab.id];
    if (!tab.table || !meta || !run || running || !tableEditable) return;

    snapshotTableEdit(tab.id);
    const rowIndex = run.rows.length;
    setRuns((current) => {
      const target = current[tab.id];
      if (!target) return current;
      return {
        ...current,
        [tab.id]: {
          ...target,
          rows: [...target.rows, target.columns.map(() => null)],
          rowCount: target.rowCount + 1,
        },
      };
    });
    setPendingTableEdits((current) => {
      const state = current[tab.id] ?? emptyPendingTableEdits();
      return {
        ...current,
        [tab.id]: { ...state, inserts: { ...state.inserts, [rowIndex]: {} } },
      };
    });
    setTableSelection((current) => ({ ...current, [tab.id]: rowIndex }));
  };

  const deleteSelectedRow = () => {
    const tab = activeTab;
    const meta = tableMetas[tab.id];
    const run = runs[tab.id];
    const rowIndex = tableSelection[tab.id];
    if (
      !tab.table ||
      !meta ||
      !run ||
      !tableEditable ||
      rowIndex === null ||
      rowIndex === undefined
    ) {
      return;
    }
    if (rowIndex < 0 || rowIndex >= run.rows.length) return;

    if (activeNoPkMode && rowIndex < (editableFromRow ?? 0)) {
      showNotice('error', '无主键表不能删除已有行，只能删除本次新增的行。');
      return;
    }

    snapshotTableEdit(tab.id);
    const isInsert = pendingTableEdits[tab.id]?.inserts[rowIndex] !== undefined;

    let keys: Record<string, QueryCell> | null = null;
    if (!isInsert) {
      const keyIndexes = meta.primaryKey.map((name) =>
        run.columns.findIndex((item) => item.name === name),
      );
      if (keyIndexes.some((index) => index < 0)) {
        showNotice('error', '无法定位主键列，已取消本次删除。');
        return;
      }
      keys = {};
      meta.primaryKey.forEach((name, index) => {
        keys![name] = run.rows[rowIndex]?.[keyIndexes[index]!] ?? null;
      });
    }

    setRuns((current) => {
      const target = current[tab.id];
      if (!target) return current;
      return {
        ...current,
        [tab.id]: {
          ...target,
          rows: target.rows.filter((_row, index) => index !== rowIndex),
          rowCount: Math.max(0, target.rowCount - 1),
        },
      };
    });

    setPendingTableEdits((current) => {
      const state = shiftPendingRows(
        current[tab.id] ?? emptyPendingTableEdits(),
        rowIndex,
      );
      if (!isInsert && keys) {
        state.deletes[rowIndex] = keys;
      }
      return { ...current, [tab.id]: state };
    });
    setTableSelection((current) => ({ ...current, [tab.id]: null }));
  };

  /** 撤销最近一步本地编辑；提交/回滚/重新查询后历史清空。 */
  const undoTableEdit = () => {
    const tab = activeTab;
    const list = editHistory[tab.id] ?? [];
    const snapshot = list[list.length - 1];
    if (!snapshot) return;

    setEditHistory((current) => ({ ...current, [tab.id]: list.slice(0, -1) }));
    setRuns((current) => {
      const target = current[tab.id];
      if (!target) return current;
      return {
        ...current,
        [tab.id]: { ...target, rows: snapshot.rows, rowCount: snapshot.rows.length },
      };
    });
    setPendingTableEdits((current) => ({ ...current, [tab.id]: snapshot.pending }));
    setTableSelection((current) => ({ ...current, [tab.id]: null }));
  };

  const toggleNoPkMode = (next: boolean) => {
    const tab = activeTab;
    if (countPendingEdits(pendingTableEdits[tab.id]) > 0) {
      showNotice('error', '请先提交或回滚当前修改，再切换无主键编辑模式。');
      return;
    }
    setNoPkMode((current) => ({ ...current, [tab.id]: next }));
    if (next) {
      showNotice(
        'info',
        '已开启高风险模式：无主键表只允许新增行，已有行保持只读。',
      );
    }
  };

  const addTab = (connectionId?: string) => {
    const number = tabCounter.current;
    tabCounter.current += 1;

    const connection =
      connections.find((item) => item.id === (connectionId ?? activeTab.connectionId)) ?? null;
    const tab: QueryTab = {
      id: `query-${number}`,
      title: `查询 ${number}`,
      sql: connection ? DEFAULT_SQL[connection.input.type] : 'SELECT 1;',
      connectionId: connection?.id ?? null,
    };

    setTabs((current) => [...current, tab]);
    setActiveTabId(tab.id);

    if (connection) {
      void openTabSession(tab, connection.id);
    }
  };

  const closeTab = (id: string) => {
    if (tabs.length <= 1) return;
    if (countPendingEdits(pendingTableEdits[id]) > 0) {
      if (!window.confirm('该标签有未提交的表格修改，关闭会丢弃。继续吗？')) {
        return;
      }
    }
    const closing = tabs.find((tab) => tab.id === id);
    if (closing?.dirty) {
      if (
        !window.confirm(
          '当前 SQL 最近修改尚未写入自动草稿（每 30 秒保存一次），关闭会丢失这些修改。继续吗？',
        )
      ) {
        return;
      }
    }

    const index = tabs.findIndex((tab) => tab.id === id);
    if (index < 0) return;

    const next = tabs.filter((tab) => tab.id !== id);
    const fallback =
      activeTabId === id ? (next[Math.max(0, index - 1)] ?? next[0]).id : activeTabId;
    setTabs(next);
    if (activeTabId === id) {
      setActiveTabId(fallback);
    }
    persistDraftTabs(next, fallback);
    void closeTabSession(id);
    setRuns((current) => {
      const copy = { ...current };
      delete copy[id];
      return copy;
    });
    setTableMetas((current) => {
      const copy = { ...current };
      delete copy[id];
      return copy;
    });
    setPendingTableEdits((current) => {
      const copy = { ...current };
      delete copy[id];
      return copy;
    });
    setEditHistory((current) => {
      const copy = { ...current };
      delete copy[id];
      return copy;
    });
    setNoPkMode((current) => {
      const copy = { ...current };
      delete copy[id];
      return copy;
    });
    setShowSystemObjects((current) => {
      const copy = { ...current };
      delete copy[id];
      return copy;
    });
  };

  const updateSql = (value: string) => {
    setTabs((current) =>
      current.map((tab) =>
        tab.id === activeTabId ? { ...tab, sql: value, dirty: true } : tab,
      ),
    );
  };

  const refreshSchema = () => {
    if (sessions[activeTab.id]?.status === 'ready') {
      void loadSchema(activeTab.id, showSystemObjects[activeTab.id] ?? false);
    }
  };

  const toggleSystemObjects = (next: boolean) => {
    const tabId = activeTab.id;
    setShowSystemObjects((current) => ({ ...current, [tabId]: next }));
    if (sessions[tabId]?.status === 'ready') {
      void loadSchema(tabId, next);
    }
  };

  /** 会话失效后就地重连：关闭旧会话、清掉错误，再按当前连接重新打开。 */
  const reconnectActive = async () => {
    const connection = connections.find((item) => item.id === activeTab.connectionId);
    if (!connection) {
      showNotice('error', '当前标签没有绑定连接，请先选择连接。');
      return;
    }

    await closeTabSession(activeTab.id);
    setRuns((current) => {
      const next = { ...current };
      delete next[activeTab.id];
      return next;
    });
    clearEditHistory(activeTab.id);
    setNoPkMode((current) => {
      const next = { ...current };
      delete next[activeTab.id];
      return next;
    });
    void openTabSession(activeTab, connection.id);
  };

  const openTable = (name: string) => {
    const type = activeConnection?.input.type ?? 'sqlite';
    updateSql(buildTablePreviewSql(type, name));
    showNotice('info', `已填入 ${name} 查询，按 Ctrl+Enter 执行。`);
  };

  const openTableData = (name: string, kind: 'table' | 'view' = 'table') => {
    const connection = activeConnection;
    if (!connection) {
      showNotice('error', '请先选择连接。');
      return;
    }
    if (connection.input.type === 'mssql') {
      showNotice('error', 'MSSQL 驱动将在后续里程碑接入。');
      return;
    }

    const pageSize = 200;
    const number = tabCounter.current;
    tabCounter.current += 1;
    const query = buildTablePageQuery(connection.input.type, name, pageSize, 0);
    const tab: QueryTab = {
      id: `query-${number}`,
      title: `表 · ${name}`,
      sql: query.sql,
      connectionId: connection.id,
      table: { name, kind, page: 0, pageSize, params: query.params },
    };

    setTabs((current) => [...current, tab]);
    setActiveTabId(tab.id);
    setRuns((current) => {
      const next = { ...current };
      delete next[tab.id];
      return next;
    });

    void runQuery(query.sql, tab, query.params, { internal: true });
  };

  const changeTablePage = async (page: number) => {
    const tab = activeTab;
    const connection = activeConnection;
    if (!tab.table || !connection) return;
    if (countPendingEdits(pendingTableEdits[tab.id]) > 0) {
      showNotice('error', '有未提交的表格修改，请先提交或回滚。');
      return;
    }

    const query = buildTablePageQuery(
      connection.input.type,
      tab.table.name,
      tab.table.pageSize,
      page * tab.table.pageSize,
      tab.table.sort,
      tab.table.filter,
    );
    const nextTab: QueryTab = {
      ...tab,
      sql: query.sql,
      table: { ...tab.table, page, params: query.params },
    };

    setTabs((current) => current.map((item) => (item.id === tab.id ? nextTab : item)));
    await runQuery(query.sql, nextTab, query.params, { internal: true });
  };

  const changeTablePageSize = async (pageSize: number) => {
    const tab = activeTab;
    const connection = activeConnection;
    if (!tab.table || !connection) return;
    if (countPendingEdits(pendingTableEdits[tab.id]) > 0) {
      showNotice('error', '有未提交的表格修改，请先提交或回滚。');
      return;
    }

    const query = buildTablePageQuery(
      connection.input.type,
      tab.table.name,
      pageSize,
      0,
      tab.table.sort,
      tab.table.filter,
    );
    const nextTab: QueryTab = {
      ...tab,
      sql: query.sql,
      table: { ...tab.table, page: 0, pageSize, params: query.params },
    };

    setTabs((current) => current.map((item) => (item.id === tab.id ? nextTab : item)));
    await runQuery(query.sql, nextTab, query.params, { internal: true });
  };

  const changeTableSort = async (column: string, direction: 'asc' | 'desc') => {
    const tab = activeTab;
    const connection = activeConnection;
    if (!tab.table || !connection) return;
    if (countPendingEdits(pendingTableEdits[tab.id]) > 0) {
      showNotice('error', '有未提交的表格修改，请先提交或回滚。');
      return;
    }

    const sort = column ? { column, direction } : undefined;
    const query = buildTablePageQuery(
      connection.input.type,
      tab.table.name,
      tab.table.pageSize,
      0,
      sort,
      tab.table.filter,
    );
    const nextTab: QueryTab = {
      ...tab,
      sql: query.sql,
      table: { ...tab.table, page: 0, sort, params: query.params },
    };

    setTabs((current) => current.map((item) => (item.id === tab.id ? nextTab : item)));
    await runQuery(query.sql, nextTab, query.params, { internal: true });
  };

  const changeTableFilter = async (column: string, value: string) => {
    const tab = activeTab;
    const connection = activeConnection;
    if (!tab.table || !connection || !column) return;
    if (countPendingEdits(pendingTableEdits[tab.id]) > 0) {
      showNotice('error', '有未提交的表格修改，请先提交或回滚。');
      return;
    }

    const filter = value === '' ? undefined : { column, value };
    const query = buildTablePageQuery(
      connection.input.type,
      tab.table.name,
      tab.table.pageSize,
      0,
      tab.table.sort,
      filter,
    );
    const nextTab: QueryTab = {
      ...tab,
      sql: query.sql,
      table: { ...tab.table, page: 0, filter, params: query.params },
    };

    setTabs((current) => current.map((item) => (item.id === tab.id ? nextTab : item)));
    await runQuery(query.sql, nextTab, query.params, { internal: true });
  };

  const saveConnection = async (input: ConnectionInput, id?: string) => {
    const api = window.dbcraft;
    if (!api) {
      showNotice('error', '未检测到 Electron IPC 桥接。');
      return;
    }

    const result = await api.connection.save(input, id);
    if (!result.ok) {
      showNotice('error', result.message);
      return;
    }

    const connection = result.connection;
    setConnections((current) =>
      id
        ? current.map((item) => (item.id === connection.id ? connection : item))
        : [connection, ...current],
    );
    if (result.warning) {
      showNotice('info', result.warning);
    }
    setConnectionDialog(null);

    // 编辑已保存连接：让当前绑定该连接的所有标签用新配置重连。
    if (id) {
      const boundTabs = tabs.filter((tab) => tab.connectionId === id);
      for (const tab of boundTabs) {
        await closeTabSession(tab.id);
        await openTabSession(tab, connection.id);
      }
      showNotice('info', `连接「${connection.input.name}」已更新。`);
      return;
    }

    const nextTab: QueryTab = {
      ...activeTab,
      connectionId: connection.id,
      sql: DEFAULT_SQL[input.type],
      table: undefined,
    };
    setTabs((current) => current.map((tab) => (tab.id === activeTab.id ? nextTab : tab)));
    setRuns((current) => {
      const next = { ...current };
      delete next[activeTab.id];
      return next;
    });
    setTableMetas((current) => {
      const next = { ...current };
      delete next[activeTab.id];
      return next;
    });
    setPendingTableEdits((current) => {
      const next = { ...current };
      delete next[activeTab.id];
      return next;
    });
    clearEditHistory(activeTab.id);
    setNoPkMode((current) => {
      const next = { ...current };
      delete next[activeTab.id];
      return next;
    });

    await closeTabSession(activeTab.id);
    await openTabSession(nextTab, connection.id);
  };

  const deleteSavedConnection = async (id: string) => {
    const api = window.dbcraft;
    if (!api) return;

    const target = connections.find((item) => item.id === id);
    if (!target) return;
    if (!window.confirm(`删除连接「${target.input.name}」？本地保存的配置与密码会一并移除。`)) {
      return;
    }

    const result = await api.connection.remove(id);
    if (!result.ok) {
      showNotice('error', result.message);
      return;
    }

    setConnections((current) => current.filter((item) => item.id !== id));

    const affectedTabs = tabs.filter((tab) => tab.connectionId === id);
    if (affectedTabs.length > 0) {
      setTabs((current) =>
        current.map((tab) =>
          tab.connectionId === id
            ? { ...tab, connectionId: null, sql: 'SELECT 1;', table: undefined }
            : tab,
        ),
      );
      setRuns((current) => {
        const next = { ...current };
        for (const tab of affectedTabs) {
          delete next[tab.id];
        }
        return next;
      });
      setTableMetas((current) => {
        const next = { ...current };
        for (const tab of affectedTabs) {
          delete next[tab.id];
        }
        return next;
      });
      setPendingTableEdits((current) => {
        const next = { ...current };
        for (const tab of affectedTabs) {
          delete next[tab.id];
        }
        return next;
      });
      setEditHistory((current) => {
        const next = { ...current };
        for (const tab of affectedTabs) {
          delete next[tab.id];
        }
        return next;
      });
      setNoPkMode((current) => {
        const next = { ...current };
        for (const tab of affectedTabs) {
          delete next[tab.id];
        }
        return next;
      });
      await Promise.all(affectedTabs.map((tab) => closeTabSession(tab.id)));
      showNotice('info', '连接已删除，相关标签已解除绑定。');
    }
  };

  const openCreateDialog = () => setConnectionDialog({ mode: 'create' });

  const openEditDialog = (id: string) => {
    const target = connections.find((item) => item.id === id);
    if (!target) return;
    setConnectionDialog({
      mode: 'edit',
      id,
      initial: target.input,
      passwordStored: target.passwordStored,
    });
  };

  const duplicateConnection = (id: string) => {
    const target = connections.find((item) => item.id === id);
    if (!target) return;
    setConnectionDialog({
      mode: 'create',
      initial: { ...target.input, name: `${target.input.name} 副本` },
    });
  };

  const disconnectConnection = async (id: string) => {
    const affected = tabs.filter(
      (tab) => tab.connectionId === id && sessions[tab.id] !== undefined,
    );
    await Promise.all(affected.map((tab) => closeTabSession(tab.id)));
    showNotice(
      'info',
      affected.length > 0
        ? '已断开连接，标签保留，下次执行会重新连接。'
        : '该连接当前没有活动会话。',
    );
  };

  const newQueryForConnection = (id: string) => {
    addTab(id);
  };

  const renameGroup = async (oldPath: string, newPath: string) => {
    const api = window.dbcraft;
    if (!api) return;

    const affected = connections.filter(
      (item) =>
        item.input.group === oldPath || item.input.group.startsWith(`${oldPath}/`),
    );
    if (affected.length === 0) return;

    const updated: SavedConnection[] = [];
    for (const record of affected) {
      const nextGroup =
        record.input.group === oldPath
          ? newPath
          : `${newPath}${record.input.group.slice(oldPath.length)}`;
      const result = await api.connection.save({ ...record.input, group: nextGroup }, record.id);
      if (result.ok) updated.push(result.connection);
    }

    setConnections((current) =>
      current.map((item) => updated.find((entry) => entry.id === item.id) ?? item),
    );
    showNotice(
      updated.length === affected.length ? 'info' : 'error',
      updated.length === affected.length
        ? `分组已重命名为「${newPath}」。`
        : `部分连接更新失败（${updated.length}/${affected.length}）。`,
    );
  };

  const deleteGroup = async (path: string) => {
    const api = window.dbcraft;
    if (!api) return;

    const affected = connections.filter(
      (item) => item.input.group === path || item.input.group.startsWith(`${path}/`),
    );
    if (affected.length === 0) return;

    const updated: SavedConnection[] = [];
    for (const record of affected) {
      const result = await api.connection.save({ ...record.input, group: '' }, record.id);
      if (result.ok) updated.push(result.connection);
    }

    setConnections((current) =>
      current.map((item) => updated.find((entry) => entry.id === item.id) ?? item),
    );
    showNotice(
      updated.length === affected.length ? 'info' : 'error',
      updated.length === affected.length
        ? '分组已删除，连接已移到未分组。'
        : `部分连接更新失败（${updated.length}/${affected.length}）。`,
    );
  };

  const moveConnectionToGroup = async (id: string, group: string) => {
    const api = window.dbcraft;
    if (!api) return;

    const record = connections.find((item) => item.id === id);
    if (!record || record.input.group === group) return;

    const result = await api.connection.save({ ...record.input, group }, id);
    if (!result.ok) {
      showNotice('error', result.message);
      return;
    }

    setConnections((current) =>
      current.map((item) => (item.id === id ? result.connection : item)),
    );
    showNotice('info', group ? `已移动到「${group}」。` : '已移到未分组。');
  };

  const openAlterColumn = async (name: string, mode: 'rename' | 'modify') => {
    const api = window.dbcraft;
    if (!api) {
      showNotice('error', '未检测到 Electron IPC 桥接。');
      return;
    }

    const connection = connections.find((item) => item.id === activeTab.connectionId);
    if (!connection) {
      showNotice('error', '当前标签没有绑定连接，请先选择连接。');
      return;
    }
    if (connection.input.type === 'mssql') {
      showNotice('error', 'MSSQL 驱动将在后续里程碑接入。');
      return;
    }

    let ready = sessions[activeTab.id]?.status === 'ready';
    if (!ready) {
      ready = await openTabSession(activeTab, connection.id);
    }
    if (!ready) return;

    const result = await api.schema.table(activeTab.id, name, 'table');
    if (!result.ok) {
      showNotice('error', result.message);
      return;
    }

    if (mode === 'modify') {
      const detail = await api.schema.describe(activeTab.id, name);
      if (!detail.ok) {
        showNotice('error', detail.message);
        return;
      }
      setAlterColumnTarget({
        mode,
        table: name,
        columns: detail.detail.columns,
        detail: detail.detail,
      });
      return;
    }

    setAlterColumnTarget({ mode, table: name, columns: result.meta.columns });
  };

  const openTableStructure = async (name: string) => {
    const api = window.dbcraft;
    if (!api) {
      showNotice('error', '未检测到 Electron IPC 桥接。');
      return;
    }
    const connection = connections.find((item) => item.id === activeTab.connectionId);
    if (!connection) {
      showNotice('error', '当前标签没有绑定连接，请先选择连接。');
      return;
    }
    if (connection.input.type === 'mssql') {
      showNotice('error', 'MSSQL 驱动将在后续里程碑接入。');
      return;
    }

    let ready = sessions[activeTab.id]?.status === 'ready';
    if (!ready) {
      ready = await openTabSession(activeTab, connection.id);
    }
    if (!ready) return;

    const result = await api.schema.describe(activeTab.id, name);
    if (!result.ok) {
      showNotice('error', result.message);
      return;
    }
    setTableStructure(result.detail);
  };

  const fetchDdl = async (name: string, kind: DdlObjectKind): Promise<string | null> => {
    const api = window.dbcraft;
    if (!api) {
      showNotice('error', '未检测到 Electron IPC 桥接。');
      return null;
    }

    const connection = connections.find((item) => item.id === activeTab.connectionId);
    if (!connection) {
      showNotice('error', '当前标签没有绑定连接，请先选择连接。');
      return null;
    }

    let ready = sessions[activeTab.id]?.status === 'ready';
    if (!ready) {
      ready = await openTabSession(activeTab, connection.id);
    }
    if (!ready) return null;

    const result = await api.ddl.get(activeTab.id, name, kind);
    if (!result.ok) {
      showNotice('error', result.message);
      return null;
    }
    return result.ddl;
  };

  const viewDdl = async (name: string, kind: DdlObjectKind) => {
    const ddl = await fetchDdl(name, kind);
    if (ddl === null) return;

    const number = tabCounter.current;
    tabCounter.current += 1;
    const connectionId = activeTab.connectionId;
    const tab: QueryTab = {
      id: `query-${number}`,
      title: `DDL · ${name}`,
      sql: ddl,
      connectionId,
    };

    setTabs((current) => [...current, tab]);
    setActiveTabId(tab.id);
    if (connectionId) {
      void openTabSession(tab, connectionId);
    }
    showNotice('info', `已打开 ${name} 的 DDL。`);
  };

  const copyDdl = async (name: string, kind: DdlObjectKind) => {
    const ddl = await fetchDdl(name, kind);
    if (ddl === null) return;

    try {
      await navigator.clipboard.writeText(ddl);
      showNotice('info', `已复制 ${name} 的 DDL。`);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = ddl;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      const copied = document.execCommand('copy');
      document.body.removeChild(textarea);
      showNotice(
        copied ? 'info' : 'error',
        copied ? `已复制 ${name} 的 DDL。` : '复制失败，请打开 DDL 后手动复制。',
      );
    }
  };

  const generateDatabaseDdl = async (connectionId: string) => {
    const api = window.dbcraft;
    if (!api) return;

    const connection = connections.find((item) => item.id === connectionId);
    if (!connection) return;

    if (connectionId !== activeTab.connectionId) {
      showNotice('error', '请先切换到该连接，再生成库级 DDL。');
      return;
    }

    let ready = sessions[activeTab.id]?.status === 'ready';
    if (!ready) {
      ready = await openTabSession(activeTab, connection.id);
    }
    if (!ready) return;

    const schema = await api.schema.get(activeTab.id, { includeSystemObjects: false });
    if (!schema.ok) {
      showNotice('error', schema.message);
      return;
    }

    if (schema.objects.length === 0) {
      showNotice('info', '当前连接没有可导出的对象。');
      return;
    }

    const parts: string[] = [`-- ${connection.input.name} 的结构脚本`, ''];
    let failed = 0;

    for (const object of schema.objects) {
      const result = await api.ddl.get(activeTab.id, object.name, object.type);
      if (result.ok) {
        parts.push(
          `-- ${object.type} ${object.name}`,
          result.ddl.trim().replace(/;?$/, ';'),
          '',
        );
      } else {
        failed += 1;
        parts.push(`-- 无法生成 ${object.name} 的 DDL：${result.message}`, '');
      }
    }

    const number = tabCounter.current;
    tabCounter.current += 1;
    const tab: QueryTab = {
      id: `query-${number}`,
      title: `DDL · ${connection.input.name}`,
      sql: parts.join('\n'),
      connectionId: connection.id,
    };

    setTabs((current) => [...current, tab]);
    setActiveTabId(tab.id);
    void openTabSession(tab, connection.id);
    showNotice(
      failed > 0 ? 'error' : 'info',
      failed > 0
        ? `已生成库级 DDL，${failed} 个对象生成失败。`
        : `已生成 ${schema.objects.length} 个对象的 DDL。`,
    );
  };

  const executeDdlSql = async (sql: string): Promise<{ ok: boolean; message: string }> => {
    const api = window.dbcraft;
    if (!api) return { ok: false, message: '未检测到 Electron IPC 桥接。' };

    if (countPendingEdits(pendingTableEdits[activeTab.id]) > 0) {
      return { ok: false, message: '有未提交的表格修改，请先提交或回滚再执行 DDL。' };
    }

    const connection = connections.find((item) => item.id === activeTab.connectionId);
    if (!connection) return { ok: false, message: '当前标签没有绑定连接，请先选择连接。' };

    let ready = sessions[activeTab.id]?.status === 'ready';
    if (!ready) {
      ready = await openTabSession(activeTab, connection.id);
    }
    if (!ready) return { ok: false, message: '会话未就绪，请检查连接。' };

    const result = await api.ddl.execute(activeTab.id, [sql]);
    if (!result.ok) {
      return { ok: false, message: result.message };
    }

    showNotice('info', 'DDL 执行成功，对象树已刷新。');
    // 表结构变了，旧的主键/列元数据与编辑快照都不能再用。
    setTableMetas((current) => {
      const next = { ...current };
      delete next[activeTab.id];
      return next;
    });
    clearEditHistory(activeTab.id);
    setNoPkMode((current) => {
      const next = { ...current };
      delete next[activeTab.id];
      return next;
    });
    void loadSchema(activeTab.id, showSystemObjects[activeTab.id] ?? false);
    return { ok: true, message: 'ok' };
  };

  const executeDdlScript = async (
    statements: string[],
    options?: { sqliteForeignKeysOff?: boolean },
  ): Promise<{
    ok: boolean;
    message: string;
    results?: DdlStatementResult[];
  }> => {
    const api = window.dbcraft;
    if (!api) return { ok: false, message: '未检测到 Electron IPC 桥接。' };

    if (countPendingEdits(pendingTableEdits[activeTab.id]) > 0) {
      return { ok: false, message: '有未提交的表格修改，请先提交或回滚再执行 DDL。' };
    }

    const connection = connections.find((item) => item.id === activeTab.connectionId);
    if (!connection) return { ok: false, message: '当前标签没有绑定连接，请先选择连接。' };

    let ready = sessions[activeTab.id]?.status === 'ready';
    if (!ready) {
      ready = await openTabSession(activeTab, connection.id);
    }
    if (!ready) return { ok: false, message: '会话未就绪，请检查连接。' };

    const result = await api.ddl.execute(activeTab.id, statements, options);
    if (!result.ok) {
      return { ok: false, message: result.message, results: result.results };
    }

    showNotice('info', 'DDL 执行成功，对象树已刷新。');
    setTableMetas((current) => {
      const next = { ...current };
      delete next[activeTab.id];
      return next;
    });
    clearEditHistory(activeTab.id);
    void loadSchema(activeTab.id, showSystemObjects[activeTab.id] ?? false);
    return { ok: true, message: 'ok', results: result.results };
  };

  /** 导出连接配置（永不含密码）；传 id 导出单个，否则导出全部。 */
  const exportConnectionConfig = async (connectionId?: string) => {
    const api = window.dbcraft;
    if (!api) return;

    const selected = connectionId
      ? connections.filter((item) => item.id === connectionId)
      : connections;
    if (selected.length === 0) {
      showNotice('info', '没有可导出的连接。');
      return;
    }

    const safeName = (selected[0].input.name || 'connections')
      .replace(/[\\/:*?"<>|]/g, '_')
      .slice(0, 40);
    const suggestedName = connectionId
      ? `dbcraft-${safeName}.json`
      : 'dbcraft-connections.json';

    const result = await api.export.save({
      suggestedName,
      content: serializeConnections(selected),
    });

    if (!result.ok) {
      if (!result.canceled) showNotice('error', result.message);
      return;
    }
    showNotice('info', `已导出 ${selected.length} 个连接配置（不含密码）。`);
  };

  const importConnectionConfig = async () => {
    const api = window.dbcraft;
    if (!api) return;

    const result = await api.connection.import();
    if (!result.ok) {
      if (!result.canceled) showNotice('error', result.message);
      return;
    }

    setConnections((current) => [...result.imported, ...current]);
    showNotice(
      'info',
      `已导入 ${result.imported.length} 个连接${
        result.skipped > 0 ? `，${result.skipped} 个失败` : ''
      }；密码需重新输入。`,
    );
  };

  /** 导出前重新执行查询，最多加载 10000 行；只允许只读语句。 */
  const loadAllForExport = async (): Promise<{
    ok: boolean;
    message?: string;
    columns?: QueryColumn[];
    rows?: QueryCell[][];
    truncated?: boolean;
  }> => {
    const api = window.dbcraft;
    if (!api) return { ok: false, message: '未检测到 Electron IPC 桥接。' };

    const tab = activeTab;
    const connection = connections.find((item) => item.id === tab.connectionId);
    if (!connection) return { ok: false, message: '当前标签没有绑定连接。' };
    if (connection.input.type === 'mssql') {
      return { ok: false, message: 'MSSQL 驱动尚未接入。' };
    }

    let ready = sessions[tab.id]?.status === 'ready';
    if (!ready) {
      ready = await openTabSession(tab, connection.id);
    }
    if (!ready) return { ok: false, message: '会话未就绪。' };

    let sql = tab.sql;
    let params: QueryCell[] | undefined = tab.table?.params;

    if (tab.table) {
      const query = buildTablePageQuery(
        connection.input.type,
        tab.table.name,
        10_000,
        0,
        tab.table.sort,
        tab.table.filter,
      );
      sql = query.sql;
      params = query.params;
    } else {
      const stripped = sql.replace(
        /^\s*(?:--[^\n]*\n|\/\*[\s\S]*?\*\/|\s)*/,
        '',
      );
      if (!/^(select|with|show|describe|desc|explain|pragma|table|values)\b/i.test(stripped)) {
        return { ok: false, message: '只有查询语句可以加载全部结果。' };
      }
    }

    const response = await api.query.execute({
      requestId: createId('export'),
      sessionId: tab.id,
      sql,
      params,
      maxRows: 10_000,
      timeoutMs: settings.queryTimeoutMs,
      connectionId: connection.id,
      connectionName: connection.input.name,
      dialect: connection.input.type,
      database: connection.input.type === 'sqlite' ? '' : connection.input.database,
      source: 'editor',
    });

    if (!response.ok) return { ok: false, message: response.error.message };
    return {
      ok: true,
      columns: response.result.columns,
      rows: response.result.rows,
      truncated: response.result.truncated,
    };
  };

  const viewFocusedCell = () => {
    const focus = focusedCells[activeTab.id];
    if (!focus) return;
    const run = runs[activeTab.id];
    const column = run?.columns[focus.columnIndex];
    const row = run?.rows[focus.rowIndex];
    if (!column || !row) return;
    setCellViewer({
      column,
      value: row[focus.columnIndex] ?? null,
      rowIndex: focus.rowIndex,
    });
  };

  const saveExportXlsx = async (
    columns: QueryColumn[],
    rows: QueryCell[][],
    suggestedName: string,
  ): Promise<{ ok: boolean; message?: string }> => {
    const api = window.dbcraft;
    if (!api) return { ok: false, message: '未检测到 Electron IPC 桥接。' };

    const result = await api.export.saveXlsx({
      suggestedName,
      columns: columns.map((column) => column.name),
      rows,
    });
    if (!result.ok) {
      if (result.canceled) return { ok: true };
      showNotice('error', result.message);
      return { ok: false, message: result.message };
    }

    showNotice('info', `已导出到 ${result.path}`);
    return { ok: true };
  };

  const saveExport = async (
    content: string,
    suggestedName: string,
  ): Promise<{ ok: boolean; message?: string }> => {
    const api = window.dbcraft;
    if (!api) return { ok: false, message: '未检测到 Electron IPC 桥接。' };

    const result = await api.export.save({ suggestedName, content });
    if (!result.ok) {
      if (result.canceled) return { ok: true };
      showNotice('error', result.message);
      return { ok: false, message: result.message };
    }

    showNotice('info', `已导出到 ${result.path}`);
    return { ok: true };
  };

  const openSqlFile = async () => {
    const api = window.dbcraft;
    if (!api) {
      showNotice('error', '未检测到 Electron IPC 桥接。');
      return;
    }
    const result = await api.file.openSql();
    if (!result.ok) {
      if (!result.canceled) showNotice('error', result.message);
      return;
    }

    const number = tabCounter.current;
    tabCounter.current += 1;
    const fileName = result.path.split(/[\\/]/).pop() || `查询 ${number}.sql`;
    const tab: QueryTab = {
      id: `query-${number}`,
      title: fileName,
      sql: result.content,
      connectionId: activeTab.connectionId,
      filePath: result.path,
      dirty: false,
    };

    setTabs((current) => [...current, tab]);
    setActiveTabId(tab.id);
    if (tab.connectionId) {
      void openTabSession(tab, tab.connectionId);
    }
    showNotice('info', `已打开 ${fileName}。`);
  };

  const saveSqlFile = async () => {
    const api = window.dbcraft;
    if (!api) {
      showNotice('error', '未检测到 Electron IPC 桥接。');
      return;
    }

    const tab = activeTab;
    const result = await api.file.saveSql({
      content: tab.sql,
      path: tab.filePath,
      suggestedName: `${tab.title || 'query'}.sql`,
    });
    if (!result.ok) {
      if (!result.canceled) showNotice('error', result.message);
      return;
    }

    const fileName = result.path.split(/[\\/]/).pop() || tab.title;
    setTabs((current) =>
      current.map((item) =>
        item.id === tab.id
          ? { ...item, filePath: result.path, title: fileName, dirty: false }
          : item,
      ),
    );
    showNotice('info', `已保存到 ${result.path}`);
  };

  const formatActiveSql = () => {
    const tab = activeTab;
    if (!tab.sql.trim()) {
      showNotice('info', '当前 SQL 为空，无需格式化。');
      return;
    }
    const formatted = formatSql(tab.sql);
    if (formatted === tab.sql) {
      showNotice('info', 'SQL 已是格式化状态。');
      return;
    }
    updateSql(formatted);
    showNotice('info', '已格式化当前 SQL。');
  };

  const copyColumnNames = async () => {
    if (activeRun.columns.length === 0) return;
    const text = activeRun.columns.map((column) => column.name).join('\t');
    try {
      await navigator.clipboard.writeText(text);
      showNotice('info', `已复制 ${activeRun.columns.length} 个列名。`);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      const copied = document.execCommand('copy');
      document.body.removeChild(textarea);
      showNotice(
        copied ? 'info' : 'error',
        copied ? `已复制 ${activeRun.columns.length} 个列名。` : '复制失败，请手动选择列名。',
      );
    }
  };

  const saveAppSettings = async (
    next: AppSettings,
  ): Promise<{ ok: boolean; message?: string }> => {
    const api = window.dbcraft;
    if (!api) return { ok: false, message: '未检测到 Electron IPC 桥接。' };
    const result = await api.settings.save(next);
    if (!result.ok) return { ok: false, message: result.message };
    setSettings(result.settings);
    showNotice('info', '设置已保存，新的结果行数上限从下次查询开始生效。');
    return { ok: true };
  };

  return (
    <main className="app-shell" data-testid="app-shell">
      <Toolbar
        connections={connections}
        activeConnectionId={activeTab.connectionId}
        onSelectConnection={rebindActiveTab}
        onNewConnection={openCreateDialog}
        onOpenHistory={() => setHistoryOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <div className="app-body">
        <Sidebar
          connections={connections}
          activeConnectionId={activeTab.connectionId}
          activeConnection={activeConnection}
          schemaObjects={activeSchema}
          schemaLoading={schemaLoadingId === activeTab.id}
          showSystemObjects={showSystemObjects[activeTab.id] ?? false}
          systemObjectsSupported={activeConnection?.input.type === 'sqlite'}
          sessionReadOnly={activeRuntime?.readonly === true}
          onSelectConnection={rebindActiveTab}
          onNewConnection={openCreateDialog}
          onRefreshSchema={refreshSchema}
          onToggleSystemObjects={toggleSystemObjects}
          onOpenTable={openTable}
          onOpenTableData={openTableData}
          onDeleteConnection={deleteSavedConnection}
          onEditConnection={openEditDialog}
          onDuplicateConnection={duplicateConnection}
          onDisconnectConnection={disconnectConnection}
          onNewQueryForConnection={newQueryForConnection}
          onRenameGroup={renameGroup}
          onDeleteGroup={deleteGroup}
          onMoveConnection={moveConnectionToGroup}
          onViewDdl={viewDdl}
          onCopyDdl={copyDdl}
          onRenameTable={(name) => setTableAction({ mode: 'rename', name })}
          onDropTable={(name) => setTableAction({ mode: 'drop-table', name })}
          onDropView={(name) => setTableAction({ mode: 'drop-view', name })}
          onAddColumn={(name) => setAddColumnTarget(name)}
          onRenameColumn={(name) => void openAlterColumn(name, 'rename')}
          onModifyColumn={(name) => void openAlterColumn(name, 'modify')}
          onShowStructure={(name) => void openTableStructure(name)}
          onCreateIndex={(name) => setIndexAction({ mode: 'create', table: name })}
          onDropIndex={(name) => setIndexAction({ mode: 'drop', table: name })}
          onDropColumn={(name) => setDropColumnTarget(name)}
          onNewTable={() => setTableDesignerOpen(true)}
          onNewView={() => setCreateViewOpen(true)}
          onRunScript={() => setScriptOpen(true)}
          onGenerateDatabaseDdl={generateDatabaseDdl}
          onExportConnection={(id) => void exportConnectionConfig(id)}
          onExportAllConnections={() => void exportConnectionConfig()}
          onImportConnections={() => void importConnectionConfig()}
        />

        <Workspace
          tabs={tabs}
          activeTabId={activeTabId}
          run={activeRun}
          running={running}
          connectionType={activeConnection?.input.type ?? null}
          sessionRuntime={activeRuntime}
          theme={settings.theme}
          tableMeta={activeTableMeta}
          tableEditable={tableEditable}
          canEnableNoPk={canEnableNoPk}
          noPkMode={activeNoPkMode}
          editableFromRow={editableFromRow}
          onToggleNoPk={toggleNoPkMode}
          pendingEdits={pendingEditCount}
          committing={committing}
          selectedRow={tableSelection[activeTab.id] ?? null}
          canUndo={canUndoEdit}
          onSelectTab={setActiveTabId}
          onCloseTab={closeTab}
          onAddTab={addTab}
          onSqlChange={updateSql}
          onRun={(sql) => void runQuery(sql)}
          onOpenSqlFile={() => void openSqlFile()}
          onSaveSqlFile={() => void saveSqlFile()}
          onFormatSql={formatActiveSql}
          completionItems={completionItems}
          onCancel={() => void cancelQuery()}
          onReconnect={() => void reconnectActive()}
          onExport={() => setExportOpen(true)}
          onCopyColumnNames={() => void copyColumnNames()}
          focusedCell={focusedCells[activeTab.id] ?? null}
          onCellFocus={(rowIndex, columnIndex) =>
            setFocusedCells((current) => ({
              ...current,
              [activeTab.id]: { rowIndex, columnIndex },
            }))
          }
          onViewCell={viewFocusedCell}
          onTablePageChange={(page) => void changeTablePage(page)}
          onTablePageSizeChange={(size) => void changeTablePageSize(size)}
          onTableSortChange={(column, direction) => void changeTableSort(column, direction)}
          onTableFilterChange={(column, value) => void changeTableFilter(column, value)}
          onCellChange={editTableCell}
          onCellsChange={applyCellChanges}
          onRowFocus={(rowIndex) =>
            setTableSelection((current) => ({ ...current, [activeTab.id]: rowIndex }))
          }
          onAddRow={addTableRow}
          onDeleteRow={deleteSelectedRow}
          onUndo={undoTableEdit}
          onCommitEdits={() => void commitTableEdits()}
          onRollbackEdits={() => void rollbackTableEdits()}
        />
      </div>

      <StatusBar
        activeConnection={activeConnection}
        sessionRuntime={activeRuntime}
        run={activeRun}
        running={running}
        appInfo={appInfo}
      />

      {scriptOpen && activeConnection && (
        <SqlScriptDialog
          dialect={activeConnection.input.type}
          onClose={() => setScriptOpen(false)}
          onExecute={executeDdlScript}
        />
      )}

      {settingsOpen && (
        <SettingsDialog
          settings={settings}
          userDataPath={appInfo?.userDataPath ?? null}
          onClose={() => setSettingsOpen(false)}
          onSave={saveAppSettings}
        />
      )}

      {connectionDialog && (
        <ConnectionDialog
          initial={connectionDialog.initial}
          editingId={connectionDialog.mode === 'edit' ? connectionDialog.id : undefined}
          passwordStored={connectionDialog.passwordStored}
          onClose={() => setConnectionDialog(null)}
          onSave={saveConnection}
        />
      )}

      {pendingDanger && (
        <DangerConfirmDialog
          sql={pendingDanger.sql}
          match={pendingDanger.match}
          onCancel={() => setPendingDanger(null)}
          onConfirm={() => {
            const pending = pendingDanger;
            setPendingDanger(null);
            void runQuery(pending.sql, undefined, undefined, { internal: true });
          }}
        />
      )}

      {tableDesignerOpen && activeConnection && (
        <TableDesigner
          dialect={activeConnection.input.type}
          onClose={() => setTableDesignerOpen(false)}
          onExecute={executeDdlSql}
        />
      )}

      {createViewOpen && activeConnection && (
        <CreateViewDialog
          dialect={activeConnection.input.type}
          onClose={() => setCreateViewOpen(false)}
          onExecute={executeDdlSql}
        />
      )}

      {exportOpen && activeConnection && activeRun.columns.length > 0 && (
        <ExportDialog
          dialect={activeConnection.input.type}
          columns={activeRun.columns}
          rows={activeRun.rows}
          onClose={() => setExportOpen(false)}
          onSave={saveExport}
          onSaveXlsx={saveExportXlsx}
          onLoadAll={loadAllForExport}
        />
      )}

      {historyOpen && (
        <HistoryDialog
          connections={connections}
          onClose={() => setHistoryOpen(false)}
          onInsert={(sql) => {
            updateSql(sql);
            setHistoryOpen(false);
            showNotice('info', '已插入历史 SQL，按 Ctrl+Enter 执行。');
          }}
          onRun={(sql) => {
            setHistoryOpen(false);
            updateSql(sql);
            void runQuery(sql);
          }}
        />
      )}

      {cellViewer && (
        <CellViewerDialog
          column={cellViewer.column}
          value={cellViewer.value}
          rowIndex={cellViewer.rowIndex}
          onClose={() => setCellViewer(null)}
        />
      )}

      {tableStructure && activeConnection && (
        <TableStructureDialog
          detail={tableStructure}
          dialect={activeConnection.input.type}
          onExecute={executeDdlSql}
          onClose={() => setTableStructure(null)}
        />
      )}

      {tableAction && activeConnection && (
        <TableActionDialog
          dialect={activeConnection.input.type}
          mode={tableAction.mode}
          name={tableAction.name}
          onClose={() => setTableAction(null)}
          onExecute={executeDdlSql}
        />
      )}

      {addColumnTarget && activeConnection && (
        <AddColumnDialog
          dialect={activeConnection.input.type}
          tableName={addColumnTarget}
          onClose={() => setAddColumnTarget(null)}
          onExecute={executeDdlSql}
        />
      )}

      {alterColumnTarget && activeConnection && (
        <AlterColumnDialog
          dialect={activeConnection.input.type}
          tableName={alterColumnTarget.table}
          mode={alterColumnTarget.mode}
          columns={alterColumnTarget.columns}
          detail={alterColumnTarget.detail}
          onClose={() => setAlterColumnTarget(null)}
          onExecute={executeDdlSql}
          onExecuteScript={executeDdlScript}
        />
      )}

      {indexAction && activeConnection && (
        <IndexDialog
          dialect={activeConnection.input.type}
          tableName={indexAction.table}
          mode={indexAction.mode}
          onClose={() => setIndexAction(null)}
          onExecute={executeDdlSql}
        />
      )}

      {dropColumnTarget && activeConnection && (
        <DropColumnDialog
          dialect={activeConnection.input.type}
          tableName={dropColumnTarget}
          onClose={() => setDropColumnTarget(null)}
          onExecute={executeDdlSql}
        />
      )}

      {notice && (
        <div className={`toast toast-${notice.kind}`} role="status">
          <span>{notice.text}</span>
          <button
            type="button"
            className="icon-btn"
            aria-label="关闭提示"
            onClick={() => setNotice(null)}
          >
            <Icon name="close" size={13} />
          </button>
        </div>
      )}
    </main>
  );
}
