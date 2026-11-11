/**
 * MSSQL 真实实例 UI E2E：
 * - 读取 .env.local 的连接信息
 * - 通过连接表单连接，验证对象树、查询结果、MSSQL `GO` 多语句
 *
 * 运行：npm run e2e:mssql
 * 会创建并删除 dbo.dbcraft_e2e_mssql，只使用测试库连接。
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron } from 'playwright-core';
import sql from 'mssql';

const projectRoot = resolve(import.meta.dirname, '..');
const workDirectory = mkdtempSync(join(tmpdir(), 'dbcraft-e2e-mssql-'));
const screenshotPath = join(workDirectory, 'mssql-e2e.png');
const tableName = 'dbcraft_e2e_mssql';

const config = {
  host: process.env.DBCRAFT_MSSQL_HOST,
  port: Number(process.env.DBCRAFT_MSSQL_PORT ?? 1433),
  user: process.env.DBCRAFT_MSSQL_USER,
  password: process.env.DBCRAFT_MSSQL_PASSWORD,
  database: process.env.DBCRAFT_MSSQL_DATABASE ?? 'master',
  encrypt: process.env.DBCRAFT_MSSQL_ENCRYPT !== 'false',
  trust: process.env.DBCRAFT_MSSQL_TRUST !== 'false',
};

if (!config.host || !config.user || config.password === undefined) {
  throw new Error('缺少 MSSQL 连接配置；请在 .env.local 设置 DBCRAFT_MSSQL_*。');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function statusText(page) {
  return page.locator('.statusbar').innerText().then((text) => text.replace(/\s+/g, ' '));
}

async function fillField(page, label, value) {
  const field = page.locator('.field', { hasText: label }).first();
  await field.locator('input').first().fill(value);
}

const pool = await sql.connect({
  server: config.host,
  port: config.port,
  user: config.user,
  password: config.password,
  database: config.database,
  connectionTimeout: 8000,
  requestTimeout: 15000,
  options: {
    encrypt: config.encrypt,
    trustServerCertificate: config.trust,
  },
});

await pool.request().batch(`
  IF OBJECT_ID(N'dbo.${tableName}', N'U') IS NOT NULL DROP TABLE dbo.${tableName};
  CREATE TABLE dbo.${tableName} (
    id int NOT NULL PRIMARY KEY,
    name nvarchar(50) NOT NULL
  );
  INSERT INTO dbo.${tableName} (id, name) VALUES (1, N'alpha'), (2, N'beta');
`);

let app = null;
let page = null;
try {
  app = await electron.launch({
    args: [`--user-data-dir=${workDirectory}`, '.'],
    cwd: projectRoot,
    env: { ...process.env, DBCRAFT_QUERY_TIMEOUT_MS: '20000' },
  });
  page = await app.firstWindow();

  await page.waitForSelector('[data-testid="app-shell"]', { timeout: 15000 });

  await page.getByRole('button', { name: '新建连接', exact: true }).first().click();
  await page.locator('.type-card', { hasText: 'MSSQL' }).click();
  await fillField(page, '连接名称', 'E2E MSSQL');
  await fillField(page, '主机', config.host);
  await fillField(page, '端口', String(config.port));
  await fillField(page, '用户名', config.user);
  await fillField(page, '密码', config.password);
  await fillField(page, '数据库', config.database);
  await page.locator('.check', { hasText: '信任服务器证书' }).locator('input').check();

  await page.getByRole('button', { name: '测试连接' }).click();
  await page.waitForSelector('.test-result', { timeout: 15000 });
  const testResult = await page.locator('.test-result').innerText();
  assert(/SQL Server/i.test(testResult), `connection test did not return SQL Server: ${testResult}`);

  await page.getByRole('button', { name: '保存', exact: true }).click();
  // 保存连接只写配置；点击连接打开对象树，右击「查询」创建 tab + session。
  await page.locator('.connection-item').first().click();
  await page.waitForSelector('.object-tree-body', { timeout: 20000 });
  await page.locator('.connection-item').first().click({ button: 'right' });
  await page.getByRole('menuitem', { name: '查询', exact: true }).click();
  await page.waitForFunction(
    () => /T-SQL|Microsoft SQL Server/i.test(document.querySelector('.statusbar')?.textContent ?? ''),
    null,
    { timeout: 20000 },
  );
  await page.waitForFunction(
    () =>
      document.querySelector('.object-tree-body')?.textContent?.includes('dbcraft_e2e_mssql') ??
      false,
    null,
    { timeout: 20000 },
  );

  await page.locator('.sql-editor').fill(
    `SELECT id, name FROM dbo.${tableName} ORDER BY id;`,
  );
  await page.getByRole('button', { name: '执行', exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector('revo-grid')?.textContent?.includes('alpha') ?? false,
    null,
    { timeout: 20000 },
  );
  assert((await statusText(page)).includes('2 行'), 'status bar should show 2 rows');

  // MSSQL GO：两条语句应生成两个结果页签，GO 不进入消息面板。
  await page.locator('.sql-editor').fill('SELECT 1 AS a\nGO\nSELECT 2 AS b');
  await page.getByRole('button', { name: '执行', exact: true }).click();
  await page.waitForSelector('.result-tabs', { timeout: 15000 });
  await page.waitForFunction(
    () => document.querySelectorAll('.result-tab').length >= 3,
    null,
    { timeout: 5000 },
  );
  await page.locator('.result-tab', { hasText: '结果 2' }).click();
  await page.waitForFunction(
    () => document.querySelector('revo-grid')?.textContent?.includes('2') ?? false,
    null,
    { timeout: 15000 },
  );
  await page.locator('.result-tab', { hasText: '消息' }).click();
  await page.waitForSelector('.result-messages', { timeout: 5000 });
  const messages = await page.locator('.result-messages').innerText();
  assert(messages.includes('SELECT 1 AS a'), 'message panel missing first GO batch');
  assert(messages.includes('SELECT 2 AS b'), 'message panel missing second GO batch');
  assert(!/\bGO\b/.test(messages), 'GO should not be sent as SQL');

  await page.screenshot({ path: screenshotPath });
  console.log('[e2e:mssql] passed');
  console.log('[e2e:mssql]', await statusText(page));
} finally {
  await app?.close();
  await pool
    .request()
    .batch(
      `IF OBJECT_ID(N'dbo.${tableName}', N'U') IS NOT NULL DROP TABLE dbo.${tableName};`,
    )
    .catch(() => undefined);
  await pool.close().catch(() => undefined);
  rmSync(workDirectory, { recursive: true, force: true });
}
