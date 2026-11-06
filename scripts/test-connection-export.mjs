/**
 * 连接导入/导出的纯逻辑测试。
 *
 * 运行：npm run test:connection-export
 */
import {
  parseConnectionExport,
  serializeConnections,
} from '../src/shared/connection-export.ts';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const mysql = {
  type: 'mysql',
  name: '本地 MySQL',
  group: '开发/本地',
  env: 'dev',
  host: '127.0.0.1',
  port: 3306,
  username: 'root',
  password: 'super-secret',
  database: 'demo',
  sslMode: 'prefer',
  charset: 'utf8mb4',
};

const sqlite = {
  type: 'sqlite',
  name: '演示库',
  group: '',
  env: 'test',
  filePath: 'D:/data/demo.db',
};

const json = serializeConnections([{ input: mysql }, { input: sqlite }]);
assert(!json.includes('super-secret'), 'export must not contain password');
assert(json.includes('"version": 1'), 'export missing version');
const payload = JSON.parse(json);
assert(payload.connections.length === 2, 'export connection count wrong');
assert(payload.connections[0].password === '', 'password should be blank');
assert(payload.connections[0].charset === 'utf8mb4', 'charset should be exported');
assert(payload.connections[1].filePath === 'D:/data/demo.db', 'sqlite path missing');

const roundtrip = parseConnectionExport(json);
assert(roundtrip.ok, `roundtrip failed: ${roundtrip.ok ? '' : roundtrip.message}`);
assert(roundtrip.inputs.length === 2, 'roundtrip count wrong');
assert(roundtrip.inputs[0].password === '', 'import must clear password');
assert(roundtrip.inputs[0].charset === 'utf8mb4', 'charset should roundtrip');

// 非法字符集导入时被丢弃，不进入驱动配置。
const badCharset = parseConnectionExport(
  JSON.stringify([{ ...mysql, charset: 'utf8mb4; DROP DATABASE x' }]),
);
assert(badCharset.ok && badCharset.inputs[0].charset === undefined, 'invalid charset kept');

// 裸数组也接受。
const bare = parseConnectionExport(JSON.stringify([sqlite]));
assert(bare.ok && bare.inputs[0].type === 'sqlite', 'bare array import failed');

// 默认值与宽字段。
const mssql = parseConnectionExport(
  JSON.stringify([
    {
      type: 'mssql',
      name: '  SQL Server  ',
      host: 'db.local',
      port: 1433,
      username: 'sa',
      password: 'x',
      database: 'master',
      unknownField: 1,
    },
  ]),
);
assert(mssql.ok, 'mssql import failed');
const mssqlInput = mssql.inputs[0];
assert(mssqlInput.name === 'SQL Server', 'name should be trimmed');
assert(mssqlInput.group === '' && mssqlInput.env === 'dev', 'defaults wrong');
assert(mssqlInput.password === '', 'mssql password not cleared');
assert(mssqlInput.encrypt === true && mssqlInput.trustServerCertificate === false, 'mssql flags wrong');

const failures = [
  ['not json', 'JSON'],
  [JSON.stringify({ version: 1 }), 'connections'],
  [JSON.stringify([]), '没有连接'],
  [JSON.stringify({ connections: [{}] }), '第 1 条'],
  [
    JSON.stringify({ connections: [{ ...mysql, type: 'postgres' }] }),
    '第 1 条',
  ],
  [
    JSON.stringify({ connections: [{ ...mysql, port: 70000 }] }),
    '第 1 条',
  ],
  [
    JSON.stringify({ connections: [{ ...sqlite, filePath: '   ' }] }),
    '第 1 条',
  ],
  [
    JSON.stringify({
      connections: Array.from({ length: 201 }, (_, index) => ({
        ...sqlite,
        name: `库 ${index}`,
      })),
    }),
    '200',
  ],
];

for (const [text, expected] of failures) {
  const result = parseConnectionExport(text);
  assert(!result.ok, `expected failure for: ${text.slice(0, 40)}`);
  assert(
    result.message.includes(expected),
    `message "${result.message}" does not include "${expected}"`,
  );
}

console.log('connection export check passed');
