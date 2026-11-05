import { useEffect, useMemo, useRef, useState } from 'react';
import type { AppInfo, ConnectionInput, DatabaseType, SchemaObject } from '@shared/ipc-contract';
import { ConnectionDialog } from './features/connections/ConnectionDialog';
import { Icon } from './components/Icon';
import { Sidebar } from './components/Sidebar';
import { StatusBar } from './components/StatusBar';
import { Toolbar } from './components/Toolbar';
import { Workspace } from './components/Workspace';
import type {
  ConnectionRuntime,
  Notice,
  QueryTab,
  RunState,
  SavedConnection,
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
};

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
};

function createId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export default function App() {
  const [connections, setConnections] = useState<SavedConnection[]>([]);
  const [activeConnectionId, setActiveConnectionId] = useState<string | null>(null);
  const [runtimes, setRuntimes] = useState<Record<string, ConnectionRuntime>>({});
  const [schemas, setSchemas] = useState<Record<string, SchemaObject[]>>({});
  const [schemaLoadingId, setSchemaLoadingId] = useState<string | null>(null);
  const [tabs, setTabs] = useState<QueryTab[]>([INITIAL_TAB]);
  const [activeTabId, setActiveTabId] = useState(INITIAL_TAB.id);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [run, setRun] = useState<RunState>(EMPTY_RUN);
  const [running, setRunning] = useState(false);
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  const tabCounter = useRef(2);
  const noticeTimer = useRef<number | null>(null);
  const runningRequestId = useRef<string | null>(null);

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

  useEffect(() => {
    return () => {
      if (noticeTimer.current !== null) {
        window.clearTimeout(noticeTimer.current);
      }
    };
  }, []);

  const activeConnection = useMemo(
    () => connections.find((connection) => connection.id === activeConnectionId) ?? null,
    [connections, activeConnectionId],
  );

  const activeRuntime = activeConnection ? (runtimes[activeConnection.id] ?? null) : null;
  const activeSchema = activeConnection ? (schemas[activeConnection.id] ?? []) : [];
  const activeSchemaLoading = activeConnection
    ? schemaLoadingId === activeConnection.id
    : false;
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];

  const showNotice = (kind: Notice['kind'], text: string) => {
    setNotice({ id: Date.now(), kind, text });
    if (noticeTimer.current !== null) {
      window.clearTimeout(noticeTimer.current);
    }
    noticeTimer.current = window.setTimeout(() => setNotice(null), 6000);
  };

  const loadSchema = async (connectionId: string) => {
    const api = window.dbcraft;
    if (!api) return;

    setSchemaLoadingId(connectionId);
    try {
      const objects = await api.schema.get(connectionId);
      setSchemas((current) => ({ ...current, [connectionId]: objects }));
    } catch (error) {
      setSchemas((current) => ({ ...current, [connectionId]: [] }));
      showNotice('error', error instanceof Error ? error.message : '加载对象树失败。');
    } finally {
      setSchemaLoadingId((current) => (current === connectionId ? null : current));
    }
  };

  const openSavedConnection = async (connection: SavedConnection) => {
    const api = window.dbcraft;
    if (!api) {
      setRuntimes((current) => ({
        ...current,
        [connection.id]: { status: 'error', message: 'IPC 未就绪' },
      }));
      showNotice('error', '未检测到 Electron IPC 桥接。');
      return;
    }

    setRuntimes((current) => ({
      ...current,
      [connection.id]: { status: 'connecting' },
    }));

    try {
      const result = await api.connection.open(connection.id, connection.input);
      if (result.ok) {
        setRuntimes((current) => ({
          ...current,
          [connection.id]: {
            status: 'connected',
            message: result.message,
            version: result.serverVersion,
          },
        }));
        showNotice('info', result.message);
        void loadSchema(connection.id);
      } else {
        setRuntimes((current) => ({
          ...current,
          [connection.id]: { status: 'error', message: result.message },
        }));
        showNotice('error', result.message);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setRuntimes((current) => ({
        ...current,
        [connection.id]: { status: 'error', message },
      }));
      showNotice('error', message);
    }
  };

  const selectConnection = (id: string) => {
    if (id !== activeConnectionId) {
      setRun(EMPTY_RUN);
    }
    setActiveConnectionId(id);

    const target = connections.find((connection) => connection.id === id);
    if (!target) return;

    const runtime = runtimes[id];
    if (runtime?.status === 'connected') {
      if (!schemas[id]) void loadSchema(id);
      return;
    }
    if (runtime?.status === 'connecting') return;
    void openSavedConnection(target);
  };

  const runQuery = async () => {
    if (running) return;

    const api = window.dbcraft;
    if (!api) {
      showNotice('error', '未检测到 Electron IPC 桥接。');
      return;
    }

    if (!activeConnection) {
      showNotice('error', '请先新建或选择一个连接。');
      return;
    }

    if (activeConnection.input.type === 'mssql') {
      showNotice('error', 'MSSQL 驱动将在后续里程碑接入。');
      return;
    }

    if (runtimes[activeConnection.id]?.status !== 'connected') {
      showNotice('error', '连接尚未就绪，请等待连接完成或重新连接。');
      return;
    }

    const sql = activeTab.sql.trim();
    if (!sql) {
      showNotice('error', 'SQL 不能为空。');
      return;
    }

    setRunning(true);
    const requestId = createId('query');
    runningRequestId.current = requestId;
    try {
      const response = await api.query.execute({
        requestId,
        connectionId: activeConnection.id,
        sql,
      });

      if (response.ok) {
        setRun({
          ...response.result,
          executedAt: Date.now(),
          error: null,
        });
        if (response.result.truncated) {
          showNotice('info', `结果超过 ${response.result.rowCount} 行，已截断。`);
        }
      } else {
        setRun((current) => ({
          ...current,
          elapsedMs: 0,
          executedAt: Date.now(),
          error: response.error.message,
        }));
        if (response.error.connectionClosed) {
          setRuntimes((current) => ({
            ...current,
            [activeConnection.id]: {
              status: 'error',
              message: response.error.message,
            },
          }));
        }
        showNotice('error', response.error.message);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setRun((current) => ({
        ...current,
        elapsedMs: 0,
        executedAt: Date.now(),
        error: message,
      }));
      showNotice('error', message);
    } finally {
      if (runningRequestId.current === requestId) {
        runningRequestId.current = null;
      }
      setRunning(false);
    }
  };

  const cancelQuery = async () => {
    const requestId = runningRequestId.current;
    if (!requestId) return;

    const api = window.dbcraft;
    if (!api) return;

    const canceled = await api.query.cancel(requestId);
    showNotice(
      canceled ? 'info' : 'error',
      canceled ? '已请求取消查询。' : '查询已结束或无法取消。',
    );
  };

  const addTab = () => {
    const number = tabCounter.current;
    tabCounter.current += 1;
    const tab: QueryTab = {
      id: `query-${number}`,
      title: `查询 ${number}`,
      sql: 'SELECT * FROM sqlite_master LIMIT 100;',
    };
    setTabs((current) => [...current, tab]);
    setActiveTabId(tab.id);
  };

  const closeTab = (id: string) => {
    if (tabs.length <= 1) return;

    const index = tabs.findIndex((tab) => tab.id === id);
    if (index < 0) return;

    const next = tabs.filter((tab) => tab.id !== id);
    setTabs(next);

    if (activeTabId === id) {
      const fallback = next[Math.max(0, index - 1)] ?? next[0];
      setActiveTabId(fallback.id);
    }
  };

  const updateSql = (value: string) => {
    setTabs((current) =>
      current.map((tab) => (tab.id === activeTabId ? { ...tab, sql: value } : tab)),
    );
  };

  const refreshSchema = () => {
    if (activeConnection) {
      void loadSchema(activeConnection.id);
    }
  };

  const openTable = (name: string) => {
    if (!activeConnection) return;
    const quoted = `"${name.replace(/"/g, '""')}"`;
    updateSql(`SELECT * FROM ${quoted} LIMIT 100;`);
    showNotice('info', `已填入 ${name} 查询，按 Ctrl+Enter 执行。`);
  };

  const saveConnection = (input: ConnectionInput) => {
    const connection: SavedConnection = { id: createId('conn'), input };
    setConnections((current) => [...current, connection]);
    setActiveConnectionId(connection.id);
    setRun(EMPTY_RUN);
    setDialogOpen(false);
    setTabs((current) =>
      current.map((tab) =>
        tab.id === activeTabId ? { ...tab, sql: DEFAULT_SQL[input.type] } : tab,
      ),
    );
    void openSavedConnection(connection);
  };

  return (
    <main className="app-shell" data-testid="app-shell">
      <Toolbar
        connections={connections}
        activeConnectionId={activeConnectionId}
        onSelectConnection={selectConnection}
        onNewConnection={() => setDialogOpen(true)}
      />

      <div className="app-body">
        <Sidebar
          connections={connections}
          activeConnectionId={activeConnectionId}
          activeConnection={activeConnection}
          schemaObjects={activeSchema}
          schemaLoading={activeSchemaLoading}
          onSelectConnection={selectConnection}
          onNewConnection={() => setDialogOpen(true)}
          onRefreshSchema={refreshSchema}
          onOpenTable={openTable}
        />

        <Workspace
          tabs={tabs}
          activeTabId={activeTabId}
          run={run}
          running={running}
          connectionType={activeConnection?.input.type ?? null}
          connectionRuntime={activeRuntime}
          onSelectTab={setActiveTabId}
          onCloseTab={closeTab}
          onAddTab={addTab}
          onSqlChange={updateSql}
          onRun={() => void runQuery()}
          onCancel={() => void cancelQuery()}
        />
      </div>

      <StatusBar
        activeConnection={activeConnection}
        connectionRuntime={activeRuntime}
        run={run}
        running={running}
        appInfo={appInfo}
      />

      {dialogOpen && (
        <ConnectionDialog onClose={() => setDialogOpen(false)} onSave={saveConnection} />
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
