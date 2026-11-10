import { useEffect, useMemo, useRef, useState } from 'react';
import { DATABASE_TYPE_LABELS, ENVIRONMENT_LABELS } from '@shared/ipc-contract';
import type {
  AgentJobSummary,
  ConnectionInput,
  DatabaseInfo,
  DdlObjectKind,
  SchemaObject,
  TableExtras,
} from '@shared/ipc-contract';
import { agentRunStatusLabel } from '@shared/agent';
import { serverDisplayName, serverKey, serverTypeLabel } from '@shared/server-identity';
import type { SavedConnection, SessionStatus } from '../types';
import { buildGroupTree, countGroup, type GroupNode } from '../utils/groups';
import { ContextMenu } from './ContextMenu';
import { Icon } from './Icon';
import { ObjectTree } from './ObjectTree';

interface SidebarProps {
  connections: SavedConnection[];
  activeConnectionId: string | null;
  activeConnection: SavedConnection | null;
  connectionStates: Record<string, SessionStatus>;
  activeSessionStatus: SessionStatus;
  schemaObjects: SchemaObject[];
  databases: DatabaseInfo[];
  objectsByDatabase: Record<string, SchemaObject[]>;
  currentDatabase: string | null;
  databaseLoading: string | null;
  tableExtras: Record<string, TableExtras>;
  tableExtrasLoadingKey: string | null;
  schemaLoading: boolean;
  showSystemObjects: boolean;
  systemObjectsSupported: boolean;
  sessionReadOnly: boolean;
  /** 编辑/删除保存连接后收起该连接的对象树。 */
  collapseSignal?: { connectionId: string; token: number } | null;
  /** 独立 browse session：左侧对象树不再依赖当前 tab。 */
  browseConnectionId: string | null;
  browseSessionStatus: SessionStatus;
  browseSchemaObjects: SchemaObject[];
  browseDatabases: DatabaseInfo[];
  browseObjectsByDatabase: Record<string, SchemaObject[]>;
  browseCurrentDatabase: string | null;
  browseDatabaseLoading: string | null;
  browseTableExtras: Record<string, TableExtras>;
  browseTableExtrasLoadingKey: string | null;
  browseSchemaLoading: boolean;
  browseShowSystemObjects: boolean;
  onOpenBrowseConnection: (id: string) => void;
  onCloseBrowseConnection: (id: string) => void;
  onRefreshBrowse: () => void;
  onToggleBrowseSystemObjects: (next: boolean) => void;
  onSelectBrowseDatabase: (database: string) => void;
  onLoadBrowseDatabase: (database: string) => void;
  onLoadBrowseTableExtras: (database: string, table: string) => void;
  onOpenTableInBrowse: (connectionId: string, name: string, database?: string) => void;
  onOpenTableDataInBrowse: (
    connectionId: string,
    name: string,
    kind: 'table' | 'view',
    database?: string,
  ) => void;
  onOpenProcedureInBrowse: (connectionId: string, name: string, database?: string) => void;
  onEnsureConnectionTab: (connectionId: string) => Promise<boolean> | boolean;
  onSelectConnection: (id: string) => void;
  onNewConnection: () => void;
  onRefreshSchema: () => void;
  onToggleSystemObjects: (next: boolean) => void;
  onSelectDatabase: (database: string) => void;
  onLoadTableExtras: (database: string, table: string) => void;
  onOpenTable: (name: string, database?: string) => void;
  onOpenTableData: (name: string, kind: 'table' | 'view', database?: string) => void;
  onOpenProcedure: (name: string, database?: string) => void;
  onDeleteConnection: (id: string) => void;
  onEditConnection: (id: string) => void;
  onDuplicateConnection: (id: string) => void;
  onDisconnectConnection: (id: string) => void;
  onNewQueryForConnection: (id: string) => void;
  onRenameGroup: (oldPath: string, newPath: string) => void;
  onDeleteGroup: (path: string) => void;
  onMoveConnection: (id: string, group: string) => void;
  onViewDdl: (name: string, kind: DdlObjectKind, database?: string) => void;
  onCopyDdl: (name: string, kind: DdlObjectKind, database?: string) => void;
  onRenameTable: (name: string, database?: string) => void;
  onDropTable: (name: string, database?: string) => void;
  onDropView: (name: string, database?: string) => void;
  onAddColumn: (name: string, database?: string) => void;
  onRenameColumn: (name: string, database?: string) => void;
  onModifyColumn: (name: string, database?: string) => void;
  onShowStructure: (name: string, database?: string) => void;
  onEditStructure: (name: string, database?: string) => void;
  onCreateIndex: (name: string, database?: string) => void;
  onDropIndex: (name: string, database?: string) => void;
  onDropColumn: (name: string, database?: string) => void;
  onNewTable: (schema?: string) => void;
  onNewView: () => void;
  onRunScript: () => void;
  onGenerateDatabaseDdl: (connectionId: string) => void;
  onExportConnection: (connectionId: string) => void;
  onExportAllConnections: () => void;
  onImportConnections: () => void;
  /** MSSQL 连接下显示 SQL Server Agent 入口。 */
  agentAvailable: boolean;
  /** 当前活动会话的作业缓存；null 表示还没展开加载过。 */
  agentJobs: AgentJobSummary[] | null;
  agentJobsLoading: boolean;
  agentJobsError: string | null;
  /** 当前详情页签对应的作业名，用于树中高亮。 */
  activeAgentJob: string | null;
  onLoadAgentJobs: () => void;
  onOpenAgentJob: (jobName: string) => void;
}

