import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron } from 'playwright-core';

const projectRoot = resolve(import.meta.dirname, '..');
const workDirectory = mkdtempSync(join(tmpdir(), 'dbcraft-e2e-'));
const databasePath = join(workDirectory, 'demo.db');
const screenshotPath = join(workDirectory, 'sqlite-e2e.png');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function statusText(page) {
  return page.locator('.statusbar').innerText().then((text) => text.replace(/\s+/g, ' '));
}

const seed = spawnSync(
  process.execPath,
  [join(projectRoot, 'scripts', 'create-demo-db.mjs'), databasePath],
  { cwd: projectRoot, encoding: 'utf8' },
);
assert(seed.status === 0, `seed failed: ${seed.stderr || seed.stdout}`);

const app = await electron.launch({ args: ['.'], cwd: projectRoot });
const page = await app.firstWindow();

try {
  await page.waitForSelector('[data-testid="app-shell"]', { timeout: 15000 });

  await page.getByRole('button', { name: '新建连接', exact: true }).first().click();
  await page.locator('.type-card', { hasText: 'SQLite' }).click();
  await page.getByPlaceholder('例如：本地开发库').fill('E2E 演示库');
  await page.getByPlaceholder('选择或粘贴 .db / .sqlite 文件路径').fill(databasePath);

  await page.getByRole('button', { name: '测试连接' }).click();
  await page.waitForSelector('.test-result', { timeout: 10000 });
  assert(
    (await page.locator('.test-result').innerText()).includes('SQLite 3'),
    'connection test did not return SQLite version',
  );

  await page.getByRole('button', { name: '保存' }).click();
  await page.waitForFunction(
    () => document.querySelector('.statusbar')?.textContent?.includes('SQLite 3'),
    null,
    { timeout: 15000 },
  );
  await page.waitForFunction(
    () => document.querySelectorAll('.tree-item').length >= 3,
    null,
    { timeout: 15000 },
  );

  const treeText = await page.locator('.object-tree').innerText();
  assert(treeText.includes('demo_users'), 'table demo_users missing from object tree');
  assert(treeText.includes('active_users'), 'view active_users missing from object tree');

  await page.locator('.tree-item', { hasText: 'demo_users' }).click();
  const editorValue = await page.locator('.sql-editor').inputValue();
  assert(editorValue.includes('SELECT * FROM "demo_users"'), 'table click did not fill SQL');

  await page.getByRole('button', { name: '执行' }).click();
  await page.waitForFunction(
    () => document.querySelector('.statusbar')?.textContent?.includes('100 行'),
    null,
    { timeout: 15000 },
  );
  await page.waitForFunction(
    () => document.querySelector('revo-grid')?.textContent?.includes('User 1') ?? false,
    null,
    { timeout: 15000 },
  );
  assert((await page.locator('revo-grid').innerText()).includes('User 1'), 'result grid missing User 1');

  await page.locator('.sql-editor').fill("UPDATE demo_users SET status = 'blocked' WHERE id = 1;");
  await page.getByRole('button', { name: '执行' }).click();
  await page.waitForFunction(
    () => document.querySelector('.result-pane')?.textContent?.includes('1 行受影响'),
    null,
    { timeout: 15000 },
  );

  await page.locator('.sql-editor').fill('SELECT * FROM missing_table;');
  await page.getByRole('button', { name: '执行' }).click();
  await page.waitForSelector('.result-error', { timeout: 15000 });
  assert(
    (await page.locator('.result-error').innerText()).includes('no such table'),
    'missing table error not shown',
  );
  assert((await statusText(page)).includes('执行失败'), 'status bar did not show failure');

  await page.locator('.sql-editor').fill('SELECT 1; SELECT 2;');
  await page.getByRole('button', { name: '执行' }).click();
  await page.waitForFunction(
    () =>
      document
        .querySelector('.result-error')
        ?.textContent?.includes('一次只能执行一条 SQL') ?? false,
    null,
    { timeout: 15000 },
  );

  await page.screenshot({ path: screenshotPath });
  console.log('[e2e:sqlite] passed');
  console.log('[e2e:sqlite]', await statusText(page));
} finally {
  await app.close();
  rmSync(workDirectory, { recursive: true, force: true });
}
