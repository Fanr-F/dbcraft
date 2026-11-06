/**
 * SQL 括号匹配的纯逻辑测试。
 *
 * 运行：npm run test:sql-brackets
 */
import { tokenizeSql } from '../src/renderer/src/utils/sql-highlight.ts';
import { findBracketMatch } from '../src/renderer/src/utils/sql-brackets.ts';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function match(sql, cursor) {
  return findBracketMatch(tokenizeSql(sql), cursor);
}

const simple = match('SELECT (1 + 2)', 7);
assert(simple && simple.open === 7 && simple.close === 13, 'simple match failed');

const onClose = match('SELECT (1 + 2)', 13);
assert(onClose && onClose.open === 7 && onClose.close === 13, 'close cursor failed');

const adjacent = match('SELECT (1 + 2)', 8);
assert(adjacent && adjacent.open === 7, 'cursor after open bracket failed');

const nested = match('SELECT f(g(x))', 9);
assert(nested && nested.close === 13, 'nested match failed');

const square = match('SELECT a[1]', 8);
assert(square && square.open === 8 && square.close === 10, 'square bracket failed');

const curly = match('SELECT {x}', 7);
assert(curly && curly.close === 9, 'curly bracket failed');

const inString = match("SELECT '(', x", 9);
assert(inString === null, 'bracket inside string must be ignored');

const inComment = match('SELECT 1 -- (', 12);
assert(inComment === null, 'bracket inside comment must be ignored');

const unbalanced = match('SELECT (1 + 2', 7);
assert(unbalanced === null, 'unbalanced should return null');

const notBracket = match('SELECT (1 + 2)', 3);
assert(notBracket === null, 'non-bracket cursor should return null');

console.log('sql brackets check passed');
