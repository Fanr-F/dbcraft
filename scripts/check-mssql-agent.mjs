/**
 * 用真实 SQL Server 验证 Agent 查询/脚本/生命周期（不启动 Electron）。
 *
 *   node --no-warnings --env-file=.env.local scripts/check-mssql-agent.mjs
 *
 * 会创建并删除测试作业 dbo?（msdb）dbcraft_agent_check，需 Agent 服务已启动。
 */
import { MssqlSession } from '../src/main/services/mssql/MssqlSession.ts';
import {
  buildAgentScript,
  executeAgentJobAction,
  fetchJobDetail,
  getAgentJobDetail,
  listAgentJobs,
} from '../src/main/services/mssql/agent-queries.ts';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const input = {
  type: 'mssql',
  name: 'mssql-agent-check',
  group: '',
  env: 'dev',
  host: process.env.DBCRAFT_MSSQL_HOST,
  port: Number(process.env.DBCRAFT_MSSQL_PORT || 1433),
  username: process.env.DBCRAFT_MSSQL_USER,
  password: process.env.DBCRAFT_MSSQL_PASSWORD,
  database: process.env.DBCRAFT_MSSQL_DATABASE || 'master',
  encrypt: process.env.DBCRAFT_MSSQL_ENCRYPT !== 'false',
  trustServerCertificate: process.env.DBCRAFT_MSSQL_TRUST !== 'false',
  ...(process.env.DBCRAFT_MSSQL_INSTANCE
    ? { instanceName: process.env.DBCRAFT_MSSQL_INSTANCE }
    : {}),
};

const JOB = 'dbcraft_agent_check';
const session = await MssqlSession.create(input, { connectTimeoutMs: 8000 });
console.log(`[连接] ${session.label} ${session.serverVersion}`);

try {
  await session
    .query(
      `IF EXISTS (SELECT 1 FROM msdb.dbo.sysjobs WHERE name = N'${JOB}')
         EXEC msdb.dbo.sp_delete_job @job_name = N'${JOB}', @delete_history = 1`,
    )
    .catch(() => undefined);

  const list = await listAgentJobs(session);
  assert(list.ok, `list failed: ${list.ok ? '' : list.message}`);
  console.log('[列表]', list.jobs.map((job) => `${job.name}(enabled=${job.enabled})`).join(', '));
  assert(list.jobs.some((job) => job.name === 'syspolicy_purge_history'), 'default job missing');

  const search = await listAgentJobs(session, 'syspolicy');
  assert(search.ok && search.jobs.length === 1, 'search failed');

  await session.query(
    `EXEC msdb.dbo.sp_add_job @job_name = N'${JOB}', @enabled = 0,
       @description = N'DBCraft agent check',
       @category_name = N'[Uncategorized (Local)]', @owner_login_name = N'sa'`,
  );
  await session.query(
    `EXEC msdb.dbo.sp_add_jobserver @job_name = N'${JOB}', @server_name = N'(LOCAL)'`,
  );
  await session.query(
    `EXEC msdb.dbo.sp_add_jobstep @job_name = N'${JOB}', @step_id = 1,
       @step_name = N'noop', @subsystem = N'TSQL', @command = N'WAITFOR DELAY ''00:00:05''',
       @retry_attempts = 0, @retry_interval = 0`,
  );
  await session.query(
    `EXEC msdb.dbo.sp_add_jobschedule @job_name = N'${JOB}', @name = N'dbcraft_agent_sched',
       @enabled = 1, @freq_type = 4, @freq_interval = 1, @active_start_time = 030000`,
  );
  console.log('[准备] 测试作业已创建');

  const detail = await getAgentJobDetail(session, JOB, 100);
  assert(detail.ok, `detail failed: ${detail.ok ? '' : detail.message}`);
  assert(detail.detail.steps.length === 1, 'steps missing');
  assert(detail.detail.steps[0].command.includes('WAITFOR'), 'step command wrong');
  assert(detail.detail.schedules.length === 1, 'schedule missing');
  assert(
    detail.detail.schedules[0].frequency.includes('每天'),
    `frequency wrong: ${detail.detail.schedules[0].frequency}`,
  );
  assert(detail.detail.description === 'DBCraft agent check', 'description wrong');
  console.log('[详情] steps/schedules/history =', detail.detail.steps.length, detail.detail.schedules.length, detail.detail.history.length);

  const built = await buildAgentScript(session, JOB);
  assert(built.script.includes('sp_update_job'), 'job script missing sp_update_job');
  assert(built.script.includes('sp_update_jobstep'), 'job script missing sp_update_jobstep');
  assert(built.script.includes('sp_update_schedule'), 'job script missing sp_update_schedule');
  assert(built.script.includes('USE msdb'), 'job script missing USE msdb');
  console.log('[脚本]\n' + built.script.slice(0, 600) + '...');

  let failed = false;
  try {
    await executeAgentJobAction(session, 'start', JOB);
  } catch (error) {
    failed = String(error.message).includes('禁用');
  }
  assert(failed, 'start on disabled job should be rejected');
  console.log('[拦截] 禁用作业启动被拒绝');

  await executeAgentJobAction(session, 'enable', JOB);
  let after = await fetchJobDetail(session, JOB, 100);
  assert(after.enabled, 'enable failed');

  await executeAgentJobAction(session, 'start', JOB);
  console.log('[启动] 已请求启动');
  await new Promise((resolve) => setTimeout(resolve, 1000));

  await executeAgentJobAction(session, 'stop', JOB);
  console.log('[停止] 已请求停止');

  // 作业历史在步骤/作业结束后落库，轮询等待。
  after = await fetchJobDetail(session, JOB, 100);
  for (let attempt = 0; attempt < 20 && after.history.length === 0; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    after = await fetchJobDetail(session, JOB, 100);
  }
  assert(after.history.length > 0, 'job history should contain a run');
  console.log(
    '[历史]',
    after.history
      .slice(0, 2)
      .map((row) => `${row.stepName}:${row.runStatus}`)
      .join(', '),
  );

  await executeAgentJobAction(session, 'disable', JOB);
  after = await fetchJobDetail(session, JOB, 100);
  assert(!after.enabled, 'disable failed');
  console.log('[禁用] ok');
} finally {
  await session
    .query(
      `IF EXISTS (SELECT 1 FROM msdb.dbo.sysjobs WHERE name = N'${JOB}')
         EXEC msdb.dbo.sp_delete_job @job_name = N'${JOB}', @delete_history = 1`,
    )
    .catch(() => undefined);
  await session.close();
  console.log('[清理] 测试作业已删除，会话已关闭');
}
