import { useEffect, useRef, useState } from 'react';
import type { AppInfo, ConnectionInput, DatabaseType, SchemaObject } from '@shared/ipc-contract';
import { ConnectionDialog } from './features/connections/ConnectionDialog';
import { Icon } from './components/Icon';
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
  const [tabs, setTabs] = useState<QueryTab[]>([INITIAL_TAB]);
  const [activeTabId, setActiveTabId] = useState(INITIAL_TAB.id);
  const [sessions, setSessions] = useState<Record<string, SessionRuntime>>({});
  const [schemas, setSchemas] = useState<Record<string, SchemaObject[]>>({});
  const [schemaLoadingId, setSchemaLoadingId] = useState<string | null>(null);
  const [runs, setRuns] = useState<Record<string, RunState>>({});
  const [runningTabs, setRunningTabs] = useState<Record<string, boolean>>({});
  const [dialogOpen, setDialogOpen] = useState(false);
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  const tabCounter = useRef(2);
  const noticeTimer = useRef<number | null>(null);
  const runningRequests = useRef<Record<string, string>>({});

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

  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];
  const activeConnection =
    connections.find((connection) => connection.id === activeTab.connectionId) ?? null;
  const activeRuntime = sessions[activeTab.id] ?? null;
  const activeSchema = schemas[activeTab.id] ?? [];
  const activeRun = runs[activeTab.id] ?? EMPTY_RUN;
  const running = Boolean(runningTabs[activeTab.id]);

  const showNotice = (kind: Notice['kind'], text: string) => {
    setNotice({ id: Date.now(), kind, text });
    if (noticeTimer.current !== null) {
      window.clearTimeout(noticeTimer.current);
    }
    noticeTimer.current = window.setTimeout(() => setNotice(null), 6000);
  };

  const loadSchema = async (sessionId: string) => {
    const api = window.dbcraft;
    if (!api) return;

    setSchemaLoadingId(sessionId);
    try {
      const objects = await api.schema.get(sessionId);
      setSchemas((current) => ({ ...current, [sessionId]: objects }));
    } catch (error) {
      setSchemas((current) => ({ ...current, [sessionId]: [] }));
      showNotice('error', error instanceof Error ? error.message : '加载对象树失败。');
    } finally {
      setSchemaLoadingId((current) => (current === sessionId ? null : current));
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

  const openTabSession = async (tab: QueryTab, input: ConnectionInput): Promise<boolean> => {
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
      const result = await api.session.open(tab.id, input);
      if (result.ok) {
        setSessions((current) => ({
          ...current,
          [tab.id]: {
            status: 'ready',
            message: result.message,
            version: result.serverVersion,
          },
        }));
        void loadSchema(tab.id);
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

    if (activeTab.connectionId === connectionId) {
      if (sessions[activeTab.id]?.status === 'ready') return;
      void openTabSession(activeTab, connection.input);
      return;
    }

    const nextTab: QueryTab = { ...activeTab, connectionId };
    setTabs((current) => current.map((tab) => (tab.id === activeTab.id ? nextTab : tab)));
    setRuns((current) => {
      const next = { ...current };
      delete next[activeTab.id];
      return next;
    });

    void (async () => {
      await closeTabSession(activeTab.id);
      await openTabSession(nextTab, connection.input);
    })();
  };

  const runQuery = async () => {
    if (running) return;

    const tab = activeTab;
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

    const sql = tab.sql.trim();
    if (!sql) {
      showNotice('error', 'SQL 不能为空。');
      return;
    }

    let ready = sessions[tab.id]?.status === 'ready';
    if (!ready) {
      ready = await openTabSession(tab, connection.input);
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
      });

      if (response.ok) {
        setRuns((current) => ({
          ...current,
          [tab.id]: {
            ...response.result,
            executedAt: Date.now(),
            error: null,
          },
        }));
        if (response.result.truncated) {
          showNotice('info', `结果超过 ${response.result.rowCount} 行，已截断。`);
        }
      } else {
        setRuns((current) => ({
          ...current,
          [tab.id]: {
            ...(current[tab.id] ?? EMPTY_RUN),
            elapsedMs: 0,
            executedAt: Date.now(),
            error: response.error.message,
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

  const addTab = () => {
    const number = tabCounter.current;
    tabCounter.current += 1;

    const connection =
      connections.find((item) => item.id === activeTab.connectionId) ?? null;
    const tab: QueryTab = {
      id: `query-${number}`,
      title: `查询 ${number}`,
      sql: connection ? DEFAULT_SQL[connection.input.type] : 'SELECT 1;',
      connectionId: connection?.id ?? null,
    };

    setTabs((current) => [...current, tab]);
    setActiveTabId(tab.id);

    if (connection) {
      void openTabSession(tab, connection.input);
    }
  };

  const closeTab = (id: string) => {
    if (tabs.length <= 1) return;

    const index = tabs.findIndex((tab) => tab.id === id);
    if (index < 0) return;

    const next = tabs.filter((tab) => tab.id !== id);
    setTabs(next);
    void closeTabSession(id);
    setRuns((current) => {
      const copy = { ...current };
      delete copy[id];
      return copy;
    });

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
    if (sessions[activeTab.id]?.status === 'ready') {
      void loadSchema(activeTab.id);
    }
  };

  const openTable = (name: string) => {
    const quoted = `"${name.replace(/"/g, '""')}"`;
    updateSql(`SELECT * FROM ${quoted} LIMIT 100;`);
    showNotice('info', `已填入 ${name} 查询，按 Ctrl+Enter 执行。`);
  };

  const saveConnection = (input: ConnectionInput) => {
    const connection: SavedConnection = { id: createId('conn'), input };
    setConnections((current) => [...current, connection]);
    setDialogOpen(false);

    const nextTab: QueryTab = {
      ...activeTab,
      connectionId: connection.id,
      sql: DEFAULT_SQL[input.type],
    };
    setTabs((current) => current.map((tab) => (tab.id === activeTab.id ? nextTab : tab)));
    setRuns((current) => {
      const next = { ...current };
      delete next[activeTab.id];
      return next;
    });

    void (async () => {
      await closeTabSession(activeTab.id);
      await openTabSession(nextTab, input);
    })();
  };

  return (
    <main className="app-shell" data-testid="app-shell">
      <Toolbar
        connections={connections}
        activeConnectionId={activeTab.connectionId}
        onSelectConnection={rebindActiveTab}
        onNewConnection={() => setDialogOpen(true)}
      />

      <div className="app-body">
        <Sidebar
          connections={connections}
          activeConnectionId={activeTab.connectionId}
          activeConnection={activeConnection}
          schemaObjects={activeSchema}
          schemaLoading={schemaLoadingId === activeTab.id}
          onSelectConnection={rebindActiveTab}
          onNewConnection={() => setDialogOpen(true)}
          onRefreshSchema={refreshSchema}
          onOpenTable={openTable}
        />

        <Workspace
          tabs={tabs}
          activeTabId={activeTabId}
          run={activeRun}
          running={running}
          connectionType={activeConnection?.input.type ?? null}
          sessionRuntime={activeRuntime}
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
        sessionRuntime={activeRuntime}
        run={activeRun}
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
