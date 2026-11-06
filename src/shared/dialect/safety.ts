import type { EnvironmentTag } from '../ipc-contract';

export type DangerKind = 'drop' | 'truncate' | 'update-without-where' | 'delete-without-where';

export interface DangerMatch {
  kind: DangerKind;
  message: string;
}

/** 跳过前导空白、行注释与块注释，返回第一条语句的起点。 */
function stripLeadingTrivia(sql: string): string {
  let index = 0;

  while (index < sql.length) {
    const char = sql[index];

    if (/\s/.test(char)) {
      index += 1;
      continue;
    }

    if (sql.startsWith('--', index)) {
      const newline = sql.indexOf('\n', index);
      index = newline === -1 ? sql.length : newline + 1;
      continue;
    }

    if (char === '#') {
      const newline = sql.indexOf('\n', index);
      index = newline === -1 ? sql.length : newline + 1;
      continue;
    }

    if (sql.startsWith('/*', index)) {
      const end = sql.indexOf('*/', index + 2);
      index = end === -1 ? sql.length : end + 2;
      continue;
    }

    break;
  }

  return sql.slice(index);
}

function isWordChar(char: string | undefined): boolean {
  return char !== undefined && /[A-Za-z0-9_$]/.test(char);
}

/**
 * 在顶层（括号外、字符串/标识符/注释外）查找关键字。
 * 用于判断 UPDATE/DELETE 是否带顶层 WHERE，避免把子查询或字面量里的 WHERE 当成条件。
 */
function hasTopLevelKeyword(sql: string, keyword: string): boolean {
  const lower = sql.toLowerCase();
  const target = keyword.toLowerCase();
  let index = 0;
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  let inBacktick = false;

  while (index < lower.length) {
    const char = lower[index];

    if (inSingle) {
      if (char === "'") {
        if (lower[index + 1] === "'") {
          index += 2;
          continue;
        }
        inSingle = false;
      }
      index += 1;
      continue;
    }

    if (inDouble) {
      if (char === '"') {
        if (lower[index + 1] === '"') {
          index += 2;
          continue;
        }
        inDouble = false;
      }
      index += 1;
      continue;
    }

    if (inBacktick) {
      if (char === '`') inBacktick = false;
      index += 1;
      continue;
    }

    if (char === '-' && lower[index + 1] === '-') {
      const newline = lower.indexOf('\n', index);
      index = newline === -1 ? lower.length : newline + 1;
      continue;
    }

    if (char === '#') {
      const newline = lower.indexOf('\n', index);
      index = newline === -1 ? lower.length : newline + 1;
      continue;
    }

    if (char === '/' && lower[index + 1] === '*') {
      const end = lower.indexOf('*/', index + 2);
      index = end === -1 ? lower.length : end + 2;
      continue;
    }

    if (char === "'") {
      inSingle = true;
      index += 1;
      continue;
    }

    if (char === '"') {
      inDouble = true;
      index += 1;
      continue;
    }

    if (char === '`') {
      inBacktick = true;
      index += 1;
      continue;
    }

    if (char === '(') {
      depth += 1;
      index += 1;
      continue;
    }

    if (char === ')') {
      depth = Math.max(0, depth - 1);
      index += 1;
      continue;
    }

    if (depth === 0 && lower.startsWith(target, index)) {
      const before = lower[index - 1];
      const after = lower[index + target.length];
      if (!isWordChar(before) && !isWordChar(after)) {
        return true;
      }
    }

    index += 1;
  }

  return false;
}

/**
 * 生产连接的危险语句检查。仅对 `env === 'prod'` 生效；
 * 返回 null 表示无需额外确认。
 */
export function inspectDangerousSql(sql: string, env: EnvironmentTag): DangerMatch | null {
  if (env !== 'prod') return null;

  const stripped = stripLeadingTrivia(sql).trim();
  if (!stripped) return null;

  const verbMatch = /^([A-Za-z]+)/.exec(stripped);
  const verb = verbMatch?.[1].toLowerCase() ?? '';

  if (verb === 'drop') {
    return { kind: 'drop', message: '检测到 DROP：生产连接上会永久删除对象。' };
  }

  if (verb === 'truncate') {
    return { kind: 'truncate', message: '检测到 TRUNCATE：生产连接上会清空整张表。' };
  }

  if (verb === 'update' && !hasTopLevelKeyword(stripped, 'where')) {
    return {
      kind: 'update-without-where',
      message: 'UPDATE 没有顶层 WHERE，可能更新整张表。',
    };
  }

  if (verb === 'delete' && !hasTopLevelKeyword(stripped, 'where')) {
    return {
      kind: 'delete-without-where',
      message: 'DELETE 没有顶层 WHERE，可能删除整张表。',
    };
  }

  return null;
}
