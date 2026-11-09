import type { ConnectionInput } from './ipc-contract';

export const CONNECTION_EXPORT_VERSION = 1;

export interface ConnectionExportFile {
  version: number;
  exportedAt: string;
  connections: ConnectionInput[];
}

export type ParseConnectionExportResult =
  | { ok: true; inputs: ConnectionInput[] }
  | { ok: false; message: string };

const TYPES = ['sqlite', 'mysql', 'percona', 'mariadb', 'mssql'] as const;
const ENVS = ['dev', 'test', 'prod'] as const;
const SSL_MODES = ['disable', 'prefer', 'require', 'verify-ca', 'verify-full'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 导出永不包含密码；SQLite 本身没有密码字段。 */
function stripPassword(input: ConnectionInput): ConnectionInput {
  return input.type === 'sqlite' ? input : { ...input, password: '' };
}

export function serializeConnections(
  connections: Array<{ input: ConnectionInput }>,
): string {
  const payload: ConnectionExportFile = {
    version: CONNECTION_EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    connections: connections.map((connection) => stripPassword(connection.input)),
  };
  return `${JSON.stringify(payload, null, 2)}\n`;
}

function normalize(raw: unknown): ConnectionInput | null {
  if (!isRecord(raw)) return null;

  const type = raw.type;
  if (typeof type !== 'string' || !TYPES.includes(type as (typeof TYPES)[number])) {
    return null;
  }

  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  if (!name) return null;

  const group = typeof raw.group === 'string' ? raw.group.trim() : '';
  const env = ENVS.includes(raw.env as (typeof ENVS)[number])
    ? (raw.env as (typeof ENVS)[number])
    : 'dev';

  if (type === 'sqlite') {
    const filePath = typeof raw.filePath === 'string' ? raw.filePath.trim() : '';
    if (!filePath) return null;
    return { type: 'sqlite', name, group, env, filePath };
  }

  const host = typeof raw.host === 'string' ? raw.host.trim() : '';
  const username = typeof raw.username === 'string' ? raw.username.trim() : '';
  const database = typeof raw.database === 'string' ? raw.database.trim() : '';
  const port = typeof raw.port === 'number' ? raw.port : Number.NaN;

  if (!host || !username || !Number.isInteger(port) || port < 1 || port > 65535) {
    return null;
  }

  if (type === 'mssql') {
    const instanceName =
      typeof raw.instanceName === 'string' ? raw.instanceName.trim() : '';
    const safeInstance = /^[A-Za-z0-9_$#-]{1,64}$/.test(instanceName)
      ? instanceName
      : '';
    return {
      type: 'mssql',
      name,
      group,
      env,
      host,
      port,
      username,
      password: '',
      database,
      encrypt: raw.encrypt !== false,
      trustServerCertificate: raw.trustServerCertificate === true,
      ...(safeInstance ? { instanceName: safeInstance } : {}),
    };
  }

  const sslMode = SSL_MODES.includes(raw.sslMode as (typeof SSL_MODES)[number])
    ? (raw.sslMode as (typeof SSL_MODES)[number])
    : 'prefer';

  const charset = typeof raw.charset === 'string' ? raw.charset.trim() : '';
  const safeCharset = /^[A-Za-z0-9_-]+$/.test(charset) ? charset : '';

  return {
    type: type as 'mysql' | 'percona' | 'mariadb',
    name,
    group,
    env,
    host,
    port,
    username,
    password: '',
    database,
    sslMode,
    ...(safeCharset ? { charset: safeCharset } : {}),
  };
}

/**
 * 解析导出文件；接受带 `connections` 的对象或裸数组。
 * 导入的连接一律清空密码。
 */
export function parseConnectionExport(text: string): ParseConnectionExportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, message: '文件不是有效的 JSON。' };
  }

  const list = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed) && Array.isArray(parsed.connections)
      ? parsed.connections
      : null;

  if (!list) {
    return { ok: false, message: '文件缺少 connections 数组。' };
  }

  if (list.length === 0) {
    return { ok: false, message: '文件中没有连接配置。' };
  }

  if (list.length > 200) {
    return { ok: false, message: '单次最多导入 200 个连接。' };
  }

  const inputs: ConnectionInput[] = [];
  for (let index = 0; index < list.length; index += 1) {
    const normalized = normalize(list[index]);
    if (!normalized) {
      return { ok: false, message: `第 ${index + 1} 条连接配置无效。` };
    }
    inputs.push(normalized);
  }

  return { ok: true, inputs };
}
