/**
 * 应用设置解析的纯逻辑测试。
 *
 * 运行：npm run test:settings
 */
import {
  DEFAULT_APP_SETTINGS,
  normalizeAppSettings,
} from '../src/shared/settings.ts';
import { matchesShortcut, normalizeShortcut } from '../src/renderer/src/utils/shortcuts.ts';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(
  normalizeAppSettings({ theme: 'light' }).theme === 'light',
  'light theme rejected',
);
assert(
  normalizeAppSettings({ editorFontSize: 14 }).editorFontSize === 14,
  'font size rejected',
);
assert(
  normalizeAppSettings({ editorFontSize: 99 }).editorFontSize === 13,
  'invalid font size should fall back',
);
assert(
  normalizeAppSettings({ historyRetention: 5000 }).historyRetention ===
    5000,
  'history retention rejected',
);
assert(
  normalizeAppSettings({ historyRetention: 123 }).historyRetention ===
    10000,
  'invalid retention should fall back',
);
assert(
  normalizeAppSettings({ historyRetention: 0 }).historyRetention === 0,
  'unlimited retention rejected',
);
assert(
  normalizeAppSettings({ queryTimeoutMs: 0 }).queryTimeoutMs === 0,
  'zero timeout should be preserved',
);
assert(
  normalizeAppSettings({ queryTimeoutMs: 30_000 }).queryTimeoutMs ===
    30_000,
  'timeout setting rejected',
);
assert(
  normalizeAppSettings({ queryTimeoutMs: 1234 }).queryTimeoutMs ===
    30_000,
  'invalid timeout should fall back',
);
assert(
  normalizeAppSettings({ connectTimeoutMs: 5000 }).connectTimeoutMs ===
    5000,
  'connect timeout rejected',
);
assert(
  normalizeAppSettings({ connectTimeoutMs: 1234 }).connectTimeoutMs ===
    8000,
  'invalid connect timeout should fall back',
);
assert(
  normalizeAppSettings(null).connectTimeoutMs === DEFAULT_APP_SETTINGS.connectTimeoutMs,
  'missing connect timeout should default',
);
assert(
  normalizeAppSettings({ historyEnabled: false }).historyEnabled === false,
  'history disable rejected',
);
assert(
  normalizeAppSettings({}).historyEnabled === true,
  'history should default to enabled',
);
assert(
  normalizeAppSettings({ historyDedupe: false }).historyDedupe === false,
  'history dedupe disable rejected',
);
assert(
  normalizeAppSettings({}).historyDedupe === true,
  'history dedupe should default to enabled',
);
assert(
  normalizeAppSettings({ historyMask: false }).historyMask === false,
  'history mask disable rejected',
);
assert(
  normalizeAppSettings({}).historyMask === true,
  'history mask should default to enabled',
);
assert(
  normalizeAppSettings({ gridAutoCommit: true }).gridAutoCommit === true,
  'grid auto commit should be accepted',
);
assert(
  normalizeAppSettings({}).gridAutoCommit === false,
  'grid auto commit should default to off',
);
assert(
  normalizeAppSettings({ gridConfirmCommit: true }).gridConfirmCommit ===
    true,
  'grid commit confirm should be accepted',
);
assert(
  normalizeAppSettings({}).gridConfirmCommit === false,
  'grid commit confirm should default to off',
);
assert(
  normalizeAppSettings({
    editorFontFamily: 'consolas',
    editorTabSize: 4,
    sqlKeywordCase: 'lower',
    completionEnabled: false,
    completionAutoTrigger: false,
    completionDelayMs: 300,
  }).editorFontFamily === 'consolas' &&
    normalizeAppSettings({
        editorTabSize: 4,
    }).editorTabSize === 4 &&
    normalizeAppSettings({
        sqlKeywordCase: 'lower',
    }).sqlKeywordCase === 'lower' &&
    normalizeAppSettings({
        completionEnabled: false,
    }).completionEnabled === false &&
    normalizeAppSettings({
        completionAutoTrigger: false,
    }).completionAutoTrigger === false &&
    normalizeAppSettings({
        completionAutoTrigger: 'no',
    }).completionAutoTrigger === true &&
    normalizeAppSettings({
        completionDelayMs: 300,
    }).completionDelayMs === 300,
  'editor/completion settings should normalize',
);
assert(
  normalizeAppSettings({ editorTabSize: 3 }).editorTabSize === 2 &&
    normalizeAppSettings({ editorFontFamily: 'x' }).editorFontFamily ===
      'default' &&
    normalizeAppSettings({ completionDelayMs: 42 }).completionDelayMs === 0,
  'invalid editor/completion settings should fall back',
);
assert(
  normalizeAppSettings({ theme: 'neon' }).theme === 'dark',
  'unknown theme should fall back',
);
assert(
  normalizeAppSettings({}).theme === 'dark',
  'missing theme should default to dark',
);
assert(
  normalizeAppSettings(null).theme === DEFAULT_APP_SETTINGS.theme,
  'null settings should fall back',
);

assert(
  normalizeAppSettings({}).shortcuts.run ===
    DEFAULT_APP_SETTINGS.shortcuts.run,
  'shortcuts should default',
);
assert(
  normalizeAppSettings({
    shortcuts: { run: 'Ctrl+R' },
  }).shortcuts.run === 'Ctrl+R',
  'custom shortcut rejected',
);
assert(
  normalizeAppSettings({
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
