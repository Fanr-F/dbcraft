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
  extractVirtualTables,
  filterCompletions,
  functionCompletions,
  keywordCompletions,
  matchCompletionCase,
  normalizeCompletionNameCase,
  quoteCompletionIdentifier,
  rankCompletions,
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

// 表引用从整条语句解析：FROM 在光标之后也要能补列（PRD AC）。
const selectList = extractCompletionContext('SELECT u. FROM users u', 9);
assert(
  selectList.tables.length === 1 && selectList.tables[0].table === 'users',
  `select-list tables wrong: ${JSON.stringify(selectList.tables)}`,
);
const bareColumn = extractCompletionContext('SELECT na FROM users', 9);
assert(
  bareColumn.tables.length === 1 && bareColumn.clause === 'select',
  'column completion before FROM should see the table',
);

// 引号/注释/字符串里的分号不切语句，也不弹补全。
const stringSemicolon = extractCompletionContext("SELECT 'a;b' FROM users u WHERE u.", 34);
assert(
  stringSemicolon.tables.length === 1 && stringSemicolon.qualifier === 'u',
  `string semicolon broke statement: ${JSON.stringify(stringSemicolon.tables)}`,
);
assert(stringSemicolon.inLiteral === false, 'cursor after literal should not be literal');
const inString = extractCompletionContext("SELECT 'ab", 10);
assert(inString.inLiteral === true, 'cursor inside string should be literal');
assert(
  shouldOpenCompletionOnInput("SELECT 'ab", 10) === false,
  'completion should not auto-open inside a string',
);
const inComment = extractCompletionContext('SELECT -- note', 14);
assert(inComment.inLiteral === true, 'cursor inside line comment should be literal');

// 逗号多表、双空格 ORDER BY。
const commaSql = 'SELECT * FROM users u, orders o WHERE ';
const commaTables = extractCompletionContext(commaSql, commaSql.length);
assert(
  commaTables.tables.length === 2 && commaTables.tables[1].alias === 'o',
  `comma tables wrong: ${JSON.stringify(commaTables.tables)}`,
);
const spacedSql = 'SELECT * FROM users ORDER  BY name';
const spacedClause = extractCompletionContext(spacedSql, spacedSql.length);
assert(spacedClause.clause === 'order by', `spaced order by wrong: ${spacedClause.clause}`);

// 通配符只在 SELECT 列表生效，函数参数里的 * 不算。
const wildcard = extractCompletionContext('SELECT * FROM users', 8);
assert(wildcard.wildcard === true, 'SELECT * should be wildcard');
assert(wildcard.replaceStart === 7 && wildcard.replaceEnd === 8, 'wildcard replacement range wrong');
assert(extractCompletionContext('SELECT COUNT(*) FROM users', 13).wildcard === false, 'COUNT(*) is not wildcard');
assert(extractCompletionContext('SELECT a * b FROM t', 10).wildcard === false, 'multiplication is not wildcard');

// 排序：前缀优先，同分按类型优先级；返回命中下标供高亮。
const ranked = rankCompletions(
  [
    { label: 'SELECT', kind: 'keyword' },
    { label: 'orders', kind: 'table' },
    { label: 'users', kind: 'table', priority: 0 },
    { label: 'user_roles', kind: 'table' },
    { label: 'zzz', kind: 'table' },
  ],
  'us',
);
assert(
  JSON.stringify(ranked.map((item) => item.label)) === JSON.stringify(['users', 'user_roles']),
  `rank order wrong: ${ranked.map((item) => item.label).join(',')}`,
);
assert(JSON.stringify(ranked[0].matches) === JSON.stringify([0, 1]), 'match indices wrong');
const fuzzy = rankCompletions([{ label: 'created_at', kind: 'column' }], 'ca');
assert(fuzzy.length === 1 && JSON.stringify(fuzzy[0].matches) === JSON.stringify([0, 8]), 'fuzzy match wrong');

// 版本感知：方言关键字与特性开关。
assert(keywordCompletions('mssql', '16.0').includes('TOP'), 'mssql should suggest TOP');
assert(!keywordCompletions('sqlite', '3.45').includes('TOP'), 'sqlite should not suggest TOP');
assert(keywordCompletions('sqlite', '3.35').includes('RETURNING'), 'sqlite 3.35 should suggest RETURNING');
assert(!keywordCompletions('sqlite', '3.34').includes('RETURNING'), 'sqlite 3.34 should hide RETURNING');
assert(!keywordCompletions('mysql', '5.7.44').includes('WITH'), 'mysql 5.7 should hide CTE keyword');
assert(keywordCompletions('mysql', '8.0.44').includes('WITH'), 'mysql 8 should suggest CTE keyword');

