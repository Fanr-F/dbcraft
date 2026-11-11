import type { QueryCell } from '../../shared/ipc-contract';

const MIN_SAFE_INTEGER = BigInt(Number.MIN_SAFE_INTEGER);
const MAX_SAFE_INTEGER = BigInt(Number.MAX_SAFE_INTEGER);

export function encodeCell(value: unknown): QueryCell {
  if (value === null || value === undefined) return null;
  if (typeof value === 'bigint') {
    // SQLite 以 BigInt 读出整数：安全范围内还原为 number，超出后保持字符串。
    return value >= MIN_SAFE_INTEGER && value <= MAX_SAFE_INTEGER
      ? Number(value)
      : value.toString();
  }
  if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }
  if (value instanceof Uint8Array) {
    const buffer = Buffer.from(value);
    // 网格只承载可显示的十六进制；限制 4 KB，完整二进制导出需要独立通道。
    const limit = 4096;
    const head = buffer.subarray(0, limit).toString('hex');
    return `0x${head}${buffer.length > limit ? '…' : ''}`;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}
