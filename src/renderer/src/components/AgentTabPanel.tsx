import { useCallback, useEffect, useState } from 'react';
import type {
  AgentJobAction,
  AgentJobDetail,
  AgentJobSummary,
} from '@shared/ipc-contract';
import { agentRunStatusLabel } from '@shared/agent';
import { explainQueryError } from '@shared/errors';
import { Icon } from './Icon';

type AgentTabMode = 'jobs' | 'detail';

interface AgentTabPanelProps {
  mode: AgentTabMode;
  /** 详情页对应的作业名。 */
  jobName?: string;
  sessionId: string;
  connectionId: string;
  connectionName: string;
  database: string;
  /** 会话就绪后才发起 msdb 查询，避免打开页签瞬间报连接未就绪。 */
  ready: boolean;
  /** 任一 Agent 页签完成生命周期操作后递增，驱动其他已打开的列表/详情刷新。 */
  refreshKey?: number;
  onOpenJob: (jobName: string) => void;
  onOpenScript: (script: string, title: string) => void;
  /** 生命周期操作成功后通知 App 刷新其他 Agent 页签。 */
  onChanged?: () => void;
}

interface PanelNotice {
  kind: 'info' | 'error';
  text: string;
}

function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return '—';
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes < 60) return `${minutes} 分 ${rest} 秒`;
  return `${Math.floor(minutes / 60)} 时 ${minutes % 60} 分 ${rest} 秒`;
}

function errorHintOf(message: string | null): string | null {
  return message ? explainQueryError({ code: null, message }) : null;
}

function PanelNoticeBar({ notice }: { notice: PanelNotice | null }) {
  if (!notice) return null;
  return (
    <div className={`agent-notice agent-notice-${notice.kind}`} role="status">
      {notice.text}
    </div>
  );
}

function PanelError({ message }: { message: string | null }) {
  if (!message) return null;
  const hint = errorHintOf(message);
  return (
    <div className="result-error" role="alert">
      <span>{message}</span>
      {hint && <span className="result-error-hint">建议：{hint}</span>}
    </div>
  );
}

export function AgentTabPanel({
  mode,
  jobName,
  sessionId,
  connectionId,
  connectionName,
  database,
  ready,
  refreshKey,
  onOpenJob,
  onOpenScript,
  onChanged,
}: AgentTabPanelProps) {
  if (mode === 'detail') {
    return (
      <AgentJobDetailView
        jobName={jobName ?? ''}
        sessionId={sessionId}
        connectionId={connectionId}
        connectionName={connectionName}
        database={database}
        ready={ready}
        refreshKey={refreshKey}
        onOpenScript={onOpenScript}
        onChanged={onChanged}
      />
    );
  }
  return (
    <AgentJobListView
      sessionId={sessionId}
      connectionId={connectionId}
      connectionName={connectionName}
      database={database}
      ready={ready}
      refreshKey={refreshKey}
      onOpenJob={onOpenJob}
      onOpenScript={onOpenScript}
      onChanged={onChanged}
    />
  );
}

interface AgentJobListViewProps {
  sessionId: string;
  connectionId: string;
  connectionName: string;
  database: string;
  ready: boolean;
  refreshKey?: number;
  onOpenJob: (jobName: string) => void;
  onOpenScript: (script: string, title: string) => void;
  onChanged?: () => void;
}

