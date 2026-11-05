import { writeFile } from 'node:fs/promises';
import {
  MYSQL_PORT,
  MARIA_PORT,
  PASSWORD,
  connectMaria,
  connectMysql,
  mariaConfig,
  mariaServerInfo,
  mysqlConfig,
  mysqlServerInfo,
  normalizeError,
} from './lib.mjs';

const EXPECT = { CONNECT: 'connect', FAIL: 'fail' };

async function attempt(action) {
  const started = performance.now();
  try {
    const value = await action();
    return {
      connected: true,
      ms: Math.round(performance.now() - started),
      value:
        value && typeof value === 'object' && !Array.isArray(value) ? value : { ok: true },
    };
  } catch (error) {
    return {
      connected: false,
      ms: Math.round(performance.now() - started),
      error: normalizeError(error),
    };
  }
}

function matchesError(result, matcher) {
  if (result.connected) return false;
  const { code, errno, message } = result.error;
  if (matcher.code && code !== matcher.code) return false;
  if (matcher.errno && errno !== matcher.errno) return false;
  if (matcher.message && !matcher.message.test(message)) return false;
  return true;
}

const results = [];

async function record(id, meta, action) {
  const result = await attempt(action);
  let ok;
  if (meta.expect === EXPECT.CONNECT) {
    ok = result.connected;
  } else {
    ok = matchesError(result, meta.errorMatcher ?? {});
  }
  results.push({
    id,
    vendor: meta.vendor,
    driver: meta.driver,
    expect: meta.expect,
    ok,
    ms: result.ms,
    note: meta.note ?? null,
    ...(result.connected ? { value: result.value } : { error: result.error }),
  });
  const label = ok ? 'PASS' : 'FAIL';
  const detail = result.connected
    ? `connected in ${result.ms}ms`
    : `${result.error.code ?? result.error.name} ${result.error.message}`;
  console.log(`[${label}] ${id} — ${detail}`);
}

async function provisionMysql() {
  return connectMysql(mysqlConfig({ user: 'root', password: '' }), async (connection) => {
    await connection.query('CREATE DATABASE IF NOT EXISTS dbcraft_spike CHARACTER SET utf8mb4');
    await connection.query("DROP USER IF EXISTS 'sha2_user'@'%'");
    await connection.query("DROP USER IF EXISTS 'native_user'@'%'");
    await connection.query(
      `CREATE USER 'sha2_user'@'%' IDENTIFIED WITH caching_sha2_password BY '${PASSWORD}'`,
    );
    await connection.query(
      `CREATE USER 'native_user'@'%' IDENTIFIED WITH mysql_native_password BY '${PASSWORD}'`,
    );
    await connection.query("GRANT SELECT ON dbcraft_spike.* TO 'sha2_user'@'%'");
    await connection.query("GRANT SELECT ON dbcraft_spike.* TO 'native_user'@'%'");
    await connection.query('FLUSH PRIVILEGES');
  });
}

async function provisionMaria() {
  return connectMaria(mariaConfig({ user: 'root', password: '' }), async (connection) => {
    await connection.query('CREATE DATABASE IF NOT EXISTS dbcraft_spike CHARACTER SET utf8mb4');
    await connection.query("DROP USER IF EXISTS 'native_user'@'%'");
    await connection.query("DROP USER IF EXISTS 'ed_user'@'%'");
    await connection.query(`CREATE USER 'native_user'@'%' IDENTIFIED BY '${PASSWORD}'`);
    await connection.query("INSTALL SONAME 'auth_ed25519'");
    await connection.query(
      `CREATE USER 'ed_user'@'%' IDENTIFIED VIA ed25519 USING PASSWORD('${PASSWORD}')`,
    );
    await connection.query("GRANT SELECT ON dbcraft_spike.* TO 'native_user'@'%'");
    await connection.query("GRANT SELECT ON dbcraft_spike.* TO 'ed_user'@'%'");
    await connection.query('FLUSH PRIVILEGES');
  });
}