function fileName(filePath: string): string {
  return filePath.split(/[\\/]/).pop() || filePath;
}

function summarize(input: ConnectionInput): string {
  if (input.type === 'sqlite') return fileName(input.filePath);
  return input.database || '未选择数据库';
}

function searchText(connection: SavedConnection): string {
  const input = connection.input;
  const parts = [input.name, input.group, DATABASE_TYPE_LABELS[input.type]];
  if (input.type === 'sqlite') {
    parts.push(input.filePath);
  } else {
    parts.push(input.host, String(input.port), input.database);
  }
  return parts.join(' ').toLowerCase();
}

export function Sidebar({
  connections,
  activeConnectionId,
  connectionStates,
  activeSessionStatus,
  schemaObjects,
  databases,
  objectsByDatabase,
  sessionReadOnly,
  collapseSignal,
  browseConnectionId,
  browseSessionStatus,
  browseSchemaObjects,
  browseDatabases,
  browseObjectsByDatabase,
  browseCurrentDatabase,
  browseDatabaseLoading,
  browseTableExtras,
  browseTableExtrasLoadingKey,
  browseSchemaLoading,
  browseShowSystemObjects,
  onOpenBrowseConnection,
  onCloseBrowseConnection,
  onRefreshBrowse,
  onToggleBrowseSystemObjects,
  onSelectBrowseDatabase,
  onLoadBrowseDatabase,
  onLoadBrowseTableExtras,
  onOpenTableInBrowse,
  onOpenTableDataInBrowse,
  onOpenProcedureInBrowse,
  onEnsureConnectionTab,
  onNewConnection,
  onOpenTable,
  onDeleteConnection,
  onEditConnection,
  onDuplicateConnection,
  onDisconnectConnection,
  onNewQueryForConnection,
  onRenameGroup,
  onDeleteGroup,
  onMoveConnection,
  onViewDdl,
  onCopyDdl,
  onRenameTable,
  onDropTable,
  onDropView,
  onAddColumn,
  onRenameColumn,
  onModifyColumn,
  onShowStructure,
  onEditStructure,
  onCreateIndex,
  onDropIndex,
  onDropColumn,
  onNewTable,
  onNewView,
  onRunScript,
  onGenerateDatabaseDdl,
  onExportConnection,
  onExportAllConnections,
  onImportConnections,
  agentAvailable,
  agentJobs,
  agentJobsLoading,
  agentJobsError,
  activeAgentJob,
  onLoadAgentJobs,
  onOpenAgentJob,
}: SidebarProps) {
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [collapsedServers, setCollapsedServers] = useState<Record<string, boolean>>({});
  const [expandedConnections, setExpandedConnections] = useState<Record<string, boolean>>({});
  useEffect(() => {
    if (!collapseSignal) return;
    setExpandedConnections((current) => ({
      ...current,
      [collapseSignal.connectionId]: false,
    }));
  }, [collapseSignal?.token]);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    tables: true,
    views: true,
    agent: true,
    jobs: false,
  });
  const [selectedAgentJob, setSelectedAgentJob] = useState<string | null>(null);
  const toggleSection = (key: string) => {
    const willExpand = !expandedSections[key];
    setExpandedSections((current) => ({ ...current, [key]: willExpand }));
    if (key === 'jobs' && willExpand) onLoadAgentJobs();
  };

  // 切换标签/连接后，若作业树仍处于展开状态，自动加载新会话的作业。
  useEffect(() => {
    if (agentAvailable && expandedSections.jobs && agentJobs === null && !agentJobsLoading) {
      onLoadAgentJobs();
    }
    // onLoadAgentJobs 每次渲染都是新函数；仅依赖影响加载条件的状态。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentAvailable, expandedSections.jobs, agentJobs, agentJobsLoading, activeConnectionId]);

  const loadAgentJobsRef = useRef(onLoadAgentJobs);
  useEffect(() => {
    loadAgentJobsRef.current = onLoadAgentJobs;
  }, [onLoadAgentJobs]);

  // 作业树展开时每 30 秒刷新一次，避免作业状态长期停留在旧值。
  useEffect(() => {
    if (!agentAvailable || !expandedSections.jobs) return;
    const timer = window.setInterval(() => loadAgentJobsRef.current(), 30_000);
    return () => window.clearInterval(timer);
  }, [agentAvailable, expandedSections.jobs, activeConnectionId]);

  const [treeQuery, setTreeQuery] = useState('');
  const [renaming, setRenaming] = useState<{ path: string; value: string } | null>(null);
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    connection: SavedConnection;
  } | null>(null);
  const [groupMenu, setGroupMenu] = useState<{
    x: number;
    y: number;
    path: string;
    name: string;
  } | null>(null);
  const [objectMenu, setObjectMenu] = useState<{
    x: number;
    y: number;
    name: string;
    kind: DdlObjectKind;
    database?: string;
    schema?: string;
  } | null>(null);

  const normalizedQuery = treeQuery.trim().toLowerCase();
  const matchesName = (name: string) => name.toLowerCase().includes(normalizedQuery);
  const activeObjectMatches =
    normalizedQuery.length > 0 &&
    (databases.some((database) => matchesName(database.name)) ||
      [...Object.values(objectsByDatabase).flat(), ...schemaObjects].some((object) =>
        matchesName(object.name),
      ) ||
      (agentJobs ?? []).some((job) => matchesName(job.name)));
  const browseObjectMatches =
    normalizedQuery.length > 0 &&
    (browseDatabases.some((database) => matchesName(database.name)) ||
      [
        ...Object.values(browseObjectsByDatabase).flat(),
        ...browseSchemaObjects,
      ].some((object) => matchesName(object.name)));

  const filteredConnections = normalizedQuery
    ? connections.filter(
        (connection) =>
          searchText(connection).includes(normalizedQuery) ||
          (connection.id === activeConnectionId && activeObjectMatches) ||
          (connection.id === browseConnectionId &&
            (browseObjectMatches || normalizedQuery.length > 0)),
      )
    : connections;

  const filteredJobs = (agentJobs ?? []).filter(
    (job) => normalizedQuery.length === 0 || matchesName(job.name),
  );

  const tree = useMemo(() => buildGroupTree(filteredConnections), [filteredConnections]);
  const hasGroups = filteredConnections.some(
    (connection) => connection.input.group.trim().length > 0,
  );

  const toggleGroup = (path: string) => {
    setCollapsedGroups((current) => ({ ...current, [path]: !current[path] }));
  };

  const commitRename = () => {
    const current = renaming;
    if (!current) return;
    const value = current.value.trim();
    setRenaming(null);

    if (!value || value === current.path.split('/').pop()) return;
    if (value.includes('/')) {
      window.alert('分组名不能包含 “/”；多级分组请在新建连接时用 “/” 分隔填写。');
      return;
    }

    const parent = current.path.split('/').slice(0, -1).join('/');
    onRenameGroup(current.path, parent ? `${parent}/${value}` : value);
  };

  const isConnectionExpanded = (connection: SavedConnection) =>
    expandedConnections[connection.id] ??
    (connection.id === activeConnectionId || connection.id === browseConnectionId);

  const expandConnection = (connection: SavedConnection) => {
    setExpandedConnections((current) => ({ ...current, [connection.id]: true }));
    onOpenBrowseConnection(connection.id);
  };

  const renderAgentSection = () => (
    <div className="agent-tree">
      <button
        type="button"
        className="tree-row tree-item"
        aria-expanded={expandedSections.agent}
        title="SQL Server Agent 作业（监控 + 启停/启用/禁用）"
        onClick={() => toggleSection('agent')}
      >
        <Icon
          name="chevron"
          size={12}
          className={expandedSections.agent ? 'chevron' : 'chevron collapsed'}
        />
        <Icon name="play" size={14} />
        <span>SQL Server Agent</span>
      </button>

      {expandedSections.agent && (
        <>
          <button
            type="button"
            className="tree-row tree-item tree-child"
            aria-expanded={expandedSections.jobs}
            title="展开/收起作业列表"
            onClick={() => toggleSection('jobs')}
          >
            <Icon
              name="chevron"
              size={12}
              className={expandedSections.jobs ? 'chevron' : 'chevron collapsed'}
            />
            <Icon name="folder" size={14} />
            <span>作业</span>
            <span className="tree-count">
              {agentJobsLoading ? '…' : agentJobs ? filteredJobs.length : ''}
            </span>
          </button>

          {expandedSections.jobs &&
            (agentJobsLoading ? (
              <div className="tree-empty tree-child-2">正在加载作业…</div>
            ) : agentJobsError ? (
              <div
                className="tree-empty tree-child-2 tree-error-text"
                title={agentJobsError}
              >
                {agentJobsError}
              </div>
            ) : !agentJobs ? (
              <div className="tree-empty tree-child-2">展开后加载作业</div>
            ) : filteredJobs.length === 0 ? null : (
              filteredJobs.map((job) => (
                <button
                  key={job.jobId}
                  type="button"
                  className={`tree-row tree-item tree-child-2 agent-job ${
                    activeAgentJob === job.name || selectedAgentJob === job.name
                      ? 'is-active'
                      : ''
                  }`}
                  title={`${job.enabled ? '已启用' : '已禁用'} · 上次：${
                    job.lastRunAt ?? '从未运行'
                  } · ${agentRunStatusLabel(job.lastRunStatus)}${
                    job.multiServer ? ' · 多服务器' : ''
                  }；单击选中，双击打开详情`}
                  onClick={() => setSelectedAgentJob(job.name)}
                  onDoubleClick={() => onOpenAgentJob(job.name)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') onOpenAgentJob(job.name);
                  }}
                >
                  <span className={`agent-job-dot ${job.enabled ? 'is-on' : 'is-off'}`} />
                  <span>{job.name}</span>
                  {job.multiServer && <span className="agent-job-tag">MSX</span>}
                  {!job.enabled && <span className="agent-job-tag">禁用</span>}
                </button>
              ))
            ))}
        </>
      )}
    </div>
  );

  const renderConnection = (connection: SavedConnection) => {
    const active = connection.id === activeConnectionId;
    const browsing = connection.id === browseConnectionId;
    const expanded = isConnectionExpanded(connection);
    const state = browsing ? browseSessionStatus : (connectionStates[connection.id] ?? 'closed');
    const browseCanManage = browsing && connection.id === activeConnectionId;
    const browseSystemSupported =
      connection.input.type === 'sqlite' || connection.input.type === 'mssql';
    const stateLabel =
      state === 'ready'
        ? '已连接'
        : state === 'opening'
          ? '连接中'
          : state === 'error'
            ? '连接失败'
            : '未连接';

    return (
      <div className="connection-branch" key={connection.id}>
        <div
          className="connection-row"
          draggable
          onDragStart={(event) => {
            event.dataTransfer.setData('text/plain', connection.id);
            event.dataTransfer.effectAllowed = 'move';
          }}
          onDragOver={(event) => {
            event.preventDefault();
            event.dataTransfer.dropEffect = 'move';
          }}
          onDrop={(event) => {
            event.preventDefault();
            event.stopPropagation();
            const draggedId = event.dataTransfer.getData('text/plain');
            if (draggedId && draggedId !== connection.id) {
              onMoveConnection(draggedId, connection.input.group);
            }
          }}
        >
          <button
            type="button"
            className="connection-expand"
            aria-label={`${expanded ? '收起' : '展开'} ${connection.input.name} 的对象`}
            aria-expanded={expanded}
            title={expanded ? '收起对象' : '展开对象'}
            onClick={(event) => {
              event.stopPropagation();
              if (expanded) {
                setExpandedConnections((current) => ({ ...current, [connection.id]: false }));
                onCloseBrowseConnection(connection.id);
              } else {
                expandConnection(connection);
              }
            }}
          >
            <Icon
              name="chevron"
              size={11}
              className={expanded ? 'chevron' : 'chevron collapsed'}
            />
          </button>
          <button
            type="button"
            className={`connection-item ${active || browsing ? 'is-active' : ''}`}
            title="右键查看更多操作"
            onClick={() => expandConnection(connection)}
            onDoubleClick={(event) => {
              event.stopPropagation();
              expandConnection(connection);
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setMenu({ x: event.clientX, y: event.clientY, connection });
            }}
          >
            <span className={`db-dot db-${connection.input.type}`} />
            <span className="connection-meta">
              <span className="connection-name">{connection.input.name}</span>
              <span className="connection-sub">
                {connection.serverName ? `${connection.serverName} · ` : ''}
                {DATABASE_TYPE_LABELS[connection.input.type]} · {summarize(connection.input)}
              </span>
            </span>
            <span
              className={`connection-state is-${state}`}
              title={stateLabel}
              aria-label={stateLabel}
            />
            <span className={`env-badge env-${connection.input.env}`}>
              {ENVIRONMENT_LABELS[connection.input.env]}
            </span>
          </button>
          <button
            type="button"
            className="connection-delete"
            title={`删除连接「${connection.input.name}」`}
            aria-label={`删除连接 ${connection.input.name}`}
            onClick={(event) => {
              event.stopPropagation();
              onDeleteConnection(connection.id);
            }}
          >
            <Icon name="close" size={12} />
          </button>
        </div>

        {browsing && expanded && browseSessionStatus !== 'ready' && (
          <div className="connection-objects">
            <div className="tree-empty">
              {browseSessionStatus === 'opening'
                ? '正在连接…'
                : browseSessionStatus === 'error'
                  ? '连接失败'
                  : '未连接'}
            </div>
          </div>
        )}

        {browsing && expanded && browseSessionStatus === 'ready' && (
          <div className="connection-objects">
            <div className="connection-object-actions">
              <button
                type="button"
                className="icon-btn"
                title={sessionReadOnly ? '当前为只读会话，无法建表' : '新建表'}
                onClick={() => {
                  if (browseCanManage) {
                    onNewTable();
                  } else {
                    void Promise.resolve(onEnsureConnectionTab(connection.id)).then((ok) => {
                      if (ok) onNewTable();
                    });
                  }
                }}
                disabled={sessionReadOnly}
              >
                <Icon name="plus" size={14} />
              </button>
              <button
                type="button"
                className="icon-btn"
                title={sessionReadOnly ? '当前为只读会话，无法建视图' : '新建视图'}
                onClick={() => {
                  if (browseCanManage) {
                    onNewView();
                  } else {
                    void Promise.resolve(onEnsureConnectionTab(connection.id)).then((ok) => {
                      if (ok) onNewView();
                    });
                  }
                }}
                disabled={sessionReadOnly}
              >
                <Icon name="view" size={14} />
              </button>
              <button
                type="button"
                className="icon-btn"
                title="执行 SQL 脚本（多语句）"
                onClick={() => {
                  if (browseCanManage) {
                    onRunScript();
                  } else {
                    void Promise.resolve(onEnsureConnectionTab(connection.id)).then((ok) => {
                      if (ok) onRunScript();
                    });
                  }
                }}
                disabled={
                  connection.input.type === 'mssql' ||
                  sessionReadOnly
                }
              >
                <Icon name="script" size={14} />
              </button>
              <button
                type="button"
                className="icon-btn"
                title="刷新对象"
                onClick={onRefreshBrowse}
                disabled={browseSchemaLoading}
              >
                <Icon name="refresh" size={14} />
              </button>
            </div>

            <label
              className={`tree-row tree-toggle ${browseSystemSupported ? '' : 'is-disabled'}`}
              title={
                browseSystemSupported
                  ? '显示或隐藏数据库系统对象（如 sqlite_*、sys.*、master/msdb 系统表）'
                  : '当前连接类型没有可显示的系统对象'
              }
            >
              <input
                type="checkbox"
                checked={browseShowSystemObjects}
                disabled={!browseSystemSupported || browseSchemaLoading}
                onChange={(event) => onToggleBrowseSystemObjects(event.target.checked)}
              />
              <span>显示系统对象</span>
            </label>

            <ObjectTree
              dialect={connection.input.type}
              query={treeQuery}
              databases={browseDatabases}
              currentDatabase={browseCurrentDatabase}
              objectsByDatabase={browseObjectsByDatabase}
              schemaObjects={browseSchemaObjects}
              loadingDatabase={browseDatabaseLoading}
              loading={browseSchemaLoading}
              tableExtras={browseTableExtras}
              tableExtrasLoadingKey={browseTableExtrasLoadingKey}
              onSelectDatabase={onSelectBrowseDatabase}
              onLoadDatabase={onLoadBrowseDatabase}
              onLoadTableExtras={onLoadBrowseTableExtras}
              onOpenTable={(name, database) =>
                onOpenTableInBrowse(connection.id, name, database)
              }
              onOpenTableData={(name, kind, database) =>
                onOpenTableDataInBrowse(connection.id, name, kind, database)
              }
              onOpenProcedure={(name, database) =>
                onOpenProcedureInBrowse(connection.id, name, database)
              }
              onTableContextMenu={(event, name, kind, database, schema) => {
                const position = { x: event.clientX, y: event.clientY };
                const showMenu = () => {
                  setObjectMenu({
                    x: position.x,
                    y: position.y,
                    name,
                    kind,
                    ...(database ? { database } : {}),
                    ...(schema ? { schema } : {}),
                  });
                };
                if (browseCanManage) {
                  showMenu();
                  return;
                }
                void Promise.resolve(onEnsureConnectionTab(connection.id)).then((ok) => {
                  if (ok) showMenu();
                });
              }}
            />

            {browseCanManage && agentAvailable && renderAgentSection()}
          </div>
        )}
      </div>
    );
  };

  const renderGroupHeader = (node: GroupNode, depth: number, editable: boolean) => {
    const collapsed =
      normalizedQuery.length === 0 && Boolean(collapsedGroups[node.path]);

    return (
      <div
        className="connection-group-head"
        style={{ paddingLeft: 8 + depth * 12 }}
        role="button"
        tabIndex={0}
        aria-expanded={!collapsed}
        onClick={() => toggleGroup(node.path)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            toggleGroup(node.path);
          }
        }}
        onContextMenu={
          editable
            ? (event) => {
                event.preventDefault();
                event.stopPropagation();
                setGroupMenu({
                  x: event.clientX,
                  y: event.clientY,
                  path: node.path,
                  name: node.name,
                });
              }
            : undefined
        }
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = 'move';
        }}
        onDrop={(event) => {
          event.preventDefault();
          event.stopPropagation();
          const draggedId = event.dataTransfer.getData('text/plain');
          if (draggedId) onMoveConnection(draggedId, node.path);
        }}
      >
        <Icon
          name="chevron"
          size={12}
          className={collapsed ? 'chevron collapsed' : 'chevron'}
        />

        {renaming?.path === node.path ? (
          <input
            className="group-rename"
            autoFocus
            value={renaming.value}
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => setRenaming({ path: node.path, value: event.target.value })}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === 'Enter') commitRename();
              if (event.key === 'Escape') setRenaming(null);
            }}
            onBlur={() => setRenaming(null)}
          />
        ) : (
          <span>{node.name}</span>
        )}

        <span className="tree-count">{countGroup(node)}</span>
      </div>
    );
  };

  const renderGroupNode = (node: GroupNode, depth: number) => {
    const collapsed =
      normalizedQuery.length === 0 && Boolean(collapsedGroups[node.path]);

    return (
      <div className="connection-group" key={node.path}>
        {renderGroupHeader(node, depth, true)}
        {!collapsed && (
          <>
            {renderServerGroups(node.connections, depth + 1)}
            {node.children.map((child) => renderGroupNode(child, depth + 1))}
          </>
        )}
      </div>
    );
  };

  const renderServerGroups = (list: SavedConnection[], depth: number) => {
    const groups = new Map<
      string,
      { key: string; name: string; type: string; connections: SavedConnection[] }
    >();
    for (const connection of list) {
      const key = connection.serverId ?? serverKey(connection.input);
      const existing = groups.get(key);
      if (existing) {
        existing.connections.push(connection);
      } else {
        groups.set(key, {
          key,
          name: connection.serverName ?? serverDisplayName(connection.input),
          type: serverTypeLabel(connection.input),
          connections: [connection],
        });
      }
    }

    return Array.from(groups.values()).map((server) => {
      const collapsed = normalizedQuery.length === 0 && Boolean(collapsedServers[server.key]);
      return (
        <div className="connection-server" key={server.key}>
          <div
            className="connection-server-head"
            style={{ paddingLeft: 8 + depth * 12 }}
            role="button"
            tabIndex={0}
            aria-expanded={!collapsed}
            title={`${server.type} · ${server.name}`}
            onClick={() =>
              setCollapsedServers((current) => ({
                ...current,
                [server.key]: !current[server.key],
              }))
            }
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                setCollapsedServers((current) => ({
                  ...current,
                  [server.key]: !current[server.key],
                }));
              }
            }}
          >
            <Icon
              name="chevron"
              size={11}
              className={collapsed ? 'chevron collapsed' : 'chevron'}
            />
            <span className="connection-server-name">{server.name}</span>
            <span className="connection-server-type">{server.type}</span>
            <span className="tree-count">{server.connections.length}</span>
          </div>
          {!collapsed && server.connections.map((connection) => renderConnection(connection))}
        </div>
      );
    });
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-heading">
        <span>连接</span>
        <button type="button" className="icon-btn" title="新建连接" onClick={onNewConnection}>
          <Icon name="plus" size={15} />
        </button>
      </div>

      {connections.length === 0 ? (
        <div className="sidebar-empty">
          <Icon name="plug" size={20} />
          <p>还没有连接</p>
          <button type="button" className="btn btn-ghost" onClick={onNewConnection}>
            新建第一个连接
          </button>
        </div>
      ) : (
        <>
          <div className="sidebar-search">
            <Icon name="search" size={13} />
            <input
              value={treeQuery}
              placeholder="搜索连接 / 表 / 视图 / 作业…"
              aria-label="搜索连接和对象"
              onChange={(event) => setTreeQuery(event.target.value)}
            />
          </div>

          <div className="sidebar-tree-scroll">
            {filteredConnections.length === 0 ? (
              <div className="sidebar-empty compact">
                <p>没有匹配的连接或对象</p>
              </div>
            ) : hasGroups ? (
              <>
                {tree.connections.length > 0 && (
                  <div className="connection-group">
                    <div
                      className="connection-group-head is-ungrouped"
                      role="button"
                      tabIndex={0}
                      aria-expanded={!(normalizedQuery.length === 0 && collapsedGroups[''])}
                      onClick={() => toggleGroup('')}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          toggleGroup('');
                        }
                      }}
                      onDragOver={(event) => {
                        event.preventDefault();
                        event.dataTransfer.dropEffect = 'move';
                      }}
                      onDrop={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        const draggedId = event.dataTransfer.getData('text/plain');
                        if (draggedId) onMoveConnection(draggedId, '');
                      }}
                    >
                      <Icon
                        name="chevron"
                        size={12}
                        className={
                          normalizedQuery.length === 0 && collapsedGroups['']
                            ? 'chevron collapsed'
                            : 'chevron'
                        }
                      />
                      <span>未分组</span>
                      <span className="tree-count">{tree.connections.length}</span>
                    </div>
                    {!(normalizedQuery.length === 0 && collapsedGroups['']) &&
                      renderServerGroups(tree.connections, 1)}
                  </div>
                )}
                {tree.children.map((child) => renderGroupNode(child, 0))}
              </>
            ) : (
              renderServerGroups(filteredConnections, 0)
            )}
          </div>
        </>
      )}

      <div className="sidebar-footer">
        <span className="muted">M1 · SQLite / MySQL 系 / MSSQL</span>
      </div>

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            {
              label: '编辑连接',
              onSelect: () => onEditConnection(menu.connection.id),
            },
            {
              label: '复制连接',
              onSelect: () => onDuplicateConnection(menu.connection.id),
            },
            {
              label: '查询',
              onSelect: () => onNewQueryForConnection(menu.connection.id),
            },
            {
              label: '新建表…',
              disabled:
                menu.connection.id !== activeConnectionId || activeSessionStatus !== 'ready',
              onSelect: () => onNewTable(),
            },
            {
              label: '生成库级 DDL',
              disabled: menu.connection.id !== activeConnectionId,
              onSelect: () => onGenerateDatabaseDdl(menu.connection.id),
            },
            {
              label: '导出连接配置',
              onSelect: () => onExportConnection(menu.connection.id),
            },
            {
              label: '导出全部连接',
              onSelect: onExportAllConnections,
            },
            {
              label: '导入连接…',
              onSelect: onImportConnections,
            },
            {
              label: '断开连接',
              onSelect: () => onDisconnectConnection(menu.connection.id),
            },
            {
              label: '移到未分组',
              disabled: menu.connection.input.group.trim().length === 0,
              onSelect: () => onMoveConnection(menu.connection.id, ''),
            },
            {
              label: '删除连接',
              danger: true,
              onSelect: () => onDeleteConnection(menu.connection.id),
            },
          ]}
        />
      )}

      {groupMenu && (
        <ContextMenu
          x={groupMenu.x}
          y={groupMenu.y}
          onClose={() => setGroupMenu(null)}
          items={[
            {
              label: '重命名分组',
              onSelect: () => setRenaming({ path: groupMenu.path, value: groupMenu.name }),
            },
            {
              label: '删除分组',
              danger: true,
              onSelect: () => {
                if (
                  window.confirm(
                    `删除分组「${groupMenu.name}」？组内连接会移到「未分组」，连接本身不会被删除。`,
                  )
                ) {
                  onDeleteGroup(groupMenu.path);
                }
              },
            },
          ]}
        />
      )}

      {objectMenu && (
        <ContextMenu
          x={objectMenu.x}
          y={objectMenu.y}
          onClose={() => setObjectMenu(null)}
          items={[
            {
              label: '查询数据',
              onSelect: () => onOpenTable(objectMenu.name, objectMenu.database),
            },
            {
              label: '查看 DDL',
              onSelect: () => onViewDdl(objectMenu.name, objectMenu.kind, objectMenu.database),
            },
            {
              label: '复制 DDL',
              onSelect: () => onCopyDdl(objectMenu.name, objectMenu.kind, objectMenu.database),
            },
            ...(objectMenu.kind === 'table'
              ? [
                  {
                    label: '编辑表结构…',
                    onSelect: () => onEditStructure(objectMenu.name, objectMenu.database),
                  },
                  {
                    label: '新建表…',
                    onSelect: () => onNewTable(objectMenu.schema),
                  },
                  {
                    label: '查看表结构…',
                    onSelect: () => onShowStructure(objectMenu.name, objectMenu.database),
                  },
                  {
                    label: '添加列…',
                    onSelect: () => onAddColumn(objectMenu.name, objectMenu.database),
                  },
                  {
                    label: '重命名列…',
                    onSelect: () => onRenameColumn(objectMenu.name, objectMenu.database),
                  },
                  {
                    label: '修改列…',
                    onSelect: () => onModifyColumn(objectMenu.name, objectMenu.database),
                  },
                  {
                    label: '删除列…',
                    danger: true,
                    onSelect: () => onDropColumn(objectMenu.name, objectMenu.database),
                  },
                  {
                    label: '创建索引…',
                    onSelect: () => onCreateIndex(objectMenu.name, objectMenu.database),
                  },
                  {
                    label: '删除索引…',
                    onSelect: () => onDropIndex(objectMenu.name, objectMenu.database),
                  },
                  {
                    label: '重命名表…',
                    onSelect: () => onRenameTable(objectMenu.name, objectMenu.database),
                  },
                  {
                    label: '删除表…',
                    danger: true,
                    onSelect: () => onDropTable(objectMenu.name, objectMenu.database),
                  },
                ]
              : [
                  {
                    label: '新建表…',
                    onSelect: () => onNewTable(objectMenu.schema),
                  },
                  {
                    label: '删除视图…',
                    danger: true,
                    onSelect: () => onDropView(objectMenu.name, objectMenu.database),
                  },
                ]),
          ]}
        />
      )}
    </aside>
  );
}
