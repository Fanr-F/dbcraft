/**
 * 导出格式的纯逻辑测试。
 *
 * 运行：npm run test:export
 */
import { toCsv, toJson, toSqlInsert } from '../src/shared/export/formats.ts';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const columns = [
  { name: 'id', declaredType: 'INTEGER' },
  { name: 'name', declaredType: 'TEXT' },
  { name: 'note', declaredType: 'TEXT' },
];
const rows = [
  [1, 'O\'Brien, "Jr"', 'line1\nline2'],
  [2, null, ''],
];

const csv = toCsv(columns, rows);
assert(csv.startsWith('\uFEFF'), 'CSV missing BOM');
assert(csv.includes('id,name,note\r\n'), 'CSV header wrong');
assert(csv.includes('1,"O\'Brien, ""Jr""","line1\nline2"\r\n'), 'CSV quote/newline escaping wrong');
assert(csv.includes('2,,\r\n'), 'CSV null/empty should be empty fields');
assert(csv.endsWith('\r\n'), 'CSV should end with CRLF');

const csvEmpty = toCsv(columns, []);
assert(csvEmpty === '\uFEFFid,name,note\r\n', 'empty CSV should keep header');

const json = toJson(columns, rows);
const parsed = JSON.parse(json);
assert(parsed.length === 2, 'JSON row count wrong');
assert(parsed[0].name === 'O\'Brien, "Jr"', 'JSON string wrong');
assert(parsed[1].name === null, 'JSON null not preserved');
assert(parsed[1].note === '', 'JSON empty string not preserved');
assert(json.endsWith('\n'), 'JSON should end with newline');

const sqlite = toSqlInsert('sqlite', 't', columns, [[1, "O'Brien", null]]);
assert(
  sqlite === 'INSERT INTO "t" ("id", "name", "note") VALUES (1, \'O\'\'Brien\', NULL);\n',
  `sqlite SQL wrong:\n${sqlite}`,
);

const mysql = toSqlInsert('mysql', 't', columns, [[1, 'x', '']]);
assert(
  mysql === 'INSERT INTO `t` (`id`, `name`, `note`) VALUES (1, \'x\', \'\');\n',
  `mysql SQL wrong:\n${mysql}`,
);

const mssql = toSqlInsert('mssql', 't', columns, [[1, "O'Brien", true]]);
assert(
  mssql === 'INSERT INTO [t] ([id], [name], [note]) VALUES (1, N\'O\'\'Brien\', 1);\n',
  `mssql SQL wrong:\n${mssql}`,
);

const none = toSqlInsert('sqlite', 't', columns, []);
assert(none === '', 'empty SQL export should be empty');

console.log('export formats check passed');
