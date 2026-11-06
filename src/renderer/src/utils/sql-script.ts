import { tokenizeSql } from './sql-highlight.ts';

export type SplitStatementsResult =
  | { ok: true; statements: string[] }
  | { ok: false; message: string };

/**
 * 按顶层分号切分脚本；字符串/注释里的分号不会被误切。
 * 只用于显式脚本执行，SQL 编辑器仍保持单语句语义。
 */
export function splitSqlStatements(sql: string, limit = 50): SplitStatementsResult {
  const tokens = tokenizeSql(sql);
  const statements: string[] = [];
  let current = '';
  let hasContent = false;

  const flush = () => {
    const text = current.trim();
    if (text.length > 0 && hasContent) {
      statements.push(text);
    }
    current = '';
    hasContent = false;
  };

  for (const token of tokens) {
    if (token.type === 'operator' && token.text === ';') {
      current += token.text;
      flush();
      continue;
    }
    current += token.text;
    if (token.type !== 'whitespace' && token.type !== 'comment') {
      hasContent = true;
    }
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
