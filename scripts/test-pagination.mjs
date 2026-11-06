/**
 * 表数据分页 SQL 的纯逻辑测试。
 *
 * 运行：npm run test:pagination
 */
import Database from 'better-sqlite3';
import {
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
  buildTablePreviewSql('sqlite', 'users', 100) === 'SELECT * FROM "users" LIMIT 100;',
  'preview SQL wrong',
);
assert(
  buildTablePreviewSql('mssql', 'users', 100) === 'SELECT TOP (100) * FROM [users];',
  'mssql preview SQL wrong',
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
database.close();

console.log('pagination SQL check passed');
