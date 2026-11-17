/**
 * SQL 补全辅助函数的纯逻辑测试。
 *
 * 运行：npm run test:sql-completion
 */
import {
  applyCompletion,
  buildJoinCondition,
  CompletionService,
  completionCandidatesForContext,
  completionExpectation,
  completionResultLimit,
  extractAttachedDatabases,
  extractCompletionContext,
  extractSignatureHelp,
  excludeReferencedTables,
  extractVirtualTables,
  filterCompletions,
  foreignKeyEqualities,
  foreignKeyJoinTargets,
  functionCompletions,
  keywordCompletions,
  matchCompletionCase,
  normalizeCompletionNameCase,
  quoteCompletionIdentifier,
  rankCompletions,
  shouldAutoTriggerCompletion,
  shouldOpenCompletionOnInput,
  splitQualifier,
  stripSchemaPrefix,
  suggestJoinAlias,
} from '../src/index.ts';

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

// 空格自动触发：对象名/列上下文关键字后弹补全。
assert(shouldAutoTriggerCompletion('SELECT ', 7), 'SELECT space should trigger');
assert(shouldAutoTriggerCompletion('SELECT DISTINCT ', 16), 'SELECT DISTINCT space should trigger');
assert(shouldOpenCompletionOnInput('SELECT ', 7), 'SELECT space should auto-open completion');
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

