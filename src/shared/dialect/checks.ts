import type { TableCheckInfo } from '../ipc-contract';

/**
 * 从 CREATE TABLE 文本里提取 CHECK 表达式。
 * SQLite 没有约束目录表，只能从 `sqlite_master.sql` 解析；
 * 这里只做括号配对与字符串跳过，不尝试理解表达式内容。
 */
export function extractCheckExpressions(ddl: string): TableCheckInfo[] {
  const checks: TableCheckInfo[] = [];
  let index = 0;

  while (index < ddl.length) {
    const char = ddl[index]!;

    // 跳过字符串与注释，避免把其中的 CHECK 当成约束。
    if (char === "'" || char === '"' || char === '`') {
      const quote = char;
      index += 1;
      while (index < ddl.length) {
        if (ddl[index] === quote) {
          if (ddl[index + 1] === quote) {
            index += 2;
            continue;
          }
          index += 1;
          break;
        }
        index += 1;
      }
      continue;
    }
    if (char === '-' && ddl[index + 1] === '-') {
      while (index < ddl.length && ddl[index] !== '\n') index += 1;
      continue;
    }
    if (char === '/' && ddl[index + 1] === '*') {
      const close = ddl.indexOf('*/', index + 2);
      index = close < 0 ? ddl.length : close + 2;
      continue;
    }

    const match = /^check\b/i.exec(ddl.slice(index, index + 5));
    if (!match) {
      index += 1;
      continue;
    }

    let cursor = index + match[0].length;
    while (cursor < ddl.length && /\s/.test(ddl[cursor]!)) cursor += 1;
    if (ddl[cursor] !== '(') {
      index += match[0].length;
      continue;
    }

    const start = cursor;
    let depth = 0;
    let quote: string | null = null;
    for (; cursor < ddl.length; cursor += 1) {
      const inner = ddl[cursor]!;
      if (quote) {
        if (inner === quote) quote = null;
        continue;
      }
      if (inner === "'" || inner === '"' || inner === '`') {
        quote = inner;
        continue;
      }
      if (inner === '(') depth += 1;
      else if (inner === ')') {
        depth -= 1;
        if (depth === 0) {
          checks.push({
            name: null,
            expression: ddl.slice(start + 1, cursor).trim(),
          });
          index = cursor + 1;
          break;
        }
      }
    }
    if (depth !== 0) {
      // 括号不配对时停止，避免把整段 DDL 当约束。
      break;
    }
  }

  return checks;
}
