/**
 * 历史 SQL 展示脱敏的纯逻辑测试。
 *
 * 运行：npm run test:sql-mask
 */
import { maskSensitiveSql } from '../src/renderer/src/utils/sql-mask.ts';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(
  maskSensitiveSql("UPDATE users SET password = 'secret123' WHERE id = 1") ===
    "UPDATE users SET password = '***' WHERE id = 1",
  'basic password mask failed',
);

assert(
  maskSensitiveSql("SET PASSWORD='x'") === "SET PASSWORD='***'",
  'no-space mask failed',
);

assert(
  maskSensitiveSql('SET api_key = 12345') === "SET api_key = '***'",
  'numeric secret mask failed',
);

assert(
  maskSensitiveSql("SET token = 'a' -- password = 'b'") ===
    "SET token = '***' -- password = 'b'",
  'comment text must not be altered',
);

assert(
  maskSensitiveSql('SELECT password FROM users') === 'SELECT password FROM users',
  'column read must not be masked',
);

assert(
  maskSensitiveSql('UPDATE t SET password = other_column') ===
    'UPDATE t SET password = other_column',
  'identifier assignment must not be masked',
);

assert(
  maskSensitiveSql('UPDATE t SET name = \'x\'') === "UPDATE t SET name = 'x'",
  'non-sensitive assignment must not be masked',
);

assert(
  maskSensitiveSql("INSERT INTO t(password) VALUES ('x')") ===
    "INSERT INTO t(password) VALUES ('***')",
  'insert form should be masked',
);

assert(
  maskSensitiveSql(
    "INSERT INTO t(name, password, token) VALUES ('a', 'secret', 123), ('b', 'other', 456)",
  ) ===
    "INSERT INTO t(name, password, token) VALUES ('a', '***', '***'), ('b', '***', '***')",
  'multi-row insert masking failed',
);

assert(
  maskSensitiveSql("INSERT INTO t(name) VALUES ('x')") ===
    "INSERT INTO t(name) VALUES ('x')",
  'non-sensitive insert should not be masked',
);

console.log('sql mask check passed');
