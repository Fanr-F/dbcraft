/**
 * SQL 脚本分句的纯逻辑测试。
 *
 * 运行：npm run test:sql-script
 */
import { splitSqlStatements } from '../src/renderer/src/utils/sql-script.ts';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const simple = splitSqlStatements('SELECT 1; SELECT 2;');
assert(simple.ok && simple.statements.length === 2, 'simple split failed');
assert(simple.ok && simple.statements[0] === 'SELECT 1;', 'semicolon not preserved');
assert(simple.ok && simple.statements[1] === 'SELECT 2;', 'second statement wrong');

const noTrailing = splitSqlStatements('SELECT 1; SELECT 2');
assert(noTrailing.ok && noTrailing.statements.length === 2, 'no trailing semicolon failed');

const strings = splitSqlStatements("SELECT ';' AS semi; SELECT 2;");
assert(strings.ok && strings.statements.length === 2, 'semicolon in string split wrongly');

const comments = splitSqlStatements('-- a;b\nSELECT 1; /* ; */ SELECT 2;');
assert(comments.ok && comments.statements.length === 2, 'semicolon in comment split wrongly');

const whitespace = splitSqlStatements('  \n\t  ');
assert(!whitespace.ok, 'empty script should fail');

const onlyComment = splitSqlStatements('-- nothing here');
assert(!onlyComment.ok, 'comment-only script should fail');

const limited = splitSqlStatements(
  Array.from({ length: 51 }, (_, index) => `SELECT ${index};`).join('\n'),
);
assert(!limited.ok && limited.message.includes('50'), 'statement limit not enforced');

const nl = splitSqlStatements('SELECT\n  1\n;\n\nSELECT 2;');
assert(nl.ok && nl.statements.length === 2, 'multiline split failed');

console.log('sql script check passed');
