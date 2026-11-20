/**
 * DBCraft 自测入口。
 *
 * 默认：纯逻辑测试 + 类型检查 + 构建 + SQLite E2E。
 * 可选：
 *   --with-mssql    追加 check:mssql / check:mssql-multidb（读取 .env.local）
 *   --with-mysql    追加 check:mysql（需 127.0.0.1:3307）
 *   --with-mariadb  追加 check:mariadb（需 127.0.0.1:3308）
 *
 * 用法：npm run self-test [-- --with-mssql]
 */
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';

const args = new Set(process.argv.slice(2));
const withMssql = args.has('--with-mssql');
const withMysql = args.has('--with-mysql');
const withMariadb = args.has('--with-mariadb');

const logicTests = [
  'test:safety',
  'test:groups',
  'test:ddl',
  'test:dml',
  'test:export',
  'test:history',
  'test:errors',
  'test:connection-export',
  'test:timeouts',
  'test:pagination',
  'test:settings',
  'test:sql-highlight',
  'test:sql-format',
  'test:sql-completion',
  'test:completion-core',
  'typecheck:completion',
  'test:metadata',
  'test:sql-brackets',
  'test:sql-mask',
  'test:sql-script',
  'test:xlsx',
  'test:sqlite-rebuild',
  'test:checks',
  'test:mssql',
  'test:table-paste',
];

const steps = [
  ...logicTests.map((script) => ({ label: script, script })),
  { label: 'typecheck', script: 'typecheck' },
  { label: 'build', script: 'build' },
  { label: 'e2e:sqlite', script: 'e2e:sqlite' },
];
if (withMssql) {
  steps.push({ label: 'check:mssql', script: 'check:mssql' });
  steps.push({ label: 'check:mssql-multidb', script: 'check:mssql-multidb' });
}
if (withMysql) steps.push({ label: 'check:mysql', script: 'check:mysql' });
if (withMariadb) steps.push({ label: 'check:mariadb', script: 'check:mariadb' });

const npmCommand = process.platform === 'win32' ? process.env.ComSpec || 'cmd.exe' : 'npm';
const failures = [];

console.log(`[self-test] steps=${steps.length}`);
for (const [index, step] of steps.entries()) {
  const started = performance.now();
  console.log(`\n[self-test] (${index + 1}/${steps.length}) ${step.label}`);
  const commandArgs =
    process.platform === 'win32'
      ? ['/d', '/s', '/c', `npm run ${step.script}`]
      : ['run', step.script];
  const result = spawnSync(npmCommand, commandArgs, {
    stdio: 'inherit',
    env: process.env,
  });
  const elapsed = ((performance.now() - started) / 1000).toFixed(1);
  if (result.error) console.error(`[self-test] ${step.label} spawn error:`, result.error);
  if (result.status !== 0) {
    failures.push(step.label);
    console.error(`[self-test] FAIL ${step.label} (${elapsed}s)`);
  } else {
    console.log(`[self-test] OK ${step.label} (${elapsed}s)`);
  }
}

if (failures.length > 0) {
  console.error(
    `\n[self-test] ${failures.length} failed: ${failures.join(', ')}`,
  );
  process.exit(1);
}

console.log('\n[self-test] all steps passed');
