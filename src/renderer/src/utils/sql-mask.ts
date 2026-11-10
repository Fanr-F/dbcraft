import { tokenizeSql, type SqlToken } from './sql-highlight.ts';

const SENSITIVE_NAMES = new Set([
  'password',
  'passwd',
  'pwd',
  'token',
  'secret',
  'api_key',
  'apikey',
  'access_key',
  'private_key',
]);

function normalizedName(token: SqlToken | undefined): string {
  return (token?.text ?? '')
    .replace(/^[`"'\[]|[`"'\]]$/g, '')
    .trim()
    .toLowerCase();
}

function isValueToken(token: SqlToken | undefined): boolean {
  return token?.type === 'string' || token?.type === 'number';
}

function nextMeaningful(tokens: SqlToken[], from: number): number {
  let index = from;
  while (
    index < tokens.length &&
    (tokens[index]!.type === 'whitespace' || tokens[index]!.type === 'comment')
  ) {
    index += 1;
  }
  return index;
}

/**
 * 对赋值和 INSERT 值中的敏感字段做展示级脱敏。
 * 支持 `password = '...'`、`INSERT INTO t(password, token) VALUES ('x', 'y')` 多行值。
 * 不改写原 SQL，只用于列表/详情/导出展示。
 */
export function maskSensitiveSql(sql: string): string {
  const tokens = tokenizeSql(sql);
  const replacements = new Map<number, string>();

  // 1) 赋值型：password = '...' / token = 123。
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (
      (token.type === 'identifier' || token.type === 'keyword') &&
      SENSITIVE_NAMES.has(normalizedName(token))
    ) {
      const equals = nextMeaningful(tokens, index + 1);
      if (tokens[equals]?.type === 'operator' && tokens[equals]!.text === '=') {
        const value = nextMeaningful(tokens, equals + 1);
        if (isValueToken(tokens[value])) replacements.set(value, "'***'");
      }
    }
  }

  // 2) INSERT 列值：INSERT INTO t(password, token) VALUES ('x', 'y'), ('z', 'w')。
  for (let index = 0; index < tokens.length; index += 1) {
    if (normalizedName(tokens[index]!) !== 'insert') continue;
    const into = nextMeaningful(tokens, index + 1);
    if (normalizedName(tokens[into]) !== 'into') continue;
    const open = tokens.findIndex((token, position) => position > into && token.text === '(');
    if (open < 0) continue;
    const close = (() => {
      let depth = 0;
      for (let position = open; position < tokens.length; position += 1) {
        if (tokens[position]!.text === '(') depth += 1;
        if (tokens[position]!.text === ')') {
          depth -= 1;
          if (depth === 0) return position;
        }
      }
      return -1;
    })();
    if (close < 0) continue;

    const columns: boolean[] = [];
    for (let position = open + 1; position < close; position += 1) {
      const token = tokens[position]!;
      if (token.type === 'identifier' || token.type === 'keyword' || token.type === 'string') {
        columns.push(SENSITIVE_NAMES.has(normalizedName(token)));
      }
    }
    if (columns.length === 0) continue;

    const valuesIndex = nextMeaningful(tokens, close + 1);
    if (normalizedName(tokens[valuesIndex]) !== 'values') continue;

    let position = valuesIndex + 1;
    while (position < tokens.length) {
      position = nextMeaningful(tokens, position);
      if (tokens[position]?.text !== '(') break;

      let depth = 0;
      let columnIndex = 0;
      let atValueStart = true;
      let end = position;
      for (let cursor = position; cursor < tokens.length; cursor += 1) {
        const token = tokens[cursor]!;
        if (token.type === 'whitespace' || token.type === 'comment') continue;
        if (token.text === '(') {
          depth += 1;
          continue;
        }
        if (token.text === ')') {
          depth -= 1;
          if (depth === 0) {
            end = cursor;
            break;
          }
          continue;
        }
        if (depth !== 1) continue;
        if (token.text === ',') {
          columnIndex += 1;
          atValueStart = true;
          continue;
        }
        if (atValueStart) {
          if (columns[columnIndex] && isValueToken(token)) {
            replacements.set(cursor, "'***'");
          }
          atValueStart = false;
        }
      }

      position = end + 1;
      const separator = nextMeaningful(tokens, position);
      if (tokens[separator]?.text !== ',') break;
      position = separator + 1;
    }
  }

  return tokens
    .map((token, index) => replacements.get(index) ?? token.text)
    .join('');
}