// 标识符按方言加引号；无需引号时保持原样。
assert(quoteCompletionIdentifier('mssql', 'users') === 'users', 'plain identifier changed');
assert(quoteCompletionIdentifier('mssql', 'my table') === '[my table]', 'mssql quoting wrong');
assert(quoteCompletionIdentifier('mysql', 'select') === '`select`', 'mysql keyword quoting wrong');
assert(quoteCompletionIdentifier('sqlite', 'a-b') === '"a-b"', 'sqlite quoting wrong');

// 带 insertText 时原样插入，不再跟随输入大小写。
const inserted = applyCompletion('SELECT * FROM ', 14, 14, 'my table', {
  insertText: '[my table]',
});
assert(inserted.text === 'SELECT * FROM [my table]', `insertText apply wrong: ${inserted.text}`);

// FROM/JOIN 之后允许库名/Schema 名；EXEC 仍然只给存储过程。
const fromGroups = {
  keywords: [],
  functions: [],
  objects: [{ name: 'users', kind: 'table' }],
  databases: ['fanr'],
  schemas: ['dbo'],
};
const fromContext = extractCompletionContext('SELECT * FROM ', 14);
const fromAll = completionCandidatesForContext(fromContext, fromGroups);
assert(
  fromAll.some((item) => item.kind === 'schema') &&
    fromAll.some((item) => item.kind === 'database'),
  'FROM should offer schema/database names',
);
const execContext = extractCompletionContext('EXEC ', 5);
assert(
  completionCandidatesForContext(execContext, fromGroups).length === 0,
  'EXEC should not offer schemas/databases when no procedures exist',
);

// CTE / 派生表列推导。
const cte = extractVirtualTables(
  'WITH recent AS (SELECT id, name FROM users WHERE id > 1) SELECT * FROM recent',
);
assert(
  cte.length === 1 && cte[0].name === 'recent',
  `cte should be parsed: ${JSON.stringify(cte)}`,
);
assert(
  JSON.stringify(cte[0].columns) === JSON.stringify(['id', 'name']),
  `cte columns wrong: ${JSON.stringify(cte[0]?.columns)}`,
);
const explicitCte = extractVirtualTables(
  'WITH x(a, b) AS (SELECT id, name FROM users) SELECT * FROM x',
);
assert(
  JSON.stringify(explicitCte[0]?.columns) === JSON.stringify(['a', 'b']),
  `explicit cte columns wrong: ${JSON.stringify(explicitCte[0]?.columns)}`,
);
const derived = extractVirtualTables(
  'SELECT u.user_id FROM (SELECT id AS user_id, name FROM users) u',
);
assert(
  derived.length === 1 && derived[0].name === 'u',
  `derived table should be parsed: ${JSON.stringify(derived)}`,
);
assert(
  JSON.stringify(derived[0].columns) === JSON.stringify(['user_id', 'name']),
  `derived columns wrong: ${JSON.stringify(derived[0]?.columns)}`,
);
assert(
  extractVirtualTables('SELECT * FROM (SELECT * FROM users) u').length === 0,
  'star-derived table should not produce column list',
);

// lower_case_table_names=1 时对象名按小写插入。
assert(normalizeCompletionNameCase('Users', 1) === 'users', 'lctn=1 should fold lower');
assert(normalizeCompletionNameCase('Users', 0) === 'Users', 'lctn=0 should keep case');
assert(normalizeCompletionNameCase('Users', 2) === 'Users', 'lctn=2 should keep case');

// 引号标识符内补全：连开引号一起替换，已存在的闭引号也被覆盖。
const bracketContext = extractCompletionContext('SELECT [us', 10);
assert(
  bracketContext.needle === 'us' &&
    bracketContext.replaceStart === 7 &&
    bracketContext.replaceEnd === 10 &&
    bracketContext.inLiteral === false,
  `bracket context wrong: ${JSON.stringify({
    needle: bracketContext.needle,
    start: bracketContext.replaceStart,
    end: bracketContext.replaceEnd,
  })}`,
);
assert(
  applyCompletion('SELECT [us', 7, 10, 'users', { insertText: '[users]' }).text ===
    'SELECT [users]',
  'bracket completion apply wrong',
);
const bracketClosed = extractCompletionContext('SELECT [us]', 10);
assert(
  bracketClosed.replaceEnd === 11 && bracketClosed.needle === 'us',
  `closed bracket range wrong: ${bracketClosed.replaceEnd}/${bracketClosed.needle}`,
);
const backtickContext = extractCompletionContext('SELECT `us', 10);
assert(
  backtickContext.needle === 'us' && backtickContext.replaceStart === 7,
  `backtick context wrong: ${JSON.stringify(backtickContext)}`,
);
const quotedQualifier = extractCompletionContext('SELECT [dbo].[us', 16);
assert(
  quotedQualifier.qualifier === '[dbo]' &&
    quotedQualifier.needle === 'us' &&
    quotedQualifier.replaceStart === 13,
  `quoted qualifier wrong: ${JSON.stringify({
    q: quotedQualifier.qualifier,
    n: quotedQualifier.needle,
    s: quotedQualifier.replaceStart,
  })}`,
);

console.log('sql completion check passed');
