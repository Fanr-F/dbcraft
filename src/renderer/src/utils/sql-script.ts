import type { DatabaseType } from '@shared/ipc-contract';

export type SplitStatementsResult =
  | { ok: true; statements: string[] }
  | { ok: false; message: string };

/**
 * 按方言切分脚本：
 * - SQLite / MSSQL 默认按顶层 `;`；
 * - MSSQL 额外把单独一行的 `GO` 当作分隔符（不发送给服务器）；
 * - MySQL 系支持 `DELIMITER $$`，自定义分隔符本身不进入语句；
 * - 字符串、注释、引号标识符里的分隔符不会被误切。
 */
export function splitSqlStatements(
  sql: string,
  limit = 50,
  dialect?: DatabaseType,
): SplitStatementsResult {  const isMssql = dialect === 'mssql';
  const isMysqlFamily =
    dialect === 'mysql' || dialect === 'percona' || dialect === 'mariadb';
  const statements: string[] = [];
  /** 当前 GO 批次内的语句；GO n 需要整批重复。 */
  let batch: string[] = [];
  let parseError: string | null = null;
  const length = sql.length;
  let current = '';
  let hasContent = false;
  let delimiter = ';';
  let index = 0;

  const flush = () => {
    const text = current.trim();
    if (text.length > 0 && hasContent) {
      statements.push(text);
      batch.push(text);
    }
    current = '';
    hasContent = false;
  };

  const linePattern = (from: number): string => {
    const end = sql.indexOf('\n', from);
    return sql.slice(from, end === -1 ? length : end);
  };

  const atLineStart = (position: number): boolean =>
    position === 0 || sql[position - 1] === '\n';

  let state: 'normal' | 'single' | 'double' | 'backtick' | 'bracket' | 'line' | 'block' =
    'normal';

  while (index < length) {
    const char = sql[index]!;
    const next = sql[index + 1];

    if (state === 'single') {
      current += char;
      if (char === '\\' && isMysqlFamily && next !== undefined) {
        current += next;
        index += 2;
        continue;
      }
      if (char === "'" && next === "'") {
        current += next;
        index += 2;
        continue;
      }
      if (char === "'") state = 'normal';
      index += 1;
      continue;
    }
    if (state === 'double') {
      current += char;
      if (char === '\\' && isMysqlFamily && next !== undefined) {
        current += next;
        index += 2;
        continue;
      }
      if (char === '"' && next === '"') {
        current += next;
        index += 2;
        continue;
      }
      if (char === '"') state = 'normal';
      index += 1;
      continue;
    }
    if (state === 'backtick') {
      current += char;
      if (char === '`' && next === '`') {
        current += next;
        index += 2;
        continue;
      }
      if (char === '`') state = 'normal';
      index += 1;
      continue;
    }
    if (state === 'bracket') {
      current += char;
      if (char === ']' && next === ']') {
        current += next;
        index += 2;
        continue;
      }
      if (char === ']') state = 'normal';
      index += 1;
      continue;
    }
    if (state === 'line') {
      current += char;
      if (char === '\n') state = 'normal';
      index += 1;
      continue;
    }
    if (state === 'block') {
      current += char;
      if (char === '*' && next === '/') {
        current += next;
        state = 'normal';
        index += 2;
        continue;
      }
      index += 1;
      continue;
    }

    // 行级指令：MSSQL GO（含 GO n）/ MySQL DELIMITER。
    if (atLineStart(index)) {
      const line = linePattern(index);
      const goMatch = isMssql ? /^\s*GO(?:\s+(\d+))?\s*(?:--.*)?$/i.exec(line) : null;
      if (goMatch) {
        flush();
        const repeat = goMatch[1] ? Number(goMatch[1]) : 1;
        if (!Number.isSafeInteger(repeat) || repeat < 1) {
          parseError = 'GO 后的重复次数必须是大于 0 的整数。';
          break;
        }
        if (repeat > limit) {
          parseError = `GO 重复次数 ${repeat} 超过单次最多执行 ${limit} 条。`;
          break;
        }
        for (let turn = 1; turn < repeat; turn += 1) {
          for (const statement of batch) {
            statements.push(statement);
            if (statements.length > limit) {
              parseError = `单次最多执行 ${limit} 条语句，当前为 ${statements.length} 条。`;
              break;
            }
          }
          if (parseError) break;
        }
        batch = [];
        if (parseError) break;
        index += line.length;
        if (sql[index] === '\n') index += 1;
        continue;
      }
      if (isMysqlFamily && current.trim().length === 0) {
        const match = /^\s*DELIMITER\s+(\S+)\s*$/i.exec(line);
        if (match) {
          delimiter = match[1]!;
          index += line.length;
          if (sql[index] === '\n') index += 1;
          continue;
        }
      }
    }

    // 分隔符。
    if (delimiter && sql.startsWith(delimiter, index)) {
      if (delimiter === ';') {
        current += char;
        index += 1;
      } else {
        index += delimiter.length;
      }
      flush();
      continue;
    }

    if (char === "'") {
      state = 'single';
      current += char;
      hasContent = true;
      index += 1;
      continue;
    }
    if (char === '"') {
      state = 'double';
      current += char;
      hasContent = true;
      index += 1;
      continue;
    }
    if (char === '`') {
      state = 'backtick';
      current += char;
      hasContent = true;
      index += 1;
      continue;
    }
    if (char === '[') {
      state = 'bracket';
      current += char;
      hasContent = true;
      index += 1;
      continue;
    }
    if (char === '-' && next === '-') {
      state = 'line';
      current += '--';
      index += 2;
      continue;
    }
    if (char === '#' && isMysqlFamily) {
      state = 'line';
      current += char;
      index += 1;
      continue;
    }
    if (char === '/' && next === '*') {
      state = 'block';
      current += '/*';
      index += 2;
      continue;
    }

    current += char;
    if (!/\s/.test(char)) hasContent = true;
    index += 1;
  }

  if (parseError) {
    return { ok: false, message: parseError };
  }

  flush();

  if (statements.length === 0) {
    return { ok: false, message: '脚本为空。' };
  }
  if (statements.length > limit) {
    return { ok: false, message: `单次最多执行 ${limit} 条语句，当前为 ${statements.length} 条。` };
  }
  return { ok: true, statements };
}

/**
 * 返回光标所在语句；用于「未选中时执行当前语句」。
 * 语句边界复用 splitSqlStatements，按出现顺序定位原始区间。
 */
export function statementAtCursor(
  sql: string,
  cursor: number,
  dialect?: DatabaseType,
): string | null {
  const result = splitSqlStatements(sql, 1000, dialect);
  if (!result.ok) return null;

  const position = Math.max(0, Math.min(sql.length, cursor));
  let searchFrom = 0;
  let nearest: { text: string; start: number; end: number } | null = null;
  for (const text of result.statements) {
    const start = sql.indexOf(text, searchFrom);
    if (start < 0) continue;
    const end = start + text.length;
    searchFrom = end;
    if (position >= start && position <= end) return text;
    // 光标停在语句之间（空白/分号后）时，优先取前一条。
    if (position > end) nearest = { text, start, end };
  }
  return nearest?.text ?? result.statements[0] ?? null;
}
