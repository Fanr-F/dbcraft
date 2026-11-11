/**
 * Electron 基础无障碍检查：可访问名称、表单标签、重复 id、语言。
 * 运行：npm run test:a11y
 * 这是最低门槛，不替代完整的人工/axe 审计。
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron } from 'playwright-core';

const projectRoot = resolve(import.meta.dirname, '..');
const workDirectory = mkdtempSync(join(tmpdir(), 'dbcraft-a11y-'));

const app = await electron.launch({
  args: [`--user-data-dir=${workDirectory}`, '.'],
  cwd: projectRoot,
  env: { ...process.env, DBCRAFT_SMOKE: '1' },
});

try {
  const page = await app.firstWindow();
  await page.waitForSelector('[data-testid="app-shell"]', { timeout: 20000 });

  const result = await page.evaluate(() => {
    const issues = [];
    const nameOf = (element) =>
      (
        element.getAttribute('aria-label') ||
        element.getAttribute('title') ||
        element.textContent ||
        ''
      )
        .replace(/\s+/g, ' ')
        .trim();

    if (document.documentElement.lang !== 'zh-CN') {
      issues.push('html lang is not zh-CN');
    }

    for (const button of document.querySelectorAll('button')) {
      if (!nameOf(button)) issues.push(`button without accessible name: ${button.outerHTML.slice(0, 120)}`);
    }

    for (const field of document.querySelectorAll('input, select, textarea')) {
      const labelled =
        field.getAttribute('aria-label') ||
        field.getAttribute('title') ||
        field.closest('label')?.textContent?.trim() ||
        (field.id && document.querySelector(`label[for="${CSS.escape(field.id)}"]`));
      if (!labelled) {
        issues.push(
          `form field without label: ${field.tagName.toLowerCase()} ${field.outerHTML.slice(0, 120)}`,
        );
      }
    }

    const seen = new Set();
    for (const element of document.querySelectorAll('[id]')) {
      if (seen.has(element.id)) issues.push(`duplicate id: ${element.id}`);
      seen.add(element.id);
    }

    return { issues, buttons: document.querySelectorAll('button').length, fields: document.querySelectorAll('input, select, textarea').length };
  });

  if (result.issues.length > 0) {
    console.error('[a11y] issues:', result.issues.slice(0, 30));
    process.exitCode = 1;
  } else {
    console.log(
      `[a11y] passed: ${result.buttons} buttons, ${result.fields} form fields checked`,
    );
  }
} finally {
  await app.close();
  rmSync(workDirectory, { recursive: true, force: true });
}
