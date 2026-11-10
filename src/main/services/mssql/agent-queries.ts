import type {
  AgentDetailResult,
  AgentJobAction,
  AgentJobDetail,
  AgentJobHistory,
  AgentJobSchedule,
  AgentJobStep,
  AgentJobSummary,
  AgentListResult,
} from '../../../shared/ipc-contract';
import {
  agentDurationSeconds,
  buildAgentActionSql,
  buildAgentEditScript,
  describeAgentSchedule,
  formatAgentRunTimestamp,
} from '../../../shared/agent.ts';
import { escapeLikeValue } from '../../../shared/dialect/identifiers.ts';
import type { MssqlSession } from './MssqlSession.ts';

function text(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

function number(value: unknown): number {
  return typeof value === 'number' ? value : Number(value ?? 0);
}

function flag(value: unknown): boolean {
  return value === true || value === 1 || value === '1';
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

const JOB_COLUMNS = `j.job_id, j.name, j.enabled, ISNULL(c.name, '') AS category_name,
       SUSER_SNAME(j.owner_sid) AS owner_name,
       h.run_status, h.run_date, h.run_time, h.run_duration,
       nr.next_run_date, nr.next_run_time,
       CASE WHEN EXISTS (
         SELECT 1 FROM msdb.dbo.sysjobservers o
         WHERE o.job_id = j.job_id AND o.server_id <> 0
       ) THEN 1 ELSE 0 END AS multi_server,
       CASE WHEN EXISTS (
         SELECT 1 FROM msdb.dbo.sysjobactivity a
         WHERE a.job_id = j.job_id AND a.stop_execution_date IS NULL
       ) THEN 1 ELSE 0 END AS is_running`;

const JOB_FROM = `FROM msdb.dbo.sysjobs j
  LEFT JOIN msdb.dbo.syscategories c ON c.category_id = j.category_id
  OUTER APPLY (
    SELECT TOP (1) run_status, run_date, run_time, run_duration
    FROM msdb.dbo.sysjobhistory
    WHERE job_id = j.job_id AND step_id = 0
    ORDER BY instance_id DESC
  ) h
  OUTER APPLY (
    SELECT TOP (1) next_run_date, next_run_time
    FROM msdb.dbo.sysjobschedules
    WHERE job_id = j.job_id
    ORDER BY next_run_date, next_run_time
  ) nr`;

function mapSummary(row: readonly unknown[]): AgentJobSummary {
  return {
    jobId: text(row[0]),
    name: text(row[1]),
    enabled: flag(row[2]),
    category: text(row[3]),
    owner: text(row[4]),
    lastRunStatus: nullableNumber(row[5]),
    lastRunAt: formatAgentRunTimestamp(nullableNumber(row[6]), nullableNumber(row[7])),
    lastRunDurationSeconds: agentDurationSeconds(nullableNumber(row[8])),
    nextRunAt: formatAgentRunTimestamp(nullableNumber(row[9]), nullableNumber(row[10])),
    multiServer: flag(row[11]),
    running: flag(row[12]),
  };
}

export async function fetchJobs(
  session: MssqlSession,
  search: string,
): Promise<AgentJobSummary[]> {
  const pattern = search.trim() ? `%${escapeLikeValue(search.trim())}%` : null;
  const result = await session.query(
    `SELECT ${JOB_COLUMNS}
     ${JOB_FROM}
     WHERE (@p1 IS NULL OR j.name LIKE @p1 ESCAPE '!')
     ORDER BY j.name`,
    [pattern],
  );
  return result.rows.map(mapSummary);
}

export async function listAgentJobs(
  session: MssqlSession,
  search = '',
): Promise<AgentListResult> {
  try {
    return { ok: true, jobs: await fetchJobs(session, search) };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

export async function fetchJobSummary(
  session: MssqlSession,
  jobName: string,
): Promise<AgentJobSummary | null> {
  const result = await session.query(
    `SELECT ${JOB_COLUMNS} ${JOB_FROM} WHERE j.name = @p1`,
    [jobName],
  );
  const row = result.rows[0];
  return row ? mapSummary(row) : null;
}

export async function fetchJobDetail(
  session: MssqlSession,
  jobName: string,
  historyLimit: number,
): Promise<AgentJobDetail> {
  const summary = await fetchJobSummary(session, jobName);
  if (!summary) throw new Error(`作业「${jobName}」不存在。`);

  const meta = await session.query(
    `SELECT j.description, j.date_created, j.date_modified
     FROM msdb.dbo.sysjobs j WHERE j.name = @p1`,
    [jobName],
  );
  const metaRow = meta.rows[0];
  const description = text(metaRow?.[0]);
  const createdAt = metaRow?.[1] === null ? null : text(metaRow?.[1]);
  const modifiedAt = metaRow?.[2] === null ? null : text(metaRow?.[2]);

  const stepsResult = await session.query(
    `SELECT step_id, step_name, subsystem, command, on_success_action, on_success_step_id,
            on_fail_action, on_fail_step_id, retry_attempts, retry_interval
     FROM msdb.dbo.sysjobsteps
     WHERE job_id = (SELECT job_id FROM msdb.dbo.sysjobs WHERE name = @p1)
     ORDER BY step_id`,
    [jobName],
  );
  const steps: AgentJobStep[] = stepsResult.rows.map((row) => ({
    stepId: number(row[0]),
    stepName: text(row[1]),
    subsystem: text(row[2]),
    command: text(row[3]),
    onSuccessAction: number(row[4]),
    onSuccessStepId: number(row[5]),
    onFailAction: number(row[6]),
    onFailStepId: number(row[7]),
    retryAttempts: number(row[8]),
    retryInterval: number(row[9]),
  }));

  const schedulesResult = await session.query(
    `SELECT s.schedule_id, s.name, s.enabled, s.freq_type, s.freq_interval,
            s.freq_subday_type, s.freq_subday_interval, s.freq_relative_interval,
            s.freq_recurrence_factor, js.next_run_date, js.next_run_time,
            (SELECT COUNT(*) FROM msdb.dbo.sysjobschedules js2
             WHERE js2.schedule_id = s.schedule_id) AS ref_count
     FROM msdb.dbo.sysjobschedules js
     JOIN msdb.dbo.sysschedules s ON s.schedule_id = js.schedule_id
     WHERE js.job_id = (SELECT job_id FROM msdb.dbo.sysjobs WHERE name = @p1)
     ORDER BY s.name`,
    [jobName],
  );
  const schedules: AgentJobSchedule[] = schedulesResult.rows.map((row) => {
    const schedule = {
      scheduleId: number(row[0]),
      name: text(row[1]),
      enabled: flag(row[2]),
      freqType: number(row[3]),
      freqInterval: number(row[4]),
      freqSubdayType: number(row[5]),
      freqSubdayInterval: number(row[6]),
      freqRelativeInterval: number(row[7]),
      freqRecurrenceFactor: number(row[8]),
      nextRunAt: formatAgentRunTimestamp(nullableNumber(row[9]), nullableNumber(row[10])),
      shared: number(row[11]) > 1,
    };
    return { ...schedule, frequency: describeAgentSchedule(schedule) };
  });

  const historyResult = await session.query(
    `SELECT TOP (${historyLimit}) instance_id, step_id, step_name, run_status,
            run_date, run_time, run_duration, ISNULL(message, '') AS message
     FROM msdb.dbo.sysjobhistory
     WHERE job_id = (SELECT job_id FROM msdb.dbo.sysjobs WHERE name = @p1)
     ORDER BY instance_id DESC`,
    [jobName],
  );
  const history: AgentJobHistory[] = historyResult.rows.map((row) => ({
    instanceId: number(row[0]),
    stepId: number(row[1]),
    stepName: text(row[2]),
    runStatus: number(row[3]),
    runAt: formatAgentRunTimestamp(nullableNumber(row[4]), nullableNumber(row[5])) ?? '—',
    durationSeconds: agentDurationSeconds(nullableNumber(row[6])) ?? 0,
    message: text(row[7]),
  }));

  return { ...summary, description, createdAt, modifiedAt, steps, schedules, history };
}

export async function getAgentJobDetail(
  session: MssqlSession,
  jobName: string,
  historyLimit = 100,
): Promise<AgentDetailResult> {
  try {
    const safeLimit = historyLimit === 500 ? 500 : 100;
    return { ok: true, detail: await fetchJobDetail(session, jobName, safeLimit) };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

/** 校验并执行生命周期操作；不做历史记录（由主进程 agent.ts 负责）。 */
export async function executeAgentJobAction(
  session: MssqlSession,
  action: AgentJobAction,
  jobName: string,
): Promise<void> {
  const job = await fetchJobSummary(session, jobName);
  if (!job) throw new Error(`作业「${jobName}」不存在。`);
  if (job.multiServer) {
    throw new Error('多服务器作业请在 SSMS 中管理，DBCraft 不执行启停操作。');
  }
  if (action === 'start' && !job.enabled) {
    throw new Error('作业已禁用，请先启用后再启动。');
  }
  await session.query(buildAgentActionSql(action, jobName));
}

export async function buildAgentScript(
  session: MssqlSession,
  jobName: string,
): Promise<{ script: string; warnings: string[] }> {
  const detail = await fetchJobDetail(session, jobName, 100);
  return buildAgentEditScript(detail);
}
