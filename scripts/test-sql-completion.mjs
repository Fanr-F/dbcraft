/**
 * SQL 补全辅助函数的纯逻辑测试。
 *
 * 运行：npm run test:sql-completion
 */
import {
  applyCompletion,
  completionCandidatesForContext,
  extractAttachedDatabases,
  extractCompletionContext,
  extractSignatureHelp,
  filterCompletions,
  functionCompletions,
  matchCompletionCase,
  shouldAutoTriggerCompletion,
  shouldOpenCompletionOnInput,
  splitQualifier,
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
assert(dotted.qualifier === 'db' && dotted.needle === 'us', 'dotted qualifier/needle wrong');
assert(dotted.replaceStart === 10, `dotted replaceStart wrong: ${dotted.replaceStart}`);

const aliasContext = extractCompletionContext('SELECT u. FROM users u', 9);
assert(aliasContext.qualifier === 'u' && aliasContext.needle === '', 'alias qualifier wrong');
assert(aliasContext.replaceStart === 9, 'alias replaceStart wrong');

const joinText = 'SELECT u.id FROM users u JOIN orders o ON u.id = o.user_id';
const joinContext = extractCompletionContext(joinText, joinText.length);
assert(joinContext.tables.length === 2, `table count wrong: ${joinContext.tables.length}`);
assert(joinContext.tables[0].table === 'users' && joinContext.tables[0].alias === 'u', 'users alias wrong');
assert(joinContext.tables[1].table === 'orders' && joinContext.tables[1].alias === 'o', 'orders alias wrong');
assert(joinContext.clause === 'on', `clause wrong: ${joinContext.clause}`);

assert(functionCompletions('sqlite').includes('COUNT'), 'sqlite functions missing COUNT');
assert(functionCompletions('mssql').includes('GETDATE'), 'mssql functions missing GETDATE');

const dateadd = extractSignatureHelp('SELECT DATEADD(', 15, 'mssql');
assert(dateadd?.name === 'DATEADD', `DATEADD signature wrong: ${dateadd?.name}`);
assert(dateadd?.parameters.length === 3, 'DATEADD parameter count wrong');
assert(dateadd?.activeParameter === 0, 'DATEADD active parameter wrong');

const concat = extractSignatureHelp('SELECT CONCAT(a, ', 17, 'mysql');
assert(concat?.name === 'CONCAT' && concat.activeParameter === 1, 'CONCAT active parameter wrong');

const strftime = extractSignatureHelp("SELECT STRFTIME('%Y', ", 22, 'sqlite');
assert(strftime?.name === 'STRFTIME' && strftime.activeParameter === 1, 'STRFTIME active parameter wrong');

assert(extractSignatureHelp('SELECT COUNT(id)', 17, 'sqlite') === null, 'closed signature should be null');

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

// 多段限定符：MSSQL `库.Schema.表`、MySQL 反引号、SQLite ATTACH 别名。
assert(
  JSON.stringify(splitQualifier('db.[dbo].`users`')) ===
    JSON.stringify(['db', 'dbo', 'users']),
  `splitQualifier wrong: ${JSON.stringify(splitQualifier('db.[dbo].`users`'))}`,
);

const mssqlParts = extractCompletionContext(
  'SELECT * FROM [demo].[dbo].[users] u',
  'SELECT * FROM [demo].[dbo].[users] u'.length,
);
assert(mssqlParts.tables.length === 1, 'mssql table count wrong');
assert(
  JSON.stringify(mssqlParts.tables[0].parts) === JSON.stringify(['demo', 'dbo', 'users']),
  `mssql parts wrong: ${JSON.stringify(mssqlParts.tables[0].parts)}`,
);
assert(mssqlParts.tables[0].alias === 'u', 'mssql alias wrong');

const mysqlParts = extractCompletionContext(
  'SELECT * FROM `demo`.`users` u',
  'SELECT * FROM `demo`.`users` u'.length,
);
assert(
  JSON.stringify(mysqlParts.tables[0].parts) === JSON.stringify(['demo', 'users']),
  `mysql parts wrong: ${JSON.stringify(mysqlParts.tables[0].parts)}`,
);

const attached = extractAttachedDatabases(
  "ATTACH DATABASE 'C:\\\\data\\\\aux.db' AS aux;\nSELECT * FROM aux.users;",
);
assert(JSON.stringify(attached) === JSON.stringify(['aux']), `attached wrong: ${attached}`);

// 大小写跟随：关键字/函数跟随输入，混合大小写的真实标识符保持原样。
assert(matchCompletionCase('SELECT', 'sel') === 'select', 'lower keyword case wrong');
assert(matchCompletionCase('select', 'SEL') === 'SELECT', 'upper keyword case wrong');
assert(matchCompletionCase('DemoUsers', 'dem') === 'DemoUsers', 'mixed identifier changed');
assert(
  applyCompletion('SEL', 0, 3, 'SELECT').text === 'SELECT',
  'applyCompletion case follow wrong',
);
assert(
  applyCompletion('select * from DEMO_US', 14, 21, 'demo_users').text ===
    'select * from DEMO_USERS',
  'applyCompletion upper table wrong',
);

// 空格自动触发：只有对象名关键字后才弹补全。
assert(shouldAutoTriggerCompletion('SELECT * FROM ', 14), 'FROM space should trigger');
assert(shouldAutoTriggerCompletion('SELECT * FROM demo ', 19) === false, 'table space should not trigger');
assert(shouldAutoTriggerCompletion('SELECT * FRO ', 13) === false, 'partial keyword should not trigger');

// 普通单词输入也应自动弹出补全（sele -> SELECT）。
assert(shouldOpenCompletionOnInput('sele', 4), 'typing a word should auto-open completion');
assert(shouldOpenCompletionOnInput('SELECT * FROM ', 14), 'FROM space should auto-open completion');
assert(shouldOpenCompletionOnInput('select u.', 9), 'dot should auto-open completion');
assert(
  shouldOpenCompletionOnInput('sele', 4, { inserted: false }) === false,
  'deleting text should not auto-open completion',
);
assert(shouldOpenCompletionOnInput('SELECT 1 ', 9) === false, 'plain space should not auto-open');

// 补全按上下文分类：FROM 只给表/视图，EXEC 只给存储过程，SELECT 给关键字/函数。
const groups = {
  keywords: ['SELECT', 'FROM'],
  functions: ['COUNT'],
  objects: [
    { name: 'users', kind: 'table' },
    { name: 'v_users', kind: 'view' },
    { name: 'p_refresh', kind: 'procedure' },
  ],
  databases: ['fanr'],
  schemas: ['dbo'],
};
const labelsOf = (sql) => {
  const context = extractCompletionContext(sql, sql.length);
  return completionCandidatesForContext(context, groups).map((item) => item.label);
};
const fromLabels = labelsOf('SELECT * FROM ');
assert(
  fromLabels.includes('users') &&
    fromLabels.includes('v_users') &&
    !fromLabels.includes('p_refresh') &&
    !fromLabels.includes('COUNT') &&
    !fromLabels.includes('SELECT'),
  `FROM completion wrong: ${fromLabels.join(',')}`,
);
const execLabels = labelsOf('EXEC ');
assert(
  execLabels.length === 1 && execLabels[0] === 'p_refresh',
  `EXEC completion wrong: ${execLabels.join(',')}`,
);
const selectLabels = labelsOf('SELECT ');
assert(
  selectLabels.includes('COUNT') &&
    selectLabels.includes('SELECT') &&
    !selectLabels.includes('users'),
  `SELECT completion wrong: ${selectLabels.join(',')}`,
);
const useLabels = labelsOf('USE ');
assert(useLabels.length === 1 && useLabels[0] === 'fanr', `USE completion wrong: ${useLabels.join(',')}`);
const qualifiedLabels = labelsOf('SELECT u.');
assert(qualifiedLabels.length === 0, 'qualified completion should not use base candidates');

console.log('sql completion check passed');
