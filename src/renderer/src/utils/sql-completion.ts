/** 补全使用的当前单词前缀（允许 `schema.table` 形式）。 */
export interface CompletionContext {
  prefix: string;
  start: number;
}

export function extractCompletionContext(text: string, cursor: number): CompletionContext {
  const safeCursor = Math.max(0, Math.min(cursor, text.length));
  let start = safeCursor;
  while (start > 0 && /[A-Za-z0-9_$\u0080-\uffff.]/.test(text[start - 1]!)) {
    start -= 1;
  }
  return { prefix: text.slice(start, safeCursor), start };
}

/**
 * 前缀优先匹配开头，其次匹配包含；去重后按字母序返回。
 * 补全只是输入辅助，不改变 SQL 语义。
 */
export function filterCompletions(
  items: string[],
  prefix: string,
  limit = 50,
): string[] {
  const needle = prefix.trim().toLowerCase();
  const seen = new Set<string>();
  const starts: string[] = [];
  const contains: string[] = [];

  for (const item of items) {
    const trimmed = item.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    if (!needle) {
      starts.push(trimmed);
    } else if (key.startsWith(needle)) {
      starts.push(trimmed);
    } else if (key.includes(needle)) {
      contains.push(trimmed);
    }
  }

  const byName = (left: string, right: string) => left.localeCompare(right, 'en');
  return [...starts.sort(byName), ...contains.sort(byName)].slice(0, Math.max(1, limit));
}

/** 用补全项替换 [start, end) 区间，返回新文本与光标位置。 */
export function applyCompletion(
  text: string,
  start: number,
  end: number,
  completion: string,
): { text: string; cursor: number } {
  const safeStart = Math.max(0, Math.min(start, text.length));
  const safeEnd = Math.max(safeStart, Math.min(end, text.length));
  const next = `${text.slice(0, safeStart)}${completion}${text.slice(safeEnd)}`;
  return { text: next, cursor: safeStart + completion.length };
}
