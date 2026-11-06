import type { AppSettings } from './ipc-contract';

/** 设置界面允许的结果行数档位。 */
export const RESULT_ROW_LIMIT_OPTIONS = [100, 500, 1000, 2000, 5000] as const;

/** 编辑器字号档位。 */
export const EDITOR_FONT_SIZE_OPTIONS = [12, 13, 14, 16] as const;

/** 查询历史保留条数档位。 */
export const HISTORY_RETENTION_OPTIONS = [1000, 5000, 10000, 50000] as const;

/** 查询超时档位（毫秒），0 表示不自动取消。 */
export const QUERY_TIMEOUT_OPTIONS = [0, 10_000, 30_000, 60_000, 120_000] as const;

export const DEFAULT_APP_SETTINGS: AppSettings = {
  resultRowLimit: 2000,
  theme: 'dark',
  editorFontSize: 13,
  historyRetention: 10000,
  queryTimeoutMs: 30_000,
  historyEnabled: true,
};

/** 解析/校验单次查询行数；非法值回退默认。 */
export function normalizeRowLimit(raw: unknown, fallback = DEFAULT_APP_SETTINGS.resultRowLimit): number {
  const value = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(value)) return fallback;
  const limit = Math.floor(value);
  if (limit < 1 || limit > 10_000) return fallback;
  return limit;
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
  return {
    resultRowLimit: allowed ? requested : DEFAULT_APP_SETTINGS.resultRowLimit,
    theme: record.theme === 'light' ? 'light' : 'dark',
    editorFontSize: fontAllowed
      ? requestedFont
      : DEFAULT_APP_SETTINGS.editorFontSize,
    historyRetention: retentionAllowed
      ? requestedRetention
      : DEFAULT_APP_SETTINGS.historyRetention,
    queryTimeoutMs: timeoutAllowed
      ? requestedTimeout
      : DEFAULT_APP_SETTINGS.queryTimeoutMs,
    historyEnabled: record.historyEnabled !== false,
  };
}
