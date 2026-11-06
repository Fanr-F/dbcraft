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

const app = await electron.launch({
  args: [`--user-data-dir=${workDirectory}`, '.'],
  cwd: projectRoot,
  env: { ...process.env, DBCRAFT_QUERY_TIMEOUT_MS: '2000' },
});
const page = await app.firstWindow();

try {
  await page.waitForSelector('[data-testid="app-shell"]', { timeout: 15000 });

  await page.getByRole('button', { name: '新建连接', exact: true }).first().click();
  await page.locator('.type-card', { hasText: 'SQLite' }).click();
  await page.getByPlaceholder('例如：本地开发库').fill('E2E 演示库');
  await page.getByPlaceholder('选择或粘贴 .db / .sqlite 文件路径').fill(databasePath);
  await page.locator('.field', { hasText: '环境' }).locator('select').selectOption('prod');

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

  // 系统对象默认隐藏；勾选后才出现 sqlite_sequence。
  assert(
    !treeText.includes('sqlite_sequence'),
    'system object sqlite_sequence should be hidden by default',
  );
  await page.locator('.tree-toggle input').check();
  await page.waitForFunction(
    () => document.querySelector('.object-tree')?.textContent?.includes('sqlite_sequence') ?? false,
    null,
    { timeout: 15000 },
  );
  await page.locator('.tree-toggle input').uncheck();
  await page.waitForFunction(
    () =>
      !(document.querySelector('.object-tree')?.textContent?.includes('sqlite_sequence') ?? true),
    null,
    { timeout: 15000 },
  );

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

  // 超过 2000 行时必须给出“仅显示前 N 行”，而不是笼统的“已截断”。
  await page.locator('.sql-editor').fill(
    'WITH RECURSIVE cnt(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM cnt WHERE x < 2001) SELECT x FROM cnt;',
  );
  await page.getByRole('button', { name: '执行' }).click();
  await page.waitForFunction(
    () =>
      document
        .querySelector('.result-pane .badge-warn')
        ?.textContent?.includes('仅显示前 2000 行') ?? false,
    null,
    { timeout: 15000 },
  );
  assert((await statusText(page)).includes('2000 行'), 'truncated row count missing from status bar');

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
  assert(
    (await page.locator('.result-error').innerText()).includes('SQLITE_ERROR'),
    'error metadata missing SQLite error code',
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

  // 生产连接：DELETE 无 WHERE 必须先弹确认；取消后不得执行。
  await page.locator('.sql-editor').fill('DELETE FROM demo_orders;');
  await page.getByRole('button', { name: '执行' }).click();
  await page.waitForSelector('.danger-modal', { timeout: 5000 });
  assert(
    (await page.locator('.danger-modal').innerText()).includes('没有顶层 WHERE'),
    'danger dialog missing DELETE reason',
  );
  await page.locator('.danger-modal').getByRole('button', { name: '取消' }).click();
  await page.waitForFunction(
    () => !document.querySelector('.danger-modal'),
    null,
    { timeout: 5000 },
  );

  await page.locator('.sql-editor').fill('SELECT COUNT(*) AS n FROM demo_orders;');
  await page.getByRole('button', { name: '执行' }).click();
  await page.waitForFunction(
    () => document.querySelector('revo-grid')?.textContent?.includes('1500') ?? false,
    null,
    { timeout: 15000 },
  );

  await page.locator('.sql-editor').fill(
    'WITH RECURSIVE cnt(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM cnt WHERE x < 200000000) SELECT sum(x) FROM cnt;',
  );
  await page.getByRole('button', { name: '执行' }).click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: '取消' }).click();
  await page.waitForFunction(
    () => document.querySelector('.result-error')?.textContent?.includes('查询已取消') ?? false,
    null,
    { timeout: 15000 },
  );
  assert((await statusText(page)).includes('执行失败'), 'status bar did not show cancel failure');

  // SQLite 取消会终止 Worker：会话必须被标记失效，并给出可读原因与「重连」入口。
  await page.waitForFunction(
    () => document.querySelector('.statusbar')?.textContent?.includes('会话失败'),
    null,
    { timeout: 15000 },
  );
  await page.waitForSelector('.session-alert-error', { timeout: 15000 });
  assert(
    (await page.locator('.session-alert-error').innerText()).includes('查询已取消'),
    'session alert missing cancel reason',
  );
  assert(
    (await page.locator('.connection-item').first().getAttribute('class'))?.includes('is-active') ??
      false,
    'connection not active after cancel',
  );

  await page.getByRole('button', { name: '重连' }).click();
  await page.waitForFunction(
    () => document.querySelector('.statusbar')?.textContent?.includes('SQLite 3'),
    null,
    { timeout: 15000 },
  );

  await page.locator('.sql-editor').fill('SELECT 42 AS ok;');
  await page.getByRole('button', { name: '执行' }).click();
  await page.waitForFunction(
    () => document.querySelector('.statusbar')?.textContent?.includes('1 行'),
    null,
    { timeout: 10000 },
  );

  // 超过 2^53 的整数必须原样返回，不能被 JS number 静默四舍五入。
  await page.locator('.sql-editor').fill('SELECT 9007199254740993 AS big;');
  await page.getByRole('button', { name: '执行' }).click();
  await page.waitForFunction(
    () => document.querySelector('revo-grid')?.textContent?.includes('9007199254740993') ?? false,
    null,
    { timeout: 10000 },
  );

  // 标签页 = 独立会话：标签 1 的长查询不应阻塞标签 2。
  await page.locator('.tab-add').click();
  await page.waitForFunction(
    () => document.querySelectorAll('.tab').length === 2,
    null,
    { timeout: 5000 },
  );
  await page.waitForFunction(
    () => document.querySelector('.statusbar')?.textContent?.includes('SQLite 3'),
    null,
    { timeout: 15000 },
  );

  await page.locator('.sql-editor').fill('SELECT 2 AS ok;');
  await page.getByRole('button', { name: '执行' }).click();
  await page.waitForFunction(
    () => document.querySelector('.statusbar')?.textContent?.includes('1 行'),
    null,
    { timeout: 10000 },
  );

  await page.locator('.tab', { hasText: '查询 1' }).click();
  await page.locator('.sql-editor').fill(
    'WITH RECURSIVE cnt(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM cnt WHERE x < 200000000) SELECT sum(x) FROM cnt;',
  );
  await page.getByRole('button', { name: '执行' }).click();
  await page.waitForTimeout(300);

  await page.locator('.tab', { hasText: '查询 2' }).click();
  const secondStarted = Date.now();
  await page.locator('.sql-editor').fill('SELECT 3 AS ok;');
  await page.getByRole('button', { name: '执行' }).click();
  await page.waitForFunction(
    () => document.querySelector('.statusbar')?.textContent?.includes('执行中'),
    null,
    { timeout: 3000 },
  );
  await page.waitForFunction(
    () => document.querySelector('.statusbar')?.textContent?.includes('1 行'),
    null,
    { timeout: 3000 },
  );
  const secondElapsed = Date.now() - secondStarted;
  assert(secondElapsed < 3000, `tab 2 was blocked by tab 1 (${secondElapsed}ms)`);
  console.log('[e2e:sqlite] independent session query ms:', secondElapsed);

  await page.locator('.tab', { hasText: '查询 2' }).click();
  await page.locator('.sql-editor').fill('SELECT 4 AS ok;');
  await page.getByRole('button', { name: '执行' }).click();
  await page.waitForFunction(
    () => document.querySelector('.statusbar')?.textContent?.includes('1 行'),
    null,
    { timeout: 10000 },
  );

  // MOD-04 Phase 1：右键表 → 查看 DDL，应在新标签中给出建表 SQL。
  await page.locator('.tree-item', { hasText: 'demo_users' }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: '查看 DDL' }).click();
  await page.waitForFunction(
    () => document.querySelectorAll('.tab').length === 3,
    null,
    { timeout: 5000 },
  );
  await page.waitForFunction(
    () => document.querySelector('.tab.is-active')?.textContent?.includes('DDL · demo_users') ?? false,
    null,
    { timeout: 5000 },
  );
  const ddlText = await page.locator('.sql-editor').inputValue();
  assert(ddlText.includes('CREATE TABLE demo_users'), 'DDL tab missing CREATE TABLE');
  assert(ddlText.includes('demo_users'), 'DDL tab missing table name');

  // 连接右键 → 生成库级 DDL：包含表与视图。
  await page.locator('.connection-item').first().click({ button: 'right' });
  await page.getByRole('menuitem', { name: '生成库级 DDL' }).click();
  await page.waitForFunction(
    () => document.querySelectorAll('.tab').length === 4,
    null,
    { timeout: 10000 },
  );
  await page.waitForFunction(
    () => document.querySelector('.tab.is-active')?.textContent?.includes('DDL · E2E 演示库') ?? false,
    null,
    { timeout: 5000 },
  );
  const databaseDdl = await page.locator('.sql-editor').inputValue();
  assert(databaseDdl.includes('CREATE TABLE demo_users'), 'database DDL missing table');
  assert(databaseDdl.includes('CREATE VIEW active_users'), 'database DDL missing view');

  // MOD-04 Phase 3：新建表向导 → DDL 预览 → 执行 → 对象树刷新。
  await page.locator('.sidebar-heading .icon-btn[title="新建表"]').click();
  await page.getByPlaceholder('例如：orders').fill('e2e_created');
  await page.getByRole('button', { name: '生成预览' }).click();
  await page.waitForSelector('.ddl-preview', { timeout: 5000 });
  assert(
    (await page.locator('.ddl-preview').inputValue()).includes('CREATE TABLE "e2e_created"'),
    'preview missing CREATE TABLE',
  );
  await page.locator('.designer-modal').getByRole('button', { name: '执行' }).click();
  await page.waitForFunction(
    () => document.querySelector('.object-tree')?.textContent?.includes('e2e_created') ?? false,
    null,
    { timeout: 15000 },
  );

  // MOD-04：添加列，再用查询确认列存在。
  await page.locator('.tree-item', { hasText: 'e2e_created' }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: '添加列…' }).click();
  await page.getByLabel('列名').fill('note');
  await page.getByLabel('列类型').fill('TEXT');
  await page.locator('.modal').getByRole('button', { name: '执行' }).click();
  await page.waitForFunction(
    () => !document.querySelector('.modal'),
    null,
    { timeout: 10000 },
  );
  await page.locator('.sql-editor').fill('SELECT * FROM "e2e_created" LIMIT 1;');
  await page.getByRole('button', { name: '执行' }).click();
  await page.waitForFunction(
    () => document.querySelector('revo-grid')?.textContent?.includes('note') ?? false,
    null,
    { timeout: 15000 },
  );

  // MOD-04：创建/删除索引。
  await page.locator('.tree-item', { hasText: 'e2e_created' }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: '创建索引…' }).click();
  await page.getByPlaceholder('例如：status, created_at').fill('note');
  await page.locator('.modal').getByRole('button', { name: '执行' }).click();
  await page.waitForFunction(() => !document.querySelector('.modal'), null, { timeout: 10000 });

  await page.locator('.sql-editor').fill(
    "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_e2e_created_note';",
  );
  await page.getByRole('button', { name: '执行' }).click();
  await page.waitForFunction(
    () => document.querySelector('revo-grid')?.textContent?.includes('idx_e2e_created_note') ?? false,
    null,
    { timeout: 15000 },
  );

  await page.locator('.tree-item', { hasText: 'e2e_created' }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: '删除索引…' }).click();
  await page.getByPlaceholder('例如：idx_orders_status').fill('idx_e2e_created_note');
  await page.locator('.modal').getByRole('button', { name: '执行' }).click();
  await page.waitForFunction(() => !document.querySelector('.modal'), null, { timeout: 10000 });

  // MOD-04：删除列（输入列名两次确认）。
  await page.locator('.tree-item', { hasText: 'e2e_created' }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: '删除列…' }).click();
  await page.getByPlaceholder('例如：note').fill('note');
  await page.getByLabel('再次输入列名确认').fill('note');
  await page.locator('.modal').getByRole('button', { name: '执行' }).click();
  await page.waitForFunction(() => !document.querySelector('.modal'), null, { timeout: 10000 });

  await page.locator('.sql-editor').fill('SELECT * FROM "e2e_created" LIMIT 1;');
  await page.getByRole('button', { name: '执行' }).click();
  await page.waitForFunction(
    () => document.querySelector('revo-grid')?.textContent?.includes('id') ?? false,
    null,
    { timeout: 15000 },
  );
  assert(
    !(await page.locator('revo-grid').innerText()).includes('note'),
    'dropped column still visible',
  );

  // MOD-04：重命名表与删除表（输入名称确认）。
  await page.locator('.tree-item', { hasText: 'e2e_created' }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: '重命名表…' }).click();
  await page.getByPlaceholder('例如：orders_new').fill('e2e_renamed');
  await page.locator('.modal').getByRole('button', { name: '执行' }).click();
  await page.waitForFunction(
    () => document.querySelector('.object-tree')?.textContent?.includes('e2e_renamed') ?? false,
    null,
    { timeout: 15000 },
  );

  await page.locator('.tree-item', { hasText: 'e2e_renamed' }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: '删除表…' }).click();
  await page.getByPlaceholder('e2e_renamed').fill('e2e_renamed');
  await page.locator('.modal').getByRole('button', { name: '执行' }).click();
  await page.waitForFunction(
    () => !(document.querySelector('.object-tree')?.textContent?.includes('e2e_renamed') ?? false),
    null,
    { timeout: 15000 },
  );

  // MOD-03：查询历史自动记录、打开面板、点击插入编辑器。
  await page.locator('.toolbar .icon-btn[title="查询历史"]').click();
  await page.waitForSelector('.history-row', { timeout: 10000 });
  const historyText = await page.locator('.history-list').innerText();
  assert(historyText.includes('SELECT'), 'history list missing executed SQL');
  await page.locator('.history-row').first().click();
  await page.waitForFunction(
    () => !document.querySelector('.history-modal'),
    null,
    { timeout: 5000 },
  );
  const insertedSql = await page.locator('.sql-editor').inputValue();
  assert(insertedSql.trim().length > 0, 'history insert left editor empty');

  // MOD-05 第一层：双击表打开数据页，分页浏览。
  await page.locator('.tree-item', { hasText: 'demo_users' }).dblclick();
  await page.waitForFunction(
    () => document.querySelector('.tab.is-active')?.textContent?.includes('表 · demo_users') ?? false,
    null,
    { timeout: 5000 },
  );
  await page.waitForFunction(
    () => document.querySelector('.statusbar')?.textContent?.includes('200 行') ?? false,
    null,
    { timeout: 15000 },
  );
  assert(
    (await page.locator('.table-pager').innerText()).includes('第 1 页'),
    'pager missing initial page',
  );
  await page.getByRole('button', { name: '下一页' }).click();
  await page.waitForFunction(
    () => document.querySelector('.table-pager')?.textContent?.includes('第 2 页') ?? false,
    null,
    { timeout: 5000 },
  );
  await page.waitForFunction(
    () => document.querySelector('.statusbar')?.textContent?.includes('200 行') ?? false,
    null,
    { timeout: 15000 },
  );

  // 排序：选择列后 SQL 应带 ORDER BY，方向按钮可切换。
  await page.locator('.table-pager select[aria-label="排序字段"]').selectOption('id');
  await page.waitForFunction(
    () =>
      document.querySelector('.sql-editor')?.value?.includes('ORDER BY "id" ASC') ?? false,
    null,
    { timeout: 5000 },
  );
  await page.getByRole('button', { name: '升序' }).click();
  await page.waitForFunction(
    () =>
      document.querySelector('.sql-editor')?.value?.includes('ORDER BY "id" DESC') ?? false,
    null,
    { timeout: 5000 },
  );

  // 查询超时：e2e 环境把超时设为 2 秒。
  await page.locator('.sql-editor').fill(
    'WITH RECURSIVE cnt(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM cnt WHERE x < 200000000) SELECT sum(x) FROM cnt;',
  );
  await page.getByRole('button', { name: '执行' }).click();
  await page.waitForFunction(
    () => document.querySelector('.result-error')?.textContent?.includes('查询超时') ?? false,
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
