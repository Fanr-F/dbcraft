/** 解析超时配置；非法值回退默认值，0 表示禁用。 */
export function parseTimeoutMs(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return fallback;
  return Math.floor(value);
}
