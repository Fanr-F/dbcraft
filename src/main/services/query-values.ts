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
    const head = buffer.subarray(0, 32).toString('hex');
    return `0x${head}${buffer.length > 32 ? '…' : ''}`;
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
