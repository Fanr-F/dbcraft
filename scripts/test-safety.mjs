/**
 * 生产连接危险语句检查的纯逻辑测试。
 *
 * 运行：npm run test:safety
 * 依赖 Node.js 的类型剥离（Node 22.18+ / 24 默认可用）。
 */
import { inspectDangerousSql } from '../src/shared/dialect/safety.ts';
import { isReadOnlyStatement } from '../src/shared/dialect/readonly.ts';

const cases = [
  ['prod', 'DROP TABLE users;', 'drop'],
  ['prod', '-- comment\nDROP TABLE users;', 'drop'],
  ['prod', '/* x */ TRUNCATE TABLE users;', 'truncate'],
  ['prod', 'DELETE FROM users;', 'delete-without-where'],
  ['prod', 'DELETE FROM users WHERE id = 1;', null],
  ['prod', "DELETE FROM users WHERE name = 'a''b';", null],
  ['prod', 'DELETE FROM users -- WHERE id=1\n;', 'delete-without-where'],
  ['prod', "UPDATE users SET name = 'WHERE x';", 'update-without-where'],
  ['prod', 'UPDATE users SET name = :name WHERE id = 1;', null],
  ['prod', 'UPDATE users SET x = (SELECT 1 WHERE 1=1);', 'update-without-where'],
  ['dev', 'DROP TABLE users;', null],
  ['test', 'DELETE FROM users;', null],
  ['prod', "SELECT 'DROP TABLE users';", null],
  ['prod', 'SELECT drop FROM t;', null],
  ['prod', 'drop', 'drop'],
  ['prod', '   ', null],
];

let failed = 0;
for (const [env, sql, expected] of cases) {
  const actual = inspectDangerousSql(sql, env)?.kind ?? null;
  if (actual !== expected) {
    failed += 1;
    console.error(`FAIL env=${env} sql=${JSON.stringify(sql)} expected=${expected} actual=${actual}`);
  }
}

if (failed > 0) {
  console.error(`${failed} case(s) failed`);
  process.exit(1);
}

for (const [sql, expected] of [
  ['SELECT 1;', true],
  ['-- c\nWITH x AS (SELECT 1) SELECT * FROM x;', true],
  ['SHOW TABLES;', true],
  ['INSERT INTO t VALUES (1);', false],
  ['UPDATE t SET x = 1;', false],
  ['DROP TABLE t;', false],
  ['EXEC dbo.proc;', false],
]) {
  if (isReadOnlyStatement(sql) !== expected) {
    console.error(`readonly classifier failed: ${JSON.stringify(sql)}`);
    process.exit(1);
  }
}

console.log(`safety check passed (${cases.length} cases)`);
