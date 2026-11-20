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

  await page.getByRole('button', { name: '保存', exact: true }).click();
  // 保存连接只写配置；点击连接打开对象树，右击「查询」才创建 tab + session。
  await page.locator('.connection-item').first().click();
  await page.waitForFunction(
    () => document.querySelectorAll('.tree-item').length >= 3,
    null,
    { timeout: 15000 },
  );
  await page.locator('.connection-item').first().click({ button: 'right' });
  await page.getByRole('menuitem', { name: '查询', exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector('.statusbar')?.textContent?.includes('SQLite 3'),
    null,
    { timeout: 15000 },
  );

  const treeText = await page.locator('.object-tree-body').innerText();
  assert(treeText.includes('demo_users'), 'table demo_users missing from object tree');
  assert(treeText.includes('active_users'), 'view active_users missing from object tree');

  // 查询超时由设置面板下发；环境变量只在未下发时兜底。
  await page.locator('.toolbar .icon-btn[title="设置"]').click();
  await page.waitForSelector('.modal', { timeout: 5000 });
  await page.locator('.modal .field', { hasText: '查询超时' }).locator('select').selectOption('10000');
  await page.locator('.modal').getByRole('button', { name: '保存', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.modal'), null, { timeout: 5000 });

  // 系统对象默认隐藏；勾选后才出现 sqlite_sequence。
  assert(
    !treeText.includes('sqlite_sequence'),
    'system object sqlite_sequence should be hidden by default',
  );
  await page.locator('.tree-toggle input').check();
  await page.waitForFunction(
    () => document.querySelector('.object-tree-body')?.textContent?.includes('sqlite_sequence') ?? false,
    null,
    { timeout: 15000 },
  );
  await page.locator('.tree-toggle input').uncheck();
  await page.waitForFunction(
    () =>
      !(document.querySelector('.object-tree-body')?.textContent?.includes('sqlite_sequence') ?? true),
    null,
    { timeout: 15000 },
  );

  await page.locator('.tree-item', { hasText: 'demo_users' }).click();
  const editorValue = await page.locator('.cm-content').innerText();
  assert(editorValue.includes('SELECT * FROM "demo_users"'), 'table click did not fill SQL');

  await page.getByRole('button', { name: '执行', exact: true }).click();
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

  // CodeMirror：输入时自动补全、Ctrl+Shift+F 格式化、Ctrl+Z 撤销格式化。
  await page.locator('.cm-content').fill('sel');
  await page.waitForSelector('.cm-tooltip-autocomplete', { timeout: 5000 });
  assert(
    (await page.locator('.cm-tooltip-autocomplete').innerText()).includes('SELECT'),
    'completion popup did not offer SELECT',
  );
  await page.keyboard.press('Escape');

  // 列上下文自动补全：INSERT 列清单、WHERE、ORDER BY 都应直接给出列。
  const expectColumnCompletion = async (sql) => {
    await page.locator('.cm-content').fill(sql);
    await page.waitForFunction(
      () =>
        document
          .querySelector('.cm-tooltip-autocomplete')
          ?.textContent?.includes('name') ?? false,
      null,
      { timeout: 5000 },
    );
    await page.keyboard.press('Escape');
  };
  await expectColumnCompletion('INSERT INTO demo_users (');
  await expectColumnCompletion('INSERT INTO demo_users (id, ');
  // 没有 FROM 时 SELECT 列表没有列可给，但逗号后仍应弹出关键字/函数候选。
  await page.locator('.cm-content').fill('SELECT id, ');
  await page.waitForSelector('.cm-tooltip-autocomplete', { timeout: 5000 });
  await page.keyboard.press('Escape');
  await expectColumnCompletion('SELECT * FROM demo_users WHERE ');
  await expectColumnCompletion('SELECT * FROM demo_users ORDER BY id, ');

  // Tab：光标处插入缩进、整行缩进/反缩进，且不把焦点移出编辑器。
  await page.locator('.cm-content').fill('SELECT 1;');
  const beforeTab = await page.evaluate(
    () => document.querySelector('.cm-content')?.textContent?.length ?? 0,
  );
  await page.keyboard.press('End');
  await page.keyboard.press('Tab');
  const afterTab = await page.evaluate(
    () => document.querySelector('.cm-content')?.textContent?.length ?? 0,
  );
  assert(afterTab === beforeTab + 2, `Tab did not insert 2 spaces: ${beforeTab} -> ${afterTab}`);
  assert(
    await page.evaluate(
      () => document.activeElement?.classList.contains('cm-content') ?? false,
    ),
    'Tab moved focus out of the editor',
  );

  await page.locator('.cm-content').fill('SELECT 1;');
  await page.keyboard.press('Control+Home');
  await page.keyboard.press('Shift+End');
  await page.keyboard.press('Tab');
  assert(
    (await page.locator('.cm-content').innerText()).startsWith('  SELECT 1;'),
    'Tab did not indent the selected line',
  );
  await page.keyboard.press('Shift+Tab');
  assert(
    (await page.locator('.cm-content').innerText()).startsWith('SELECT 1;'),
    'Shift+Tab did not outdent the selected line',
  );

  // 补全弹层打开时 Tab 接受候选。
  await page.locator('.cm-content').fill('SELECT * FROM dem');
  await page.waitForSelector('.cm-tooltip-autocomplete', { timeout: 5000 });
  await page.keyboard.press('Tab');
  await page.waitForFunction(
    () => !document.querySelector('.cm-tooltip-autocomplete'),
    null,
    { timeout: 2000 },
  );
  const tabCompletion = await page.locator('.cm-content').innerText();
  assert(
    tabCompletion.includes('demo_'),
    `Tab did not accept completion: ${JSON.stringify(tabCompletion)}`,
  );

  await page.locator('.cm-content').fill('select id, name from users');
  await page.waitForTimeout(600);
  await page.keyboard.press('Control+Shift+F');
  await page.waitForFunction(
    () => document.querySelector('.cm-content')?.innerText?.includes('SELECT') ?? false,
    null,
    { timeout: 5000 },
  );
  const formattedEditorText = await page.locator('.cm-content').innerText();
  assert(
    formattedEditorText.split('\n').length > 1 && formattedEditorText.includes('FROM'),
    `format did not produce multiline SQL:\n${formattedEditorText}`,
  );
  await page.keyboard.press('Control+Z');
  await page.waitForFunction(
    () =>
      document.querySelector('.cm-content')?.innerText?.includes('select id, name from users') ??
      false,
    null,
    { timeout: 5000 },
  );

  // 快捷键要压过 CodeMirror 默认键位（Ctrl+Enter 默认是插入空行）。
  await page.locator('.cm-content').fill('SELECT 42 AS ok;');
  await page.keyboard.press('Control+Enter');
  await page.waitForFunction(
    () => document.querySelector('.statusbar')?.textContent?.includes('1 行') ?? false,
    null,
    { timeout: 15000 },
  );

  // F5 与工具栏「执行」一致：无选区执行整段 SQL。
  await page.locator('.cm-content').fill('SELECT 7 AS f5;');
  await page.keyboard.press('F5');
  await page.waitForFunction(
    () => document.querySelector('revo-grid')?.textContent?.includes('7') ?? false,
    null,
    { timeout: 15000 },
  );

  // 选区格式化：只重排选中语句，未选中的语句保持原样。
  await page.locator('.cm-content').fill('select a from t;\nselect b from u;');
  await page.keyboard.press('Control+Home');
  await page.keyboard.press('Shift+End');
  await page.keyboard.press('Control+Shift+F');
  await page.waitForFunction(
    () => {
      const text = document.querySelector('.cm-content')?.innerText ?? '';
      return text.includes('SELECT') && text.includes('select b from u;');
    },
    null,
    { timeout: 5000 },
  );
  await page.keyboard.press('Control+Z');
  await page.waitForFunction(
    () => (document.querySelector('.cm-content')?.innerText ?? '').includes('select a from t;'),
    null,
    { timeout: 5000 },
  );

  // 工具栏「格式化」按钮同样按选区处理。
  await page.keyboard.press('Control+Home');
  await page.keyboard.press('Shift+End');
  await page.getByRole('button', { name: '格式化', exact: true }).click();
  await page.waitForFunction(
    () => {
      const text = document.querySelector('.cm-content')?.innerText ?? '';
      return text.includes('SELECT') && text.includes('select b from u;');
    },
    null,
    { timeout: 5000 },
  );

  // 结果集不再截断：2001 行全部加载，状态栏显示真实行数。
  await page.locator('.cm-content').fill(
    'WITH RECURSIVE cnt(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM cnt WHERE x < 2001) SELECT x FROM cnt;',
  );
  await page.getByRole('button', { name: '执行', exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector('.statusbar')?.textContent?.includes('2001 行') ?? false,
    null,
    { timeout: 15000 },
  );
  assert(
    !((await page.locator('.result-pane .badge-warn').allInnerTexts()).join(' ').includes('仅显示前')),
    'result should not be truncated',
  );

  await page.locator('.cm-content').fill("UPDATE demo_users SET status = 'blocked' WHERE id = 1;");
  await page.getByRole('button', { name: '执行', exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector('.result-pane')?.textContent?.includes('1 行受影响'),
    null,
    { timeout: 15000 },
  );

  await page.locator('.cm-content').fill('SELECT * FROM missing_table;');
  await page.getByRole('button', { name: '执行', exact: true }).click();
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

  await page.locator('.cm-content').fill('SELECT 1 AS a; SELECT 2 AS b;');
  await page.getByRole('button', { name: '执行', exact: true }).click();
  await page.waitForSelector('.result-tabs', { timeout: 15000 });
  await page.waitForFunction(
    () => document.querySelectorAll('.result-tab').length >= 3,
    null,
    { timeout: 5000 },
  );
  assert(
    (await page.locator('.result-tabs').innerText()).includes('结果 1') &&
      (await page.locator('.result-tabs').innerText()).includes('结果 2'),
    'multi-statement result tabs missing',
  );
  await page.waitForFunction(
    () => document.querySelector('revo-grid')?.textContent?.includes('1') ?? false,
    null,
    { timeout: 15000 },
  );
  await page.locator('.result-tab', { hasText: '结果 2' }).click();
  await page.waitForFunction(
    () => document.querySelector('revo-grid')?.textContent?.includes('2') ?? false,
    null,
    { timeout: 15000 },
  );
  await page.locator('.result-tab', { hasText: '消息' }).click();
  await page.waitForSelector('.result-messages', { timeout: 5000 });
  assert(
    (await page.locator('.result-messages').innerText()).includes('SELECT 1 AS a;'),
    'message panel missing statement text',
  );

  // 多语句遇错停止：第一条结果保留，失败原因进入消息面板，后续语句不执行。
  await page.locator('.cm-content').fill(
    'SELECT 10 AS ok; SELECT * FROM missing_multi; SELECT 20 AS never;',
  );
  await page.getByRole('button', { name: '执行', exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector('.result-messages')?.textContent?.includes('no such table') ?? false,
    null,
    { timeout: 15000 },
  );
  assert(
    (await page.locator('.result-messages').innerText()).includes('后续 1 条未执行'),
    'message panel missing stop note',
  );
  assert(
    (await page.locator('.result-tabs').innerText()).includes('结果 1'),
    'first result should remain after later failure',
  );

  // 生产连接：DELETE 无 WHERE 必须先弹确认；取消后不得执行。
  await page.locator('.cm-content').fill('DELETE FROM demo_orders;');
  await page.getByRole('button', { name: '执行', exact: true }).click();
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

  await page.locator('.cm-content').fill('SELECT COUNT(*) AS n FROM demo_orders;');
  await page.getByRole('button', { name: '执行', exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector('revo-grid')?.textContent?.includes('1500') ?? false,
    null,
    { timeout: 15000 },
  );

  await page.locator('.cm-content').fill(
    'WITH RECURSIVE cnt(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM cnt WHERE x < 200000000) SELECT sum(x) FROM cnt;',
  );
  await page.getByRole('button', { name: '执行', exact: true }).click();
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

  await page.getByRole('button', { name: '重连', exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector('.statusbar')?.textContent?.includes('SQLite 3'),
    null,
    { timeout: 15000 },
  );

  await page.locator('.cm-content').fill('SELECT 42 AS ok;');
  await page.getByRole('button', { name: '执行', exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector('.statusbar')?.textContent?.includes('1 行'),
    null,
    { timeout: 10000 },
  );

  // 超过 2^53 的整数必须原样返回，不能被 JS number 静默四舍五入。
  await page.locator('.cm-content').fill('SELECT 9007199254740993 AS big;');
  await page.getByRole('button', { name: '执行', exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector('revo-grid')?.textContent?.includes('9007199254740993') ?? false,
    null,
    { timeout: 10000 },
  );

  // 标签页 = 独立会话：标签 1 的长查询不应阻塞标签 2。
  const tabCountBeforeAdd = await page.locator('.tab').count();
  await page.locator('.tab-add').click();
  await page.waitForFunction(
    (expected) => document.querySelectorAll('.tab').length === expected,
    tabCountBeforeAdd + 1,
    { timeout: 5000 },
  );
  try {
    await page.waitForFunction(
      () => document.querySelector('.statusbar')?.textContent?.includes('SQLite 3'),
      null,
      { timeout: 15000 },
    );
  } catch (error) {
    console.error('[e2e] status after new tab:', await statusText(page));
    console.error('[e2e] tabs:', await page.locator('.tab').allInnerTexts());
    console.error('[e2e] alerts:', await page.locator('.session-alert').allInnerTexts());
    throw error;
  }

  await page.locator('.cm-content').fill('SELECT 2 AS ok;');
  await page.getByRole('button', { name: '执行', exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector('.statusbar')?.textContent?.includes('1 行'),
    null,
    { timeout: 10000 },
  );

  await page.locator('.tab', { hasText: '查询 2' }).click();
  await page.locator('.cm-content').fill(
    'WITH RECURSIVE cnt(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM cnt WHERE x < 200000000) SELECT sum(x) FROM cnt;',
  );
  await page.getByRole('button', { name: '执行', exact: true }).click();
  await page.waitForTimeout(300);

  await page.locator('.tab', { hasText: '查询 3' }).click();
  const secondStarted = Date.now();
  await page.locator('.cm-content').fill('SELECT 3 AS ok;');
  await page.getByRole('button', { name: '执行', exact: true }).click();
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

  await page.locator('.tab', { hasText: '查询 3' }).click();
  await page.locator('.cm-content').fill('SELECT 4 AS ok;');
  await page.getByRole('button', { name: '执行', exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector('.statusbar')?.textContent?.includes('1 行'),
    null,
    { timeout: 10000 },
  );

  // MOD-04 Phase 1：右键表 → 复制 DDL，剪贴板里应是建表 SQL（不再单独开 DDL 标签）。
  const tabCountBeforeDdl = await page.locator('.tab').count();
  await page.locator('.tree-item', { hasText: 'demo_users' }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: '复制 DDL' }).click();
  await page.waitForFunction(
    () => document.querySelector('.toast')?.textContent?.includes('已复制 demo_users 的 DDL') ?? false,
    null,
    { timeout: 10000 },
  );
  assert(
    (await page.locator('.tab').count()) === tabCountBeforeDdl,
    'copy DDL should not open a new tab',
  );
  const ddlText = await app.evaluate(({ clipboard }) => clipboard.readText());
  assert(ddlText.includes('CREATE TABLE demo_users'), 'copied DDL missing CREATE TABLE');
  assert(ddlText.includes('demo_users'), 'copied DDL missing table name');

  // 连接右键 → 生成库级 DDL：包含表与视图。
  await page.locator('.connection-item').first().click({ button: 'right' });
  await page.getByRole('menuitem', { name: '生成库级 DDL' }).click();
  await page.waitForFunction(
    (expected) => document.querySelectorAll('.tab').length === expected,
    tabCountBeforeDdl + 1,
    { timeout: 10000 },
  );
  await page.waitForFunction(
    () => document.querySelector('.tab.is-active')?.textContent?.includes('DDL · E2E 演示库') ?? false,
    null,
    { timeout: 5000 },
  );
  const databaseDdl = await page.locator('.cm-content').innerText();
  assert(databaseDdl.includes('CREATE TABLE demo_users'), 'database DDL missing table');
  assert(databaseDdl.includes('CREATE VIEW active_users'), 'database DDL missing view');

  // MOD-04 Phase 3：新建表页签 → DDL 预览 → 执行 → 对象树刷新。
  await page.locator('.connection-object-actions .icon-btn[title="新建表"]').click();
  await page.waitForSelector('.table-design-tab', { timeout: 10000 });
  await page.getByPlaceholder('例如：orders').fill('e2e_created');
  await page.getByRole('button', { name: '保存并生成 DDL' }).click();
  await page.waitForSelector('.ddl-preview', { timeout: 5000 });
  assert(
    (await page.locator('.ddl-preview').inputValue()).includes('CREATE TABLE "e2e_created"'),
    'preview missing CREATE TABLE',
  );
  assert(
    (await page.locator('.table-design-db').count()) === 0,
    'SQLite should hide the database selector',
  );
  await page.locator('.table-design-tab').getByRole('button', { name: '执行 DDL' }).click();
  await page.waitForFunction(() => !document.querySelector('.table-design-tab'), null, {
    timeout: 15000,
  });
  await page.waitForFunction(
    () => document.querySelector('.object-tree-body')?.textContent?.includes('e2e_created') ?? false,
    null,
    { timeout: 15000 },
  );

  // 右击表 → 编辑表结构页签（独立会话，不能改绑当前 SQL 标签）。
  await page.locator('.tree-item', { hasText: 'e2e_created' }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: '编辑表结构…' }).click();
  await page.waitForSelector('.table-design-tab', { timeout: 15000 });
  assert(
    (await page.locator('.table-design-header').innerText()).includes('编辑表结构'),
    'edit structure tab missing title',
  );
  await page.locator('.table-design-tab').getByRole('button', { name: '添加列' }).click();
  await page.getByLabel('第 2 列列名').fill('e2e_struct_col');
  await page.getByLabel('第 2 列类型').fill('TEXT');
  await page.getByRole('button', { name: '保存并生成 DDL' }).click();
  await page.waitForSelector('.ddl-preview', { timeout: 5000 });
  assert(
    (await page.locator('.ddl-preview').inputValue()).includes('ADD COLUMN "e2e_struct_col"'),
    'edit structure preview missing ADD COLUMN',
  );
  await page.locator('.table-design-tab').getByRole('button', { name: '执行 DDL' }).click();
  await page.waitForFunction(() => !document.querySelector('.table-design-tab'), null, {
    timeout: 15000,
  });

  // 编辑列类型：SQLite 走整表重建（多语句 + 外键检查关闭）。
  await page.locator('.tree-item', { hasText: 'e2e_created' }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: '编辑表结构…' }).click();
  await page.waitForSelector('.table-design-tab', { timeout: 15000 });
  await page.getByLabel('第 2 列类型').fill('INTEGER');
  await page.getByRole('button', { name: '保存并生成 DDL' }).click();
  await page.waitForSelector('.ddl-preview', { timeout: 5000 });
  assert(
    (await page.locator('.ddl-preview').inputValue()).includes('__dbcraft_rebuild_e2e_created'),
    'edit type preview missing SQLite rebuild',
  );
  await page.locator('.table-design-tab').getByRole('button', { name: '执行 DDL' }).click();
  await page.waitForFunction(() => !document.querySelector('.table-design-tab'), null, {
    timeout: 15000,
  });

  // MOD-04：添加列统一走「编辑表结构…」页签。
  await page.locator('.tree-item', { hasText: 'e2e_created' }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: '编辑表结构…' }).click();
  await page.waitForSelector('.table-design-tab', { timeout: 15000 });
  await page.locator('.table-design-tab').getByRole('button', { name: '添加列' }).click();
  await page.getByLabel('第 3 列列名').fill('note');
  await page.getByLabel('第 3 列类型').fill('TEXT');
  await page.getByRole('button', { name: '保存并生成 DDL' }).click();
  await page.waitForSelector('.ddl-preview', { timeout: 5000 });
  assert(
    (await page.locator('.ddl-preview').inputValue()).includes('ADD COLUMN "note"'),
    'add column preview missing ADD COLUMN',
  );
  await page.locator('.table-design-tab').getByRole('button', { name: '执行 DDL' }).click();
  await page.waitForFunction(() => !document.querySelector('.table-design-tab'), null, {
    timeout: 15000,
  });
  await page.locator('.cm-content').fill('SELECT * FROM "e2e_created" LIMIT 1;');
  await page.getByRole('button', { name: '执行', exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector('revo-grid')?.textContent?.includes('note') ?? false,
    null,
    { timeout: 15000 },
  );

  // MOD-04：创建/删除索引合并到「管理索引…」。
  await page.locator('.tree-item', { hasText: 'e2e_created' }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: '管理索引…' }).click();
  await page.getByPlaceholder('例如：status, created_at').fill('note');
  await page.locator('.modal').getByRole('button', { name: '执行', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.modal'), null, { timeout: 10000 });

  await page.locator('.cm-content').fill(
    "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_e2e_created_note';",
  );
  await page.getByRole('button', { name: '执行', exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector('revo-grid')?.textContent?.includes('idx_e2e_created_note') ?? false,
    null,
    { timeout: 15000 },
  );

  await page.locator('.tree-item', { hasText: 'e2e_created' }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: '管理索引…' }).click();
  await page.getByRole('tab', { name: '删除索引', exact: true }).click();
  await page.getByPlaceholder('例如：idx_orders_status').fill('idx_e2e_created_note');
  await page.locator('.modal').getByRole('button', { name: '执行', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.modal'), null, { timeout: 10000 });

  // MOD-04：删除列也走「编辑表结构…」，在 DDL 预览里输入表名确认。
  await page.locator('.tree-item', { hasText: 'e2e_created' }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: '编辑表结构…' }).click();
  await page.waitForSelector('.table-design-tab', { timeout: 15000 });
  await page.locator('.table-design-tab').getByRole('button', { name: '删除第 3 列' }).click();
  await page.getByRole('button', { name: '保存并生成 DDL' }).click();
  await page.waitForSelector('.ddl-preview', { timeout: 5000 });
  await page.getByLabel('输入表名确认删除列').fill('e2e_created');
  await page.locator('.table-design-tab').getByRole('button', { name: '执行 DDL' }).click();
  await page.waitForFunction(() => !document.querySelector('.table-design-tab'), null, {
    timeout: 15000,
  });

  await page.locator('.cm-content').fill('SELECT * FROM "e2e_created" LIMIT 1;');
  await page.getByRole('button', { name: '执行', exact: true }).click();
  await page.waitForFunction(
    () => {
      const text = document.querySelector('revo-grid')?.textContent ?? '';
      return text.includes('id') && !text.includes('note');
    },
    null,
    { timeout: 15000 },
  );

  // MOD-04：重命名表与删除表（输入名称确认）。
  await page.locator('.tree-item', { hasText: 'e2e_created' }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: '重命名表…' }).click();
  await page.getByPlaceholder('例如：orders_new').fill('e2e_renamed');
  await page.locator('.modal').getByRole('button', { name: '执行', exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector('.object-tree-body')?.textContent?.includes('e2e_renamed') ?? false,
    null,
    { timeout: 15000 },
  );

  await page.locator('.tree-item', { hasText: 'e2e_renamed' }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: '删除表…' }).click();
  await page.getByPlaceholder('e2e_renamed').fill('e2e_renamed');
  await page.locator('.modal').getByRole('button', { name: '执行', exact: true }).click();
  await page.waitForFunction(
    () => !(document.querySelector('.object-tree-body')?.textContent?.includes('e2e_renamed') ?? false),
    null,
    { timeout: 15000 },
  );

  // MOD-03：Ctrl+E 打开历史、搜索命中高亮、点击记录插入编辑器光标处。
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+E' : 'Control+E');
  await page.waitForSelector('.history-modal', { timeout: 10000 });
  await page.waitForSelector('.history-row', { timeout: 10000 });
  const historyText = await page.locator('.history-list').innerText();
  assert(historyText.includes('SELECT'), 'history list missing executed SQL');
  await page.getByLabel('搜索查询历史').fill('SELECT');
  await page.waitForFunction(
    () => Boolean(document.querySelector('.history-match')),
    null,
    { timeout: 5000 },
  );
  await page.locator('.history-row').first().click();
  await page.waitForFunction(
    () => !document.querySelector('.history-modal'),
    null,
    { timeout: 5000 },
  );
  const insertedSql = await page.locator('.cm-content').innerText();
  assert(insertedSql.trim().length > 0, 'history insert left editor empty');

  // MOD-05 第一层：双击表打开数据页，分页浏览。
  await page.locator('.tree-item', { hasText: 'demo_users' }).dblclick();
  await page.waitForFunction(
    () => {
      const tab = document.querySelector('.tab.is-active')?.textContent ?? '';
      return tab.includes('表 ·') && tab.includes('demo_users');
    },
    null,
    { timeout: 5000 },
  );
  await page.waitForFunction(
    () => document.querySelector('.statusbar')?.textContent?.includes('200 行') ?? false,
    null,
    { timeout: 15000 },
  );
  // SQLite 表数据页必须可编辑（不能因为 main 触发 USE 失败而变只读）。
  assert(
    (await page.locator('revo-grid').getAttribute('readonly')) === 'false',
    'SQLite table data grid should be editable',
  );
  assert(
    !(await page.getByRole('button', { name: '新增行', exact: true }).isDisabled()),
    'SQLite table data 新增行 should be enabled',
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
      document.querySelector('.cm-content')?.innerText?.includes('ORDER BY "id" ASC') ?? false,
    null,
    { timeout: 5000 },
  );
  await page.getByRole('button', { name: '升序' }).click();
  await page.waitForFunction(
    () =>
      document.querySelector('.cm-content')?.innerText?.includes('ORDER BY "id" DESC') ?? false,
    null,
    { timeout: 5000 },
  );

  // 类型化过滤：列 + 操作符 + 值生成参数化 WHERE。
  await page.locator('.table-pager select[aria-label="过滤列"]').selectOption('name');
  await page.locator('.table-pager select[aria-label="过滤操作符"]').selectOption('contains');
  await page.locator('.table-pager input[aria-label="过滤值"]').fill('user');
  await page.getByRole('button', { name: '添加条件' }).click();
  await page.waitForFunction(
    () =>
      document.querySelector('.cm-content')?.innerText?.includes('WHERE "name" LIKE ? ESCAPE \'!\'') ??
      false,
    null,
    { timeout: 5000 },
  );
  await page.getByRole('button', { name: '清除', exact: true }).click();
  await page.waitForFunction(
    () => !(document.querySelector('.cm-content')?.innerText?.includes('WHERE "name"') ?? false),
    null,
    { timeout: 5000 },
  );

  // 列布局：隐藏列写入 localStorage，重置后清空。
  await page.locator('.grid-layout summary').click();
  const nameColumnToggle = page
    .locator('.grid-layout-columns label', { hasText: 'name' })
    .locator('input');
  await nameColumnToggle.uncheck();
  const hiddenColumns = await page.evaluate(() => {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index) ?? '';
      if (!key.startsWith('dbcraft.gridLayout.')) continue;
      return (JSON.parse(localStorage.getItem(key) ?? '{}').hidden) ?? [];
    }
    return [];
  });
  assert(hiddenColumns.includes('name'), 'column hide was not persisted');
  await page.getByRole('button', { name: '重置列宽与隐藏' }).click();
  const resetHidden = await page.evaluate(() => {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index) ?? '';
      if (!key.startsWith('dbcraft.gridLayout.')) continue;
      return (JSON.parse(localStorage.getItem(key) ?? '{}').hidden) ?? [];
    }
    return [];
  });
  assert(resetHidden.length === 0, 'column layout reset failed');
  await page.locator('.grid-layout summary').click();

  // MOD-05：从 Excel/TSV 粘贴多行多列。没有单元格焦点时从第一个可写列、
  // 行尾开始追加待提交新增行；非数字写入 REAL 列要标红。
  await app.evaluate(({ clipboard }) =>
    clipboard.writeText(
      '用户A\ta@example.com\tactive\t2024-01-01\tabc\t备注A\n用户B\tb@example.com\tpending\t2024-01-02\t3.5\t备注B',
    ),
  );
  await page.getByRole('button', { name: '从 Excel 粘贴', exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector('.toast')?.textContent?.includes('类型不匹配') ?? false,
    null,
    { timeout: 5000 },
  );
  await page.waitForFunction(
    () => document.querySelector('.badge.badge-warn')?.textContent?.includes('待提交 2 项') ?? false,
    null,
    { timeout: 5000 },
  );
  // 新增行在 200 行之外，必须自动滚动过去，否则用户看不到粘贴结果。
  await page.waitForFunction(
    () => document.querySelector('revo-grid')?.textContent?.includes('用户A') ?? false,
    null,
    { timeout: 5000 },
  );
  await page.locator('button[title="丢弃本次修改并重新加载"]').click();
  await page.waitForFunction(
    () => !document.querySelector('.badge.badge-warn'),
    null,
    { timeout: 15000 },
  );

  // 查询超时：上面把设置面板的查询超时调成了 10 秒。
  await page.locator('.cm-content').fill(
    'WITH RECURSIVE cnt(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM cnt WHERE x < 200000000) SELECT sum(x) FROM cnt;',
  );
  await page.getByRole('button', { name: '执行', exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector('.result-error')?.textContent?.includes('查询超时') ?? false,
    null,
    { timeout: 20000 },
  );

  await page.screenshot({ path: screenshotPath });
  console.log('[e2e:sqlite] passed');
  console.log('[e2e:sqlite]', await statusText(page));
} finally {
  await app.close();
  rmSync(workDirectory, { recursive: true, force: true });
}
