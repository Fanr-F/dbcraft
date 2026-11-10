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

/** 结果行数「不限制」哨兵值。 */
export const RESULT_ROW_LIMIT_UNLIMITED = 0;

/** 设置界面允许的结果行数档位；0 表示不限制。 */
export const RESULT_ROW_LIMIT_OPTIONS = [100, 500, 1000, 2000, 5000, 0] as const;

/** 编辑器字号档位。 */
export const EDITOR_FONT_SIZE_OPTIONS = [12, 13, 14, 16] as const;

/** 查询历史保留条数档位；0 表示不限制（超过 50,000 条后搜索可能变慢）。 */
export const HISTORY_RETENTION_OPTIONS = [1000, 5000, 10000, 50000, 0] as const;

/** 查询超时档位（毫秒），0 表示不自动取消。 */
export const QUERY_TIMEOUT_OPTIONS = [0, 10_000, 30_000, 60_000, 120_000] as const;

/** 连接/测试连接超时档位（毫秒）。 */
export const CONNECT_TIMEOUT_OPTIONS = [3_000, 5_000, 8_000, 10_000, 30_000] as const;

export const DEFAULT_APP_SETTINGS: AppSettings = {
  resultRowLimit: 2000,
  theme: 'dark',
  editorFontSize: 13,
  historyRetention: 10000,
  queryTimeoutMs: 30_000,
  connectTimeoutMs: 8_000,
  historyEnabled: true,
  historyDedupe: true,
  historyMask: true,
  shortcuts: { ...DEFAULT_SHORTCUTS },
};

/** 解析/校验单次查询行数；非法值回退默认，0 表示不限制。 */
export function normalizeRowLimit(raw: unknown, fallback = DEFAULT_APP_SETTINGS.resultRowLimit): number {
  const value = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(value)) return fallback;
  const limit = Math.floor(value);
  if (limit === RESULT_ROW_LIMIT_UNLIMITED) return RESULT_ROW_LIMIT_UNLIMITED;
  if (limit < 1 || limit > 10_000) return fallback;
  return limit;
}

/** 驱动行读取上限：0 转成 Infinity，其余仍按 normalizeRowLimit 校验。 */
export function resolveRowLimit(raw: unknown, fallback = DEFAULT_APP_SETTINGS.resultRowLimit): number {
  const limit = normalizeRowLimit(raw, fallback);
  return limit === RESULT_ROW_LIMIT_UNLIMITED ? Number.POSITIVE_INFINITY : limit;
}

/** 设置对象来自磁盘或 IPC，必须按白名单/范围归一化后再使用。 */
export function normalizeAppSettings(raw: unknown): AppSettings {
  if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_APP_SETTINGS };
  const record = raw as Record<string, unknown>;
  const requested = Number(record.resultRowLimit);
  const allowed = RESULT_ROW_LIMIT_OPTIONS.some((option) => option === requested);
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
    resultRowLimit: allowed ? requested : DEFAULT_APP_SETTINGS.resultRowLimit,
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
