/**
 * SQL 高亮词法切分的纯逻辑测试。
 *
 * 运行：npm run test:sql-highlight
 */
import { tokenizeSql } from '../src/renderer/src/utils/sql-highlight.ts';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function typesOf(sql) {
  return tokenizeSql(sql)
    .filter((token) => token.type !== 'whitespace')
    .map((token) => token.type);
}

// 任何输入都必须无损还原，否则高亮层会和 textarea 错位。
const samples = [
  "SELECT * FROM users WHERE name = 'O''Brien';",
  '-- 注释\nSELECT 1;',
  '/* block\n comment */ SELECT `weird``name` FROM t',
  'SELECT 12.5, -3, "double" FROM 表 WHERE x >= 1.0',
  "SELECT '未闭合的字符串",
  'SELECT 中文列名 FROM 中文表;',
  '',
  '   ',
];

for (const sample of samples) {
  const roundtrip = tokenizeSql(sample)
    .map((token) => token.text)
    .join('');
  assert(roundtrip === sample, `tokenization lost characters: ${JSON.stringify(sample)}`);
}

const basic = typesOf("SELECT id, 'x' FROM users -- tail");
assert(basic[0] === 'keyword', 'SELECT should be keyword');
assert(basic.includes('string'), 'string literal missing');
assert(basic[basic.length - 1] === 'comment', 'line comment missing');

const block = typesOf('/* note */ SELECT 1');
assert(block[0] === 'comment', 'block comment missing');
assert(block[2] === 'number', 'number missing');

const keywords = tokenizeSql('select FROM Where').filter((token) => token.type === 'keyword');
assert(keywords.length === 3, 'keywords should be case-insensitive');

const identifiers = tokenizeSql('用户 name_x').filter((token) => token.type === 'identifier');
assert(identifiers.length === 2, 'identifier detection failed');

const quoted = tokenizeSql("'a''b'")[0];
assert(quoted.type === 'string' && quoted.text === "'a''b'", 'escaped quote handling failed');

console.log('sql highlight check passed');
