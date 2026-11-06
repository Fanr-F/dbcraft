import { tokenizeSql } from './sql-highlight.ts';

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

/**
 * 对 `password = '...'` 这类赋值做展示级脱敏。
 * 只处理「敏感列名 + = + 字符串/数字」；不改写原 SQL，也不覆盖 INSERT 列值等复杂形式。
 */
export function maskSensitiveSql(sql: string): string {
  const tokens = tokenizeSql(sql);
  const output: string[] = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;

    if (
      (token.type === 'identifier' || token.type === 'keyword') &&
      SENSITIVE_NAMES.has(token.text.toLowerCase())
    ) {
      let cursor = index + 1;
      const between: string[] = [];
      while (
        cursor < tokens.length &&
        (tokens[cursor]!.type === 'whitespace' || tokens[cursor]!.type === 'comment')
      ) {
        between.push(tokens[cursor]!.text);
        cursor += 1;
      }

      const equals = tokens[cursor];
      if (equals && equals.type === 'operator' && equals.text === '=') {
        const afterEquals: string[] = [];
        let valueIndex = cursor + 1;
        while (
          valueIndex < tokens.length &&
          (tokens[valueIndex]!.type === 'whitespace' ||
            tokens[valueIndex]!.type === 'comment')
        ) {
          afterEquals.push(tokens[valueIndex]!.text);
          valueIndex += 1;
        }

        const value = tokens[valueIndex];
        if (value && (value.type === 'string' || value.type === 'number')) {
          output.push(token.text, ...between, '=', ...afterEquals, "'***'");
          index = valueIndex;
          continue;
        }
      }
    }

    output.push(token.text);
  }

  return output.join('');
}
