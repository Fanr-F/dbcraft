/**
 * MSSQL 地址解析：支持 `host`、`host:port`、`host\instance` 与显式实例名。
 *
 * 命名实例会忽略端口，由 SQL Browser（UDP 1434）解析实际端口；
 * 这里只做纯字符串归一化，不发起网络请求，便于测试与 IPC 校验复用。
 */
export interface MssqlAddress {
  host: string;
  port: number;
  instanceName?: string;
}

export function normalizeMssqlAddress(
  hostRaw: string,
  portRaw: number,
  instanceNameRaw?: string,
): MssqlAddress {
  let host = hostRaw.trim();
  let port = portRaw;
  let instance = (instanceNameRaw ?? '').trim().replace(/^\\+/, '');

  if (host.includes('\\')) {
    const index = host.indexOf('\\');
    const parsedInstance = host.slice(index + 1).trim();
    host = host.slice(0, index).trim();
    if (!instance) instance = parsedInstance;
  }

  if (host.startsWith('[')) {
    // IPv6 字面量：[::1] 或 [::1]:1433
    const end = host.indexOf(']');
    if (end > 0) {
      const after = host.slice(end + 1).trim();
      host = host.slice(1, end);
      if (after.startsWith(':')) {
        const parsed = Number(after.slice(1));
        if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 65535) port = parsed;
      }
    }
  } else {
    const parts = host.split(':');
    if (parts.length === 2) {
      const parsed = Number(parts[1]);
      if (parts[0] && Number.isInteger(parsed) && parsed >= 1 && parsed <= 65535) {
        host = parts[0];
        port = parsed;
      }
    }
  }

  return instance ? { host, port, instanceName: instance } : { host, port };
}
