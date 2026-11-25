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
const crossDbTableName = 'dbcraft_e2e_crossdb';
const editTableName = 'dbcraft_e2e_edit';

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

  IF OBJECT_ID(N'tempdb.dbo.${crossDbTableName}', N'U') IS NOT NULL
    DROP TABLE tempdb.dbo.${crossDbTableName};
  CREATE TABLE tempdb.dbo.${crossDbTableName} (
    id int NOT NULL PRIMARY KEY,
    name nvarchar(50) NOT NULL
  );
  INSERT INTO tempdb.dbo.${crossDbTableName} (id, name) VALUES (1, N'cross-alpha');

  IF OBJECT_ID(N'tempdb.dbo.${editTableName}', N'U') IS NOT NULL
    DROP TABLE tempdb.dbo.${editTableName};
  CREATE TABLE tempdb.dbo.${editTableName} (
    id int IDENTITY(1,1) NOT NULL PRIMARY KEY,
    name nvarchar(50) NOT NULL,
    qty int NOT NULL
  );
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

  // 锁屏/无桌面会话时 Windows 剪贴板不可用；粘贴用例改用合成 paste 事件。
  const clipboardAvailable = await app.evaluate(({ clipboard }) => {
    try {
      clipboard.writeText('__dbcraft_clipboard_probe__');
      return clipboard.readText() === '__dbcraft_clipboard_probe__';
    } catch {
      return false;
    }
  });
  if (!clipboardAvailable) {
    console.warn('[e2e:mssql] OS clipboard unavailable; using synthetic paste events');
  }

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
  // 系统库默认收起：master 是系统库，先展开数据库节点再找测试表。
  const databaseRow = page.locator('.tree-row', { hasText: config.database }).first();
  if ((await databaseRow.locator('.tree-label-btn').getAttribute('aria-expanded')) === 'false') {
    await databaseRow.locator('.tree-chevron-btn').click();
  }
  await page.waitForFunction(
    () =>
      document.querySelector('.object-tree-body')?.textContent?.includes('dbcraft_e2e_mssql') ??
      false,
    null,
    { timeout: 20000 },
  );

  await page.locator('.cm-content').fill(
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
  await page.locator('.cm-content').fill('SELECT 1 AS a\nGO\nSELECT 2 AS b');
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

  // MSSQL GO n：整个批次重复执行。
  await page.locator('.cm-content').fill('SELECT 1 AS a\nGO 2\nSELECT 2 AS b');
  await page.getByRole('button', { name: '执行', exact: true }).click();
  await page.waitForSelector('.result-tabs', { timeout: 15000 });
  await page.waitForFunction(
    () => document.querySelectorAll('.result-tab').length >= 4,
    null,
    { timeout: 10000 },
  );
  await page.locator('.result-tab', { hasText: '结果 3' }).click();
  await page.waitForFunction(
    () => document.querySelector('revo-grid')?.textContent?.includes('2') ?? false,
    null,
    { timeout: 15000 },
  );
  await page.locator('.result-tab', { hasText: '结果 1' }).click();
  await page.waitForFunction(
    () => document.querySelector('revo-grid')?.textContent?.includes('1') ?? false,
    null,
    { timeout: 15000 },
  );

  // 回归：双击非默认库（tempdb）里的表，表数据页必须自动切到该库。
  // 之前 runQuery 因 sessions 快照过期重新 open 会话时丢掉了 table.database，
  // 会话退回 master，报 Invalid object name（W-20261119-02）。
  const tempdbRow = page.locator('.tree-row', { hasText: 'tempdb' }).first();
  if ((await tempdbRow.locator('.tree-label-btn').getAttribute('aria-expanded')) === 'false') {
    await tempdbRow.locator('.tree-chevron-btn').click();
  }
  await page.waitForFunction(
    () =>
      document.querySelector('.object-tree-body')?.textContent?.includes('dbcraft_e2e_crossdb') ??
      false,
    null,
    { timeout: 20000 },
  );
  await page
    .locator('.tree-label-btn')
    .filter({ hasText: /^dbcraft_e2e_crossdb$/ })
    .first()
    .dblclick();
  await page.waitForFunction(
    () =>
      document.querySelector('.tab.is-active')?.textContent?.includes('tempdb.dbcraft_e2e_crossdb') ??
      false,
    null,
    { timeout: 15000 },
  );
  await page.waitForFunction(
    () => document.querySelector('.statusbar')?.textContent?.includes('库 tempdb') ?? false,
    null,
    { timeout: 20000 },
  );
  assert(
    !(await page.locator('.result-error').count()),
    'cross-database table data should not fail',
  );
  await page.waitForFunction(
    () => document.querySelector('revo-grid')?.textContent?.includes('cross-alpha') ?? false,
    null,
    { timeout: 15000 },
  );
  await page.locator('.tab.is-active .tab-close').click();

  // 回归：MSSQL 表数据页粘贴后提交。MSSQL 的 BEGIN TRANSACTION 不能走 execSql（错误 266），
  // 必须使用驱动原生事务 API（W-20261120-02）。
  await page
    .locator('.tree-label-btn')
    .filter({ hasText: /^dbcraft_e2e_edit$/ })
    .first()
    .dblclick();
  await page.waitForFunction(
    () =>
      document.querySelector('.tab.is-active')?.textContent?.includes('tempdb.dbcraft_e2e_edit') ??
      false,
    null,
    { timeout: 15000 },
  );
  await page.waitForFunction(
    () => document.querySelector('.statusbar')?.textContent?.includes('库 tempdb') ?? false,
    null,
    { timeout: 20000 },
  );
  // 打开表页后会自动聚焦网格宿主；等焦点到位再模拟 Ctrl+V。
  await page.waitForFunction(
    () => document.activeElement?.tagName === 'REVO-GRID',
    null,
    { timeout: 5000 },
  );
  if (clipboardAvailable) {
    await app.evaluate(({ clipboard }) => clipboard.writeText('e2e-row\t7'));
    await page.keyboard.press('Control+V');
  } else {
    await page.evaluate(() => {
      const data = new DataTransfer();
      data.setData('text/plain', 'e2e-row\t7');
      const event = new ClipboardEvent('paste', {
        bubbles: true,
        composed: true,
        cancelable: true,
      });
      // Chromium 不在构造参数里接收 clipboardData，需要显式定义。
      Object.defineProperty(event, 'clipboardData', { value: data });
      const grids = [...document.querySelectorAll('revo-grid')];
      const grid = grids.find((element) => element.offsetParent !== null) ?? grids.at(-1);
      grid?.dispatchEvent(event);
    });
  }
  await page.waitForFunction(
    () => document.querySelector('.badge.badge-warn')?.textContent?.includes('待提交 1 项') ?? false,
    null,
    { timeout: 10000 },
  );
  await page.getByRole('button', { name: '提交修改', exact: true }).click();
  await page.waitForFunction(
    () => !document.querySelector('.badge.badge-warn'),
    null,
    { timeout: 20000 },
  );
  const inserted = await pool
    .request()
    .query(`SELECT name, qty FROM tempdb.dbo.${editTableName}`);
  assert(
    inserted.recordset.length === 1 &&
      inserted.recordset[0].name === 'e2e-row' &&
      inserted.recordset[0].qty === 7,
    `MSSQL table edit commit failed: ${JSON.stringify(inserted.recordset)}`,
  );
  await page.locator('.tab.is-active .tab-close').click();

  // 回归：编辑表结构 grid 保存不能被误判为重命名（W-20261118-12）。
  const designRow = page.locator('.tree-table-row', { hasText: tableName }).first();
  await designRow.click({ button: 'right' });
  await page.getByRole('menuitem', { name: '编辑表结构…', exact: true }).click();
  await page.waitForSelector('.structure-grid', { timeout: 15000 });
  const typeInput = page.getByLabel('第 2 列类型');
  const originalType = await typeInput.inputValue();
  await typeInput.fill(originalType.includes('60') ? 'NVARCHAR(70)' : 'NVARCHAR(60)');
  await page.getByRole('button', { name: '保存并生成 DDL' }).click();
  await page.waitForSelector('.ddl-preview', { timeout: 15000 });
  const preview = await page.locator('.ddl-preview').inputValue();
  assert(preview.includes('ALTER COLUMN'), 'design preview should alter the column');
  assert(!preview.includes('sp_rename'), 'same-name design save must not rename the table');
  assert(
    !(await page.locator('.form-error').filter({ hasText: '新旧表名相同' }).count()),
    'same-name design save must not report 新旧表名相同',
  );
  await page.locator('.table-design-tab').getByRole('button', { name: '执行 DDL' }).click();
  await page.waitForFunction(() => !document.querySelector('.table-design-tab'), null, {
    timeout: 20000,
  });

  // 改名时仍应生成 sp_rename，只预览不执行。
  await page.waitForFunction(
    () => document.querySelector('.object-tree-body')?.textContent?.includes('dbcraft_e2e_mssql') ?? false,
    null,
    { timeout: 20000 },
  );
  await page.locator('.tree-table-row', { hasText: tableName }).first().click({ button: 'right' });
  await page.getByRole('menuitem', { name: '编辑表结构…', exact: true }).click();
  await page.waitForSelector('.structure-grid', { timeout: 15000 });
  await page.getByLabel('表名').fill('dbcraft_e2e_mssql_renamed');
  await page.getByRole('button', { name: '保存并生成 DDL' }).click();
  await page.waitForSelector('.ddl-preview', { timeout: 15000 });
  const renamePreview = await page.locator('.ddl-preview').inputValue();
  assert(renamePreview.includes('sp_rename'), 'rename preview should include sp_rename');
  assert(
    renamePreview.includes('dbcraft_e2e_mssql_renamed'),
    'rename preview should include the new table name',
  );
  await page.locator('.tab.is-active .tab-close').click();
  await page.waitForFunction(() => !document.querySelector('.table-design-tab'), null, {
    timeout: 10000,
  });

  await page.screenshot({ path: screenshotPath });
  console.log('[e2e:mssql] passed');
  console.log('[e2e:mssql]', await statusText(page));
} finally {
  await app?.close();
  await pool
    .request()
    .batch(
      `IF OBJECT_ID(N'dbo.${tableName}', N'U') IS NOT NULL DROP TABLE dbo.${tableName};
       IF OBJECT_ID(N'tempdb.dbo.${crossDbTableName}', N'U') IS NOT NULL
         DROP TABLE tempdb.dbo.${crossDbTableName};
       IF OBJECT_ID(N'tempdb.dbo.${editTableName}', N'U') IS NOT NULL
         DROP TABLE tempdb.dbo.${editTableName};`,
    )
    .catch(() => undefined);
  await pool.close().catch(() => undefined);
  rmSync(workDirectory, { recursive: true, force: true });
}
