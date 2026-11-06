/**
 * CHECK 约束提取的纯逻辑测试。
 *
 * 运行：npm run test:checks
 */
import { extractCheckExpressions } from '../src/shared/dialect/checks.ts';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const one = extractCheckExpressions(
  'CREATE TABLE t (age INTEGER CHECK (age > 0))',
);
assert(one.length === 1 && one[0].expression === 'age > 0', 'simple CHECK failed');

const two = extractCheckExpressions(
  "CREATE TABLE t (a INT CHECK ((a + 1) > 0), b TEXT CHECK (b <> '' AND b NOT LIKE 'x%'))",
);
assert(two.length === 2, `expected 2 checks, got ${two.length}`);
assert(two[0].expression === '(a + 1) > 0', 'nested parens failed');
assert(two[1].expression === "b <> '' AND b NOT LIKE 'x%'", 'string in check failed');

const quoted = extractCheckExpressions(
  "CREATE TABLE t (note TEXT DEFAULT 'CHECK (fake)', x INT CHECK (x > 0))",
);
assert(quoted.length === 1 && quoted[0].expression === 'x > 0', 'string CHECK leaked');

const commented = extractCheckExpressions(
  'CREATE TABLE t (x INT /* CHECK (fake) */ CHECK (x > 0))',
);
assert(commented.length === 1, 'block comment CHECK leaked');

const none = extractCheckExpressions('CREATE TABLE t (x INT)');
assert(none.length === 0, 'unexpected checks');

const broken = extractCheckExpressions('CREATE TABLE t (x INT CHECK (x > 0');
assert(broken.length === 0, 'unbalanced parens should not produce checks');

console.log('checks extraction check passed');
