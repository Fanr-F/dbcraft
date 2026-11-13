export type SqlTokenType =
  | 'keyword'
  | 'function'
  | 'string'
  | 'comment'
  | 'number'
  | 'identifier'
  | 'operator'
  | 'whitespace';

export interface SqlToken {
  type: SqlTokenType;
  text: string;
}

const KEYWORDS = new Set(
  `select from where join left right inner outer full cross on as group by order having limit offset
   insert into values update set delete create table view index alter drop add column rename primary key
   foreign references unique not null default check constraint and or in is like between exists case when
   then else end distinct union all with begin commit rollback transaction pragma explain asc desc if
   replace truncate show use database schema grant revoke cast count sum avg min max coalesce
   current_timestamp true false autoincrement auto_increment integer text varchar int bigint decimal
   boolean date datetime timestamp blob json real numeric returning over partition`
    .split(/\s+/)
    .filter(Boolean),
);

/** 补全使用的关键字列表（小写存储，展示时统一大写）。 */
export const SQL_KEYWORD_LIST = Array.from(KEYWORDS, (keyword) => keyword.toUpperCase());

/** 常见 SQL 函数；只有后面跟 `(` 时才按函数高亮。 */
const FUNCTIONS = new Set(
  `count sum avg min max coalesce ifnull nullif length substr substring upper lower trim
   date time datetime strftime julianday round abs random typeof json_extract json_unquote
   json_value json_query concat group_concat string_agg now curdate curtime date_format
   str_to_date datediff dateadd date_add date_sub isnull len getdate sysdatetime format
   convert cast replace`
    .split(/\s+/)
    .filter(Boolean),
);

function isWordStart(char: string): boolean {
  return /[A-Za-z_\u0080-\uffff]/.test(char);
}

function isWordPart(char: string): boolean {
  return /[A-Za-z0-9_$\u0080-\uffff]/.test(char);
}

/**
 * 轻量 SQL 词法切分，仅用于语法高亮：必须原样保留所有字符，
 * `tokenizeSql(sql).map(t => t.text).join('')` 要等于输入。
 */
export function tokenizeSql(sql: string): SqlToken[] {
  const tokens: SqlToken[] = [];
  let index = 0;

  const push = (type: SqlTokenType, text: string) => {
    tokens.push({ type, text });
  };

  while (index < sql.length) {
    const char = sql[index]!;
    const next = sql[index + 1];

    if (/\s/.test(char)) {
      let end = index + 1;
      while (end < sql.length && /\s/.test(sql[end]!)) end += 1;
      push('whitespace', sql.slice(index, end));
      index = end;
      continue;
    }

    if (char === '-' && next === '-') {
      let end = index + 2;
      while (end < sql.length && sql[end] !== '\n') end += 1;
      push('comment', sql.slice(index, end));
      index = end;
      continue;
    }

    if (char === '/' && next === '*') {
      const close = sql.indexOf('*/', index + 2);
      const end = close < 0 ? sql.length : close + 2;
      push('comment', sql.slice(index, end));
      index = end;
      continue;
    }

    if (char === "'" || char === '"' || char === '`') {
      let end = index + 1;
      while (end < sql.length) {
        if (sql[end] === char) {
          // SQL 用两个连续引号表示转义。
          if (sql[end + 1] === char) {
            end += 2;
            continue;
          }
          end += 1;
          break;
        }
        end += 1;
      }
      push('string', sql.slice(index, end));
      index = end;
      continue;
    }

    if (/[0-9]/.test(char)) {
      let end = index + 1;
      while (end < sql.length && /[0-9.]/.test(sql[end]!)) end += 1;
      push('number', sql.slice(index, end));
      index = end;
      continue;
    }

    if (isWordStart(char)) {
      let end = index + 1;
      while (end < sql.length && isWordPart(sql[end]!)) end += 1;
      const word = sql.slice(index, end);
      const lower = word.toLowerCase();
      let lookahead = end;
      while (lookahead < sql.length && /\s/.test(sql[lookahead]!)) lookahead += 1;
      const isCall = sql[lookahead] === '(';
      push(
        FUNCTIONS.has(lower) && isCall
          ? 'function'
          : KEYWORDS.has(lower)
            ? 'keyword'
            : 'identifier',
        word,
      );
      index = end;
      continue;
    }

    // 其余按单字符运算符/标点处理，保证不丢字符。
    push('operator', char);
    index += 1;
  }

  return tokens;
}
