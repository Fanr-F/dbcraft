import { useEffect, useMemo, useRef, useState } from 'react';
import type { AppInfo, ConnectionInput } from '@shared/ipc-contract';
import { ConnectionDialog } from './features/connections/ConnectionDialog';
import { Sidebar } from './components/Sidebar';
import { StatusBar } from './components/StatusBar';
import { Toolbar } from './components/Toolbar';
import { Workspace } from './components/Workspace';
import { createDemoRows } from './data/mock';
import type { QueryTab, RunState, SavedConnection } from './types';

const DEMO_ROWS = createDemoRows(500);

const INITIAL_SQL = `SELECT id, name, email, status, created_at, amount, note
FROM demo_users
ORDER BY id
LIMIT 500;`;

const INITIAL_TAB: QueryTab = {
  id: 'query-1',
  title: '查询 1',
  sql: INITIAL_SQL,
};

const INITIAL_RUN: RunState = {
  rows: DEMO_ROWS,
  elapsedMs: 12,
  executedAt: null,
  simulated: true,
};

function createId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export default function App() {
  const [connections, setConnections] = useState<SavedConnection[]>([]);
  const [activeConnectionId, setActiveConnectionId] = useState<string | null>(null);
  const [tabs, setTabs] = useState<QueryTab[]>([INITIAL_TAB]);
  const [activeTabId, setActiveTabId] = useState(INITIAL_TAB.id);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [run, setRun] = useState<RunState>(INITIAL_RUN);
  const [running, setRunning] = useState(false);
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);

  const tabCounter = useRef(2);
  const runTimer = useRef<number | null>(null);

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
      if (runTimer.current !== null) {
        window.clearTimeout(runTimer.current);
      }
    };
  }, []);

  const activeConnection = useMemo(
    () => connections.find((connection) => connection.id === activeConnectionId) ?? null,
    [connections, activeConnectionId],
  );

  const runQuery = () => {
    if (running) return;
    setRunning(true);
    runTimer.current = window.setTimeout(() => {
      setRun({
        rows: DEMO_ROWS,
        elapsedMs: 180 + Math.round(Math.random() * 320),
        executedAt: Date.now(),
        simulated: true,
      });
      setRunning(false);
      runTimer.current = null;
    }, 420);
  };

  const addTab = () => {
    const number = tabCounter.current;
    tabCounter.current += 1;
    const tab: QueryTab = {
      id: `query-${number}`,
      title: `查询 ${number}`,
      sql: 'SELECT * FROM demo_users LIMIT 100;',
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

  const saveConnection = (input: ConnectionInput) => {
    const connection: SavedConnection = { id: createId('conn'), input };
    setConnections((current) => [...current, connection]);
    setActiveConnectionId(connection.id);
    setDialogOpen(false);
  };

  return (
    <main className="app-shell" data-testid="app-shell">
      <Toolbar
        connections={connections}
        activeConnectionId={activeConnectionId}
        onSelectConnection={setActiveConnectionId}
        onNewConnection={() => setDialogOpen(true)}
      />

      <div className="app-body">
        <Sidebar
          connections={connections}
          activeConnectionId={activeConnectionId}
          activeConnection={activeConnection}
          onSelectConnection={setActiveConnectionId}
          onNewConnection={() => setDialogOpen(true)}
        />

        <Workspace
          tabs={tabs}
          activeTabId={activeTabId}
          run={run}
          running={running}
          connectionType={activeConnection?.input.type ?? null}
          onSelectTab={setActiveTabId}
          onCloseTab={closeTab}
          onAddTab={addTab}
          onSqlChange={updateSql}
          onRun={runQuery}
        />
      </div>

      <StatusBar
        activeConnection={activeConnection}
        run={run}
        running={running}
        appInfo={appInfo}
      />

      {dialogOpen && (
        <ConnectionDialog onClose={() => setDialogOpen(false)} onSave={saveConnection} />
      )}
    </main>
  );
}
