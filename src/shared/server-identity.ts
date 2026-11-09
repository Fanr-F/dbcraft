import type { ConnectionInput } from './ipc-contract';

/**
 * 服务器身份：同一台服务器上的多个连接配置应归到同一个 server。
 * SQLite 以文件路径作为服务器身份；MySQL 系按 host:port；MSSQL 优先命名实例。
 */
export function serverKey(input: ConnectionInput): string {
  if (input.type === 'sqlite') {
    return `sqlite:${input.filePath.trim().toLowerCase()}`;
  }
  if (input.type === 'mssql') {
    const host = input.host.trim().toLowerCase();
    const instance = input.instanceName?.trim().toLowerCase();
    return instance
      ? `mssql:${host}\\${instance}`
      : `mssql:${host}:${input.port}`;
  }
  return `${input.type}:${input.host.trim().toLowerCase()}:${input.port}`;
}

/** 服务器展示名；不包含密码/用户名。 */
export function serverDisplayName(input: ConnectionInput): string {
  if (input.type === 'sqlite') {
    return input.filePath.trim();
  }
  if (input.type === 'mssql' && input.instanceName?.trim()) {
    return `${input.host.trim()}\\${input.instanceName.trim()}`;
  }
  return `${input.host.trim()}:${input.port}`;
}

/** 服务器类型标签；用于 UI 显示。 */
export function serverTypeLabel(input: ConnectionInput): string {
  switch (input.type) {
    case 'sqlite':
      return 'SQLite';
    case 'mysql':
      return 'MySQL';
    case 'percona':
      return 'Percona';
    case 'mariadb':
      return 'MariaDB';
    case 'mssql':
      return 'MSSQL';
  }
}
