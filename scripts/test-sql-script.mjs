/**
 * SQL 脚本分句的纯逻辑测试。
 *
 * 运行：npm run test:sql-script
 */
import { splitSqlStatements, statementAtCursor } from '../src/renderer/src/utils/sql-script.ts';

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

// MSSQL：单独一行的 GO 是分隔符，不发送给服务器。
const go = splitSqlStatements('SELECT 1\nGO\nSELECT 2\nGO\n', 50, 'mssql');
assert(go.ok && go.statements.length === 2, `GO split failed: ${go.ok ? go.statements.length : go.message}`);
assert(go.ok && go.statements[0] === 'SELECT 1', 'GO should be stripped from first batch');
assert(go.ok && go.statements[1] === 'SELECT 2', 'GO should be stripped from second batch');
const goInline = splitSqlStatements("SELECT 'GO' AS g;\nGO\nSELECT 2;", 50, 'mssql');
assert(goInline.ok && goInline.statements.length === 2, 'GO in string split wrongly');

// MSSQL：GO n 重复整个批次；GO 0 / 超限要报错。
const goRepeat = splitSqlStatements('SELECT 1\nGO 3\nSELECT 2;', 50, 'mssql');
assert(goRepeat.ok && goRepeat.statements.length === 4, 'GO 3 should repeat the batch');
assert(
  goRepeat.ok &&
    goRepeat.statements[0] === 'SELECT 1' &&
    goRepeat.statements[1] === 'SELECT 1' &&
    goRepeat.statements[2] === 'SELECT 1' &&
    goRepeat.statements[3] === 'SELECT 2;',
  'GO 3 statement order wrong',
);
const goRepeatSemicolon = splitSqlStatements('SELECT 1;\nGO 3\n', 50, 'mssql');
assert(
  goRepeatSemicolon.ok && goRepeatSemicolon.statements.length === 3,
  'GO 3 after semicolon should repeat the batch',
);
const goRepeatMulti = splitSqlStatements('SELECT 1; SELECT 2;\nGO 2\n', 50, 'mssql');
assert(
  goRepeatMulti.ok && goRepeatMulti.statements.length === 4,
  'GO 2 should repeat all statements in the batch',
);
const goZero = splitSqlStatements('SELECT 1\nGO 0\n', 50, 'mssql');
assert(!goZero.ok, 'GO 0 should be rejected');
const goOverLimit = splitSqlStatements('SELECT 1\nGO 100\n', 50, 'mssql');
assert(!goOverLimit.ok, 'GO n over the statement limit should be rejected');

// MySQL：DELIMITER 内不按分号切分，DELIMITER 行本身不进入语句。
const delimiter = splitSqlStatements(
  'DELIMITER $$\nCREATE PROCEDURE p() BEGIN SELECT 1; SELECT 2; END$$\nDELIMITER ;\nSELECT 3;',
  50,
  'mysql',
);
assert(
  delimiter.ok && delimiter.statements.length === 2,
  `DELIMITER split failed: ${delimiter.ok ? delimiter.statements.length : delimiter.message}`,
);
assert(
  delimiter.ok && delimiter.statements[0].includes('SELECT 2;') && !delimiter.statements[0].includes('$$'),
  'DELIMITER body wrong',
);
assert(delimiter.ok && delimiter.statements[1] === 'SELECT 3;', 'DELIMITER reset wrong');

// 光标所在语句。
const cursorSql = 'SELECT 1;\nSELECT 2;\nSELECT 3;';
assert(statementAtCursor(cursorSql, 2) === 'SELECT 1;', 'cursor first statement wrong');
assert(
  statementAtCursor(cursorSql, cursorSql.indexOf('SELECT 2') + 3) === 'SELECT 2;',
  'cursor second statement wrong',
);
assert(
  statementAtCursor(cursorSql, cursorSql.indexOf('SELECT 3') + 3) === 'SELECT 3;',
  'cursor third statement wrong',
);
const cursorGo = 'SELECT 1\nGO\nSELECT 2\nGO';
assert(
  statementAtCursor(cursorGo, cursorGo.indexOf('SELECT 2') + 2, 'mssql') === 'SELECT 2',
  'cursor GO statement wrong',
);

console.log('sql script check passed');
