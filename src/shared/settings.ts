import type { AppSettings, ShortcutAction, ShortcutMap } from './ipc-contract';

export const SHORTCUT_ACTIONS: ShortcutAction[] = [
  'run',
  'complete',
  'format',
  'save',
  'history',
];

export const DEFAULT_SHORTCUTS: ShortcutMap = {
  run: 'Ctrl+Enter',
  complete: 'Ctrl+Space',
  format: 'Ctrl+Shift+F',
  save: 'Ctrl+S',
  history: 'Ctrl+E',
};

/** 编辑器字号档位。 */
export const EDITOR_FONT_SIZE_OPTIONS = [12, 13, 14, 16] as const;

/** 查询历史保留条数档位；0 表示不限制（超过 50,000 条后搜索可能变慢）。 */
export const HISTORY_RETENTION_OPTIONS = [1000, 5000, 10000, 50000, 0] as const;

/** 查询超时档位（毫秒），0 表示不自动取消。 */
export const QUERY_TIMEOUT_OPTIONS = [0, 10_000, 30_000, 60_000, 120_000] as const;

/** 连接/测试连接超时档位（毫秒）。 */
export const CONNECT_TIMEOUT_OPTIONS = [3_000, 5_000, 8_000, 10_000, 30_000] as const;

/** 编辑器字体族键；值为 CSS font-family。 */
export const EDITOR_FONT_FAMILIES = {
  default: '"Cascadia Code", "JetBrains Mono", Consolas, "Microsoft YaHei", monospace',
  consolas: 'Consolas, "Courier New", monospace',
  cascadia: '"Cascadia Code", Consolas, monospace',
  jetbrains: '"JetBrains Mono", Consolas, monospace',
} as const;

export const EDITOR_FONT_FAMILY_OPTIONS = [
  { value: 'default', label: '默认（Cascadia Code）' },
  { value: 'consolas', label: 'Consolas' },
  { value: 'cascadia', label: 'Cascadia Code' },
  { value: 'jetbrains', label: 'JetBrains Mono' },
] as const;

export const EDITOR_TAB_SIZE_OPTIONS = [2, 4, 8] as const;

export const COMPLETION_DELAY_OPTIONS = [0, 100, 300, 500] as const;

export const DEFAULT_APP_SETTINGS: AppSettings = {
  theme: 'dark',
  editorFontSize: 13,
  historyRetention: 10000,
  queryTimeoutMs: 30_000,
  connectTimeoutMs: 8_000,
  historyEnabled: true,
  historyDedupe: true,
  historyMask: true,
  gridAutoCommit: false,
  gridConfirmCommit: false,
  editorFontFamily: 'default',
  editorTabSize: 2,
  sqlKeywordCase: 'upper',
  completionEnabled: true,
  completionAutoTrigger: true,
  completionDelayMs: 0,
  shortcuts: { ...DEFAULT_SHORTCUTS },
};

/** 设置对象来自磁盘或 IPC，必须按白名单/范围归一化后再使用。 */
export function normalizeAppSettings(raw: unknown): AppSettings {
  if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_APP_SETTINGS };
  const record = raw as Record<string, unknown>;
  const requestedFont = Number(record.editorFontSize);
  const fontAllowed = EDITOR_FONT_SIZE_OPTIONS.some((option) => option === requestedFont);
  const requestedRetention = Number(record.historyRetention);
  const retentionAllowed = HISTORY_RETENTION_OPTIONS.some(
    (option) => option === requestedRetention,
  );
  const requestedTimeout = Number(record.queryTimeoutMs);
  const timeoutAllowed = QUERY_TIMEOUT_OPTIONS.some(
    (option) => option === requestedTimeout,
  );
  const requestedConnectTimeout = Number(record.connectTimeoutMs);
  const connectTimeoutAllowed = CONNECT_TIMEOUT_OPTIONS.some(
    (option) => option === requestedConnectTimeout,
  );
  return {
    theme:
      record.theme === 'light' || record.theme === 'system' ? record.theme : 'dark',
    editorFontSize: fontAllowed
      ? requestedFont
      : DEFAULT_APP_SETTINGS.editorFontSize,
    historyRetention: retentionAllowed
      ? requestedRetention
      : DEFAULT_APP_SETTINGS.historyRetention,
    queryTimeoutMs: timeoutAllowed
      ? requestedTimeout
      : DEFAULT_APP_SETTINGS.queryTimeoutMs,
    connectTimeoutMs: connectTimeoutAllowed
      ? requestedConnectTimeout
      : DEFAULT_APP_SETTINGS.connectTimeoutMs,
    historyEnabled: record.historyEnabled !== false,
    historyDedupe: record.historyDedupe !== false,
    historyMask: record.historyMask !== false,
    gridAutoCommit: record.gridAutoCommit === true,
    gridConfirmCommit: record.gridConfirmCommit === true,
    editorFontFamily:
      typeof record.editorFontFamily === 'string' &&
      record.editorFontFamily in EDITOR_FONT_FAMILIES
        ? record.editorFontFamily
        : DEFAULT_APP_SETTINGS.editorFontFamily,
    editorTabSize: EDITOR_TAB_SIZE_OPTIONS.some(
      (option) => option === Number(record.editorTabSize),
    )
      ? Number(record.editorTabSize)
      : DEFAULT_APP_SETTINGS.editorTabSize,
    sqlKeywordCase:
      record.sqlKeywordCase === 'lower' ||
      record.sqlKeywordCase === 'preserve' ||
      record.sqlKeywordCase === 'upper'
        ? record.sqlKeywordCase
        : DEFAULT_APP_SETTINGS.sqlKeywordCase,
    completionEnabled: record.completionEnabled !== false,
    completionAutoTrigger: record.completionAutoTrigger !== false,
    completionDelayMs: COMPLETION_DELAY_OPTIONS.some(
      (option) => option === Number(record.completionDelayMs),
    )
      ? Number(record.completionDelayMs)
      : DEFAULT_APP_SETTINGS.completionDelayMs,
    shortcuts: normalizeShortcuts(record.shortcuts),
  };
}

function normalizeShortcuts(raw: unknown): ShortcutMap {
  const source = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const result = { ...DEFAULT_SHORTCUTS };
  for (const action of SHORTCUT_ACTIONS) {
    const value = source[action];
    if (typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 40) {
      result[action] = value.trim();
    }
  }
  return result;
}
