import type { QueryCell } from '../../shared/ipc-contract';

export function encodeCell(value: unknown): QueryCell {
  if (value === null || value === undefined) return null;
  if (typeof value === 'bigint') return value.toString();
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
