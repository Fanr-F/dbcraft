import type { QueryCell } from '../../../shared/ipc-contract';
import { encodeCell } from '../query-values.ts';

/**
 * SQL Server 按列类型格式化结果值。
 *
 * 连接统一使用 `useUTC: true`，因此 datetime/datetime2 的 Date 分量就是数据库里存的值；
 * 这里按 UTC 分量拼回字符串，不做应用层时区转换。
 * 已知边界：datetimeoffset 的原始偏移会被驱动归一化为 UTC，只保留时间点；
 * datetime2 的 7 位小数精度受 JS Date 限制，只保留到毫秒。
 */
const DECIMAL_TYPES = new Set([
  'Decimal',
  'DecimalN',
  'Numeric',
  'NumericN',
  'Money',
  'MoneyN',
  'SmallMoney',
  'SmallMoneyN',
]);

function pad(value: number, length = 2): string {
  return String(value).padStart(length, '0');
}

function formatDatePart(value: Date): string {
  return `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`;
}

function formatTimePart(value: Date): string {
  return `${pad(value.getUTCHours())}:${pad(value.getUTCMinutes())}:${pad(value.getUTCSeconds())}.${pad(
    value.getUTCMilliseconds(),
    3,
  )}`;
}

export function formatMssqlCell(value: unknown, typeName: string): QueryCell {
  if (value === null || value === undefined) return null;

  if (value instanceof Date) {
    switch (typeName) {
      case 'Date':
        return formatDatePart(value);
      case 'Time':
        return formatTimePart(value);
      case 'DateTimeOffset':
        // 驱动只保留时间点；用 ISO 8601 UTC 表示，避免伪造偏移。
        return value.toISOString();
      default:
        return `${formatDatePart(value)} ${formatTimePart(value)}`;
    }
  }

  if (typeof value === 'number' && DECIMAL_TYPES.has(typeName)) {
    // 避免浮点显示误差（如 0.1 + 0.2）；更高精度仍需数据库侧 CAST 为字符串。
    return String(value);
  }

  return encodeCell(value);
}
