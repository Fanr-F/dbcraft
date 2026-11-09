/**
 * 连接导入/导出的纯逻辑测试。
 *
 * 运行：npm run test:connection-export
 */
import {
  parseConnectionExport,
  serializeConnections,
} from '../src/shared/connection-export.ts';
import { connectionProfileKey } from '../src/shared/server-identity.ts';

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

// MSSQL 命名实例往返不能丢。
const named = parseConnectionExport(
  JSON.stringify([
    {
      type: 'mssql',
      name: '命名实例',
      host: 'db.local',
      port: 1433,
      username: 'sa',
      password: '',
      database: 'master',
      instanceName: 'SQLEXPRESS',
      encrypt: true,
      trustServerCertificate: false,
    },
  ]),
);
assert(named.ok, 'named instance import failed');
assert(named.inputs[0].instanceName === 'SQLEXPRESS', 'named instance lost');

// 非法实例名被丢弃，不进入连接配置。
const badInstance = parseConnectionExport(
  JSON.stringify([
    {
      type: 'mssql',
      name: '坏实例',
      host: 'db.local',
      port: 1433,
      username: 'sa',
      password: '',
      database: 'master',
      instanceName: 'x; DROP DATABASE y',
    },
  ]),
);
assert(
  badInstance.ok && badInstance.inputs[0].instanceName === undefined,
  'invalid instance kept',
);

// 去重键：同服务器 + 同名视为重复；换名或换服务器则不是。
const base = {
  type: 'mysql',
  name: '本地 MySQL',
  group: '',
  env: 'dev',
  host: '127.0.0.1',
  port: 3306,
  username: 'root',
  password: '',
  database: 'demo',
  sslMode: 'prefer',
};
assert(connectionProfileKey(base) === connectionProfileKey({ ...base }), 'dedupe key unstable');
assert(
  connectionProfileKey(base) !== connectionProfileKey({ ...base, name: '另一个名字' }),
  'dedupe key should include name',
);
assert(
  connectionProfileKey(base) !== connectionProfileKey({ ...base, port: 3307 }),
  'dedupe key should include server',
);

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
