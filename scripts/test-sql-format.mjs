/**
 * SQL 格式化的纯逻辑测试。
 *
 * 运行：npm run test:sql-format
 *
 * 格式化主体是第三方 `sql-formatter`；MySQL `DELIMITER` 例程脚本走本地保守
 * 格式化（第三方解析器会把 `END$$` / `DELIMITER ;` 拆坏）。
 */
import { formatSql } from '../src/renderer/src/utils/sql-format.ts';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function expectFormatted(input, expected, options) {
  const actual = formatSql(input, options);
  assert(actual === expected, `format mismatch:\n--- actual ---\n${actual}\n--- expected ---\n${expected}`);
}

// 普通查询：一个子句一行、一个字段一行（sql-formatter 的纵向风格）。
expectFormatted(
  'select id, name from users where active = 1 and name like "%from%"',
  [
    'SELECT',
    '  id,',
    '  name',
    'FROM',
    '  users',
    'WHERE',
    '  active = 1',
    '  AND name LIKE "%from%"',
  ].join('\n'),
);

// 字符串里的关键字/逗号/分号不能被改写。
expectFormatted(
  "select 'select,from;where' as x from t;",
  ["SELECT", "  'select,from;where' AS x", 'FROM', '  t;'].join('\n'),
);

// 行注释保留，且独占一行。
expectFormatted(
  'select 1 -- keep me\nfrom t',
  ['SELECT', '  1 -- keep me', 'FROM', '  t'].join('\n'),
);

// 块注释保留。
expectFormatted(
  'select /* from where */ 1 from t',
  ['SELECT', '  /* from where */', '  1', 'FROM', '  t'].join('\n'),
);

// 多语句：语句之间空一行。
expectFormatted(
  'select 1; select 2;',
  ['SELECT', '  1;', '', 'SELECT', '  2;'].join('\n'),
);

// T-SQL：GO 批分隔符必须独占一行，多语句不能被合并成一条。
expectFormatted(
  [
    'exec sp_aaa',
    'go',
    'CREATE TABLE ddd(id INT, v VARCHAR)',
    'go',
    'INSERT INTO ddd VALUES (1, 1),(1, 1),(1, 1),(1, 1),(1, 1)',
    'go',
    'SELECT *, sum(v) OVER( PARTITION BY id)',
    'FROM ddd',
  ].join('\n'),
  [
    'EXEC sp_aaa',
    'GO',
    'CREATE TABLE ddd (id INT, v VARCHAR)',
    'GO',
    'INSERT INTO',
    '  ddd',
    'VALUES',
    '  (1, 1),',
    '  (1, 1),',
    '  (1, 1),',
    '  (1, 1),',
    '  (1, 1)',
    'GO',
    'SELECT',
    '  *,',
    '  SUM(v) OVER (',
    '    PARTITION BY',
    '      id',
    '  )',
    'FROM',
    '  ddd',
  ].join('\n'),
  { dialect: 'mssql' },
);

// GO 带重复次数；字符串里的 go 不当作批分隔符。
expectFormatted(
  'select 1\ngo 5\nselect 2',
  ['SELECT', '  1', 'GO 5', 'SELECT', '  2'].join('\n'),
  { dialect: 'mssql' },
);
expectFormatted("select 'go' as x", ["SELECT", "  'go' AS x"].join('\n'), { dialect: 'mssql' });
expectFormatted(
  'select 1\ngo -- batch\nselect 2',
  ['SELECT', '  1', 'GO -- batch', 'SELECT', '  2'].join('\n'),
  { dialect: 'mssql' },
);

// GO 只在 T-SQL 下是批分隔符；MySQL 下只是普通标识符。
const mysqlGo = formatSql('select 1\ngo\nselect 2', { dialect: 'mysql' });
assert(
  !mysqlGo.split('\n').some((line) => /^GO\b/i.test(line.trim())) &&
    /SELECT\s+1\s+go/s.test(mysqlGo),
  `GO must not be a batch separator outside T-SQL, got:\n${mysqlGo}`,
);

// GO 格式化幂等。
const goOnce = formatSql('exec p\ngo\nselect 1', { dialect: 'mssql' });
assert(
  formatSql(goOnce, { dialect: 'mssql' }) === goOnce,
  'GO formatting should be idempotent',
);