// MSSQL 系统 schema：`sys.` 的候选要去掉对象名里的 `sys.` 前缀。
assert(stripSchemaPrefix('sys.tables', 'sys') === 'tables', 'sys prefix not stripped');
assert(stripSchemaPrefix('users', 'dbo') === 'users', 'unprefixed name should stay as-is');
assert(stripSchemaPrefix('dbo.users', 'dbo') === 'users', 'qualified name should be stripped');
assert(stripSchemaPrefix('SYS.tables', 'sys') === 'tables', 'schema prefix should be case-insensitive');
const execSys = extractCompletionContext('exec sys.', 'exec sys.'.length);
assert(execSys.qualifier === 'sys' && execSys.clause === 'exec', 'exec sys. context wrong');
const fromSys = extractCompletionContext('select * from sys.', 'select * from sys.'.length);
assert(fromSys.qualifier === 'sys' && fromSys.clause === 'from', 'from sys. context wrong');
assert(
  completionCandidatesForContext(execSys, groups).length === 0 &&
    completionCandidatesForContext(fromSys, groups).length === 0,
  'qualified sys completion should rely on async schema objects',
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
// 常用关键字在同分关键字中优先：fr -> FROM 先于 FREE/FREETEXT。
const frRank = rankCompletions(
  [
    { label: 'FREE', kind: 'keyword' },
    { label: 'FREETEXT', kind: 'keyword' },
    { label: 'FROM', kind: 'keyword' },
  ],
  'fr',
);
assert(frRank[0]?.label === 'FROM', `common keyword should rank first: ${frRank.map((i) => i.label)}`);
// 但不越过函数优先级：co -> COUNT 仍在 COMMIT 前。
const coRank = rankCompletions(
  [
    { label: 'COMMIT', kind: 'keyword' },
    { label: 'COUNT', kind: 'function' },
  ],
  'co',
);
assert(coRank[0]?.label === 'COUNT', `function should stay above keyword: ${coRank.map((i) => i.label)}`);
// 有前缀命中时，子序列命中的表/列也必须丢弃：se -> sessions/SELECT，不含 users。
const strictPrefix = rankCompletions(
  [
    { label: 'sessions', kind: 'table' },
    { label: 'users', kind: 'table' },
    { label: 'user_settings', kind: 'table' },
    { label: 'SELECT', kind: 'keyword' },
  ],
  'se',
);
assert(
  JSON.stringify(strictPrefix.map((item) => item.label)) ===
    JSON.stringify(['sessions', 'SELECT']),
  `strict prefix order wrong: ${strictPrefix.map((item) => item.label).join(',')}`,
);
// 没有任何前缀命中时才回退模糊匹配。
const fallbackFuzzy = rankCompletions(
  [
    { label: 'users', kind: 'table' },
    { label: 'releases', kind: 'table' },
  ],
  'se',
);
assert(
  fallbackFuzzy.some((item) => item.label === 'releases'),
  `fuzzy fallback should apply without prefix matches: ${fallbackFuzzy.map((i) => i.label)}`,
);

// 加权排序：匹配质量 > 类型权重，列 > 表 > 关键字。
const weighted = rankCompletions(
  [
    { label: 'UNION', kind: 'keyword' },
    { label: 'users', kind: 'table' },
    { label: 'user_id', kind: 'column' },
  ],
  'u',
);
assert(
  JSON.stringify(weighted.map((item) => item.label)) ===
    JSON.stringify(['user_id', 'users', 'UNION']),
  `weighted order wrong: ${weighted.map((i) => i.label)}`,
);
// 精确匹配始终排在前缀匹配前。
const exactRanked = rankCompletions(
  [
    { label: 'user_roles', kind: 'table' },
    { label: 'user', kind: 'table' },
  ],
  'user',
);
assert(
  exactRanked[0]?.label === 'user',
  `exact match should rank first: ${exactRanked.map((i) => i.label)}`,
);
// boost 用于系统对象降权等情境，同类型内按 boost 重排。
const boosted = rankCompletions(
  [
    { label: 'users', kind: 'table', boost: -20 },
    { label: 'user_roles', kind: 'table' },
  ],
  'user',
);
assert(
  boosted[0]?.label === 'user_roles',
  `boost should reorder same-kind matches: ${boosted.map((i) => i.label)}`,
);
// priority 只在同分时作为先后顺序：第一个表的列优先。
const priorityRanked = rankCompletions(
  [
    { label: 'id', kind: 'column', priority: 1 },
    { label: 'name', kind: 'column', priority: 0 },
  ],
  '',
);
assert(
  JSON.stringify(priorityRanked.map((i) => i.label)) === JSON.stringify(['name', 'id']),
  `priority tie-break wrong: ${priorityRanked.map((i) => i.label)}`,
);
// 重复候选按最高分保留，而不是先到先得。
const deduped = rankCompletions(
  [
    { label: 'users', kind: 'table', boost: -20, detail: 'system' },
    { label: 'users', kind: 'table', detail: 'user' },
  ],
  'us',
);
assert(
  deduped.length === 1 && deduped[0].detail === 'user',
  `dedupe should keep best candidate: ${JSON.stringify(deduped)}`,
);

// FROM/INTO/UPDATE 后排除语句已引用的表；JOIN 允许自连接，不排除。
const fromText = 'SELECT * FROM users, ';
const fromCtx = extractCompletionContext(fromText, fromText.length);
const fromCandidates = excludeReferencedTables(
  [
    { label: 'users', kind: 'table' },
    { label: 'orders', kind: 'table' },
    { label: 'user_id', kind: 'column' },
  ],
  fromCtx,
);
assert(
  JSON.stringify(fromCandidates.map((i) => i.label)) === JSON.stringify(['orders', 'user_id']),
  `referenced table not excluded: ${fromCandidates.map((i) => i.label)}`,
);
const selfJoinText = 'SELECT * FROM users JOIN ';
const joinCtx = extractCompletionContext(selfJoinText, selfJoinText.length);
const joinCandidates = excludeReferencedTables([{ label: 'users', kind: 'table' }], joinCtx);
assert(joinCandidates.length === 1, 'JOIN should keep referenced tables for self-join');

// 光标正在补全语句里已有的表时（`sys.` 位于 `sys.databases` 中间），不能把
// 当前表按“已引用”排除；补全到完整名字时同样要保留。
const editingText = 'SELECT * FROM sys.databases';
for (const [cursor, label] of [
  ['SELECT * FROM sys.'.length, '中缀'],
  [editingText.length, '完整'],
]) {
  const editingCtx = extractCompletionContext(editingText, cursor);
  const editingCandidates = excludeReferencedTables(
    [{ label: 'databases', kind: 'view' }],
    editingCtx,
  );
  assert(
    editingCandidates.length === 1,
    `referenced table being edited should stay (${label}): ${editingCandidates.map((i) => i.label)}`,
  );
}

// 限定符补全不截断：`sys.` 下按名称排在 60 位的 sys.databases 也要能看到。
const qualifiedScopeCtx = extractCompletionContext('SELECT * FROM sys.', 18);
assert(completionResultLimit(qualifiedScopeCtx) === 2000, 'qualified scope should not cap at 50');
assert(
  completionResultLimit(extractCompletionContext('SELECT * FROM ', 14)) === 50,
  'unqualified scope should keep 50',
);
const manyViews = Array.from({ length: 59 }, (_, index) => ({
  label: `a_${String(index).padStart(2, '0')}`,
  kind: 'view',
}));
manyViews.push({ label: 'databases', kind: 'view' });
const cappedViews = rankCompletions(manyViews, '', { limit: 50 });
assert(
  !cappedViews.some((item) => item.label === 'databases'),
  'default 50 should demonstrate truncation for the regression case',
);
const fullViews = rankCompletions(manyViews, '', {
  limit: completionResultLimit(qualifiedScopeCtx),
});
assert(
  fullViews.some((item) => item.label === 'databases'),
  'qualified scope should keep late-alphabet objects',
);

// 类型分组：表在视图（含 DMV/DMF）之前；同类型内按名称排序。
const relationOrder = rankCompletions(
  [
    { label: 'dm_b', kind: 'view' },
    { label: 'dm_a', kind: 'view' },
    { label: 'dm_table', kind: 'table' },
  ],
  'dm',
);
assert(
  JSON.stringify(relationOrder.map((item) => item.label)) ===
    JSON.stringify(['dm_table', 'dm_a', 'dm_b']),
  `relation order wrong: ${relationOrder.map((item) => item.label)}`,
);
const emptyRelationOrder = rankCompletions(
  [
    { label: 'v_all', kind: 'view' },
    { label: 't_all', kind: 'table' },
  ],
  '',
);
assert(
  emptyRelationOrder[0]?.label === 't_all',
  `table should precede view without prefix: ${emptyRelationOrder.map((i) => i.label)}`,
);

// 多段输入：`dm_sql` 要命中 `dm_exec_sql_text`，即使列表里已有 `dm_sql_*`
// 这样的真正前缀候选；仍按前缀优先、同类型字母序排列。
const segmentRanked = rankCompletions(
  [
    { label: 'dm_sql_referenced_entities', kind: 'view' },
    { label: 'dm_exec_sql_text', kind: 'view' },
    { label: 'dm_exec_requests', kind: 'view' },
  ],
  'dm_sql',
);
assert(
  JSON.stringify(segmentRanked.map((item) => item.label)) ===
    JSON.stringify(['dm_sql_referenced_entities', 'dm_exec_sql_text']),
  `segment match order wrong: ${segmentRanked.map((item) => item.label)}`,
);
const segmentOnly = rankCompletions(
  [{ label: 'dm_exec_sql_text', kind: 'view' }],
  'dm_sql',
);
assert(
  segmentOnly.length === 1 && segmentOnly[0].label === 'dm_exec_sql_text',
  `segment-only match missing: ${segmentOnly.map((item) => item.label)}`,
);

// 限定符下单段也按段命中：`sys.sql` 同时给出真正前缀 `sql_modules` 和后段
// 命中 `dm_exec_sql_text`；没有限定符时不放宽，避免 `se` 式噪音。
const sysSqlText = 'SELECT * FROM sys.sql';
const sysSqlCtx = extractCompletionContext(sysSqlText, sysSqlText.length);
const sysSqlRanked = rankCompletions(
  [
    { label: 'sql_modules', kind: 'view' },
    { label: 'dm_exec_sql_text', kind: 'view' },
  ],
  'sql',
  { context: sysSqlCtx },
);
assert(
  JSON.stringify(sysSqlRanked.map((item) => item.label)) ===
    JSON.stringify(['sql_modules', 'dm_exec_sql_text']),
  `qualified single-segment order wrong: ${sysSqlRanked.map((item) => item.label)}`,
);
const plainSqlRanked = rankCompletions(
  [
    { label: 'sql_modules', kind: 'view' },
    { label: 'dm_exec_sql_text', kind: 'view' },
  ],
  'sql',
);
assert(
  JSON.stringify(plainSqlRanked.map((item) => item.label)) ===
    JSON.stringify(['sql_modules']),
  `unqualified single-segment should stay strict: ${plainSqlRanked.map((item) => item.label)}`,
);

// 期望模型：FROM 只要表，WHERE 要列，JOIN ... ON 要列且是 joinOn。
const fromExp = completionExpectation(extractCompletionContext('SELECT * FROM ', 14));
assert(fromExp.tables && fromExp.schemas && !fromExp.columns, 'FROM expectation wrong');
const whereExp = completionExpectation(
  extractCompletionContext('SELECT * FROM users WHERE ', 26),
);
assert(whereExp.columns && !whereExp.tables, 'WHERE expectation wrong');
const onSql = 'SELECT * FROM users u JOIN orders o ON ';
const onExp = completionExpectation(extractCompletionContext(onSql, onSql.length));
assert(onExp.columns && onExp.joinOn, 'JOIN ON expectation wrong');
const insertListSql = 'INSERT INTO users (';
const insertExp = completionExpectation(
  extractCompletionContext(insertListSql, insertListSql.length),
);
assert(insertExp.columnNames && insertExp.columns, 'INSERT column-list expectation wrong');

// qualifier/所属表加权：u. 时 users 的列排在 orders 的列前。
const qualifiedSql = 'SELECT u. FROM users u';
const qualifiedCtx = extractCompletionContext(qualifiedSql, qualifiedSql.indexOf('u.') + 2);
const qualifiedRanked = rankCompletions(
  [
    { label: 'alpha', kind: 'column', table: 'orders' },
    { label: 'zeta', kind: 'column', table: 'users' },
  ],
  '',
  { context: qualifiedCtx },
);
assert(
  qualifiedRanked[0]?.label === 'zeta',
  `qualifier table should rank first: ${qualifiedRanked.map((i) => i.label)}`,
);

// schema qualifier 加权：dbo. 时 dbo 的表排在 sys 的表前。
const schemaSql = 'SELECT * FROM dbo.';
const schemaCtx = extractCompletionContext(schemaSql, schemaSql.length);
const schemaRanked = rankCompletions(
  [
    { label: 'sys_objects', kind: 'table', schema: 'sys' },
    { label: 'users', kind: 'table', schema: 'dbo' },
  ],
  '',
  { context: schemaCtx },
);
assert(
  schemaRanked[0]?.label === 'users',
  `schema qualifier should rank first: ${schemaRanked.map((i) => i.label)}`,
);

// JOIN ... ON 时主键列优先。
const pkRanked = rankCompletions(
  [
    { label: 'id', kind: 'column', table: 'users' },
    { label: 'user_id', kind: 'column', table: 'orders', primaryKey: true },
  ],
  '',
  { context: extractCompletionContext(onSql, onSql.length) },
);
assert(
  pkRanked[0]?.label === 'user_id',
  `primary key should rank first in JOIN ON: ${pkRanked.map((i) => i.label)}`,
);

// 子句期望加权：WHERE 里列排在函数前。
const affinityRanked = rankCompletions(
  [
    { label: 'zzz', kind: 'function' },
    { label: 'aaa', kind: 'column', table: 'users' },
  ],
  '',
  { context: extractCompletionContext('SELECT * FROM users WHERE ', 26) },
);
assert(
  affinityRanked[0]?.label === 'aaa',
  `column should rank above function in WHERE: ${affinityRanked.map((i) => i.label)}`,
);

// FK JOIN 目标：跳过语句已引用的表，按目标表去重。
const fkReferences = [
  { table: 'orders', columns: ['user_id'], referencedTable: 'users', referencedColumns: ['id'] },
  { table: 'orders', columns: ['user_id'], referencedTable: 'users', referencedColumns: ['id'] },
  { table: 'orders', columns: ['role_id'], referencedTable: 'roles', referencedColumns: ['id'] },
  { table: 'orders', columns: ['org_id'], referencedTable: 'dbo.orgs', referencedColumns: ['id'] },
];
const fkTargets = foreignKeyJoinTargets(fkReferences, ['orders', 'users']);
assert(
  JSON.stringify(fkTargets.map((item) => item.referencedTable)) ===
    JSON.stringify(['roles', 'dbo.orgs']),
  `FK join targets wrong: ${fkTargets.map((item) => item.referencedTable)}`,
);
assert(
  foreignKeyJoinTargets(fkReferences, ['orders', 'users', 'roles', 'orgs']).length === 0,
  'FK join targets should skip all referenced tables',
);

// ON 等式：只保留目标表已在语句中的外键，按列对去重，跳过自引用。
assert(
  foreignKeyEqualities(fkReferences, ['orders']).length === 0,
  'ON equality should skip targets not referenced in the statement',
);
const fkEqualities = foreignKeyEqualities(fkReferences, ['orders', 'users', 'roles', 'orgs']);
assert(
  fkEqualities.length === 3 &&
    fkEqualities[0]?.referencedTable === 'users' &&
    fkEqualities[1]?.referencedTable === 'roles',
  `ON equalities wrong: ${fkEqualities.map((item) => item.referencedTable)}`,
);
assert(
  foreignKeyEqualities(
    [
      {
        table: 'users',
        columns: ['manager_id'],
        referencedTable: 'users',
        referencedColumns: ['id'],
      },
    ],
    ['users'],
  ).length === 0,
  'ON equality should skip self references',
);

// JOIN 别名与条件片段。
assert(suggestJoinAlias('orders', []) === 'o1', 'alias should start at 1');
assert(suggestJoinAlias('dbo.users', ['u1']) === 'u2', 'alias should skip used aliases');
assert(suggestJoinAlias('123_table', []) === 't1', 'non-alpha table should fall back to t');
assert(
  buildJoinCondition('o1', 'u1', ['user_id'], ['id']) === 'o1.user_id = u1.id',
  'single-column join condition wrong',
);
assert(
  buildJoinCondition('o1', 'u1', ['tenant_id', 'user_id'], ['tenant_id', 'id']) ===
    'o1.tenant_id = u1.tenant_id AND o1.user_id = u1.id',
  'multi-column join condition wrong',
);
assert(
  buildJoinCondition('o1', 'u1', ['user_id'], []) === 'o1.user_id = u1.user_id',
  'missing referenced column should fall back to same name',
);

// 语句分析器由宿主注入：注入时采用分析结果，未注入/解析失败时回退扫描。
const tablesAnalyzer = (tables) => () => ({ tables, ctes: [] });
const astJoinSql = 'SELECT u.id FROM users u JOIN orders o ON o.user_id = u.id';
const astJoinCtx = extractCompletionContext(
  astJoinSql,
  astJoinSql.length,
  'mysql',
  tablesAnalyzer([
    { raw: 'users', parts: ['users'], table: 'users', alias: 'u' },
    { raw: 'orders', parts: ['orders'], table: 'orders', alias: 'o' },
  ]),
);
assert(
  JSON.stringify(astJoinCtx.tables.map((table) => `${table.table}:${table.alias}`)) ===
    JSON.stringify(['users:u', 'orders:o']),
  `analyzer tables wrong: ${JSON.stringify(astJoinCtx.tables)}`,
);
const astMssql = 'SELECT * FROM [dbo].[users] u';
const astMssqlCtx = extractCompletionContext(
  astMssql,
  astMssql.length,
  'mssql',
  tablesAnalyzer([
    { raw: '[dbo].[users]', parts: ['dbo', 'users'], table: 'users', schema: 'dbo', alias: 'u' },
  ]),
);
assert(
  JSON.stringify(astMssqlCtx.tables[0]?.parts) === JSON.stringify(['dbo', 'users']) &&
    astMssqlCtx.tables[0]?.schema === 'dbo' &&
    astMssqlCtx.tables[0]?.alias === 'u',
  `analyzer mssql qualified table wrong: ${JSON.stringify(astMssqlCtx.tables)}`,
);
const astMysql = 'SELECT * FROM db1.users u';
const astMysqlCtx = extractCompletionContext(
  astMysql,
  astMysql.length,
  'mysql',
  tablesAnalyzer([
    { raw: 'db1.users', parts: ['db1', 'users'], table: 'users', database: 'db1', alias: 'u' },
  ]),
);
assert(
  astMysqlCtx.tables[0]?.database === 'db1' &&
    JSON.stringify(astMysqlCtx.tables[0]?.parts) === JSON.stringify(['db1', 'users']),
  `analyzer mysql qualified table wrong: ${JSON.stringify(astMysqlCtx.tables)}`,
);
const incompleteSql = 'SELECT * FROM users WHERE ';
const incompleteCtx = extractCompletionContext(incompleteSql, incompleteSql.length, 'mysql');
assert(
  JSON.stringify(incompleteCtx.tables.map((table) => table.table)) === JSON.stringify(['users']),
  `incomplete SQL should fall back to scanner: ${JSON.stringify(incompleteCtx.tables)}`,
);
const cteAnalyzer = () => ({
  tables: [],
  ctes: [{ name: 'x', columns: ['id', 'name'] }],
});
const astCte = extractVirtualTables(
  'WITH x(id, name) AS (SELECT id, name FROM users) SELECT * FROM x',
  'mysql',
  cteAnalyzer,
);
assert(
  astCte[0]?.name === 'x' &&
    JSON.stringify(astCte[0]?.columns) === JSON.stringify(['id', 'name']),
  `analyzer CTE columns wrong: ${JSON.stringify(astCte)}`,
);
const astInferredCte = extractVirtualTables(
  'WITH x AS (SELECT id AS uid, name FROM users) SELECT * FROM x',
  'mysql',
);
assert(
  astInferredCte[0]?.name === 'x' &&
    JSON.stringify(astInferredCte[0]?.columns) === JSON.stringify(['uid', 'name']),
  `scanner CTE fallback wrong: ${JSON.stringify(astInferredCte)}`,
);

// DBCC 子命令：只提示命令，不在命令后重复提示。
const emptyGroups = {
  keywords: [],
  functions: [],
  objects: [],
  databases: [],
  schemas: [],
};
const dbccCtx = extractCompletionContext('DBCC ', 5);
assert(dbccCtx.clause === 'dbcc', `DBCC clause wrong: ${dbccCtx.clause}`);
const dbccCandidates = completionCandidatesForContext(dbccCtx, emptyGroups);
assert(
  dbccCandidates.some((item) => item.label === 'CHECKDB') &&
    dbccCandidates.some((item) => item.label === 'SHOW_STATISTICS'),
  `DBCC commands missing: ${dbccCandidates.map((item) => item.label)}`,
);
const dbccPartial = extractCompletionContext('DBCC CHECK', 10);
assert(
  dbccPartial.clause === 'dbcc' && dbccPartial.needle === 'CHECK',
  `DBCC partial context wrong: ${dbccPartial.clause}/${dbccPartial.needle}`,
);
const dbccRanked = rankCompletions(dbccCandidates, 'CHECKDB', {
  context: dbccPartial,
});
assert(dbccRanked[0]?.label === 'CHECKDB', `DBCC exact match wrong: ${dbccRanked.map((i) => i.label)}`);
assert(shouldOpenCompletionOnInput('DBCC ', 5), 'DBCC space should auto-open completion');
const dbccCommandText = 'DBCC CHECKDB ';
assert(
  extractCompletionContext(dbccCommandText, dbccCommandText.length).clause !== 'dbcc',
  'DBCC command with trailing space should not re-open command list',
);
const dbccWithText = 'DBCC CHECKDB WITH ';
const dbccWithCtx = extractCompletionContext(dbccWithText, dbccWithText.length);
assert(dbccWithCtx.clause === 'dbcc-with', `DBCC WITH clause wrong: ${dbccWithCtx.clause}`);
const dbccOptions = completionCandidatesForContext(dbccWithCtx, emptyGroups);
assert(
  dbccOptions.some((item) => item.label === 'NO_INFOMSGS') &&
    !dbccOptions.some((item) => item.label === 'REPAIR_ALLOW_DATA_LOSS'),
  `DBCC options wrong: ${dbccOptions.map((item) => item.label)}`,
);
assert(
  shouldOpenCompletionOnInput(dbccWithText, dbccWithText.length),
  'DBCC WITH should auto-open option completion',
);

// EXEC sys. 的系统存储过程候选（基础数据来自对象列表）。
const execCtx = extractCompletionContext('EXEC ', 5);
const execGroups = {
  ...emptyGroups,
  objects: [
    { name: 'sys.sp_who', kind: 'procedure', schema: 'sys' },
    { name: 'dbo.user_proc', kind: 'procedure', schema: 'dbo' },
  ],
};
const execCandidates = completionCandidatesForContext(execCtx, execGroups);
assert(
  execCandidates.some((item) => item.label === 'sys.sp_who'),
  `sys procedure should be a candidate: ${execCandidates.map((i) => i.label)}`,
);

// 版本感知：方言关键字与特性开关。
assert(keywordCompletions('mssql', '16.0').includes('TOP'), 'mssql should suggest TOP');
assert(
  keywordCompletions('mssql', '16.0').includes('WAITFOR'),
  'mssql should suggest WAITFOR from CodeMirror dialect keywords',
);
assert(
  keywordCompletions('mssql', '16.0').includes('DBCC'),
  'mssql should suggest DBCC from CodeMirror dialect keywords',
);
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

// INSERT INTO <table> ( 列清单：识别所属表，只给列。
const insertSql = 'INSERT INTO demo_users (';
const insertContext = extractCompletionContext(insertSql, insertSql.length);
assert(insertContext.insertColumnList, 'insert column list not detected');
assert(
  insertContext.insertTable?.table === 'demo_users',
  `insert table wrong: ${JSON.stringify(insertContext.insertTable)}`,
);
assert(
  completionCandidatesForContext(insertContext, groups).length === 0,
  'insert column list should not use base candidates',
);
assert(
  shouldOpenCompletionOnInput(insertSql, insertSql.length),
  'typing ( in insert column list should open completion',
);
const insertComma = 'INSERT INTO demo_users (id,';
assert(
  shouldOpenCompletionOnInput(insertComma, insertComma.length),
  'typing comma in insert column list should open completion',
);
const insertValues = 'INSERT INTO demo_users VALUES (';
assert(
  shouldOpenCompletionOnInput(insertValues, insertValues.length) === false,
  'VALUES ( should not open insert column completion',
);
const insertQualifiedSql = 'INSERT INTO [demo].[dbo].[users] (';
const insertQualified = extractCompletionContext(
  insertQualifiedSql,
  insertQualifiedSql.length,
);
assert(
  JSON.stringify(insertQualified.insertTable?.parts) ===
    JSON.stringify(['demo', 'dbo', 'users']),
  `qualified insert table wrong: ${JSON.stringify(insertQualified.insertTable)}`,
);
const insertIgnoreSql = 'INSERT IGNORE INTO `db`.`users` (';
const insertIgnore = extractCompletionContext(insertIgnoreSql, insertIgnoreSql.length);
assert(insertIgnore.insertTable?.table === 'users', 'INSERT IGNORE table wrong');
const fnSql = 'SELECT fn(';
assert(
  extractCompletionContext(fnSql, fnSql.length).insertColumnList === false,
  'function paren is not insert column list',
);

// 列上下文关键字后空格自动触发补全。
const trigger = (sql) => shouldAutoTriggerCompletion(sql, sql.length);
assert(trigger('SELECT * FROM users WHERE '), 'WHERE space should trigger completion');
assert(trigger('SELECT * FROM users ORDER BY '), 'ORDER BY space should trigger completion');
assert(trigger('SELECT * FROM users GROUP BY '), 'GROUP BY space should trigger completion');
assert(trigger('SELECT * FROM users HAVING '), 'HAVING space should trigger completion');
assert(
  trigger('SELECT * FROM users u JOIN orders o ON '),
  'JOIN ON space should trigger completion',
);
assert(
  trigger('CREATE INDEX idx ON users ') === false,
  'CREATE INDEX ON should not auto-trigger column completion',
);
// 逗号后再列候选：SELECT 列表、FROM 多表、ORDER BY 多列。
const commaAt = (sql) => shouldOpenCompletionOnInput(sql, sql.length);
assert(commaAt('SELECT id, '), 'comma in select list should open completion');
assert(commaAt('SELECT * FROM users, '), 'comma in FROM list should open completion');
assert(commaAt('SELECT * FROM users ORDER BY id, '), 'comma in ORDER BY should open completion');
assert(
  commaAt('INSERT INTO users VALUES (1, ') === false,
  'comma in VALUES should not open schema completion',
);

// 有前缀命中时丢弃纯子序列命中的关键字/函数噪音。
const noiseRanked = rankCompletions(
  [
    { label: 'name', kind: 'column' },
    { label: 'CURRENT_TIMESTAMP', kind: 'keyword' },
    { label: 'JSON_EXTRACT', kind: 'function' },
  ],
  'na',
);
assert(
  JSON.stringify(noiseRanked.map((item) => item.label)) === JSON.stringify(['name']),
  `fuzzy keyword noise not filtered: ${noiseRanked.map((item) => item.label).join(',')}`,
);
const fuzzyOnly = rankCompletions([{ label: 'JSON_EXTRACT', kind: 'function' }], 'na');
assert(fuzzyOnly.length === 1, 'fuzzy keyword should survive without strong matches');

// CompletionService + Provider：方言策略与元数据注入的端到端纯逻辑验证。
const provider = {
  async loadUserObjects(database) {
    return database === 'db1'
      ? [{ name: 'users', type: 'table' }, { name: 'orders', type: 'view' }]
      : [{ name: 'app_table', type: 'table' }];
  },
  async loadSystemObjects(database) {
    if (database !== 'app') return [];
    return [
      { name: 'sys.trace_xe_event_map', type: 'table', schema: 'sys' },
      { name: 'sys.databases', type: 'view', schema: 'sys' },
      { name: 'sys.dm_exec_sql_text', type: 'function', schema: 'sys' },
    ];
  },
  async loadColumns() {
    return [{ name: 'name', type: 'nvarchar(50)' }];
  },
  async loadForeignKeys() {
    return [];
  },
};

const mssqlService = new CompletionService('mssql', provider);
const sysText = 'SELECT * FROM sys.';
const sysCtx = extractCompletionContext(sysText, sysText.length, 'mssql');
const sysItems = await mssqlService.complete(sysCtx, {
  database: 'app',
  databases: ['app'],
  activeSchema: [],
});
assert(
  sysItems.some((item) => item.label === 'databases'),
  `engine should expose sys.databases: ${sysItems.slice(0, 8).map((i) => i.label)}`,
);
assert(
  sysItems.findIndex((item) => item.label === 'trace_xe_event_map') <
    sysItems.findIndex((item) => item.label === 'databases'),
  `engine should put tables before views: ${sysItems.map((i) => i.label)}`,
);
const sqlText = 'SELECT * FROM sys.sql';
const sqlCtx = extractCompletionContext(sqlText, sqlText.length, 'mssql');
const sqlItems = await mssqlService.complete(sqlCtx, {
  database: 'app',
  databases: ['app'],
  activeSchema: [],
});
assert(
  sqlItems.some((item) => item.label === 'dm_exec_sql_text'),
  `engine should match sys.sql -> dm_exec_sql_text: ${sqlItems.map((i) => i.label)}`,
);
mssqlService.dispose();

const mysqlService = new CompletionService('mysql', provider);
const mysqlText = 'SELECT * FROM db1.';
const mysqlCtx = extractCompletionContext(mysqlText, mysqlText.length, 'mysql');
const mysqlItems = await mysqlService.complete(mysqlCtx, {
  database: 'app',
  databases: ['app', 'db1'],
  activeSchema: [],
  lowerCaseTableNames: 1,
});
assert(
  mysqlItems.some((item) => item.label === 'users'),
  `mysql database qualifier should load db1 objects: ${mysqlItems.map((i) => i.label)}`,
);
mysqlService.dispose();

console.log('sql completion check passed');
