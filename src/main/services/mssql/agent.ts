import type { AgentActionResult, AgentScriptResult } from '../../../shared/ipc-contract';
import { buildAgentActionSql } from '../../../shared/agent.ts';
import { createLogger } from '../../logging/logger';
import { recordQueryHistory } from '../../storage/metadata';
import type { MssqlSession } from './MssqlSession.ts';
import { buildAgentScript, executeAgentJobAction } from './agent-queries.ts';

const log = createLogger('agent');

export { getAgentJobDetail, listAgentJobs } from './agent-queries.ts';

export interface AgentHistoryContext {
  connectionId?: string;
  connectionName?: string;
  database?: string;
}

const ACTION_LABELS = {
  start: '启动',
  stop: '停止',
  enable: '启用',
  disable: '禁用',
} as const;

/** 生命周期操作；失败原样返回 SQL Server 原生错误，并写入 agent-control 历史。 */
export async function runAgentJobAction(
  session: MssqlSession,
  action: keyof typeof ACTION_LABELS,
  jobName: string,
  context: AgentHistoryContext = {},
): Promise<AgentActionResult> {
  const startedAt = Date.now();
  const sql = buildAgentActionSql(action, jobName);

  const record = (status: 'success' | 'failed', message: string): void => {
    recordQueryHistory({
      sqlText: sql,
      dialect: 'mssql',
      connectionId: context.connectionId ?? '',
      connectionName: context.connectionName ?? '',
      databaseName: context.database ?? 'msdb',
      status,
      errorMessage: status === 'failed' ? message.slice(0, 500) : null,
      durationMs: Date.now() - startedAt,
      affectedRows: null,
      returnedRows: null,
      source: 'agent-control',
      executedAt: new Date().toISOString(),
    });
  };

  try {
    await executeAgentJobAction(session, action, jobName);
    record('success', '');
    log.info('Agent 生命周期操作完成', { action });
    return {
      ok: true,
      message:
        action === 'stop'
          ? `已请求停止作业「${jobName}」。`
          : `已${ACTION_LABELS[action]}作业「${jobName}」。`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    record('failed', message);
    log.warn('Agent 生命周期操作失败', {
      action,
      code: (error as { number?: number }).number ?? null,
    });
    return { ok: false, message };
  }
}

export async function getAgentEditScript(
  session: MssqlSession,
  jobName: string,
): Promise<AgentScriptResult> {
  try {
    const built = await buildAgentScript(session, jobName);
    return { ok: true, script: built.script, warnings: built.warnings };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}
