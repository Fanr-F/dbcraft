/**
 * 应用设置解析的纯逻辑测试。
 *
 * 运行：npm run test:settings
 */
import {
  DEFAULT_APP_SETTINGS,
  RESULT_ROW_LIMIT_OPTIONS,
  normalizeAppSettings,
  normalizeRowLimit,
  resolveRowLimit,
} from '../src/shared/settings.ts';
import { matchesShortcut, normalizeShortcut } from '../src/renderer/src/utils/shortcuts.ts';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(
  normalizeAppSettings({ resultRowLimit: 500 }).resultRowLimit === 500,
  'valid setting rejected',
);
assert(
  normalizeAppSettings({ resultRowLimit: 500, theme: 'light' }).theme === 'light',
  'light theme rejected',
);
assert(
  normalizeAppSettings({ resultRowLimit: 500, editorFontSize: 14 }).editorFontSize === 14,
  'font size rejected',
);
assert(
  normalizeAppSettings({ resultRowLimit: 500, editorFontSize: 99 }).editorFontSize === 13,
  'invalid font size should fall back',
);
assert(
  normalizeAppSettings({ resultRowLimit: 500, historyRetention: 5000 }).historyRetention ===
    5000,
  'history retention rejected',
);
assert(
  normalizeAppSettings({ resultRowLimit: 500, historyRetention: 123 }).historyRetention ===
    10000,
  'invalid retention should fall back',
);
assert(
  normalizeAppSettings({ resultRowLimit: 500, historyRetention: 0 }).historyRetention === 0,
  'unlimited retention rejected',
);
assert(
  normalizeAppSettings({ resultRowLimit: 500, queryTimeoutMs: 0 }).queryTimeoutMs === 0,
  'zero timeout should be preserved',
);
assert(
  normalizeAppSettings({ resultRowLimit: 500, queryTimeoutMs: 30_000 }).queryTimeoutMs ===
    30_000,
  'timeout setting rejected',
);
assert(
  normalizeAppSettings({ resultRowLimit: 500, queryTimeoutMs: 1234 }).queryTimeoutMs ===
    30_000,
  'invalid timeout should fall back',
);
assert(
  normalizeAppSettings({ resultRowLimit: 500, connectTimeoutMs: 5000 }).connectTimeoutMs ===
    5000,
  'connect timeout rejected',
);
assert(
  normalizeAppSettings({ resultRowLimit: 500, connectTimeoutMs: 1234 }).connectTimeoutMs ===
    8000,
  'invalid connect timeout should fall back',
);
assert(
  normalizeAppSettings(null).connectTimeoutMs === DEFAULT_APP_SETTINGS.connectTimeoutMs,
  'missing connect timeout should default',
);
assert(
  normalizeAppSettings({ resultRowLimit: 500, historyEnabled: false }).historyEnabled === false,
  'history disable rejected',
);
assert(
  normalizeAppSettings({ resultRowLimit: 500 }).historyEnabled === true,
  'history should default to enabled',
);
assert(
  normalizeAppSettings({ resultRowLimit: 500, historyDedupe: false }).historyDedupe === false,
  'history dedupe disable rejected',
);
assert(
  normalizeAppSettings({ resultRowLimit: 500 }).historyDedupe === true,
  'history dedupe should default to enabled',
);
assert(
  normalizeAppSettings({ resultRowLimit: 500, historyMask: false }).historyMask === false,
  'history mask disable rejected',
);
assert(
  normalizeAppSettings({ resultRowLimit: 500 }).historyMask === true,
  'history mask should default to enabled',
);
assert(
  normalizeAppSettings({ resultRowLimit: 500, theme: 'neon' }).theme === 'dark',
  'unknown theme should fall back',
);
assert(
  normalizeAppSettings({ resultRowLimit: 500 }).theme === 'dark',
  'missing theme should default to dark',
);
assert(
  normalizeAppSettings({ resultRowLimit: 123 }).resultRowLimit ===
    DEFAULT_APP_SETTINGS.resultRowLimit,
  'unlisted option should fall back',
);
assert(
  normalizeAppSettings(null).resultRowLimit === DEFAULT_APP_SETTINGS.resultRowLimit,
  'null settings should fall back',
);
assert(
  normalizeAppSettings({ resultRowLimit: '1000' }).resultRowLimit === 1000,
  'string setting should normalize',
);
assert(
  normalizeAppSettings({ resultRowLimit: 0 }).resultRowLimit === 0,
  'unlimited result rows should be preserved',
);
assert(
  normalizeRowLimit(-1) === 2000,
  'negative row limit should fall back',
);

for (const option of RESULT_ROW_LIMIT_OPTIONS) {
  assert(normalizeRowLimit(option) === option, `row limit ${option} rejected`);
}
assert(normalizeRowLimit(0) === 0, 'zero should mean unlimited');
assert(resolveRowLimit(0) === Number.POSITIVE_INFINITY, 'unlimited should resolve to Infinity');
assert(resolveRowLimit(500) === 500, 'finite limit should pass through');
assert(normalizeRowLimit(10_001) === 2000, 'oversized should fall back');
assert(normalizeRowLimit(undefined) === 2000, 'undefined should fall back');
assert(normalizeRowLimit('abc') === 2000, 'NaN should fall back');
assert(normalizeRowLimit(42.9) === 42, 'fraction should floor');

assert(
  normalizeAppSettings({ resultRowLimit: 500 }).shortcuts.run ===
    DEFAULT_APP_SETTINGS.shortcuts.run,
  'shortcuts should default',
);
assert(
  normalizeAppSettings({
    resultRowLimit: 500,
    shortcuts: { run: 'Ctrl+R' },
  }).shortcuts.run === 'Ctrl+R',
  'custom shortcut rejected',
);
assert(
  normalizeAppSettings({
    resultRowLimit: 500,
    shortcuts: { run: 123 },
  }).shortcuts.run === DEFAULT_APP_SETTINGS.shortcuts.run,
  'invalid shortcut should fall back',
);
assert(normalizeShortcut('ctrl+enter') === 'Ctrl+Enter', 'shortcut normalization failed');
assert(normalizeShortcut('shift+ctrl+f') === 'Ctrl+Shift+F', 'shortcut modifier order wrong');
assert(
  matchesShortcut(
    { key: 'Enter', ctrlKey: true, metaKey: false, shiftKey: false, altKey: false },
    'Ctrl+Enter',
  ),
  'Ctrl+Enter should match',
);
assert(
  !matchesShortcut(
    { key: 'Enter', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false },
    'Ctrl+Enter',
  ),
  'Enter without Ctrl should not match',
);
assert(
  matchesShortcut(
    { key: ' ', ctrlKey: true, metaKey: false, shiftKey: false, altKey: false },
    'Ctrl+Space',
  ),
  'Ctrl+Space should match',
);

console.log('settings check passed');
