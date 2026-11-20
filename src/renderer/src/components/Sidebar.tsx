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
import type { BrowseConnectionView, SavedConnection, SessionStatus } from '../types';
import { buildGroupTree, countGroup, type GroupNode } from '../utils/groups';
import { ContextMenu, type ContextMenuItem } from './ContextMenu';
import { Icon } from './Icon';
import { ObjectTree, type ObjectTreeContextTarget } from './ObjectTree';

/** 每个连接的对象树展开状态；跨重启保留，连接 id 稳定。 */
const TREE_EXPANDED_STORAGE_KEY = 'dbcraft.tree-expanded.v1';

/** 表子对象（约束/触发器/索引）的展开键；这些不跨重启保存。 */
function isExtrasExpansionKey(key: string): boolean {
  return (
    key.startsWith('extras:') ||
    key.startsWith('constraints:') ||
    key.startsWith('triggers:') ||
    key.startsWith('indexes:')
  );
}

interface SidebarProps {
  connections: SavedConnection[];
  activeConnectionId: string | null;
  activeConnection: SavedConnection | null;
  connectionStates: Record<string, SessionStatus>;
  /** 每个连接最近一次会话失败原因，用于状态点悬停提示。 */
  connectionErrors: Record<string, string>;
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
  /** 独立 browse session：每个连接的对象树数据（可同时展开多个）。 */
  browseConnectionId: string | null;
  browseViews: Record<string, BrowseConnectionView>;
  onOpenBrowseConnection: (id: string) => void;
  onCollapseBrowseConnection: (id: string) => void;
  onRefreshBrowse: (connectionId: string) => void;
  /** 只刷新某个数据库的对象并清掉它的表子对象缓存。 */
  onRefreshBrowseDatabase: (connectionId: string, database: string) => void;
  onToggleBrowseSystemObjects: (connectionId: string, next: boolean) => void;
  onSelectBrowseDatabase: (connectionId: string, database: string) => void;
  onLoadBrowseDatabase: (connectionId: string, database: string) => void;
  onLoadBrowseTableExtras: (connectionId: string, database: string, table: string) => void;
  /** 强制重载某张表的约束/触发器/索引。 */
  onReloadTableExtras: (connectionId: string, database: string, table: string) => void;
  onOpenTableInBrowse: (connectionId: string, name: string, database?: string) => void;
  onOpenTableDataInBrowse: (
    connectionId: string,
    name: string,
    kind: 'table' | 'view',
    database?: string,
  ) => void;
  onOpenProcedureInBrowse: (connectionId: string, name: string, database?: string) => void;
  onEnsureConnectionTab: (connectionId: string) => Promise<boolean> | boolean;
  onNewConnection: () => void;
  onRefreshSchema: () => void;
  onToggleSystemObjects: (next: boolean) => void;
  onSelectDatabase: (database: string) => void;
  onLoadTableExtras: (database: string, table: string) => void;
  onOpenTableData: (name: string, kind: 'table' | 'view', database?: string) => void;
  onOpenProcedure: (name: string, database?: string) => void;
  onDeleteConnection: (id: string) => void;
  onEditConnection: (id: string) => void;
  onDuplicateConnection: (id: string) => void;
  onDisconnectConnection: (id: string) => void;
  onNewQueryForConnection: (id: string, database?: string) => void;
  onRenameGroup: (oldPath: string, newPath: string) => void;
  onDeleteGroup: (path: string) => void;
  onMoveConnection: (id: string, group: string) => void;
  onCopyDdl: (name: string, kind: DdlObjectKind, database?: string) => void;
  onRenameTable: (name: string, database?: string) => void;
  onDropTable: (name: string, database?: string) => void;
  onDropView: (name: string, database?: string) => void;
  onDropProcedure: (name: string, database?: string) => void;
  onDropTrigger: (table: string, trigger: string, database?: string) => void;
  onToggleTrigger: (
    table: string,
    trigger: string,
    enabled: boolean,
    database?: string,
  ) => void;
  /** 把存储过程定义打开到编辑器，供修改后执行。 */
  onEditProcedureDefinition: (name: string, database?: string) => void;
  /** 表结构详情：列/主键/索引/约束/触发器/注释。 */
  onShowStructure: (name: string, database?: string) => void;
  onEditStructure: (name: string, database?: string) => void;
  /** 管理索引：创建与删除合并在同一个弹窗；可直接带入要删除的索引名。 */
  onManageIndex: (name: string, database?: string, indexName?: string) => void;
  /** 新建表：可指定 schema、目标库与连接（从任意已展开的对象树发起）。 */
  onNewTable: (schema?: string, database?: string, connectionId?: string) => void;
  /** 新建视图：可指定目标库与连接。 */
  onNewView: (database?: string, connectionId?: string) => void;
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
  onAgentJobAction: (
    jobName: string,
    action: 'start' | 'stop' | 'enable' | 'disable',
  ) => void;
}

