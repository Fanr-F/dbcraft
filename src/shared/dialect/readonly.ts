/** 允许在只读连接上执行的语句首关键字。 */
export const READ_ONLY_KEYWORDS = new Set([
  'select',
  'with',
  'show',
  'describe',
  'desc',
  'explain',
  'values',
  'table',
]);

export function firstSqlKeyword(sql: string): string {
  const cleaned = sql
    .replace(/^\s*(?:--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/|\s)+/g, '')
    .trim();
  return (cleaned.split(/\s+/)[0] ?? '').toLowerCase();
}

/** 只读连接的前置检查；不是权限边界，数据库只读模式仍是最终保障。 */
export function isReadOnlyStatement(sql: string): boolean {
  return READ_ONLY_KEYWORDS.has(firstSqlKeyword(sql));
}
