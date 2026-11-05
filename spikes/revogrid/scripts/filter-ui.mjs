import { chromium } from 'playwright-core';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const browser = await chromium.launch({
  executablePath: EDGE,
  headless: true,
  args: ['--disable-gpu', '--no-first-run'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
await page.goto('http://127.0.0.1:5273/', { waitUntil: 'networkidle' });
await page.getByText('User 1', { exact: true }).waitFor({ timeout: 15000 });
await page.waitForTimeout(800);

await page.getByText('Status', { exact: true }).hover();
await page.waitForTimeout(300);
const nodes = await page.evaluate(() =>
  [...document.querySelectorAll('revo-grid [class*="filter"]')].slice(0, 12).map((element) => {
    const rect = element.getBoundingClientRect();
    return {
      tag: element.tagName,
      className: element.className,
      text: element.textContent?.slice(0, 40),
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    };
  }),
);
console.log('FILTER NODES:', JSON.stringify(nodes, null, 2));
await page.mouse.click(640, 128);
await page.waitForTimeout(800);

const text = await page.locator('revo-grid').innerText();
console.log('FILTER UI TEXT:', text.slice(-1200));
await page.screenshot({ path: 'filter-panel.png', fullPage: false });
await browser.close();
