import type {
  AgentJobAction,
  AgentJobDetail,
  AgentJobSchedule,
} from './ipc-contract';
import { sqlNString } from './dialect/identifiers.ts';

/**
 * 把 sysjobhistory 的 run_date/run_time 还原成 `YYYY-MM-DD HH:mm:ss`。
 * 数据库里分别是 20261106 和 153015 这样的整数；无效值返回 null。
 */
export function formatAgentRunTimestamp(
  runDate: number | null | undefined,
  runTime: number | null | undefined,
): string | null {
  if (!runDate) return null;
  const date = String(runDate).padStart(8, '0');
  const time = String(runTime ?? 0).padStart(6, '0');
  if (!/^\d{8}$/.test(date) || !/^\d{6}$/.test(time)) return null;
  return `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)} ${time.slice(
    0,
    2,
  )}:${time.slice(2, 4)}:${time.slice(4, 6)}`;
}

/** sysjobhistory.run_duration 是 HHMMSS 形式的整数；转成秒。 */
export function agentDurationSeconds(runDuration: number | null | undefined): number | null {
  if (runDuration === null || runDuration === undefined) return null;
  const text = String(Math.max(0, Math.trunc(runDuration))).padStart(6, '0');
  const hours = Number(text.slice(0, text.length - 4));
  const minutes = Number(text.slice(-4, -2));
  const seconds = Number(text.slice(-2));
  return hours * 3600 + minutes * 60 + seconds;
}

/** sysjobhistory.run_status → 中文；未知值不伪造。 */
export function agentRunStatusLabel(status: number | null | undefined): string {
  switch (status) {
    case 0:
      return '失败';
    case 1:
      return '成功';
    case 2:
      return '重试';
    case 3:
      return '已取消';
    case 4:
      return '运行中';
    default:
      return '—';
  }
}

const WEEKDAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const RELATIVE_INTERVALS = ['第 1 个', '第 2 个', '第 3 个', '第 4 个', '最后一个'];

function weekdayNames(mask: number): string {
  const names: string[] = [];
  for (let day = 0; day < 7; day += 1) {
    if ((mask & (1 << day)) !== 0) names.push(WEEKDAY_NAMES[day]!);
  }
  return names.length > 0 ? names.join('、') : '（未指定星期）';
}

function subdaySuffix(schedule: Omit<AgentJobSchedule, 'frequency'>): string {
  if (!schedule.freqSubdayType || schedule.freqSubdayInterval <= 0) return '';
  const interval = schedule.freqSubdayInterval;
  switch (schedule.freqSubdayType) {
    case 1:
      // 在指定时间执行一次，没有“重复”语义。
      return '';
    case 2:
      return `，每 ${interval} 秒重复`;
    case 4:
      return `，每 ${interval} 分钟重复`;
    case 8:
      return `，每 ${interval} 小时重复`;
    default:
      return `，重复方式 ${schedule.freqSubdayType}`;
  }
}

/**
 * 按 PRD 4.8.4 覆盖常见 freq_type；无法解析时返回原始字段提示，
 * 不假装理解复杂计划。
 */
export function describeAgentSchedule(
  schedule: Omit<AgentJobSchedule, 'frequency'>,
): string {
  const base = (() => {
    switch (schedule.freqType) {
      case 1:
        return '一次性';
      case 4:
        return schedule.freqInterval > 1
          ? `每 ${schedule.freqInterval} 天`
          : '每天';
      case 8:
        return `每 ${schedule.freqRecurrenceFactor || 1} 周：${weekdayNames(
          schedule.freqInterval,
        )}`;
      case 16:
        return `每 ${schedule.freqRecurrenceFactor || 1} 月第 ${schedule.freqInterval} 天`;
      case 32: {
        const which =
          RELATIVE_INTERVALS[schedule.freqRelativeInterval - 1] ??
          `第 ${schedule.freqRelativeInterval} 个`;
        return `每 ${schedule.freqRecurrenceFactor || 1} 月${which}${weekdayNames(
          schedule.freqInterval,
        )}`;
      }
      case 64:
        return 'SQL Server Agent 空闲时';
      case 128:
        return 'SQL Server Agent 启动时';
      case 256:
        return '登录时';
      default:
        return `复杂计划（freq_type=${schedule.freqType}），请用 SSMS 查看`;
    }
  })();

  if (schedule.freqType === 1 || schedule.freqType >= 64) return base;
  return `${base}${subdaySuffix(schedule)}`;
}

