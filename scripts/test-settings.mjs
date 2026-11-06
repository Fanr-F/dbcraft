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
} from '../src/shared/settings.ts';

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
  normalizeAppSettings({ resultRowLimit: 500, historyEnabled: false }).historyEnabled === false,
  'history disable rejected',
);
assert(
  normalizeAppSettings({ resultRowLimit: 500 }).historyEnabled === true,
  'history should default to enabled',
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

for (const option of RESULT_ROW_LIMIT_OPTIONS) {
  assert(normalizeRowLimit(option) === option, `row limit ${option} rejected`);
}
assert(normalizeRowLimit(0) === 2000, 'zero should fall back');
assert(normalizeRowLimit(10_001) === 2000, 'oversized should fall back');
assert(normalizeRowLimit(undefined) === 2000, 'undefined should fall back');
assert(normalizeRowLimit('abc') === 2000, 'NaN should fall back');
assert(normalizeRowLimit(42.9) === 42, 'fraction should floor');

console.log('settings check passed');
