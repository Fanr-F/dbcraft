import { tokenizeSql } from './sql-highlight.ts';

/** 这些关键字前换行，形成常见的 SQL 分块排版。 */
const BREAK_BEFORE = new Set([
  'select',
  'from',
  'where',
  'group',
  'order',
  'having',
  'limit',
  'offset',
  'join',
  'left',
  'right',
  'inner',
  'outer',
  'full',
  'cross',
  'union',
  'with',
  'insert',
  'update',
  'delete',
  'values',
  'returning',
  'set',
]);

/** 这些关键字后保留空格再接左括号；函数名（COUNT 等）保持紧凑。 */
const SPACE_BEFORE_PAREN = new Set(['in', 'values', 'exists']);

/**
 * 保守的 SQL 格式化：只处理关键字大小写、分块换行与空格。
 * 字符串、注释内容原样保留（由 tokenizer 保证）。
 */
export function formatSql(sql: string): string {
  const tokens = tokenizeSql(sql);
  const lines: string[] = [];
  let current = '';
  let pendingSpace = false;
  let lastKeyword = '';

  const trimTrailing = () => {
    current = current.replace(/[ \t]+$/, '');
  };

  const append = (text: string) => {
    if (pendingSpace && current.length > 0 && !current.endsWith(' ')) {
      current += ' ';
    }
    pendingSpace = false;
    current += text;
  };

  const newLine = () => {
    trimTrailing();
    if (current.trim().length > 0) lines.push(current.trim());
    current = '';
    pendingSpace = false;
  };

  for (const token of tokens) {
    if (token.type === 'whitespace') {
      pendingSpace = true;
      continue;
    }

    if (token.type === 'comment') {
      if (token.text.startsWith('--')) {
        // 行注释独占一行，避免把后续 SQL 一并注释掉。
        newLine();
        lines.push(token.text.trimEnd());
        pendingSpace = false;
      } else {
        // 块注释可以留在语句中间。
        append(token.text);
        pendingSpace = true;
      }
      continue;
    }

    if (token.type === 'keyword') {
      const upper = token.text.toUpperCase();
      lastKeyword = upper.toLowerCase();
      if (BREAK_BEFORE.has(lastKeyword)) {
        newLine();
        current = upper;
        pendingSpace = true;
      } else {
        append(upper);
        pendingSpace = true;
      }
      continue;
    }

    if (token.type === 'operator') {
      if (token.text === ',') {
        trimTrailing();
        current += ',';
        pendingSpace = true;
      } else if (token.text === ';') {
        trimTrailing();
        current += ';';
        newLine();
      } else if (token.text === '(') {
        trimTrailing();
        if (
          SPACE_BEFORE_PAREN.has(lastKeyword) &&
          pendingSpace &&
          current.length > 0 &&
          !current.endsWith(' ')
        ) {
          current += ' ';
        }
        current += '(';
        pendingSpace = false;
        lastKeyword = '';
      } else if (token.text === ')' || token.text === '.') {
        trimTrailing();
        current += token.text;
        pendingSpace = false;
      } else {
        append(token.text);
        pendingSpace = true;
      }
      continue;
    }

    append(token.text);
    pendingSpace = true;
  }

  newLine();

  // 续行统一缩进两格；分号后的新语句与空行不缩进。
  const indented = lines.map((line, index) => {
    if (index === 0 || line.length === 0) return line;
    const previous = lines[index - 1] ?? '';
    return previous.endsWith(';') ? line : `  ${line}`;
  });
  return indented.join('\n');
}
