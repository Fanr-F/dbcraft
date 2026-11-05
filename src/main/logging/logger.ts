import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { app } from 'electron';
import type { LogLevel } from '../../shared/ipc-contract';

const LEVEL_WEIGHT: Record<LogLevel, number> = { error: 0, warn: 1, info: 2, debug: 3 };
const LEVELS: LogLevel[] = ['error', 'warn', 'info', 'debug'];

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_ROTATED_FILES = 3;
const MAX_MESSAGE_LENGTH = 2000;
const MAX_META_LENGTH = 4000;
const SENSITIVE_KEY = /pass(word|wd)?|secret|token|authorization|api[-_]?key|cookie/i;
const REDACTED = '***';

let cachedLevel: LogLevel | null = null;
let logFilePath: string | null = null;
let logFileBytes = 0;
let fileInitFailed = false;

/** 默认：开发/未打包 debug，打包后 info；可用 DBCRAFT_LOG_LEVEL 覆盖。 */
export function resolveLogLevel(): LogLevel {
  if (cachedLevel) return cachedLevel;

  const fromEnv = process.env['DBCRAFT_LOG_LEVEL']?.trim().toLowerCase();
  cachedLevel =
    fromEnv && (LEVELS as string[]).includes(fromEnv)
      ? (fromEnv as LogLevel)
      : app.isPackaged
        ? 'info'
        : 'debug';
  return cachedLevel;
}

function isEnabled(level: LogLevel): boolean {
  return LEVEL_WEIGHT[level] <= LEVEL_WEIGHT[resolveLogLevel()];
}

function redact(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[depth-limit]';
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'string') {
    return value.length > MAX_MESSAGE_LENGTH ? `${value.slice(0, MAX_MESSAGE_LENGTH)}…` : value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => redact(item, depth + 1));
  }
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message.slice(0, MAX_MESSAGE_LENGTH),
      code: (value as Error & { code?: string | number }).code ?? null,
    };
  }
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      result[key] = SENSITIVE_KEY.test(key) ? REDACTED : redact(item, depth + 1);
    }
    return result;
  }
  return value;
}

function serializeMeta(meta?: Record<string, unknown>): string {
  if (!meta) return '';
  try {
    const json = JSON.stringify(redact(meta));
    if (!json || json === '{}') return '';
    return ` ${json.length > MAX_META_LENGTH ? `${json.slice(0, MAX_META_LENGTH)}…` : json}`;
  } catch {
    return ' [meta 无法序列化]';
  }
}

function sanitizeMessage(message: string): string {
  const singleLine = message.replace(/[\r\n]+/g, ' ');
  return singleLine.length > MAX_MESSAGE_LENGTH
    ? `${singleLine.slice(0, MAX_MESSAGE_LENGTH)}…`
    : singleLine;
}

function writeConsole(level: LogLevel, text: string): void {
  if (level === 'error') console.error(text);
  else if (level === 'warn') console.warn(text);
  else if (level === 'info') console.info(text);
  else console.debug(text);
}

/** 开发/未打包写项目根 `logs/`；打包后写 userData；可用 DBCRAFT_LOG_DIR 覆盖。 */
export function resolveLogDirectory(): string {
  const configured = process.env['DBCRAFT_LOG_DIR']?.trim();
  if (configured) return resolve(configured);
  if (!app.isPackaged) return join(process.cwd(), 'logs');
  return join(app.getPath('userData'), 'logs');
}

function getLogFile(): string | null {
  if (logFilePath) return logFilePath;
  if (fileInitFailed) return null;

  try {
    const directory = resolveLogDirectory();
    mkdirSync(directory, { recursive: true });
    logFilePath = join(directory, 'dbcraft.log');
    try {
      logFileBytes = statSync(logFilePath).size;
    } catch {
      logFileBytes = 0;
    }
    return logFilePath;
  } catch (error) {
    fileInitFailed = true;
    writeConsole('error', `[logger] 无法初始化日志文件: ${String(error)}`);
    return null;
  }
}

function rotateIfNeeded(file: string, incomingBytes: number): void {
  if (logFileBytes + incomingBytes <= MAX_FILE_BYTES) return;

  for (let index = MAX_ROTATED_FILES - 1; index >= 1; index -= 1) {
    const source = index === 1 ? file : `${file}.${index - 1}`;
    const target = `${file}.${index}`;
    try {
      renameSync(source, target);
    } catch {
      // 源文件可能还不存在，忽略。
    }
  }
  logFileBytes = 0;
}

function writeLine(
  level: LogLevel,
  scope: string,
  message: string,
  meta?: Record<string, unknown>,
): void {
  if (!isEnabled(level)) return;

  const line = `${new Date().toISOString()} [${level.toUpperCase()}] [${scope}] ${sanitizeMessage(
    message,
  )}${serializeMeta(meta)}\n`;

  writeConsole(level, line.trimEnd());

  const file = getLogFile();
  if (!file) return;

  try {
    const bytes = Buffer.byteLength(line, 'utf8');
    rotateIfNeeded(file, bytes);
    appendFileSync(file, line, 'utf8');
    logFileBytes += bytes;
  } catch (error) {
    writeConsole('error', `[logger] 写入日志失败: ${String(error)}`);
  }
}

export interface Logger {
  error(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  debug(message: string, meta?: Record<string, unknown>): void;
}

export function createLogger(scope: string): Logger {
  return {
    error: (message, meta) => writeLine('error', scope, message, meta),
    warn: (message, meta) => writeLine('warn', scope, message, meta),
    info: (message, meta) => writeLine('info', scope, message, meta),
    debug: (message, meta) => writeLine('debug', scope, message, meta),
  };
}
