/**
 * 超时配置解析的纯逻辑测试。
 *
 * 运行：npm run test:timeouts
 */
import { parseTimeoutMs } from '../src/shared/timeouts.ts';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(parseTimeoutMs(undefined, 30_000) === 30_000, 'undefined should fall back');
assert(parseTimeoutMs('', 30_000) === 30_000, 'blank should fall back');
assert(parseTimeoutMs('   ', 30_000) === 30_000, 'spaces should fall back');
assert(parseTimeoutMs('0', 30_000) === 0, '0 should disable');
assert(parseTimeoutMs('1500', 30_000) === 1500, 'positive value');
assert(parseTimeoutMs('1.9', 30_000) === 1, 'floor decimals');
assert(parseTimeoutMs('-1', 30_000) === 30_000, 'negative should fall back');
assert(parseTimeoutMs('abc', 30_000) === 30_000, 'NaN should fall back');
assert(parseTimeoutMs('Infinity', 30_000) === 30_000, 'Infinity should fall back');

console.log('timeout parsing check passed');
