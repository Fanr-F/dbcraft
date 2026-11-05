import type { LogLevel } from '@shared/ipc-contract';

const MAX_META_LENGTH = 4000;
const MAX_MESSAGE_LENGTH = 2000;

function serializeMeta(meta?: Record<string, unknown>): string | undefined {
  if (!meta) return undefined;
  try {
    const json = JSON.stringify(meta);
    if (!json || json === '{}') return undefined;
    return json.length > MAX_META_LENGTH
      ? `${json.slice(0, MAX_META_LENGTH - 1)}…`
      : json;
  } catch {
    return undefined;
  }
}

function emit(
  level: LogLevel,
  scope: string,
  message: string,
  meta?: Record<string, unknown>,
): void {
  const text = `[${scope}] ${message}`;
  if (level === 'error') console.error(text, meta ?? '');
  else if (level === 'warn') console.warn(text, meta ?? '');
  else if (level === 'info') console.info(text, meta ?? '');
  else console.debug(text, meta ?? '');

  // 与主进程 logWriteSchema 的长度限制保持一致，避免超长日志被静默丢弃。
  const safeMessage =
    message.length > MAX_MESSAGE_LENGTH
      ? `${message.slice(0, MAX_MESSAGE_LENGTH - 1)}…`
      : message;

  // 渲染进程不直接写文件：交给主进程统一过滤级别并落盘。
  window.dbcraft?.log.write(level, scope, safeMessage, serializeMeta(meta));
}

export interface RendererLogger {
  error(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  debug(message: string, meta?: Record<string, unknown>): void;
}

export function createLogger(scope: string): RendererLogger {
  return {
    error: (message, meta) => emit('error', scope, message, meta),
    warn: (message, meta) => emit('warn', scope, message, meta),
    info: (message, meta) => emit('info', scope, message, meta),
    debug: (message, meta) => emit('debug', scope, message, meta),
  };
}
