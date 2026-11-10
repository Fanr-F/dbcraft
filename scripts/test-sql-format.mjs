/**
 * SQL 格式化的纯逻辑测试。
 *
 * 运行：npm run test:sql-format
 */
import { formatSql } from '../src/renderer/src/utils/sql-format.ts';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function expectFormatted(input, expected) {
  const actual = formatSql(input);
  assert(actual === expected, `format mismatch:\n--- actual ---\n${actual}\n--- expected ---\n${expected}`);
}

expectFormatted(
  'select id, name from users where active = 1 and name like "%from%"',
  'SELECT id, name\n  FROM users\n  WHERE active = 1 AND name LIKE "%from%"',
);

// 字符串里的关键字/逗号/分号不能被改写。
expectFormatted(
  "select 'select,from;where' as x from t;",
  "SELECT 'select,from;where' AS x\n  FROM t;",
);

// 行注释保留，且独占一行。
expectFormatted(
  'select 1 -- keep me\nfrom t',
  'SELECT 1\n  -- keep me\n  FROM t',
);

// 块注释原样保留。
expectFormatted(
  'select /* from where */ 1 from t',
  'SELECT /* from where */ 1\n  FROM t',
);

// 多语句：分号后另起一段。
expectFormatted(
  'select 1; select 2;',
  'SELECT 1;\nSELECT 2;',
);

// 括号与点号保持紧凑。
expectFormatted(
  'select count(*) from db.users where id in (1,2,3)',
  'SELECT COUNT(*)\n  FROM db.users\n  WHERE id IN (1, 2, 3)',
);

// 已经格式化的输入保持稳定（幂等）。
const once = formatSql("select a,b from t where x='y'");
const twice = formatSql(once);
assert(once === twice, 'formatting should be idempotent');
assert(
  formatSql('select A from T', { keywordCase: 'lower' }) === 'select A\n  from T',
  'lower keyword case should only affect keywords',
);
assert(
  formatSql('SeLeCt A from T', { keywordCase: 'preserve' }) === 'SeLeCt A\n  from T',
  'preserve keyword case should keep original keyword text',
);

console.log('sql format check passed');
