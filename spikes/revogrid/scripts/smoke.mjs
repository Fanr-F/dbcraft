import { chromium } from 'playwright-core';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

const browser = await chromium.launch({
  executablePath: EDGE,
  headless: true,
  args: ['--disable-gpu', '--no-first-run'],
});

const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
const failedRequests = [];
page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(`console: ${message.text()}`);
});
page.on('response', (response) => {
  if (response.status() >= 400) failedRequests.push(`${response.status()} ${response.url()}`);
});

await page.goto('http://127.0.0.1:5273/', { waitUntil: 'networkidle' });
let waitError = null;
try {
  await page.waitForFunction(
    () => Boolean(document.querySelector('revo-grid revogr-data')),
    { timeout: 10000 },
  );
} catch (error) {
  waitError = error.message;
}
await page.waitForTimeout(1500);

const info = await page.evaluate(() => {
  const grid = document.querySelector('revo-grid');
  const rect = grid?.getBoundingClientRect();
  const bodyText = grid?.textContent ?? '';
  return {
    title: document.querySelector('h1')?.textContent,
    gridFound: Boolean(grid),
    gridRect: rect ? { width: rect.width, height: rect.height } : null,
    customElementDefined: Boolean(customElements.get('revo-grid')),
    gridConstructor: grid?.constructor?.name,
    lightHtml: grid?.innerHTML?.slice(0, 400),
    dataFound: Boolean(grid?.querySelector('revogr-data')),
    dataHtml: grid?.querySelector('revogr-data')?.innerHTML?.slice(0, 1200),
    rowHeadersFound: Boolean(grid?.querySelector('revogr-row-headers')),
    clipboardFound: Boolean(grid?.querySelector('revogr-clipboard')),
    hasUser1: bodyText.includes('User 1'),
    hasUser25000: bodyText.includes('User 25000'),
    visibleText: bodyText.slice(0, 500),
  };
});

console.log(JSON.stringify({ ...info, waitError }, null, 2));
console.log('FAILED REQUESTS:', failedRequests.length ? failedRequests : 'none');
console.log('ERRORS:', errors.length ? errors : 'none');

await page.screenshot({ path: 'smoke.png', fullPage: false });
await browser.close();
