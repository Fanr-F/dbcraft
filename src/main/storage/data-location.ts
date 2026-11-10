import { app } from 'electron';
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

const POINTER_NAME = 'data-location.json';
const META_FILES = ['dbcraft-meta.db', 'dbcraft-meta.db-wal', 'dbcraft-meta.db-shm'];

/** 模块加载时捕获系统默认 userData，setPath 之后仍能定位指针文件。 */
const DEFAULT_USER_DATA = app.getPath('userData');

export interface DataLocationInfo {
  current: string;
  defaultDir: string;
  custom: boolean;
  /** 启动期间迁移失败时的提示。 */
  warning?: string;
}

interface DataLocationPointer {
  dataDir: string;
  /** 下次启动时从该目录复制元数据库与日志。 */
  migrateFrom?: string;
}

function defaultUserData(): string {
  return DEFAULT_USER_DATA;
}

function pointerPath(defaultDir: string): string {
  return join(defaultDir, POINTER_NAME);
}

function readPointer(): DataLocationPointer | null {
  try {
    const raw = readFileSync(pointerPath(defaultUserData()), 'utf8');
    const parsed = JSON.parse(raw) as Partial<DataLocationPointer>;
    if (typeof parsed.dataDir !== 'string' || parsed.dataDir.trim().length === 0) {
      return null;
    }
    return {
      dataDir: parsed.dataDir,
      ...(typeof parsed.migrateFrom === 'string'
        ? { migrateFrom: parsed.migrateFrom }
        : {}),
    };
  } catch {
    return null;
  }
}

function writePointer(pointer: DataLocationPointer | null): void {
  const path = pointerPath(defaultUserData());
  if (!pointer) {
    rmSync(path, { force: true });
    return;
  }
  writeFileSync(path, `${JSON.stringify(pointer, null, 2)}\n`, 'utf8');
}

function migrateIfNeeded(pointer: DataLocationPointer, target: string): string | undefined {
  if (!pointer.migrateFrom) return undefined;
  const source = pointer.migrateFrom;
  if (source === target) return undefined;

  try {
    mkdirSync(target, { recursive: true });
    for (const name of META_FILES) {
      const from = join(source, name);
      const to = join(target, name);
      if (existsSync(from) && !existsSync(to)) copyFileSync(from, to);
    }
    const sourceLogs = join(source, 'logs');
    const targetLogs = join(target, 'logs');
    if (existsSync(sourceLogs) && !existsSync(targetLogs)) {
      cpSync(sourceLogs, targetLogs, { recursive: true });
    }
    writePointer({ dataDir: target });
    return undefined;
  } catch (error) {
    return `数据迁移失败，继续使用原目录：${
      error instanceof Error ? error.message : String(error)
    }`;
  }
}

/**
 * 在打开元数据库/创建窗口前调用。
 * 指针文件始终保存在系统默认 userData，避免自定义目录失效后找不到配置。
 */
export function resolveDataDirectory(): DataLocationInfo {
  const defaultDir = defaultUserData();
  const pointer = readPointer();
  if (!pointer) {
    return { current: defaultDir, defaultDir, custom: false };
  }

  try {
    mkdirSync(pointer.dataDir, { recursive: true });
  } catch (error) {
    return {
      current: defaultDir,
      defaultDir,
      custom: false,
      warning: `数据目录不可用，已回退默认目录：${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }

  const warning = migrateIfNeeded(pointer, pointer.dataDir);
  if (warning) {
    return { current: defaultDir, defaultDir, custom: false, warning };
  }

  app.setPath('userData', pointer.dataDir);
  return { current: pointer.dataDir, defaultDir, custom: true };
}

export function getDataLocation(): DataLocationInfo {
  const defaultDir = defaultUserData();
  const current = app.getPath('userData');
  return {
    current,
    defaultDir,
    custom: current !== defaultDir,
  };
}

/** 只写指针；真正的复制发生在下次启动、打开元数据库之前。 */
export function setDataDirectory(target: string): DataLocationInfo {
  const normalized = target.trim();
  if (!normalized) throw new Error('数据目录不能为空。');
  const current = app.getPath('userData');
  if (normalized === current) {
    writePointer(null);
    return { ...getDataLocation(), custom: false };
  }
  mkdirSync(normalized, { recursive: true });
  writePointer({ dataDir: normalized, migrateFrom: current });
  return { current: normalized, defaultDir: defaultUserData(), custom: true };
}

export function resetDataDirectory(): DataLocationInfo {
  writePointer(null);
  return getDataLocation();
}
