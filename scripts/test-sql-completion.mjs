/**
 * SQL 补全辅助函数的纯逻辑测试。
 *
 * 运行：npm run test:sql-completion
 */
import {
  applyCompletion,
  extractCompletionContext,
  filterCompletions,
} from '../src/renderer/src/utils/sql-completion.ts';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const text = 'SELECT * FROM demo_us';
const context = extractCompletionContext(text, text.length);
assert(context.prefix === 'demo_us', `prefix wrong: ${context.prefix}`);
assert(context.start === text.length - 'demo_us'.length, 'start wrong');

const dotted = extractCompletionContext('SELECT db.us', 13);
assert(dotted.prefix === 'db.us', 'dotted prefix wrong');

const empty = extractCompletionContext('SELECT * FROM ', 14);
assert(empty.prefix === '' && empty.start === 14, 'empty prefix wrong');

const items = ['users', 'demo_users', 'orders', 'user_roles', 'Users'];
assert(
  JSON.stringify(filterCompletions(items, 'user')) ===
    JSON.stringify(['user_roles', 'users', 'demo_users']),
  `filter/order wrong: ${JSON.stringify(filterCompletions(items, 'user'))}`,
);
assert(filterCompletions(items, 'zzz').length === 0, 'no-match should be empty');
assert(
  filterCompletions(['a', 'A', 'a '], '').length === 1,
  'should dedupe case-insensitively',
);

const applied = applyCompletion('SELECT * FROM demo_us', 14, 21, 'demo_users');
assert(applied.text === 'SELECT * FROM demo_users', `apply wrong: ${applied.text}`);
assert(applied.cursor === 'SELECT * FROM demo_users'.length, 'cursor wrong');

const middle = applyCompletion('SELECT  FROM t', 7, 7, 'name');
assert(middle.text === 'SELECT name FROM t', 'middle insertion wrong');

assert(filterCompletions(items, 'user', 2).length === 2, 'limit not applied');

console.log('sql completion check passed');