function AgentJobListView({
  sessionId,
  connectionId,
  connectionName,
  database,
  ready,
  refreshKey,
  onOpenJob,
  onOpenScript,
  onChanged,
}: AgentJobListViewProps) {
  const [jobs, setJobs] = useState<AgentJobSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<PanelNotice | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const api = window.dbcraft;

  const loadJobs = useCallback(
    async (term: string) => {
      if (!api || !ready) return;
      setLoading(true);
      setError(null);
      try {
        const result = await api.agent.list(sessionId, term);
        if (!result.ok) {
          setError(result.message);
          setJobs([]);
          return;
        }
        setJobs(result.jobs);
        setSelected((current) =>
          current && result.jobs.some((job) => job.name === current) ? current : null,
        );
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
        setJobs([]);
      } finally {
        setLoading(false);
      }
    },
    [api, ready, sessionId],
  );

  useEffect(() => {
    if (!ready) return;
    const timer = window.setTimeout(() => void loadJobs(search), 250);
    return () => window.clearTimeout(timer);
  }, [search, loadJobs, refreshToken, refreshKey, ready]);

  const selectedJob = jobs.find((job) => job.name === selected) ?? null;
  const multiServer = selectedJob?.multiServer === true;

  const refreshAll = async () => {
    await loadJobs(search);
  };

  const runAction = async (action: AgentJobAction) => {
    if (!selected) return;
    if (action === 'stop' && !window.confirm('停止会中断当前运行，确定继续吗？')) return;
    if (action === 'disable' && !window.confirm('禁用后该作业的后续计划不再运行，确定继续吗？')) {
      return;
    }

    setBusy(true);
    setNotice(null);
    try {
      const result = await api!.agent.action(sessionId, selected, action, {
        connectionId,
        connectionName,
        database,
      });
      setNotice(
        result.ok
          ? { kind: 'info', text: result.message }
          : { kind: 'error', text: result.message },
      );
      await refreshAll();
      if (result.ok) onChanged?.();
    } finally {
      setBusy(false);
    }
  };

  const openScript = async () => {
    if (!selected) return;
    setBusy(true);
    setNotice(null);
    try {
      const result = await api!.agent.script(sessionId, selected);
      if (!result.ok) {
        setNotice({ kind: 'error', text: result.message });
        return;
      }
      onOpenScript(result.script, selected);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="agent-tab-body">
      <div className="agent-toolbar">
        <div className="sidebar-search agent-search">
          <Icon name="search" size={13} />
          <input
            value={search}
            placeholder="搜索作业名称…"
            aria-label="搜索作业"
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <button
          type="button"
          className="btn"
          disabled={!ready || loading || busy}
          onClick={() => setRefreshToken((value) => value + 1)}
        >
          <Icon name="refresh" size={13} />
          刷新
        </button>
        <span className="spacer" />
        <button
          type="button"
          className="btn btn-run"
          disabled={!selected || busy || multiServer || !selectedJob?.enabled}
          title={
            !selectedJob?.enabled ? '作业已禁用，请先启用' : multiServer ? '多服务器作业只读' : '启动作业'
          }
          onClick={() => void runAction('start')}
        >
          启动
        </button>
        <button
          type="button"
          className="btn"
          disabled={!selected || busy || multiServer}
          onClick={() => void runAction('stop')}
        >
          停止
        </button>
        <button
          type="button"
          className="btn"
          disabled={!selected || busy || multiServer || selectedJob?.enabled === true}
          onClick={() => void runAction('enable')}
        >
          启用
        </button>
        <button
          type="button"
          className="btn btn-danger"
          disabled={!selected || busy || multiServer || selectedJob?.enabled === false}
          onClick={() => void runAction('disable')}
        >
          禁用
        </button>
        <button
          type="button"
          className="btn"
          disabled={!selected || busy}
          onClick={() => void openScript()}
        >
          编辑脚本
        </button>
      </div>

      <div className="agent-context">
        {connectionName} · {database || '默认库'} · 只读监控 + 启停/启用/禁用；双击作业行打开详情页签
      </div>

      <PanelNoticeBar notice={notice} />
      <PanelError message={error} />

      {!ready ? (
        <div className="agent-empty">
          正在打开数据库会话；若上方显示会话失败，请先重连。
        </div>
      ) : (
        <div className="agent-scroll">
          <table className="agent-table">
            <thead>
              <tr>
                <th>名称</th>
                <th>已启用</th>
                <th>类别</th>
                <th>上次结果</th>
                <th>上次运行</th>
                <th>耗时</th>
                <th>下次运行</th>
                <th>所属者</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr
                  key={job.jobId}
                  className={job.name === selected ? 'is-selected' : undefined}
                  title="双击打开作业详情"
                  onClick={() => setSelected(job.name)}
                  onDoubleClick={() => onOpenJob(job.name)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') onOpenJob(job.name);
                  }}
                >
                  <td title={job.name}>
                    {job.name}
                    {job.multiServer && <span className="agent-tag">[多服务器]</span>}
                  </td>
                  <td>{job.enabled ? '是' : '否'}</td>
                  <td>{job.category || '—'}</td>
                  <td>{agentRunStatusLabel(job.lastRunStatus)}</td>
                  <td>{job.lastRunAt ?? '从未运行'}</td>
                  <td>{formatDuration(job.lastRunDurationSeconds)}</td>
                  <td>{job.nextRunAt ?? '—'}</td>
                  <td>{job.owner || '—'}</td>
                </tr>
              ))}
              {!loading && jobs.length === 0 && (
                <tr>
                  <td colSpan={8} className="agent-empty">
                    {error ? '作业列表加载失败' : '没有匹配的作业'}
                  </td>
                </tr>
              )}
              {loading && (
                <tr>
                  <td colSpan={8} className="agent-empty">
                    正在加载作业…
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

interface AgentJobDetailViewProps {
  jobName: string;
  sessionId: string;
  connectionId: string;
  connectionName: string;
  database: string;
  ready: boolean;
  refreshKey?: number;
  onOpenScript: (script: string, title: string) => void;
  onChanged?: () => void;
}

function AgentJobDetailView({
  jobName,
  sessionId,
  connectionId,
  connectionName,
  database,
  ready,
  refreshKey,
  onOpenScript,
  onChanged,
}: AgentJobDetailViewProps) {
  const [detail, setDetail] = useState<AgentJobDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [historyLimit, setHistoryLimit] = useState<100 | 500>(100);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<PanelNotice | null>(null);
  const api = window.dbcraft;

  const loadDetail = useCallback(
    async (limit: 100 | 500) => {
      if (!api || !ready || !jobName) return;
      setLoading(true);
      setError(null);
      try {
        const result = await api.agent.detail(sessionId, jobName, limit);
        if (!result.ok) {
          setError(result.message);
          setDetail(null);
          return;
        }
        setDetail(result.detail);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
        setDetail(null);
      } finally {
        setLoading(false);
      }
    },
    [api, ready, sessionId, jobName],
  );

  useEffect(() => {
    if (!ready) return;
    void loadDetail(historyLimit);
  }, [ready, loadDetail, historyLimit, refreshKey]);

  // 详情页每 30 秒自动刷新一次；手动刷新仍可用。
  useEffect(() => {
    if (!ready || !jobName) return;
    const timer = window.setInterval(() => void loadDetail(historyLimit), 30_000);
    return () => window.clearInterval(timer);
  }, [ready, jobName, historyLimit, loadDetail]);

  const runAction = async (action: AgentJobAction) => {
    if (!jobName) return;
    if (action === 'stop' && !window.confirm('停止会中断当前运行，确定继续吗？')) return;
    if (action === 'disable' && !window.confirm('禁用后该作业的后续计划不再运行，确定继续吗？')) {
      return;
    }

    setBusy(true);
    setNotice(null);
    try {
      const result = await api!.agent.action(sessionId, jobName, action, {
        connectionId,
        connectionName,
        database,
      });
      setNotice(
        result.ok
          ? { kind: 'info', text: result.message }
          : { kind: 'error', text: result.message },
      );
      await loadDetail(historyLimit);
      if (result.ok) onChanged?.();
    } finally {
      setBusy(false);
    }
  };

  const openScript = async () => {
    if (!jobName) return;
    setBusy(true);
    setNotice(null);
    try {
      const result = await api!.agent.script(sessionId, jobName);
      if (!result.ok) {
        setNotice({ kind: 'error', text: result.message });
        return;
      }
      onOpenScript(result.script, jobName);
    } finally {
      setBusy(false);
    }
  };

  const openStepCommand = (command: string, stepId: number) => {
    if (!command.trim()) return;
    onOpenScript(command, `${jobName} · 步骤 ${stepId}`);
  };

  const copyCommand = async (command: string) => {
    try {
      await navigator.clipboard.writeText(command);
      setNotice({ kind: 'info', text: '步骤命令已复制到剪贴板。' });
    } catch {
      setNotice({ kind: 'error', text: '复制失败，请检查剪贴板权限。' });
    }
  };

  const multiServer = detail?.multiServer === true;

  return (
    <div className="agent-tab-body">
      <div className="agent-toolbar">
        <strong>作业：{jobName || '（未指定）'}</strong>
        <span className="spacer" />
        <button
          type="button"
          className="btn btn-run"
          disabled={!detail || busy || multiServer || !detail.enabled}
          title={
            !detail?.enabled ? '作业已禁用，请先启用' : multiServer ? '多服务器作业只读' : '启动作业'
          }
          onClick={() => void runAction('start')}
        >
          启动
        </button>
        <button
          type="button"
          className="btn"
          disabled={!detail || busy || multiServer}
          onClick={() => void runAction('stop')}
        >
          停止
        </button>
        <button
          type="button"
          className="btn"
          disabled={!detail || busy || multiServer || detail.enabled}
          onClick={() => void runAction('enable')}
        >
          启用
        </button>
        <button
          type="button"
          className="btn btn-danger"
          disabled={!detail || busy || multiServer || !detail.enabled}
          onClick={() => void runAction('disable')}
        >
          禁用
        </button>
        <button
          type="button"
          className="btn"
          disabled={!detail || busy}
          onClick={() => void openScript()}
        >
          编辑脚本
        </button>
      </div>

      <div className="agent-context">
        {connectionName} · {database || '默认库'} · 内容只读，配置修改统一生成脚本
      </div>

      <PanelNoticeBar notice={notice} />
      <PanelError message={error} />

      {!ready ? (
        <div className="agent-empty">
          正在打开数据库会话；若上方显示会话失败，请先重连。
        </div>
      ) : loading && !detail ? (
        <div className="agent-empty">正在加载作业详情…</div>
      ) : detail ? (
        <div className="agent-scroll">
          <h3>{detail.name}</h3>
          <dl className="agent-meta">
            <dt>描述</dt>
            <dd>{detail.description || '—'}</dd>
            <dt>启用 / 类别</dt>
            <dd>
              {detail.enabled ? '是' : '否'} / {detail.category || '—'}
            </dd>
            <dt>所属者</dt>
            <dd>{detail.owner || '—'}</dd>
            <dt>创建 / 修改</dt>
            <dd>
              {detail.createdAt ?? '—'} / {detail.modifiedAt ?? '—'}
            </dd>
            <dt>上次运行</dt>
            <dd>
              {detail.lastRunAt ?? '从未运行'} · {agentRunStatusLabel(detail.lastRunStatus)} ·{' '}
              {formatDuration(detail.lastRunDurationSeconds)}
            </dd>
          </dl>

          <h4>步骤（{detail.steps.length}）</h4>
          <table className="agent-table">
            <thead>
              <tr>
                <th>#</th>
                <th>步骤名</th>
                <th>子系统</th>
                <th>成功/失败动作</th>
                <th>命令</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {detail.steps.map((step) => {
                const isTsql = step.subsystem === 'TSQL';
                return (
                  <tr key={step.stepId}>
                    <td>{step.stepId}</td>
                    <td>{step.stepName}</td>
                    <td>{step.subsystem}</td>
                    <td>
                      {step.onSuccessAction} / {step.onFailAction}
                    </td>
                    <td className="agent-command" title={step.command}>
                      {step.command.replace(/\s+/g, ' ').slice(0, 120) || '—'}
                    </td>
                    <td className="agent-row-actions">
                      <button
                        type="button"
                        className="btn btn-mini"
                        disabled={!isTsql || !step.command.trim()}
                        title={isTsql ? '在编辑器中打开完整命令' : '仅 T-SQL 步骤支持在编辑器中打开'}
                        onClick={() => openStepCommand(step.command, step.stepId)}
                      >
                        打开命令
                      </button>
                      <button
                        type="button"
                        className="btn btn-mini"
                        disabled={!step.command.trim()}
                        onClick={() => void copyCommand(step.command)}
                      >
                        复制
                      </button>
                    </td>
                  </tr>
                );
              })}
              {detail.steps.length === 0 && (
                <tr>
                  <td colSpan={6} className="agent-empty">
                    没有步骤
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          <h4>计划（{detail.schedules.length}）</h4>
          <table className="agent-table">
            <thead>
              <tr>
                <th>计划名</th>
                <th>启用</th>
                <th>频率</th>
                <th>下次运行</th>
                <th>共享</th>
              </tr>
            </thead>
            <tbody>
              {detail.schedules.map((schedule) => (
                <tr key={schedule.scheduleId}>
                  <td>{schedule.name}</td>
                  <td>{schedule.enabled ? '是' : '否'}</td>
                  <td>{schedule.frequency}</td>
                  <td>{schedule.nextRunAt ?? '—'}</td>
                  <td className={schedule.shared ? 'agent-failed' : undefined}>
                    {schedule.shared ? '是（修改会影响其他作业）' : '否'}
                  </td>
                </tr>
              ))}
              {detail.schedules.length === 0 && (
                <tr>
                  <td colSpan={5} className="agent-empty">
                    没有计划
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          <div className="agent-history-header">
            <h4>运行历史</h4>
            <select
              className="page-size"
              value={historyLimit}
              aria-label="历史条数"
              onChange={(event) => setHistoryLimit(Number(event.target.value) === 500 ? 500 : 100)}
            >
              <option value={100}>最近 100 条</option>
              <option value={500}>最近 500 条</option>
            </select>
          </div>
          <p className="form-note">更多历史请直接查 msdb.dbo.sysjobhistory。</p>
          <table className="agent-table">
            <thead>
              <tr>
                <th>时间</th>
                <th>步骤</th>
                <th>结果</th>
                <th>耗时</th>
                <th>消息</th>
              </tr>
            </thead>
            <tbody>
              {detail.history.map((row) => (
                <tr key={row.instanceId}>
                  <td>{row.runAt}</td>
                  <td>{row.stepName}</td>
                  <td className={row.runStatus === 0 ? 'agent-failed' : undefined}>
                    {agentRunStatusLabel(row.runStatus)}
                  </td>
                  <td>{formatDuration(row.durationSeconds)}</td>
                  <td className={row.runStatus === 0 ? 'agent-failed' : undefined}>
                    {row.message}
                  </td>
                </tr>
              ))}
              {detail.history.length === 0 && (
                <tr>
                  <td colSpan={5} className="agent-empty">
                    还没有运行记录
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
        !error && <div className="agent-empty">没有可显示的作业详情。</div>
      )}
    </div>
  );
}