// MySQL：DELIMITER 指令与自定义分隔符不能被拆成 `$ $`，
// `DELIMITER ;` 也必须在 END$$ 之后独占一行。
const mysqlRoutine = [
  'DELIMITER $$',
  'DROP PROCEDURE IF EXISTS sp_get_customer_order_summary$$',
  "CREATE PROCEDURE sp_get_customer_order_summary(IN p_customer_id INT, OUT p_total_amount DECIMAL(12,2)) COMMENT '统计订单'",
  'BEGIN',
  'DECLARE v_start DATE DEFAULT IFNULL(p_start_date, "1970-01-01");',
  'SELECT IFNULL(SUM(total_amount), 0) INTO p_total_amount',
  'FROM orders',
  'WHERE customer_id = p_customer_id;',
  'END$$',
  'DELIMITER ;',
].join('\n');
expectFormatted(
  mysqlRoutine,
  [
    'DELIMITER $$',
    'DROP PROCEDURE IF EXISTS sp_get_customer_order_summary$$',
    "CREATE PROCEDURE sp_get_customer_order_summary(IN p_customer_id INT, OUT p_total_amount DECIMAL(12, 2)) COMMENT '统计订单'",
    'BEGIN',
    '  DECLARE v_start DATE DEFAULT IFNULL(p_start_date, "1970-01-01");',
    '  SELECT IFNULL(SUM(total_amount), 0) INTO p_total_amount',
    '    FROM orders',
    '    WHERE customer_id = p_customer_id;',
    'END$$',
    'DELIMITER ;',
  ].join('\n'),
  { dialect: 'mysql' },
);
const mysqlOnce = formatSql(mysqlRoutine, { dialect: 'mysql' });
assert(
  formatSql(mysqlOnce, { dialect: 'mysql' }) === mysqlOnce,
  'DELIMITER formatting should be idempotent',
);

// 其它自定义分隔符（`//`）同样保留，DELIMITER 指令本身大写。
expectFormatted(
  'delimiter //\ncreate procedure p() begin select 1; end//\ndelimiter ;',
  'DELIMITER //\nCREATE PROCEDURE p()\nBEGIN\n  SELECT 1;\nEND//\nDELIMITER ;',
  { dialect: 'mysql' },
);

// `END IF` 不关闭 BEGIN 块，块内语句保持缩进。
expectFormatted(
  [
    'DELIMITER $$',
    'CREATE PROCEDURE p()',
    'BEGIN',
    'IF a > 0 THEN',
    'SET b = 1;',
    'END IF;',
    'SELECT b;',
    'END$$',
    'DELIMITER ;',
  ].join('\n'),
  [
    'DELIMITER $$',
    'CREATE PROCEDURE p()',
    'BEGIN',
    '  IF a > 0 THEN',
    '    SET b = 1;',
    '  END IF;',
    '  SELECT b;',
    'END$$',
    'DELIMITER ;',
  ].join('\n'),
  { dialect: 'mysql' },
);

// SQLite 的 BEGIN 是事务语句；第三方格式化器不会把事务体缩进。
expectFormatted(
  'begin\nselect 1;\ncommit;\nselect 2;',
  ['BEGIN', 'SELECT', '  1;', '', 'COMMIT;', '', 'SELECT', '  2;'].join('\n'),
  { dialect: 'sqlite' },
);

// 括号与点号保持紧凑，函数名跟随关键字大小写。
expectFormatted(
  'select count(*) from db.users where id in (1,2,3)',
  ['SELECT', '  COUNT(*)', 'FROM', '  db.users', 'WHERE', '  id IN (1, 2, 3)'].join('\n'),
);

// 已经格式化的输入保持稳定（幂等）。
const once = formatSql("select a,b from t where x='y'");
const twice = formatSql(once);
assert(once === twice, 'formatting should be idempotent');
const lower = formatSql('select A from T', { keywordCase: 'lower' });
assert(lower === 'select\n  A\nfrom\n  T', 'lower keyword case should only affect keywords');
const preserve = formatSql('SeLeCt A from T', { keywordCase: 'preserve' });
assert(
  preserve === 'SeLeCt\n  A\nfrom\n  T',
  'preserve keyword case should keep original keyword text',
);

// 空 SQL 原样返回。
assert(formatSql('   ') === '   ', 'empty SQL should be returned as-is');

console.log('sql format check passed');