async function main() {
  console.log('== server info ==');
  const mysqlInfo = await mysqlServerInfo();
  const mariaInfo = await mariaServerInfo();
  console.log('MySQL  :', mysqlInfo);
  console.log('MariaDB:', mariaInfo);

  console.log('\n== provision users ==');
  await provisionMysql();
  await provisionMaria();
  console.log('users created');

  console.log('\n== MySQL / Percona path (mysql2) ==');

  // Cold cache: the first auth for this user has no server-side cache entry,
  // so caching_sha2_password needs the RSA public key over a non-TLS link.
  // mysql2 does not read allowPublicKeyRetrieval; it always requests the key.
  await record(
    'mysql/sha2-cold-no-tls',
    {
      vendor: 'mysql',
      driver: 'mysql2',
      expect: EXPECT.CONNECT,
      note: '非 TLS 首次认证；mysql2 忽略 allowPublicKeyRetrieval，自动请求 RSA 公钥',
    },
    () =>
      connectMysql(
        mysqlConfig({
          user: 'sha2_user',
          password: PASSWORD,
          database: 'dbcraft_spike',
          allowPublicKeyRetrieval: false,
        }),
        async (connection) => {
          await connection.query('SELECT 1 AS ok');
          return {
            allowPublicKeyRetrievalInConfig:
              connection.config.allowPublicKeyRetrieval ?? 'dropped',
            warnings: connection.config.warnings,
          };
        },
      ),
  );

  await record(
    'mysql/sha2-cached',
    {
      vendor: 'mysql',
      driver: 'mysql2',
      expect: EXPECT.CONNECT,
      note: '认证缓存命中后走 fast auth，不再交换 RSA 公钥',
    },
    () =>
      connectMysql(
        mysqlConfig({
          user: 'sha2_user',
          password: PASSWORD,
          database: 'dbcraft_spike',
        }),
        (connection) => connection.query('SELECT 1 AS ok'),
      ),
  );

  await record(
    'mysql/sha2-tls',
    {
      vendor: 'mysql',
      driver: 'mysql2',
      expect: EXPECT.CONNECT,
      note: 'TLS 下无需 allowPublicKeyRetrieval；使用服务端自签证书',
    },
    () =>
      connectMysql(
        mysqlConfig({
          user: 'sha2_user',
          password: PASSWORD,
          database: 'dbcraft_spike',
          ssl: { rejectUnauthorized: false },
        }),
        (connection) => connection.query('SELECT 1 AS ok'),
      ),
  );

  await record(
    'mysql/tls-strict-self-signed',
    {
      vendor: 'mysql',
      driver: 'mysql2',
      expect: EXPECT.FAIL,
      errorMatcher: {
        code: 'HANDSHAKE_SSL_ERROR',
        message: /self.signed|unable to verify|certificate/i,
      },
      note: '严格校验自签证书应失败，UI 需要给出信任选项',
    },
    () =>
      connectMysql(
        mysqlConfig({
          user: 'sha2_user',
          password: PASSWORD,
          database: 'dbcraft_spike',
          ssl: { rejectUnauthorized: true },
        }),
        (connection) => connection.query('SELECT 1 AS ok'),
      ),
  );

  await record(
    'mysql/native-password',
    {
      vendor: 'mysql',
      driver: 'mysql2',
      expect: EXPECT.CONNECT,
      note: '旧账号插件 mysql_native_password 仍可连接（MySQL 8.0）',
    },
    () =>
      connectMysql(
        mysqlConfig({
          user: 'native_user',
          password: PASSWORD,
          database: 'dbcraft_spike',
        }),
        (connection) => connection.query('SELECT 1 AS ok'),
      ),
  );

  await record(
    'mysql/wrong-password',
    {
      vendor: 'mysql',
      driver: 'mysql2',
      expect: EXPECT.FAIL,
      errorMatcher: { errno: 1045, code: 'ER_ACCESS_DENIED_ERROR' },
      note: '密码错误应返回 1045，UI 可区分账号/密码问题',
    },
    () =>
      connectMysql(
        mysqlConfig({
          user: 'sha2_user',
          password: 'wrong-password',
          database: 'dbcraft_spike',
          allowPublicKeyRetrieval: true,
        }),
        (connection) => connection.query('SELECT 1 AS ok'),
      ),
  );

  await record(
    'mysql/unknown-database',
    {
      vendor: 'mysql',
      driver: 'mysql2',
      expect: EXPECT.FAIL,
      errorMatcher: { errno: 1049, code: 'ER_BAD_DB_ERROR' },
      note: '用 root 连接不存在的库应返回 1049',
    },
    () =>
      connectMysql(
        mysqlConfig({
          user: 'root',
          password: '',
          database: 'dbcraft_missing',
        }),
        (connection) => connection.query('SELECT 1 AS ok'),
      ),
  );

  await record(
    'mysql/database-access-denied',
    {
      vendor: 'mysql',
      driver: 'mysql2',
      expect: EXPECT.FAIL,
      errorMatcher: { errno: 1044, code: 'ER_DBACCESS_DENIED_ERROR' },
      note: '普通账号连未授权库返回 1044，UI 不能只按 1049 判断',
    },
    () =>
      connectMysql(
        mysqlConfig({
          user: 'sha2_user',
          password: PASSWORD,
          database: 'dbcraft_missing',
        }),
        (connection) => connection.query('SELECT 1 AS ok'),
      ),
  );

  await record(
    'mysql/connection-refused',
    {
      vendor: 'mysql',
      driver: 'mysql2',
      expect: EXPECT.FAIL,
      errorMatcher: { code: 'ECONNREFUSED' },
      note: '端口未监听应返回 ECONNREFUSED',
    },
    () =>
      connectMysql(
        mysqlConfig({
          port: MYSQL_PORT + 90,
          user: 'sha2_user',
          password: PASSWORD,
          connectTimeout: 2000,
        }),
        (connection) => connection.query('SELECT 1 AS ok'),
      ),
  );

  console.log('\n== MariaDB path (mariadb) ==');

  await record(
    'maria/native-password',
    {
      vendor: 'mariadb',
      driver: 'mariadb',
      expect: EXPECT.CONNECT,
      note: 'MariaDB 默认 mysql_native_password 账号',
    },
    () =>
      connectMaria(
        mariaConfig({
          user: 'native_user',
          password: PASSWORD,
          database: 'dbcraft_spike',
        }),
        (connection) => connection.query('SELECT 1 AS ok'),
      ),
  );

  await record(
    'maria/ed25519',
    {
      vendor: 'mariadb',
      driver: 'mariadb',
      expect: EXPECT.CONNECT,
      note: 'ed25519 账号必须走 mariadb 驱动',
    },
    () =>
      connectMaria(
        mariaConfig({
          user: 'ed_user',
          password: PASSWORD,
          database: 'dbcraft_spike',
        }),
        (connection) => connection.query('SELECT 1 AS ok'),
      ),
  );

  await record(
    'maria/ed25519-via-mysql2',
    {
      vendor: 'mariadb',
      driver: 'mysql2',
      expect: EXPECT.FAIL,
      errorMatcher: { message: /authentication protocol|plugin|not supported/i },
      note: 'mysql2 不支持 ed25519，验证必须分驱动',
    },
    () =>
      connectMysql(
        mysqlConfig({
          port: MARIA_PORT,
          user: 'ed_user',
          password: PASSWORD,
          database: 'dbcraft_spike',
        }),
        (connection) => connection.query('SELECT 1 AS ok'),
      ),
  );

  await record(
    'maria/native-via-mysql2',
    {
      vendor: 'mariadb',
      driver: 'mysql2',
      expect: EXPECT.CONNECT,
      note: '对照项：mysql2 可连 MariaDB 的原生密码账号，但不能覆盖 ed25519',
    },
    () =>
      connectMysql(
        mysqlConfig({
          port: MARIA_PORT,
          user: 'native_user',
          password: PASSWORD,
          database: 'dbcraft_spike',
        }),
        (connection) => connection.query('SELECT 1 AS ok'),
      ),
  );

  await record(
    'maria/wrong-password',
    {
      vendor: 'mariadb',
      driver: 'mariadb',
      expect: EXPECT.FAIL,
      errorMatcher: { errno: 1045, code: 'ER_ACCESS_DENIED_ERROR' },
      note: '密码错误应返回 1045',
    },
    () =>
      connectMaria(
        mariaConfig({
          user: 'ed_user',
          password: 'wrong-password',
          database: 'dbcraft_spike',
        }),
        (connection) => connection.query('SELECT 1 AS ok'),
      ),
  );

  await record(
    'maria/unknown-database',
    {
      vendor: 'mariadb',
      driver: 'mariadb',
      expect: EXPECT.FAIL,
      errorMatcher: { errno: 1049, code: 'ER_BAD_DB_ERROR' },
      note: '用 root 连接不存在的库应返回 1049',
    },
    () =>
      connectMaria(
        mariaConfig({
          user: 'root',
          password: '',
          database: 'dbcraft_missing',
        }),
        (connection) => connection.query('SELECT 1 AS ok'),
      ),
  );

  await record(
    'maria/database-access-denied',
    {
      vendor: 'mariadb',
      driver: 'mariadb',
      expect: EXPECT.FAIL,
      errorMatcher: { errno: 1044, code: 'ER_DBACCESS_DENIED_ERROR' },
      note: '普通账号连未授权库返回 1044',
    },
    () =>
      connectMaria(
        mariaConfig({
          user: 'native_user',
          password: PASSWORD,
          database: 'dbcraft_missing',
        }),
        (connection) => connection.query('SELECT 1 AS ok'),
      ),
  );

  console.log('\n== unix_socket（Windows 环境限制）==');
  let unixSocket;
  try {
    await connectMaria(mariaConfig({ user: 'root', password: '' }), async (connection) => {
      await connection.query("DROP USER IF EXISTS 'socket_user'@'localhost'");
      await connection.query("CREATE USER 'socket_user'@'localhost' IDENTIFIED VIA unix_socket");
    });
    unixSocket = { created: true };
    console.log('[INFO] unix_socket user created');
  } catch (error) {
    unixSocket = { created: false, error: normalizeError(error) };
    console.log(`[SKIP] unix_socket — ${unixSocket.error.message}`);
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    environment: {
      platform: process.platform,
      node: process.version,
      mysql: { port: MYSQL_PORT, ...mysqlInfo },
      mariadb: { port: MARIA_PORT, ...mariaInfo },
    },
    unixSocket,
    passed: results.filter((item) => item.ok).length,
    failed: results.filter((item) => !item.ok).length,
    results,
  };

  await writeFile(
    new URL('../result.json', import.meta.url),
    `${JSON.stringify(summary, null, 2)}\n`,
    'utf8',
  );

  console.log('\n== summary ==');
  console.log(`${summary.passed} passed, ${summary.failed} failed`);
  if (summary.failed > 0) {
    console.log('failed cases:');
    for (const item of results.filter((entry) => !entry.ok)) {
      console.log(`- ${item.id}: ${JSON.stringify(item.error ?? item.value)}`);
    }
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
