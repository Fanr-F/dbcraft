import type { SqlToken } from './sql-highlight.ts';

export interface BracketMatch {
  open: number;
  close: number;
}

const OPEN = new Set(['(', '[', '{']);
const CLOSE = new Set([')', ']', '}']);

function partnerOf(char: string): string {
  switch (char) {
    case '(':
      return ')';
    case '[':
      return ']';
    case '{':
      return '}';
    case ')':
      return '(';
    case ']':
      return '[';
    case '}':
      return '{';
    default:
      return '';
  }
}

/**
 * 找到光标所在/紧邻的括号及其配对位置。
 * 只用词法切分后的 operator token，天然跳过字符串与注释里的括号。
 */
export function findBracketMatch(tokens: SqlToken[], cursor: number): BracketMatch | null {
  const brackets: Array<{ char: string; offset: number }> = [];
  let offset = 0;

  for (const token of tokens) {
    if (token.type === 'operator' && token.text.length === 1) {
      if (OPEN.has(token.text) || CLOSE.has(token.text)) {
        brackets.push({ char: token.text, offset });
      }
    }
    offset += token.text.length;
  }

  const index = brackets.findIndex(
    (bracket) => bracket.offset === cursor || bracket.offset === cursor - 1,
  );
  if (index < 0) return null;

  const target = brackets[index]!;
  const isOpen = OPEN.has(target.char);
  const partner = partnerOf(target.char);

  if (isOpen) {
    let depth = 0;
    for (let current = index; current < brackets.length; current += 1) {
      const bracket = brackets[current]!;
      if (bracket.char === target.char) depth += 1;
      else if (bracket.char === partner) {
        depth -= 1;
        if (depth === 0) {
          return { open: target.offset, close: bracket.offset };
        }
      }
    }
    return null;
  }

  let depth = 0;
  for (let current = index; current >= 0; current -= 1) {
    const bracket = brackets[current]!;
    if (bracket.char === target.char) depth += 1;
    else if (bracket.char === partner) {
      depth -= 1;
      if (depth === 0) {
        return { open: bracket.offset, close: target.offset };
      }
    }
  }
  return null;
}
