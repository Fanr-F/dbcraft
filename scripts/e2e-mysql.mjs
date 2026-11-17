/**
 * MySQL 真实实例 UI E2E：
 * - 通过连接表单连接便携 MySQL（默认 127.0.0.1:3307）
 * - 验证对象树、查询结果、多语句结果页签/消息面板
 *
 * 运行：npm run e2e:mysql
 * 前置：spikes/mysql-auth/scripts/setup.ps1 已启动实例，root 空密码。
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron } from 'playwright-core';
import mysql from 'mysql2/promise';

const projectRoot = resolve(import.meta.dirname, '..');
const workDirectory = mkdtempSync(join(tmpdir(), 'dbcraft-e2e-mysql-'));
const screenshotPath = join(workDirectory, 'mysql-e2e.png');
const databaseName = `dbcraft_e2e_mysql_${process.pid}`;

const envPrefix = 'DBCRAFT_MYSQL';
const config = {
  host: process.env[`${envPrefix}_HOST`] ?? '127.0.0.1',
  port: Number(process.env[`${envPrefix}_PORT`] ?? 3307),
  user: process.env[`${envPrefix}_USER`] ?? 'root',
  password: process.env[`${envPrefix}_PASSWORD`] ?? '',
};

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

/** 建临时库和表；脚本失败时也能在 finally 清理。 */
const admin = await mysql.createConnection({
  host: config.host,
  port: config.port,
  user: config.user,
  password: config.password,
  multipleStatements: false,
});
await admin.query(`DROP DATABASE IF EXISTS \`${databaseName}\``);
await admin.query(
  `CREATE DATABASE \`${databaseName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
);
await admin.query(
  `CREATE TABLE \`${databaseName}\`.items (id int NOT NULL PRIMARY KEY, name varchar(50) NOT NULL)`,
);
await admin.query(
  `INSERT INTO \`${databaseName}\`.items (id, name) VALUES (1, 'alpha'), (2, 'beta')`,
);

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
  await page.locator('.type-card', { hasText: 'MySQL' }).click();
  await fillField(page, '连接名称', 'E2E MySQL');
  await fillField(page, '主机', config.host);
  await fillField(page, '端口', String(config.port));
  await fillField(page, '用户名', config.user);
  await fillField(page, '密码', config.password);
  await fillField(page, '数据库', databaseName);
  await page.locator('.field', { hasText: 'SSL 模式' }).locator('select').selectOption('disable');

  await page.getByRole('button', { name: '测试连接' }).click();
  await page.waitForSelector('.test-result', { timeout: 15000 });
  const testResult = await page.locator('.test-result').innerText();
  assert(/MySQL/i.test(testResult), `connection test did not return MySQL: ${testResult}`);

  await page.getByRole('button', { name: '保存', exact: true }).click();
  // 保存连接只写配置；点击连接打开对象树，右击「查询」创建 tab + session。
  await page.locator('.connection-item').first().click();
  await page.waitForSelector('.object-tree-body', { timeout: 20000 });
  await page.locator('.connection-item').first().click({ button: 'right' });
  await page.getByRole('menuitem', { name: '查询', exact: true }).click();
  await page.waitForFunction(
    () => /MySQL\s+\d/.test(document.querySelector('.statusbar')?.textContent ?? ''),
    null,
    { timeout: 20000 },
  );
  await page.waitForFunction(
    () =>
      document.querySelector('.object-tree-body')?.textContent?.includes('items') ?? false,
    null,
    { timeout: 20000 },
  );

  await page.locator('.cm-content').fill('SELECT id, name FROM items ORDER BY id;');
  await page.getByRole('button', { name: '执行', exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector('revo-grid')?.textContent?.includes('alpha') ?? false,
    null,
    { timeout: 20000 },
  );
  assert((await statusText(page)).includes('2 行'), 'status bar should show 2 rows');

  // 多语句：结果页签 + 消息面板。
  await page.locator('.cm-content').fill('SELECT 1 AS a; SELECT 2 AS b;');
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
  assert(messages.includes('SELECT 1 AS a;'), 'message panel missing first statement');
  assert(messages.includes('SELECT 2 AS b;'), 'message panel missing second statement');

  await page.screenshot({ path: screenshotPath });
  console.log('[e2e:mysql] passed');
  console.log('[e2e:mysql]', await statusText(page));
} finally {
  await app?.close();
  await admin.query(`DROP DATABASE IF EXISTS \`${databaseName}\``).catch(() => undefined);
  await admin.end().catch(() => undefined);
  rmSync(workDirectory, { recursive: true, force: true });
}
