import { randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import Database from 'better-sqlite3';
import { app, safeStorage } from 'electron';
import type {
  ConnectionInput,
  ConnectionListResult,
  ConnectionRecord,
  ConnectionRemoveAllResult,
  ConnectionSaveResult,
  AppSettings,
  HistoryListOptions,
  HistoryListResult,
  LocalStats,
  SettingsGetResult,
  SettingsSaveResult,
  StatsGetResult,
} from '../../shared/ipc-contract';
import { normalizeAppSettings } from '../../shared/settings';
import { serverDisplayName, serverKey } from '../../shared/server-identity';
import { createLogger } from '../logging/logger';
import {
  HISTORY_SCHEMA,
  clearConnectionHistory,
  clearHistory,
  deleteHistory,
  ensureHistoryFts,
  listHistory,
  recordHistory,
  type HistoryEntry,
} from './history-store';

const log = createLogger('metadata');

interface ConnectionRow {
  id: string;
  config_json: string;
  secret: Buffer | null;
  created_at: string;
  updated_at: string;
  last_opened_at?: string | null;
  server_id?: string | null;
  server_name?: string | null;
}

let database: Database.Database | null = null;
let openError: string | null = null;
let cachedSettings: AppSettings | null = null;
let historyTimer: ReturnType<typeof setTimeout> | null = null;
const pendingHistory: HistoryEntry[] = [];

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS connections (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    group_name TEXT NOT NULL DEFAULT '',
    env TEXT NOT NULL,
    config_json TEXT NOT NULL,
    secret BLOB,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_opened_at TEXT,
    server_id TEXT
  );

  CREATE TABLE IF NOT EXISTS servers (
    id TEXT PRIMARY KEY,
    server_key TEXT NOT NULL UNIQUE,
    type TEXT NOT NULL,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`;

function ensureLastOpenedColumn(db: Database.Database): void {
  const columns = db.prepare('PRAGMA table_info(connections)').all() as Array<{
    name: string;
  }>;
  if (!columns.some((column) => column.name === 'last_opened_at')) {
    db.exec('ALTER TABLE connections ADD COLUMN last_opened_at TEXT');
  }
}

/** v5：服务器实体。旧连接按 host/port/instance/文件路径回填 server_id。 */
function ensureServerColumn(db: Database.Database): void {
  const columns = db.prepare('PRAGMA table_info(connections)').all() as Array<{
    name: string;
  }>;
  if (!columns.some((column) => column.name === 'server_id')) {
    db.exec('ALTER TABLE connections ADD COLUMN server_id TEXT');
  }

  const rows = db
    .prepare('SELECT id, config_json FROM connections WHERE server_id IS NULL')
    .all() as Array<{ id: string; config_json: string }>;
  for (const row of rows) {
    let input: ConnectionInput;
    try {
      input = JSON.parse(row.config_json) as ConnectionInput;
    } catch {
      continue;
    }
    const key = serverKey(input);
    const name = serverDisplayName(input);
    const now = new Date().toISOString();
    const existing = db
      .prepare('SELECT id FROM servers WHERE server_key = ?')
      .get(key) as { id: string } | undefined;
    const serverId = existing?.id ?? randomUUID();
    if (!existing) {
      db.prepare(
        'INSERT INTO servers (id, server_key, type, name, created_at) VALUES (?, ?, ?, ?, ?)',
      ).run(serverId, key, input.type, name, now);
    }
    db.prepare('UPDATE connections SET server_id = ? WHERE id = ?').run(serverId, row.id);
  }
}

/** 查找或创建服务器，返回 server id。 */
function ensureServer(
  db: Database.Database,
  input: ConnectionInput,
): string {
  const key = serverKey(input);
  const name = serverDisplayName(input);
  const existing = db
    .prepare('SELECT id FROM servers WHERE server_key = ?')
    .get(key) as { id: string } | undefined;
  if (existing) {
    db.prepare('UPDATE servers SET type = ?, name = ? WHERE id = ?').run(
      input.type,
      name,
      existing.id,
    );
    return existing.id;
  }
  const id = randomUUID();
  db.prepare(
    'INSERT INTO servers (id, server_key, type, name, created_at) VALUES (?, ?, ?, ?, ?)',
  ).run(id, key, input.type, name, new Date().toISOString());
  return id;
}

/**
 * 打开本地元数据库。位置固定在 `<userData>/dbcraft-meta.db`，
 * 与用户自己的 SQLite 连接文件分开，避免被对象树/查询误操作。
 */
export function openMetadataDatabase(): void {
  if (database) return;

  try {
    const file = join(app.getPath('userData'), 'dbcraft-meta.db');
    mkdirSync(dirname(file), { recursive: true });
    const opened = new Database(file);
    opened.pragma('journal_mode = WAL');
    opened.pragma('busy_timeout = 3000');
    opened.exec(SCHEMA);
    ensureLastOpenedColumn(opened);
    ensureServerColumn(opened);
    opened.exec(HISTORY_SCHEMA);
    if (!ensureHistoryFts(opened)) {
      log.warn('FTS5 trigram 不可用，历史搜索将回退 LIKE');
    }
    opened.pragma('user_version = 5');
    database = opened;
    openError = null;
    log.info('元数据库已打开', { file });
  } catch (error) {
    database = null;
    openError = error instanceof Error ? error.message : String(error);
    log.error('元数据库打开失败', { message: openError });
  }
}

export function closeMetadataDatabase(): void {
  if (!database) return;
  flushQueryHistoryWrites();
  try {
    database.close();
  } catch {
    // 退出路径上不再抛出。
  }
  database = null;
  log.debug('元数据库已关闭');
}

/** 备份元数据库（连接、历史、设置）到指定文件；使用 SQLite 在线备份，避免直接拷贝 WAL。 */
export async function backupMetadataDatabase(destination: string): Promise<void> {
  await requireDatabase().backup(destination);
  log.info('元数据库已备份', { destination });
}

/**
 * 用备份文件替换当前元数据库。
 * 替换前把当前库另存为 `dbcraft-meta.backup-<时间>.db`；恢复后打不开会自动回滚。
 */
export function restoreMetadataDatabase(
  sourcePath: string,
): { ok: true; preRestoreBackup: string } | { ok: false; message: string } {
  const destination = join(app.getPath('userData'), 'dbcraft-meta.db');
  if (sourcePath === destination) {
    return { ok: false, message: '不能使用当前正在使用的元数据库文件恢复。' };
  }

  let check: Database.Database | null = null;
  try {
    check = new Database(sourcePath, { readonly: true, fileMustExist: true });
    const tables = check
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as Array<{ name: string }>;
    if (!tables.some((table) => table.name === 'connections')) {
      return { ok: false, message: '不是有效的 DBCraft 元数据库备份（缺少 connections 表）。' };
    }
    check.close();
    check = null;
  } catch (error) {
    return {
      ok: false,
      message: `无法读取备份文件：${error instanceof Error ? error.message : String(error)}`,
    };
  } finally {
    check?.close();
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const preRestoreBackup = join(
    app.getPath('userData'),
    `dbcraft-meta.backup-${stamp}.db`,
  );

  try {
    if (database) {
      try {
        database.pragma('wal_checkpoint(TRUNCATE)');
      } catch {
        // 只读或已关闭时忽略。
      }
    }
    closeMetadataDatabase();

    if (existsSync(destination)) {
      copyFileSync(destination, preRestoreBackup);
    }
    for (const suffix of ['-wal', '-shm']) {
      rmSync(`${destination}${suffix}`, { force: true });
    }
    copyFileSync(sourcePath, destination);
    openMetadataDatabase();

    if (!database) {
      if (existsSync(preRestoreBackup)) {
        copyFileSync(preRestoreBackup, destination);
        openMetadataDatabase();
      }
      return { ok: false, message: openError ?? '恢复后无法打开元数据库，已回滚。' };
    }

    log.info('元数据库已恢复', { preRestoreBackup });
    return { ok: true, preRestoreBackup };
  } catch (error) {
    openMetadataDatabase();
    return {
      ok: false,
      message: `恢复失败：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/** 查询历史写入失败只记日志，不影响查询结果。 */
export function recordQueryHistory(entry: HistoryEntry): void {
  if (!currentSettings().historyEnabled) return;
  pendingHistory.push(entry);
  if (historyTimer) return;
  historyTimer = setTimeout(() => {
    historyTimer = null;
    flushQueryHistoryWrites();
  }, 0);
}

/** 退出/备份前调用，保证队列里的历史已落库。 */
export function flushQueryHistoryWrites(): void {
  if (historyTimer) {
    clearTimeout(historyTimer);
    historyTimer = null;
  }
  while (pendingHistory.length > 0) {
    const entry = pendingHistory.shift()!;
    try {
      recordHistory(requireDatabase(), entry, {
        dedupe: currentSettings().historyDedupe,
        retentionLimit: historyRetentionLimit(),
      });
    } catch (error) {
      log.warn('写入查询历史失败', {
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

/** 当前设置（带缓存）；读取失败时用默认值，不阻塞查询。 */
function currentSettings(): AppSettings {
  if (cachedSettings) return cachedSettings;
  try {
    const row = requireDatabase()
      .prepare('SELECT value FROM settings WHERE key = ?')
      .get('app') as { value: string } | undefined;
    cachedSettings = normalizeAppSettings(row ? JSON.parse(row.value) : null);
  } catch {
    cachedSettings = normalizeAppSettings(null);
  }
  return cachedSettings;
}

/** 历史保留条数来自设置。 */
function historyRetentionLimit(): number {
  return currentSettings().historyRetention;
}

export function listQueryHistory(options: HistoryListOptions): HistoryListResult {
  try {
    return { ok: true, records: listHistory(requireDatabase(), options) };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

export function removeQueryHistory(id: number): { ok: boolean; message?: string } {
  try {
    const changes = deleteHistory(requireDatabase(), id);
    return changes > 0 ? { ok: true } : { ok: false, message: '记录不存在。' };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

export function clearQueryHistory(): { ok: boolean; message?: string } {
  try {
    clearHistory(requireDatabase());
    return { ok: true };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

export function clearConnectionQueryHistory(
  connectionId: string,
): { ok: boolean; message?: string } {
  try {
    clearConnectionHistory(requireDatabase(), connectionId);
    return { ok: true };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

const SETTINGS_KEY = 'app';

export function getAppSettings(): SettingsGetResult {
  try {
    const row = requireDatabase()
      .prepare('SELECT value FROM settings WHERE key = ?')
      .get(SETTINGS_KEY) as { value: string } | undefined;
    if (!row) {
      return { ok: true, settings: normalizeAppSettings(null) };
    }
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(row.value);
    } catch {
      log.warn('设置 JSON 解析失败，使用默认值');
    }
    return { ok: true, settings: normalizeAppSettings(parsed) };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

export function getLocalStats(): StatsGetResult {
  try {
    const db = requireDatabase();
    const count = (table: string) => {
      const row = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as {
        count: number;
      };
      return Number(row.count ?? 0);
    };
    const stats: LocalStats = {
      connections: count('connections'),
      history: count('history'),
      settings: count('settings'),
      databaseBytes: statSync(join(app.getPath('userData'), 'dbcraft-meta.db')).size,
    };
    return { ok: true, stats };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

export function saveAppSettings(raw: unknown): SettingsSaveResult {  try {
    const settings = normalizeAppSettings(raw);
    cachedSettings = null;
    requireDatabase()
      .prepare(
        `INSERT INTO settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run(SETTINGS_KEY, JSON.stringify(settings));
    log.info('应用设置已保存', { resultRowLimit: settings.resultRowLimit });
    return { ok: true, settings };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

function requireDatabase(): Database.Database {
  if (!database) {
    throw new Error(openError ?? '本地元数据库未就绪');
  }
  return database;
}

function passwordOf(input: ConnectionInput): string {
  return input.type === 'sqlite' ? '' : input.password;
}

function stripPassword(input: ConnectionInput): ConnectionInput {
  return input.type === 'sqlite' ? input : { ...input, password: '' };
}

function parseConfig(row: ConnectionRow): ConnectionInput | null {
  try {
    const parsed = JSON.parse(row.config_json) as ConnectionInput;
    return parsed;
  } catch {
    log.warn('连接配置解析失败，已跳过', { id: row.id });
    return null;
  }
}

function toRecord(row: ConnectionRow, config: ConnectionInput): ConnectionRecord {
  return {
    id: row.id,
    input: stripPassword(config),
    passwordStored: row.secret !== null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.server_id ? { serverId: row.server_id } : {}),
    ...(row.server_name ? { serverName: row.server_name } : {}),
  };
}

export function listConnections(): ConnectionListResult {
  try {
    const rows = requireDatabase()
      .prepare(
        `SELECT c.id, c.config_json, c.secret, c.created_at, c.updated_at,
                c.last_opened_at, c.server_id, s.name AS server_name
         FROM connections c
         LEFT JOIN servers s ON s.id = c.server_id
         ORDER BY COALESCE(c.last_opened_at, c.updated_at) DESC`,
      )
      .all() as ConnectionRow[];

    const connections: ConnectionRecord[] = [];
    for (const row of rows) {
      const config = parseConfig(row);
      if (config) connections.push(toRecord(row, config));
    }

    return { ok: true, connections };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

export function saveConnection(
  input: ConnectionInput,
  id?: string,
  options?: { rememberPassword?: boolean },
): ConnectionSaveResult {
  try {
    const db = requireDatabase();
    const now = new Date().toISOString();
    const existing = id
      ? (db
          .prepare('SELECT id, config_json, secret, created_at, updated_at FROM connections WHERE id = ?')
          .get(id) as ConnectionRow | undefined)
      : undefined;

    const connectionId = existing?.id ?? id ?? randomUUID();
    const createdAt = existing?.created_at ?? now;
    const rememberPassword = options?.rememberPassword !== false;
    let secret: Buffer | null = existing?.secret ?? null;
    let warning: string | undefined;

    if (!rememberPassword) {
      secret = null;
      warning = existing?.secret
        ? '已清除保存的密码；下次连接需要重新输入。'
        : '密码未保存；下次连接需要重新输入。';
    } else if (passwordOf(input).length > 0) {
      if (safeStorage.isEncryptionAvailable()) {
        secret = safeStorage.encryptString(passwordOf(input));
      } else {
        // 不落明文：加密不可用时宁可不保存密码，由用户下次重新输入。
        secret = null;
        warning = '系统加密不可用，密码未保存；下次连接时需要重新输入。';
      }
    }

    const config = stripPassword(input);
    const serverId = ensureServer(db, input);
    const serverName = serverDisplayName(input);

    db.prepare(
      `INSERT INTO connections (id, name, type, group_name, env, config_json, secret, created_at, updated_at, last_opened_at, server_id)
       VALUES (@id, @name, @type, @group, @env, @config, @secret, @createdAt, @updatedAt, @lastOpenedAt, @serverId)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         type = excluded.type,
         group_name = excluded.group_name,
         env = excluded.env,
         config_json = excluded.config_json,
         secret = excluded.secret,
         updated_at = excluded.updated_at,
         server_id = excluded.server_id`,
    ).run({
      id: connectionId,
      name: input.name,
      type: input.type,
      group: input.group,
      env: input.env,
      config: JSON.stringify(config),
      secret,
      createdAt,
      updatedAt: now,
      lastOpenedAt: now,
      serverId,
    });

    log.info(existing ? '连接已更新' : '连接已保存', {
      id: connectionId,
      type: input.type,
      passwordStored: secret !== null,
    });

    return {
      ok: true,
      connection: {
        id: connectionId,
        input: config,
        passwordStored: secret !== null,
        createdAt,
        updatedAt: now,
        serverId,
        serverName,
      },
      ...(warning ? { warning } : {}),
    };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

export function removeConnection(id: string): { ok: true } | { ok: false; message: string } {
  try {
    const db = requireDatabase();
    const info = db.prepare('DELETE FROM connections WHERE id = ?').run(id);
    db.prepare(
      'DELETE FROM servers WHERE id NOT IN (SELECT server_id FROM connections WHERE server_id IS NOT NULL)',
    ).run();
    log.info('连接已删除', { id, removed: info.changes });
    return { ok: true };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

export function removeAllConnections(): ConnectionRemoveAllResult {
  try {
    const db = requireDatabase();
    const info = db.prepare('DELETE FROM connections').run();
    db.prepare('DELETE FROM servers').run();
    log.info('已删除全部连接', { removed: info.changes });
    return { ok: true, removed: info.changes };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

/** 记录最近打开时间，用于连接列表排序。 */
export function touchConnection(id: string): void {
  try {
    requireDatabase()
      .prepare('UPDATE connections SET last_opened_at = ? WHERE id = ?')
      .run(new Date().toISOString(), id);
  } catch (error) {
    log.warn('更新连接最近使用时间失败', {
      id,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

/** 仅在主进程内使用：读取完整连接（含解密后的密码）用于建立会话。 */
export function getConnectionInput(id: string): ConnectionInput | null {
  try {
    const row = requireDatabase()
      .prepare('SELECT id, config_json, secret, created_at, updated_at FROM connections WHERE id = ?')
      .get(id) as ConnectionRow | undefined;

    if (!row) return null;

    const config = parseConfig(row);
    if (!config) return null;

    if (config.type !== 'sqlite' && row.secret) {
      try {
        config.password = safeStorage.decryptString(row.secret);
      } catch (error) {
        log.warn('密码解密失败，将使用空密码', {
          id,
          message: error instanceof Error ? error.message : String(error),
        });
        config.password = '';
      }
    } else if (config.type !== 'sqlite') {
      config.password = '';
    }

    return config;
  } catch (error) {
    log.error('读取连接失败', {
      id,
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
