/**
 * MSSQL 值格式化与标识符/分页 SQL 的纯逻辑测试（不连接数据库）。
 *
 * 运行：npm run test:mssql
 */
import { formatMssqlCell } from '../src/main/services/mssql/values.ts';
import { normalizeMssqlAddress } from '../src/shared/mssql-address.ts';
import {
  agentDurationSeconds,
  buildAgentActionSql,
  buildAgentEditScript,
  describeAgentSchedule,
  formatAgentRunTimestamp,
} from '../src/shared/agent.ts';
import {
  buildTablePageQuery,
  buildTablePreviewSql,
  quoteIdent,
} from '../src/shared/dialect/identifiers.ts';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function utcDate() {
  return new Date(Date.UTC(2026, 0, 2, 3, 4, 5, 123));
}

assert(
  formatMssqlCell(utcDate(), 'DateTime2') === '2026-01-02 03:04:05.123',
  'datetime2 formatting wrong',
);
assert(
  formatMssqlCell(utcDate(), 'DateTime') === '2026-01-02 03:04:05.123',
  'datetime formatting wrong',
);
assert(formatMssqlCell(utcDate(), 'Date') === '2026-01-02', 'date formatting wrong');
assert(formatMssqlCell(utcDate(), 'Time') === '03:04:05.123', 'time formatting wrong');
assert(
  formatMssqlCell(utcDate(), 'DateTimeOffset') === '2026-01-02T03:04:05.123Z',
  'datetimeoffset should keep the instant',
);
assert(formatMssqlCell(null, 'Int') === null, 'null should stay null');
assert(formatMssqlCell(123.45, 'DecimalN') === '123.45', 'decimal should be string');
assert(formatMssqlCell(42, 'Int') === 42, 'int should stay number');
assert(formatMssqlCell(true, 'Bit') === true, 'bit should stay boolean');
assert(
  String(formatMssqlCell(Buffer.from([1, 2, 255]), 'VarBinary')).startsWith('0x0102ff'),
  'binary should be hex preview',
);

assert(quoteIdent('mssql', 'users') === '[users]', 'plain identifier wrong');
assert(quoteIdent('mssql', 'dbo.users') === '[dbo].[users]', 'qualified identifier wrong');
assert(quoteIdent('mssql', 'a]b') === '[a]]b]', 'bracket escaping wrong');
assert(
  buildTablePreviewSql('mssql', 'dbo.users', 100) === 'SELECT TOP (100) * FROM [dbo].[users];',
  'mssql preview SQL wrong',
);

const page = buildTablePageQuery(
  'mssql',
  'dbo.users',
  50,
  100,
  { column: 'id', direction: 'desc' },
  { column: 'name', value: 'a%b' },
);
assert(
  page.sql ===
    "SELECT * FROM [dbo].[users] WHERE [name] LIKE @p1 ESCAPE '!' ORDER BY [id] DESC OFFSET 100 ROWS FETCH NEXT 50 ROWS ONLY;",
  `mssql page SQL wrong: ${page.sql}`,
);
assert(page.params.length === 1 && page.params[0] === '%a!%b%', 'mssql filter params wrong');

// 命名实例 / host\instance / host:port 解析。
assert(
  JSON.stringify(normalizeMssqlAddress('db-host', 1433)) ===
    JSON.stringify({ host: 'db-host', port: 1433 }),
  'plain address wrong',
);
assert(
  JSON.stringify(normalizeMssqlAddress('db-host\\SQLEXPRESS', 1433)) ===
    JSON.stringify({ host: 'db-host', port: 1433, instanceName: 'SQLEXPRESS' }),
  'host\\instance parsing wrong',
);
assert(
  JSON.stringify(normalizeMssqlAddress('db-host:1444', 1433)) ===
    JSON.stringify({ host: 'db-host', port: 1444 }),
  'host:port parsing wrong',
);
assert(
  JSON.stringify(normalizeMssqlAddress('db-host\\INST', 1433, 'EXPLICIT')) ===
    JSON.stringify({ host: 'db-host', port: 1433, instanceName: 'EXPLICIT' }),
  'explicit instance should win',
);
assert(
  JSON.stringify(normalizeMssqlAddress('\\SQLEXPRESS', 1433)) ===
    JSON.stringify({ host: '', port: 1433, instanceName: 'SQLEXPRESS' }),
  'leading backslash instance wrong',
);
assert(
  JSON.stringify(normalizeMssqlAddress('[::1]:1444', 1433)) ===
    JSON.stringify({ host: '::1', port: 1444 }),
  'ipv6 address wrong',
);

