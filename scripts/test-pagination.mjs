/**
 * 表数据分页 SQL 的纯逻辑测试。
 *
 * 运行：npm run test:pagination
 */
import Database from 'better-sqlite3';
import {
  buildSubqueryPageSql,
  buildTablePageQuery,
  buildTablePageSql,
  buildTablePreviewSql,
} from '../src/shared/dialect/identifiers.ts';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(
  buildTablePageSql('sqlite', 'users', 200, 0) ===
    'SELECT * FROM "users" LIMIT 200 OFFSET 0;',
  'sqlite page SQL wrong',
);
assert(
  buildTablePageSql('mysql', 'users', 50, 100) ===
    'SELECT * FROM `users` LIMIT 50 OFFSET 100;',
  'mysql page SQL wrong',
);
assert(
  buildTablePageSql('mariadb', 'users', 500, 1000) ===
    'SELECT * FROM `users` LIMIT 500 OFFSET 1000;',
  'mariadb page SQL wrong',
);
assert(
  buildTablePageSql('mssql', 'users', 200, 200) ===
    'SELECT * FROM [users] ORDER BY (SELECT NULL) OFFSET 200 ROWS FETCH NEXT 200 ROWS ONLY;',
  'mssql page SQL wrong',
);
assert(
  buildTablePageSql('sqlite', 'we"ird', 10, 0).includes('"we""ird"'),
  'identifier not escaped',
);

assert(
  buildTablePageSql('sqlite', 'users', 200, 0, { column: 'name', direction: 'desc' }) ===
    'SELECT * FROM "users" ORDER BY "name" DESC LIMIT 200 OFFSET 0;',
  'sqlite sorted page SQL wrong',
);
assert(
  buildTablePageSql('mysql', 'users', 200, 200, { column: 'created_at', direction: 'asc' }) ===
    'SELECT * FROM `users` ORDER BY `created_at` ASC LIMIT 200 OFFSET 200;',
  'mysql sorted page SQL wrong',
);
assert(
  buildTablePageSql('mssql', 'users', 200, 0, { column: 'id', direction: 'desc' }) ===
    'SELECT * FROM [users] ORDER BY [id] DESC OFFSET 0 ROWS FETCH NEXT 200 ROWS ONLY;',
  'mssql sorted page SQL wrong',
);
assert(
  buildTablePageSql('mssql', 'users', 200, 0) ===
    'SELECT * FROM [users] ORDER BY (SELECT NULL) OFFSET 0 ROWS FETCH NEXT 200 ROWS ONLY;',
  'mssql default order wrong',
);
assert(
  buildTablePageSql('sqlite', 'users', 200, 0, [
    { column: 'name', direction: 'asc' },
    { column: 'id', direction: 'desc' },
  ]) === 'SELECT * FROM "users" ORDER BY "name" ASC, "id" DESC LIMIT 200 OFFSET 0;',
  'sqlite multi-column sort wrong',
);
assert(
  buildTablePageSql('mssql', 'users', 200, 0, [
    { column: 'name', direction: 'asc' },
    { column: 'id', direction: 'desc' },
  ]) ===
    'SELECT * FROM [users] ORDER BY [name] ASC, [id] DESC OFFSET 0 ROWS FETCH NEXT 200 ROWS ONLY;',
  'mssql multi-column sort wrong',
);

assert(
  buildTablePreviewSql('sqlite', 'users', 100) === 'SELECT * FROM "users" LIMIT 100;',
  'preview SQL wrong',
);
assert(
  buildTablePreviewSql('mssql', 'users', 100) === 'SELECT TOP (100) * FROM [users];',
  'mssql preview SQL wrong',
);
assert(
  buildTablePageSql('sqlite', 'logs', 50, 0, null, null, { rowidAlias: 'rowid' }) ===
    'SELECT "rowid" AS "rowid", * FROM "logs" LIMIT 50 OFFSET 0;',
  'sqlite rowid page SQL wrong',
);
assert(
  buildSubqueryPageSql('sqlite', 'SELECT * FROM users;', 5000, 10000) ===
    'SELECT * FROM (SELECT * FROM users) AS dbcraft_stream LIMIT 5000 OFFSET 10000',
  'sqlite subquery stream page wrong',
);
assert(
  buildSubqueryPageSql('mssql', 'SELECT * FROM users', 5000, 0) ===
    'SELECT * FROM (SELECT * FROM users) AS [dbcraft_stream] ORDER BY (SELECT NULL) OFFSET 0 ROWS FETCH NEXT 5000 ROWS ONLY',
  'mssql subquery stream page wrong',
);