function fileName(filePath: string): string {
  return filePath.split(/[\\/]/).pop() || filePath;
}

function summarize(input: ConnectionInput): string {
  const suffix = input.readOnly ? ' · 只读' : '';
  if (input.type === 'sqlite') return `${fileName(input.filePath)}${suffix}`;
  return `${input.database || '未选择数据库'}${suffix}`;
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
  connectionErrors,
  schemaObjects,
  databases,
  objectsByDatabase,
  tableExtrasLoadingKey,
  sessionReadOnly,
  browseConnectionId,
  browseViews,
  onOpenBrowseConnection,
  onCollapseBrowseConnection,
  onRefreshBrowse,
  onRefreshBrowseDatabase,
  onToggleBrowseSystemObjects,
  onSelectBrowseDatabase,
  onLoadBrowseDatabase,
  onLoadBrowseTableExtras,
  onReloadTableExtras,
  onOpenTableInBrowse,
  onOpenTableDataInBrowse,
  onOpenProcedureInBrowse,
  onEnsureConnectionTab,
  onNewConnection,
  onOpenTableData,
  onOpenProcedure,
  onDeleteConnection,
  onEditConnection,
  onDuplicateConnection,
  onDisconnectConnection,
  onNewQueryForConnection,
  onRenameGroup,
  onDeleteGroup,
  onMoveConnection,
  onCopyDdl,
  onRenameTable,
  onDropTable,
  onDropView,
  onDropProcedure,
  onDropTrigger,
  onToggleTrigger,
  onEditProcedureDefinition,
  onShowStructure,
  onEditStructure,
  onManageIndex,
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
  onAgentJobAction,
}: SidebarProps) {
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [expandedConnections, setExpandedConnections] = useState<Record<string, boolean>>({});
  // App 通过 browseConnectionId 请求展开某个连接（双击、工具栏切连接）。
  useEffect(() => {
    if (!browseConnectionId) return;
    setExpandedConnections((current) =>
      current[browseConnectionId] ? current : { ...current, [browseConnectionId]: true },
    );
  }, [browseConnectionId]);
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
  const [jobMenu, setJobMenu] = useState<{
    x: number;
    y: number;
    job: AgentJobSummary;
  } | null>(null);
  const [objectMenu, setObjectMenu] = useState<{
    x: number;
    y: number;
    name: string;
    kind: DdlObjectKind;
    database?: string;
    schema?: string;
    connectionId?: string;
    /** MSSQL 扩展存储过程没有 SQL 定义。 */
    extended?: boolean;
  } | null>(null);
  const [nodeMenu, setNodeMenu] = useState<{
    x: number;
    y: number;
    connectionId: string;
    target: ObjectTreeContextTarget;
  } | null>(null);
  /** 按连接保存对象树展开状态：收起连接、重启应用后都不会回到默认。 */
  const [treeExpanded, setTreeExpanded] = useState<Record<string, Record<string, boolean>>>(() => {
    try {
      const raw = window.localStorage.getItem(TREE_EXPANDED_STORAGE_KEY);
      return raw ? (JSON.parse(raw) as Record<string, Record<string, boolean>>) : {};
    } catch {
      return {};
    }
  });
  useEffect(() => {
    try {
      // 表子对象的展开状态不跨重启保存：重启后 extras 缓存不存在，
      // 直接展开会显示空壳；收起后由用户展开再触发懒加载。
      const persistent = Object.fromEntries(
        Object.entries(treeExpanded).map(([connectionId, view]) => [
          connectionId,
          Object.fromEntries(
            Object.entries(view).filter(([key]) => !isExtrasExpansionKey(key)),
          ),
        ]),
      );
      window.localStorage.setItem(
        TREE_EXPANDED_STORAGE_KEY,
        JSON.stringify(persistent),
      );
    } catch {
      // localStorage 不可用时只保留本次会话内的展开状态。
    }
  }, [treeExpanded]);
  const collapseExtrasFor = (connectionId: string) => {
    setTreeExpanded((current) => {
      const view = current[connectionId];
      if (!view) return current;
      const next = Object.fromEntries(
        Object.entries(view).filter(([key]) => !isExtrasExpansionKey(key)),
      );
      return { ...current, [connectionId]: next };
    });
  };
  const toggleTreeExpanded = (connectionId: string, key: string, defaultValue = false) => {
    setTreeExpanded((current) => {
      const view = current[connectionId] ?? {};
      return {
        ...current,
        [connectionId]: { ...view, [key]: !(view[key] ?? defaultValue) },
      };
    });
  };

  const copyText = (text: string) => {
    void navigator.clipboard.writeText(text).catch(() => undefined);
  };

  const normalizedQuery = treeQuery.trim().toLowerCase();
  const matchesName = (name: string) => name.toLowerCase().includes(normalizedQuery);
  const activeObjectMatches =
    normalizedQuery.length > 0 &&
    (databases.some((database) => matchesName(database.name)) ||
      [...Object.values(objectsByDatabase).flat(), ...schemaObjects].some((object) =>
        matchesName(object.name),
      ) ||
      (agentJobs ?? []).some((job) => matchesName(job.name)));
  const viewMatches = (connectionId: string) => {
    if (normalizedQuery.length === 0) return false;
    const view = browseViews[connectionId];
    if (!view) return false;
    return (
      view.databases.some((database) => matchesName(database.name)) ||
      [...Object.values(view.objectsByDatabase).flat(), ...view.schemaObjects].some((object) =>
        matchesName(object.name),
      )
    );
  };

  const filteredConnections = normalizedQuery
    ? connections.filter(
        (connection) =>
          searchText(connection).includes(normalizedQuery) ||
          (connection.id === activeConnectionId && activeObjectMatches) ||
          viewMatches(connection.id),
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

  const expandConnection = (connection: SavedConnection) => {
    // 多个连接可以同时展开；只有再次点击自己（或折叠按钮）才收起。
    const expanded = Boolean(expandedConnections[connection.id] && browseViews[connection.id]);
    if (expanded) {
      setExpandedConnections((current) => ({ ...current, [connection.id]: false }));
      onCollapseBrowseConnection(connection.id);
      return;
    }
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
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setSelectedAgentJob(job.name);
                    setJobMenu({ x: event.clientX, y: event.clientY, job });
                  }}
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
    const view = browseViews[connection.id];
    // 会话被断开/编辑/删除后 view 消失，行自动收起；否则按本地展开状态渲染。
    const expanded = Boolean(expandedConnections[connection.id] && view);
    const browseCanManage = expanded && connection.id === activeConnectionId;
    const browseSystemSupported =
      connection.input.type === 'sqlite' || connection.input.type === 'mssql';
    const state = connectionStates[connection.id] ?? 'closed';
    const stateLabel =
      state === 'ready'
        ? '已连接'
        : state === 'opening'
          ? '连接中'
          : state === 'error'
            ? '连接失败'
            : '未连接';
    const stateTitle =
      state === 'error'
        ? `连接失败：${connectionErrors[connection.id] ?? '原因未知'}`
        : stateLabel;

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
              expandConnection(connection);
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
              title={stateTitle}
              aria-label={stateTitle}
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

        {expanded && view && view.status !== 'ready' && (
          <div className="connection-objects">
            <div
              className={`tree-empty ${view.status === 'error' ? 'tree-error-text' : ''}`}
              title={view.status === 'error' ? view.message : undefined}
            >
              {view.status === 'opening'
                ? '正在连接…'
                : view.status === 'error'
                  ? `连接失败：${view.message ?? '原因未知'}`
                  : '未连接'}
            </div>
          </div>
        )}

        {expanded && view && view.status === 'ready' && (
          <div className="connection-objects">
            <div className="connection-object-actions">
              <button
                type="button"
                className="icon-btn"
                title={sessionReadOnly ? '当前为只读会话，无法建表' : '新建表'}
                onClick={() => onNewTable(undefined, undefined, connection.id)}
                disabled={sessionReadOnly}
              >
                <Icon name="plus" size={14} />
              </button>
              <button
                type="button"
                className="icon-btn"
                title={sessionReadOnly ? '当前为只读会话，无法建视图' : '新建视图'}
                onClick={() => onNewView(undefined, connection.id)}
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
                onClick={() => {
                  collapseExtrasFor(connection.id);
                  onRefreshBrowse(connection.id);
                }}
                disabled={view.schemaLoading}
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
                checked={view.showSystemObjects}
                disabled={!browseSystemSupported || view.schemaLoading}
                onChange={(event) =>
                  onToggleBrowseSystemObjects(connection.id, event.target.checked)
                }
              />
              <span>显示系统对象</span>
            </label>

            <ObjectTree
              dialect={connection.input.type}
              query={treeQuery}
              databases={view.databases}
              currentDatabase={view.currentDatabase}
              objectsByDatabase={view.objectsByDatabase}
              schemaObjects={view.schemaObjects}
              loadingDatabase={view.databaseLoading}
              loading={view.schemaLoading}
              tableExtras={view.tableExtras}
              tableExtrasLoadingKey={tableExtrasLoadingKey}
              expanded={treeExpanded[connection.id] ?? {}}
              onToggleExpanded={(key, defaultValue) =>
                toggleTreeExpanded(connection.id, key, defaultValue)
              }
              onSelectDatabase={(database) =>
                onSelectBrowseDatabase(connection.id, database)
              }
              onLoadDatabase={(database) =>
                onLoadBrowseDatabase(connection.id, database)
              }
              onLoadTableExtras={(database, table) =>
                onLoadBrowseTableExtras(connection.id, database, table)
              }
              onOpenTable={(name, database) =>
                onOpenTableInBrowse(connection.id, name, database)
              }
              onOpenTableData={(name, kind, database) =>
                onOpenTableDataInBrowse(connection.id, name, kind, database)
              }
              onOpenProcedure={(name, database) =>
                onOpenProcedureInBrowse(connection.id, name, database)
              }
              onTableContextMenu={(event, name, kind, database, schema, extended) => {
                const position = { x: event.clientX, y: event.clientY };
                const showMenu = () => {
                  setObjectMenu({
                    x: position.x,
                    y: position.y,
                    name,
                    kind,
                    connectionId: connection.id,
                    ...(database ? { database } : {}),
                    ...(schema ? { schema } : {}),
                    ...(extended ? { extended } : {}),
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
              onNodeContextMenu={(event, target) => {
                const position = { x: event.clientX, y: event.clientY };
                const showMenu = () => {
                  setNodeMenu({
                    x: position.x,
                    y: position.y,
                    connectionId: connection.id,
                    target,
                  });
                };
                // 表结构详情/删除索引等动作依赖活动标签，非当前连接先激活它。
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
            {node.connections.map((connection) => renderConnection(connection))}
            {node.children.map((child) => renderGroupNode(child, depth + 1))}
          </>
        )}
      </div>
    );
  };

  /** 数据库 / 文件夹 / schema / 表子对象的右键菜单。 */
  const renderNodeMenu = () => {
    if (!nodeMenu) return null;
    const { connectionId, target } = nodeMenu;
    const items: ContextMenuItem[] = (() => {
      switch (target.type) {
        case 'database':
          return [
            {
              label: '设为当前库',
              disabled: target.current,
              onSelect: () => onSelectBrowseDatabase(connectionId, target.database),
            },
            {
              label: '新建查询',
              onSelect: () => onNewQueryForConnection(connectionId, target.database),
            },
            {
              label: '新建表…',
              onSelect: () => onNewTable(undefined, target.database, connectionId),
            },
            {
              label: '新建视图…',
              onSelect: () => onNewView(target.database, connectionId),
            },
            {
              label: '刷新此库对象',
              onSelect: () => {
                collapseExtrasFor(connectionId);
                onRefreshBrowseDatabase(connectionId, target.database);
              },
            },
            {
              label: '复制数据库名',
              onSelect: () => copyText(target.database),
            },
          ];
        case 'folder':
          return [
            ...(target.folder === 'tables'
              ? [
                  {
                    label: '新建表…',
                    onSelect: () =>
                      onNewTable(undefined, target.database, connectionId),
                  },
                ]
              : []),
            ...(target.folder === 'views'
              ? [
                  {
                    label: '新建视图…',
                    onSelect: () => onNewView(target.database, connectionId),
                  },
                ]
              : []),
            {
              label: '新建查询',
              onSelect: () => onNewQueryForConnection(connectionId, target.database),
            },
            {
              label: '刷新此库对象',
              onSelect: () => {
                collapseExtrasFor(connectionId);
                onRefreshBrowseDatabase(connectionId, target.database);
              },
            },
            {
              label: '复制数据库名',
              onSelect: () => copyText(target.database),
            },
          ];
        case 'schema':
          return [
            {
              label: '新建表…',
              onSelect: () =>
                onNewTable(target.schema, target.database, connectionId),
            },
            {
              label: '新建查询',
              onSelect: () => onNewQueryForConnection(connectionId, target.database),
            },
            {
              label: '刷新此库对象',
              onSelect: () => {
                collapseExtrasFor(connectionId);
                onRefreshBrowseDatabase(connectionId, target.database);
              },
            },
            {
              label: '复制 schema 名',
              onSelect: () => copyText(target.schema),
            },
          ];
        case 'extras':
          return [
            {
              label: '刷新此项',
              onSelect: () =>
                onReloadTableExtras(connectionId, target.database, target.table),
            },
            {
              label: '表结构详情…',
              onSelect: () => onShowStructure(target.table, target.database),
            },
            {
              label: '复制名称',
              onSelect: () =>
                copyText(
                  target.folder === 'constraints'
                    ? '约束'
                    : target.folder === 'triggers'
                      ? '触发器'
                      : '索引',
                ),
            },
          ];
        case 'detail':
          return [
            {
              label: '复制名称',
              onSelect: () => copyText(target.name),
            },
            ...(target.detailKind === 'index'
              ? [
                  {
                    label: '删除索引…',
                    danger: true,
                    onSelect: () =>
                      onManageIndex(target.table, target.database, target.name),
                  },
                ]
              : []),
            ...(target.detailKind === 'trigger'
              ? [
                  {
                    label: '删除触发器…',
                    danger: true,
                    onSelect: () =>
                      onDropTrigger(
                        target.table,
                        target.qualifiedName ?? target.name,
                        target.database,
                      ),
                  },
                  ...(target.canToggle
                    ? [
                        {
                          label: target.disabled ? '启用触发器' : '禁用触发器',
                          onSelect: () =>
                            onToggleTrigger(
                              target.table,
                              target.qualifiedName ?? target.name,
                              Boolean(target.disabled),
                              target.database,
                            ),
                        },
                      ]
                    : []),
                ]
              : []),
            {
              label: '表结构详情…',
              onSelect: () => onShowStructure(target.table, target.database),
            },
          ];
      }
    })();
    return (
      <ContextMenu
        x={nodeMenu.x}
        y={nodeMenu.y}
        onClose={() => setNodeMenu(null)}
        items={items}
      />
    );
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
                      tree.connections.map((connection) => renderConnection(connection))}
                  </div>
                )}
                {tree.children.map((child) => renderGroupNode(child, 0))}
              </>
            ) : (
              filteredConnections.map((connection) => renderConnection(connection))
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
              label:
                browseViews[menu.connection.id] &&
                expandedConnections[menu.connection.id]
                  ? '收起对象树'
                  : '打开对象树',
              onSelect: () => {
                const view = browseViews[menu.connection.id];
                if (view && expandedConnections[menu.connection.id]) {
                  setExpandedConnections((current) => ({
                    ...current,
                    [menu.connection.id]: false,
                  }));
                  onCollapseBrowseConnection(menu.connection.id);
                  return;
                }
                setExpandedConnections((current) => ({
                  ...current,
                  [menu.connection.id]: true,
                }));
                onOpenBrowseConnection(menu.connection.id);
              },
            },
            {
              label: '刷新对象树',
              disabled: browseViews[menu.connection.id]?.status !== 'ready',
              onSelect: () => {
                collapseExtrasFor(menu.connection.id);
                onRefreshBrowse(menu.connection.id);
              },
            },
            {
              label: '新建表…',
              onSelect: () => onNewTable(undefined, undefined, menu.connection.id),
            },
            {
              label: '复制连接名',
              onSelect: () => copyText(menu.connection.input.name),
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

      {jobMenu && (
        <ContextMenu
          x={jobMenu.x}
          y={jobMenu.y}
          onClose={() => setJobMenu(null)}
          items={[
            {
              label: '打开详情',
              onSelect: () => onOpenAgentJob(jobMenu.job.name),
            },
            {
              label: '启动作业',
              disabled: jobMenu.job.multiServer || !jobMenu.job.enabled || jobMenu.job.running,
              onSelect: () => onAgentJobAction(jobMenu.job.name, 'start'),
            },
            {
              label: '停止作业',
              disabled: jobMenu.job.multiServer,
              onSelect: () => onAgentJobAction(jobMenu.job.name, 'stop'),
            },
            {
              label: jobMenu.job.enabled ? '禁用' : '启用',
              disabled: jobMenu.job.multiServer,
              onSelect: () =>
                onAgentJobAction(
                  jobMenu.job.name,
                  jobMenu.job.enabled ? 'disable' : 'enable',
                ),
            },
            {
              label: '复制名称',
              onSelect: () => {
                void navigator.clipboard.writeText(jobMenu.job.name).catch(() => undefined);
              },
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

      {renderNodeMenu()}

      {objectMenu && (
        <ContextMenu
          x={objectMenu.x}
          y={objectMenu.y}
          onClose={() => setObjectMenu(null)}
          items={
            objectMenu.kind === 'procedure'
              ? [
                  {
                    label: '生成调用 SQL',
                    onSelect: () =>
                      onOpenProcedure(objectMenu.name, objectMenu.database),
                  },
                  {
                    label: objectMenu.extended
                      ? '编辑定义（扩展存储过程无定义）'
                      : '编辑定义…',
                    disabled: objectMenu.extended === true,
                    onSelect: () =>
                      onEditProcedureDefinition(objectMenu.name, objectMenu.database),
                  },
                  {
                    label: objectMenu.extended
                      ? '复制 DDL（扩展存储过程无定义）'
                      : '复制 DDL',
                    disabled: objectMenu.extended === true,
                    onSelect: () =>
                      onCopyDdl(objectMenu.name, 'procedure', objectMenu.database),
                  },
                  {
                    label: '复制名称',
                    onSelect: () => copyText(objectMenu.name),
                  },
                  {
                    label: '删除存储过程…',
                    danger: true,
                    disabled: objectMenu.extended === true,
                    onSelect: () =>
                      onDropProcedure(objectMenu.name, objectMenu.database),
                  },
                ]
              : [
                  {
                    label:
                      objectMenu.kind === 'table' ? '打开表数据' : '打开视图数据',
                    onSelect: () =>
                      onOpenTableData(
                        objectMenu.name,
                        objectMenu.kind as 'table' | 'view',
                        objectMenu.database,
                      ),
                  },
                  ...(objectMenu.kind === 'table'
                    ? [
                        {
                          label: '编辑表结构…',
                          onSelect: () =>
                            onEditStructure(objectMenu.name, objectMenu.database),
                        },
                        {
                          label: '表结构详情…',
                          onSelect: () =>
                            onShowStructure(objectMenu.name, objectMenu.database),
                        },
                        {
                          label: '管理索引…',
                          onSelect: () =>
                            onManageIndex(objectMenu.name, objectMenu.database),
                        },
                      ]
                    : []),
                  {
                    label: '复制 DDL',
                    onSelect: () =>
                      onCopyDdl(objectMenu.name, objectMenu.kind, objectMenu.database),
                  },
                  ...(objectMenu.kind === 'table'
                    ? [
                        {
                          label: '重命名表…',
                          onSelect: () =>
                            onRenameTable(objectMenu.name, objectMenu.database),
                        },
                        {
                          label: '删除表…',
                          danger: true,
                          onSelect: () =>
                            onDropTable(objectMenu.name, objectMenu.database),
                        },
                      ]
                    : [
                        {
                          label: '删除视图…',
                          danger: true,
                          onSelect: () =>
                            onDropView(objectMenu.name, objectMenu.database),
                        },
                      ]),
                ]
          }
        />
      )}
    </aside>
  );
}
