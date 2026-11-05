import { chromium } from 'playwright-core';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const browser = await chromium.launch({
  executablePath: EDGE,
  headless: true,
  args: ['--disable-gpu', '--no-first-run'],
});
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
await context.grantPermissions(['clipboard-read', 'clipboard-write']);
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
page.on('console', (message) => {
  if (message.text().includes('[spike]')) console.log('BROWSER:', message.text());
});

await page.goto('http://127.0.0.1:5273/', { waitUntil: 'networkidle' });
await page.getByText('User 1', { exact: true }).waitFor({ timeout: 15000 });
await page.waitForTimeout(800);

const statusText = async () => (await page.locator('.statusbar').innerText()).replace(/\s+/g, ' ');
const probeRange = async (label) => {
  const range = await page.evaluate(() => window.__spikeGrid?.getSelectedRange?.());
  console.log(`RANGE ${label}:`, range);
};

await page.getByText('active', { exact: true }).first().click();
await probeRange('status click');
await page.getByText('User 2', { exact: true }).click();
await probeRange('name click');
await page.getByText('user2@example.com', { exact: true }).click();
await probeRange('email click');

// 1) drag a small range and copy
const activeCell = await page.getByText('active', { exact: true }).first().boundingBox();
const ageCell = await page.getByText('20', { exact: true }).first().boundingBox();
if (activeCell && ageCell) {
  await page.mouse.move(activeCell.x + activeCell.width / 2, activeCell.y + activeCell.height / 2);
  await page.mouse.down();
  await page.mouse.move(ageCell.x + ageCell.width / 2, ageCell.y + ageCell.height / 2, { steps: 8 });
  await page.mouse.up();
}
await page.keyboard.press('Control+C');
await page.waitForTimeout(400);
console.log('COPY STATUS:', await statusText());

// 2) custom status editor
await page.getByRole('button', { name: '编辑首行 Status' }).click();
await page.waitForTimeout(500);
console.log('SELECT COUNT:', await page.locator('select').count());
const select = page.locator('select').first();
if ((await select.count()) > 0) {
  await select.selectOption('blocked');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  console.log('EDIT STATUS:', await statusText());
  console.log('EDIT SELECT STILL OPEN:', await page.locator('select').count());
}

// 2b) boolean editor
await page.evaluate(() => window.__spikeGrid?.setCellEdit?.(0, 'active'));
await page.waitForTimeout(400);
console.log('BOOLEAN EDITOR SELECTS:', await page.locator('select').count());
await page.keyboard.press('Escape');
await page.waitForTimeout(200);

// 2c) date editor
await page.evaluate(() => window.__spikeGrid?.setCellEdit?.(0, 'created_at'));
await page.waitForTimeout(400);
console.log('DATE EDITOR INPUTS:', await page.locator('input[type="date"]').count());
await page.keyboard.press('Escape');
await page.waitForTimeout(200);

// 2d) paste a 2x2 range
await page.evaluate(() => window.__spikeGrid?.scrollToRow?.(0));
await page.waitForTimeout(400);
await page.evaluate(() => navigator.clipboard.writeText('alpha\tbeta\ngamma\tdelta'));
await page.getByText('active', { exact: true }).first().click();
await page.keyboard.press('Control+V');
await page.waitForTimeout(500);
console.log('PASTE STATUS:', await statusText());

// 3) context menu -> set null
const user2 = page.getByText('User 2', { exact: true });
await user2.click();
await user2.click({ button: 'right' });
await page.waitForTimeout(300);
console.log('CONTEXT MENU VISIBLE:', await page.getByRole('button', { name: '设为 NULL' }).count());
await page.getByRole('button', { name: '设为 NULL' }).click();
await page.waitForTimeout(400);
console.log('NULL STATUS:', await statusText());

// 4) scroll to middle
await page.getByRole('button', { name: '滚动到 12,500 行' }).click();
await page.waitForTimeout(800);
const bodyText = await page.locator('revo-grid').innerText();
console.log('SCROLLED TO 12500:', bodyText.includes('User 12500'));
console.log('SCROLL STATUS:', await statusText());

await page.getByText('Status', { exact: true }).hover();
await page.waitForTimeout(400);
console.log('FILTER UI NODES:', await page.locator('revo-grid [class*="filter"]').count());
await page.screenshot({ path: 'filter-hover.png', fullPage: false });

// 5) large-text / Chinese editor (last because it moves the viewport)
await page.evaluate(() => window.__spikeGrid?.setCellEdit?.(0, 'notes'));
await page.waitForTimeout(400);
console.log('NOTE EDITOR TEXTAREAS:', await page.locator('textarea').count());
const note = page.locator('textarea').first();
if ((await note.count()) > 0) {
  await note.fill('中文备注：RevoGrid 编辑器测试');
  await note.blur();
  await page.waitForTimeout(400);
  console.log('NOTE EDIT STATUS:', await statusText());
  console.log('NOTE CHINESE VISIBLE:', (await page.locator('revo-grid').innerText()).includes('中文备注'));
}

console.log('ERRORS:', errors.length ? errors : 'none');
await page.screenshot({ path: 'interactions.png', fullPage: false });
await browser.close();