const filtered = buildTablePageQuery('sqlite', 'users', 200, 0, null, {
  column: 'name',
  value: 'a%b_c!',
});
assert(
  filtered.sql ===
    'SELECT * FROM "users" WHERE "name" LIKE ? ESCAPE \'!\' LIMIT 200 OFFSET 0;',
  `filtered SQL wrong: ${filtered.sql}`,
);
assert(
  filtered.params.length === 1 && filtered.params[0] === '%a!%b!_c!!%',
  `filtered params wrong: ${JSON.stringify(filtered.params)}`,
);

const mysqlFiltered = buildTablePageQuery(
  'mysql',
  'users',
  50,
  10,
  { column: 'name', direction: 'desc' },
  { column: 'email', value: 'x' },
);
assert(
  mysqlFiltered.sql ===
    'SELECT * FROM `users` WHERE `email` LIKE ? ESCAPE \'!\' ORDER BY `name` DESC LIMIT 50 OFFSET 10;',
  `mysql filtered SQL wrong: ${mysqlFiltered.sql}`,
);
assert(mysqlFiltered.params[0] === '%x%', 'mysql filter params wrong');

// 空过滤值不应生成 WHERE。
const unfiltered = buildTablePageQuery('sqlite', 'users', 200, 0, null, {
  column: 'name',
  value: '',
});
assert(!unfiltered.sql.includes('WHERE') && unfiltered.params.length === 0, 'empty filter wrong');

const multiFiltered = buildTablePageQuery(
  'mssql',
  'users',
  200,
  0,
  null,
  [
    { column: 'name', operator: 'contains', value: 'a' },
    { column: 'age', operator: 'gt', value: '18' },
    { column: 'deleted_at', operator: 'isNull', value: '' },
  ],
);
assert(
  multiFiltered.sql ===
    'SELECT * FROM [users] WHERE [name] LIKE @p1 ESCAPE \'!\' AND [age] > @p2 AND [deleted_at] IS NULL ORDER BY (SELECT NULL) OFFSET 0 ROWS FETCH NEXT 200 ROWS ONLY;',
  `multi filter SQL wrong: ${multiFiltered.sql}`,
);
assert(
  multiFiltered.params.length === 2 &&
    multiFiltered.params[0] === '%a%' &&
    multiFiltered.params[1] === '18',
  `multi filter params wrong: ${JSON.stringify(multiFiltered.params)}`,
);

const operators = buildTablePageQuery('sqlite', 'users', 10, 0, null, [
  { column: 'name', operator: 'startsWith', value: 'A%' },
  { column: 'id', operator: 'lte', value: '9' },
  { column: 'email', operator: 'notEquals', value: 'x' },
]);
assert(
  operators.sql ===
    'SELECT * FROM "users" WHERE "name" LIKE ? ESCAPE \'!\' AND "id" <= ? AND "email" <> ? LIMIT 10 OFFSET 0;',
  `operator SQL wrong: ${operators.sql}`,
);
assert(
  operators.params[0] === 'A!%%' && operators.params[1] === '9' && operators.params[2] === 'x',
  `operator params wrong: ${JSON.stringify(operators.params)}`,
);

// 真实 SQLite 验证 ESCAPE 与参数绑定。
const database = new Database(':memory:');
database.exec('CREATE TABLE users (name TEXT)');
const insert = database.prepare('INSERT INTO users (name) VALUES (?)');
for (const name of ['50%', '50x', 'a_b', 'axb', 'plain']) insert.run(name);

const percent = buildTablePageQuery('sqlite', 'users', 200, 0, null, {
  column: 'name',
  value: '50%',
});
const percentRows = database.prepare(percent.sql).all(...percent.params);
assert(
  percentRows.length === 1 && percentRows[0].name === '50%',
  `LIKE % escape failed: ${JSON.stringify(percentRows)}`,
);

const underscore = buildTablePageQuery('sqlite', 'users', 200, 0, null, {
  column: 'name',
  value: 'a_b',
});
const underscoreRows = database.prepare(underscore.sql).all(...underscore.params);
assert(
  underscoreRows.length === 1 && underscoreRows[0].name === 'a_b',
  `LIKE _ escape failed: ${JSON.stringify(underscoreRows)}`,
);

const combined = buildTablePageQuery('sqlite', 'users', 200, 0, null, [
  { column: 'name', operator: 'startsWith', value: '5' },
  { column: 'name', operator: 'notEquals', value: '50%' },
]);
const combinedRows = database.prepare(combined.sql).all(...combined.params);
assert(
  combinedRows.length === 1 && combinedRows[0].name === '50x',
  `combined filter failed: ${JSON.stringify(combinedRows)}`,
);
database.close();

console.log('pagination SQL check passed');