/** 生命周期操作生成的存储过程调用；作业名来自数据库元数据，仍按 N 字符串转义。 */
export function buildAgentActionSql(action: AgentJobAction, jobName: string): string {
  const name = sqlNString(jobName);
  switch (action) {
    case 'start':
      return `EXEC msdb.dbo.sp_start_job @job_name = ${name}`;
    case 'stop':
      return `EXEC msdb.dbo.sp_stop_job @job_name = ${name}`;
    case 'enable':
      return `EXEC msdb.dbo.sp_update_job @job_name = ${name}, @enabled = 1`;
    case 'disable':
      return `EXEC msdb.dbo.sp_update_job @job_name = ${name}, @enabled = 0`;
  }
}

function bracket(value: string | null | undefined): string {
  return value && value.trim() ? value.trim() : '';
}

/**
 * 生成作业配置的 ALTER 风格脚本（PRD 4.8.5）。
 * @step_id / @schedule_id 使用生成时快照；共享计划会在头部和对应语句前警告。
 */
export function buildAgentEditScript(
  detail: AgentJobDetail,
  now = new Date(),
): { script: string; warnings: string[] } {
  const warnings: string[] = [];
  const shared = detail.schedules.filter((schedule) => schedule.shared);
  for (const schedule of shared) {
    warnings.push(
      `计划「${schedule.name}」被多个作业共享，sp_update_schedule 会影响其他作业；建议改用 sp_add_schedule + sp_attach_schedule 创建作业私有计划。`,
    );
  }

  const lines: string[] = [
    `-- 由 DBCraft 生成（Job: ${detail.name}，${now.toISOString()}）。`,
    '-- 修改下方脚本后请核对再执行。新增/删除步骤或计划请改用 sp_add_jobstep / sp_delete_jobstep / sp_add_schedule / sp_attach_schedule / sp_detach_schedule。',
    '-- @step_id / @schedule_id 为生成时快照；若脚本中增删或重排步骤，请自行调整后续 @step_id。',
    `-- 编辑范围：作业属性、已有步骤、已附加计划；新增/删除对象只给出改法，不生成破坏性语句。`,
  ];
  for (const warning of warnings) lines.push(`-- 警告：${warning}`);
  lines.push('USE msdb', 'GO', '');

  const jobArgs = [
    `@job_name = ${sqlNString(detail.name)}`,
    `@enabled = ${detail.enabled ? 1 : 0}`,
  ];
  if (detail.description) jobArgs.push(`@description = ${sqlNString(detail.description)}`);
  if (bracket(detail.category)) jobArgs.push(`@category_name = ${sqlNString(detail.category)}`);
  if (bracket(detail.owner)) jobArgs.push(`@owner_login_name = ${sqlNString(detail.owner)}`);
  lines.push(`EXEC dbo.sp_update_job ${jobArgs.join(', ')}`, 'GO', '');

  for (const step of detail.steps) {
    lines.push(
      `EXEC dbo.sp_update_jobstep @job_name = ${sqlNString(detail.name)}, @step_id = ${step.stepId},`,
      `     @step_name = ${sqlNString(step.stepName)}, @subsystem = ${sqlNString(step.subsystem)},`,
      `     @command = ${sqlNString(step.command)},`,
      `     @on_success_action = ${step.onSuccessAction}, @on_success_step_id = ${step.onSuccessStepId},`,
      `     @on_fail_action = ${step.onFailAction}, @on_fail_step_id = ${step.onFailStepId},`,
      `     @retry_attempts = ${step.retryAttempts}, @retry_interval = ${step.retryInterval}`,
      'GO',
      '',
    );
  }

  for (const schedule of detail.schedules) {
    if (schedule.shared) {
      lines.push(`-- 警告：计划「${schedule.name}」被多个作业共享，修改会影响其他作业。`);
    }
    lines.push(
      `EXEC dbo.sp_update_schedule @schedule_id = ${schedule.scheduleId},`,
      `     @name = ${sqlNString(schedule.name)}, @enabled = ${schedule.enabled ? 1 : 0},`,
      `     @freq_type = ${schedule.freqType}, @freq_interval = ${schedule.freqInterval},`,
      `     @freq_subday_type = ${schedule.freqSubdayType}, @freq_subday_interval = ${schedule.freqSubdayInterval},`,
      `     @freq_relative_interval = ${schedule.freqRelativeInterval}, @freq_recurrence_factor = ${schedule.freqRecurrenceFactor}`,
      'GO',
      '',
    );
  }

  return { script: `${lines.join('\n').trimEnd()}\n`, warnings };
}