// Agent：时间/耗时/频率/脚本。
assert(
  formatAgentRunTimestamp(20261106, 153015) === '2026-11-06 15:30:15',
  'agent run timestamp wrong',
);
assert(formatAgentRunTimestamp(0, 0) === null, 'empty run timestamp should be null');
assert(agentDurationSeconds(12345) === 5025, 'agent duration wrong');
assert(agentDurationSeconds(0) === 0, 'zero duration wrong');

const daily = describeAgentSchedule({
  scheduleId: 1,
  name: 'daily',
  enabled: true,
  nextRunAt: null,
  shared: false,
  freqType: 4,
  freqInterval: 1,
  freqSubdayType: 1,
  freqSubdayInterval: 0,
  freqRelativeInterval: 0,
  freqRecurrenceFactor: 0,
});
assert(daily === '每天', `daily schedule wrong: ${daily}`);
const weekly = describeAgentSchedule({
  scheduleId: 2,
  name: 'weekly',
  enabled: true,
  nextRunAt: null,
  shared: false,
  freqType: 8,
  freqInterval: 20, // 周二(4) + 周四(16)
  freqSubdayType: 1,
  freqSubdayInterval: 0,
  freqRelativeInterval: 0,
  freqRecurrenceFactor: 1,
});
assert(weekly.includes('周二') && weekly.includes('周四'), `weekly schedule wrong: ${weekly}`);
const complex = describeAgentSchedule({
  scheduleId: 3,
  name: 'complex',
  enabled: true,
  nextRunAt: null,
  shared: false,
  freqType: 999,
  freqInterval: 0,
  freqSubdayType: 0,
  freqSubdayInterval: 0,
  freqRelativeInterval: 0,
  freqRecurrenceFactor: 0,
});
assert(complex.includes('复杂计划'), 'unknown schedule should not be faked');

assert(
  buildAgentActionSql('start', "job'name") ===
    "EXEC msdb.dbo.sp_start_job @job_name = N'job''name'",
  'agent action SQL escaping wrong',
);
assert(
  buildAgentActionSql('disable', 'job') ===
    "EXEC msdb.dbo.sp_update_job @job_name = N'job', @enabled = 0",
  'agent disable SQL wrong',
);

const script = buildAgentEditScript(
  {
    jobId: '1',
    name: "job'name",
    enabled: true,
    category: 'cat',
    owner: 'sa',
    lastRunStatus: 1,
    lastRunAt: null,
    lastRunDurationSeconds: null,
    nextRunAt: null,
    multiServer: false,
    description: "desc'x",
    createdAt: null,
    modifiedAt: null,
    steps: [
      {
        stepId: 1,
        stepName: 'step',
        subsystem: 'TSQL',
        command: "SELECT 'a''b'",
        onSuccessAction: 1,
        onSuccessStepId: 0,
        onFailAction: 2,
        onFailStepId: 0,
        retryAttempts: 0,
        retryInterval: 0,
      },
    ],
    schedules: [
      {
        scheduleId: 9,
        name: 'shared',
        enabled: true,
        frequency: '每天',
        nextRunAt: null,
        shared: true,
        freqType: 4,
        freqInterval: 1,
        freqSubdayType: 1,
        freqSubdayInterval: 0,
        freqRelativeInterval: 0,
        freqRecurrenceFactor: 0,
      },
    ],
    history: [],
  },
  new Date('2026-11-06T00:00:00.000Z'),
);
assert(script.script.includes("N'job''name'"), 'job script should escape quote');
assert(script.script.includes('sp_update_jobstep'), 'job script missing step');
assert(script.script.includes('sp_update_schedule'), 'job script missing schedule');
assert(script.warnings.length === 1, 'shared schedule warning missing');
assert(script.script.includes('多个作业共享'), 'shared warning not in script');

console.log('mssql check passed');
