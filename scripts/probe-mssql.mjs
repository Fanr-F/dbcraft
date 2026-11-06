/**
 * MSSQL 联调探活脚本（不启动 Electron）。
 *
 * 用法：
 *   node --env-file=.env.local scripts/probe-mssql.mjs
 *
 * 只读取环境变量，不打印密码；用于验证连接、版本、库列表与 Agent 可用性。
 */
import mssql from 'mssql';

const host = process.env.DBCRAFT_MSSQL_HOST;
const port = Number(process.env.DBCRAFT_MSSQL_PORT || 1433);
const user = process.env.DBCRAFT_MSSQL_USER;
const password = process.env.DBCRAFT_MSSQL_PASSWORD ?? '';
const database = process.env.DBCRAFT_MSSQL_DATABASE || 'master';
const trust = process.env.DBCRAFT_MSSQL_TRUST !== 'false';
const wantEncrypt = process.env.DBCRAFT_MSSQL_ENCRYPT !== 'false';
const connectTimeout = Number(process.env.DBCRAFT_CONNECT_TIMEOUT_MS || 8000);

if (!host || !user) {
  console.error('缺少 DBCRAFT_MSSQL_HOST / DBCRAFT_MSSQL_USER，请先准备 .env.local。');
  process.exit(2);
}

function config(encrypt) {
  return {
    server: host,
    port,
    user,
    password,
    database,
    connectionTimeout: connectTimeout,
    requestTimeout: 20_000,
    options: {
      encrypt,
      trustServerCertificate: trust,
      enableArithAbort: true,
    },
    pool: { max: 1, min: 0, idleTimeoutMillis: 5_000 },
  };
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`连接超过 ${ms}ms 未完成`)), ms),
    ),
  ]);
}

async function main() {
  let pool = null;
  let usedEncrypt = null;
  const candidates = wantEncrypt ? [true, false] : [false];

  for (const encrypt of candidates) {
    try {
      pool = await withTimeout(mssql.connect(config(encrypt)), connectTimeout + 5_000);
      usedEncrypt = encrypt;
      break;
    } catch (error) {
      console.log(`[连接] encrypt=${encrypt} 失败：${error.message}`);
    }
  }

  if (!pool) {
    console.error('[连接] 所有加密模式均失败。');
    process.exit(1);
  }

  console.log(`[连接] 成功 ${host}:${port}（encrypt=${usedEncrypt}, trust=${trust}）`);

  const run = async (label, sql) => {
    try {
      const result = await pool.request().query(sql);
      return result.recordset;
    } catch (error) {
      console.log(`[${label}] 失败：${error.message}（number=${error.number ?? '-'}）`);
      return null;
    }
  };

  const info = await run(
    '版本',
    `SELECT @@VERSION AS version,
            SERVERPROPERTY('ProductVersion') AS product_version,
            SERVERPROPERTY('ProductMajorVersion') AS major_version,
            SERVERPROPERTY('Edition') AS edition,
            SERVERPROPERTY('ServerName') AS server_name,
            DB_NAME() AS current_database,
            SUSER_SNAME() AS login_name,
            IS_SRVROLEMEMBER('sysadmin') AS is_sysadmin`,
  );
  if (info?.[0]) {
    const row = info[0];
    console.log(`[版本] ${String(row.version).split('\n')[0]}`);
    console.log(
      `[版本] ProductVersion=${row.product_version} major=${row.major_version} edition=${row.edition}`,
    );
    console.log(
      `[环境] server=${row.server_name} db=${row.current_database} login=${row.login_name} sysadmin=${row.is_sysadmin}`,
    );
  }

  const databases = await run('库列表', 'SELECT name FROM sys.databases ORDER BY name');
  if (databases) {
    console.log(`[库列表] ${databases.map((row) => row.name).join(', ')}`);
  }

  const agentConfig = await run(
    'Agent XPs',
    `SELECT value_in_use FROM sys.configurations WHERE name = 'Agent XPs'`,
  );
  if (agentConfig?.[0]) {
    console.log(`[Agent] Agent XPs=${agentConfig[0].value_in_use}`);
  }

  const jobs = await run(
    '作业列表',
    `SELECT TOP (5) j.name, j.enabled, c.name AS category_name,
            SUSER_SNAME(j.owner_sid) AS owner_name
     FROM msdb.dbo.sysjobs j
     LEFT JOIN msdb.dbo.syscategories c ON c.category_id = j.category_id
     ORDER BY j.name`,
  );
  if (jobs) {
    console.log(`[作业] 前 ${jobs.length} 个：`);
    for (const job of jobs) {
      console.log(
        `  - ${job.name} enabled=${job.enabled} category=${job.category_name ?? '-'} owner=${job.owner_name ?? '-'}`,
      );
    }
  }

  const lastRun = await run(
    '最近运行',
    `SELECT TOP (3) j.name, h.step_id, h.run_status, h.run_date, h.run_time, h.run_duration
     FROM msdb.dbo.sysjobhistory h
     JOIN msdb.dbo.sysjobs j ON j.job_id = h.job_id
     WHERE h.step_id = 0
     ORDER BY h.instance_id DESC`,
  );
  if (lastRun) {
    console.log(`[最近运行] ${lastRun.length} 条作业级记录`);
    for (const row of lastRun) {
      console.log(
        `  - ${row.name} status=${row.run_status} ${row.run_date} ${String(row.run_time).padStart(6, '0')} duration=${row.run_duration}`,
      );
    }
  }

  await pool.close();
  console.log('[完成] 探活结束。');
}

main().catch((error) => {
  console.error(`[失败] ${error.message}`);
  process.exit(1);
});
