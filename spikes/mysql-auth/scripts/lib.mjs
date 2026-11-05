import mysql from 'mysql2/promise';
import mariadb from 'mariadb';

export const MYSQL_HOST = '127.0.0.1';
export const MYSQL_PORT = 3307;
export const MARIA_HOST = '127.0.0.1';
export const MARIA_PORT = 3308;
export const PASSWORD = 'Spike!Pass123';

export function mysqlConfig(overrides = {}) {
  return {
    host: MYSQL_HOST,
    port: MYSQL_PORT,
    connectTimeout: 5000,
    ...overrides,
  };
}

export function mariaConfig(overrides = {}) {
  return {
    host: MARIA_HOST,
    port: MARIA_PORT,
    connectTimeout: 5000,
    ...overrides,
  };
}

/**
 * 与正式实现一致：MySQL / Percona 走 mysql2。
 */
export async function connectMysql(options, run) {
  const connection = await mysql.createConnection(options);
  try {
    return await run(connection);
  } finally {
    await connection.end();
  }
}

/**
 * 与正式实现一致：MariaDB 走 mariadb 驱动。
 */
export async function connectMaria(options, run) {
  const connection = await mariadb.createConnection(options);
  try {
    return await run(connection);
  } finally {
    await connection.end();
  }
}

export function normalizeError(error) {
  return {
    name: error?.name ?? null,
    code: error?.code ?? null,
    errno: error?.errno ?? null,
    sqlState: error?.sqlState ?? null,
    sqlMessage: error?.sqlMessage ?? null,
    message: error?.message ?? String(error),
  };
}

export function mysqlServerInfo() {
  return connectMysql(
    mysqlConfig({ user: 'root', password: '' }),
    async (connection) => {
      const [rows] = await connection.query(
        'SELECT VERSION() AS version, @@version_comment AS comment',
      );
      return rows[0];
    },
  );
}

export function mariaServerInfo() {
  return connectMaria(
    mariaConfig({ user: 'root', password: '' }),
    async (connection) => {
      const rows = await connection.query(
        'SELECT VERSION() AS version, @@version_comment AS comment',
      );
      return rows[0];
    },
  );
}
