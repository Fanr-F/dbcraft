import type { DatabaseType } from '@shared/ipc-contract';
import {
  format as formatWithSqlFormatter,
  type SqlLanguage,
} from 'sql-formatter';
import { tokenizeSql, type SqlToken } from './sql-highlight.ts';

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
  // 语句级关键字：多语句（尤其没有分号时）不能被粘到同一行。
  'create',
  'alter',
  'drop',
  'exec',
  'execute',
  'truncate',
  'merge',
  'use',
  'declare',
  'begin',
  'commit',
  'rollback',
  'print',
  'grant',
  'revoke',
]);

/** 这些关键字开头的行属于子句续行，缩进两格；语句起始关键字不缩进。 */
const CONTINUATION_START = new Set([
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
  'values',
  'returning',
  'set',
]);

/** 这些关键字后保留空格再接左括号；函数名（COUNT 等）保持紧凑。 */
const SPACE_BEFORE_PAREN = new Set(['in', 'values', 'exists']);

/**
 * 存储过程控制语句：只在原始 SQL 中独占行首时换行。
 * 避免把 `SELECT IF(a, b, c)` 里的 `IF` 也拆成新行。
 */
const LINE_START_BREAK = new Set([
  'if',
  'else',
  'elseif',
  'while',
  'loop',
  'repeat',
  'until',
]);

/** T-SQL `GO` 批分隔符：独占一行，可带重复次数和行尾注释。 */
const GO_LINE = /^go(?:\s+\d+)?(?:\s+--.*)?$/i;

/** 支持 `DELIMITER` 客户端指令的方言。 */
const MYSQL_FAMILY_TYPES = new Set<DatabaseType>(['mysql', 'percona', 'mariadb']);

export interface FormatSqlOptions {
  keywordCase?: 'upper' | 'lower' | 'preserve';
  /**
   * 方言：T-SQL 才把 `GO` 当批分隔符，MySQL 系才识别 `DELIMITER`。
   * 缺省时两者都识别，保证不带连接信息的 SQL 也能格式化。
   */
  dialect?: DatabaseType;
}

interface BatchSeparator {
  count: string;
  comment: string;
  /** 分隔符及其行尾附加内容占用的最后一个 token 下标。 */
  endIndex: number;
}

interface DelimiterDirective {
  /** 指令声明的自定义分隔符，如 `$$`、`//`、`;`。 */
  delimiter: string;
  comment: string;
  endIndex: number;
}

/** 当前 token 是否在原始 SQL 的行首：前一个 token 是含换行的空白，或文件开头。 */
function isLineStart(tokens: SqlToken[], index: number): boolean {
  const previous = tokens[index - 1];
  return !previous || (previous.type === 'whitespace' && previous.text.includes('\n'));
}

/**
 * 判断当前 token 是否是独占一行的 T-SQL `GO` 批分隔符。
 * 字符串/注释里的 `go` 不会是 identifier token，因此不会被误判。
 */
function matchBatchSeparator(
  tokens: SqlToken[],
  index: number,
): BatchSeparator | null {
  const token = tokens[index];
  if (!token || token.type !== 'identifier' || token.text.toLowerCase() !== 'go') {
    return null;
  }
  if (!isLineStart(tokens, index)) return null;

  let cursor = index + 1;
  if (tokens[cursor]?.type === 'whitespace' && !tokens[cursor]!.text.includes('\n')) {
    cursor += 1;
  }
  let count = '';
  if (tokens[cursor]?.type === 'number' && /^\d+$/.test(tokens[cursor]!.text)) {
    count = tokens[cursor]!.text;
    cursor += 1;
    if (tokens[cursor]?.type === 'whitespace' && !tokens[cursor]!.text.includes('\n')) {
      cursor += 1;
    }
  }
  let comment = '';
  if (tokens[cursor]?.type === 'comment' && tokens[cursor]!.text.startsWith('--')) {
    comment = tokens[cursor]!.text.trimEnd();
    cursor += 1;
  }
  const tail = tokens[cursor];
  if (tail && !(tail.type === 'whitespace' && tail.text.includes('\n'))) {
    return null;
  }
  return { count, comment, endIndex: cursor - 1 };
}

/**
 * 识别 MySQL 客户端指令 `DELIMITER $$`：必须独占一行，后接分隔符文本，
 * 可带行尾注释。指令本身不属于 SQL 语句，但要原样保留在格式化结果里。
 */
function matchDelimiterDirective(
  tokens: SqlToken[],
  index: number,
): DelimiterDirective | null {
  const token = tokens[index];
  if (
    !token ||
    (token.type !== 'identifier' && token.type !== 'keyword') ||
    token.text.toLowerCase() !== 'delimiter' ||
    !isLineStart(tokens, index)
  ) {
    return null;
  }

  let cursor = index + 1;
  const separator = tokens[cursor];
  if (!separator || separator.type !== 'whitespace' || separator.text.includes('\n')) {
    return null;
  }
  cursor += 1;

  let delimiter = '';
  while (cursor < tokens.length) {
    const part = tokens[cursor]!;
    if (part.type === 'whitespace') {
      if (part.text.includes('\n')) break;
      delimiter += ' ';
      cursor += 1;
      continue;
    }
    if (part.type === 'comment') break;
    delimiter += part.text;
    cursor += 1;
  }
  delimiter = delimiter.trim();
  if (!delimiter) return null;

  let comment = '';
  if (tokens[cursor]?.type === 'comment' && tokens[cursor]!.text.startsWith('--')) {
    comment = tokens[cursor]!.text.trimEnd();
    cursor += 1;
  }
  const tail = tokens[cursor];
  if (tail && !(tail.type === 'whitespace' && tail.text.includes('\n'))) {
    return null;
  }
  return { delimiter, comment, endIndex: cursor - 1 };
}

/**
 * 匹配当前自定义分隔符（如 `$$`、`//`）。分隔符可能被词法切成多个
 * 运算符 token，因此逐个拼接比较；返回最后一个 token 的下标。
 */
function matchDelimiterAt(
  tokens: SqlToken[],
  index: number,
  delimiter: string,
): number | null {
  let cursor = index;
  let text = '';
  while (cursor < tokens.length && text.length < delimiter.length) {
    const token = tokens[cursor]!;
    if (
      token.type === 'whitespace' ||
      token.type === 'comment' ||
      token.type === 'string'
    ) {
      return null;
    }
    text += token.text;
    cursor += 1;
    if (text === delimiter) return cursor - 1;
    if (!delimiter.startsWith(text)) return null;
  }
  return null;
}

/**
 * 保守的 SQL 格式化：只处理关键字大小写、分块换行与空格。
 * 字符串、注释内容原样保留（由 tokenizer 保证）；T-SQL `GO` 与
 * MySQL `DELIMITER` 保持独占一行，语句之间不会被合并。
 *
 * 这是本地兜底实现：`sql-formatter` 无法解析的脚本（例如带 `DELIMITER`
 * 的 MySQL 存储过程）以及格式化抛错时使用。
 */
function formatSqlLocally(sql: string, options: FormatSqlOptions = {}): string {
  const keywordCase = options.keywordCase ?? 'upper';
  const supportsBatchSeparator =
    options.dialect === undefined || options.dialect === 'mssql';
  const supportsDelimiter =
    options.dialect === undefined || MYSQL_FAMILY_TYPES.has(options.dialect);
  const tokens = tokenizeSql(sql);
  const lines: string[] = [];
  let current = '';
  let pendingSpace = false;
  let lastKeyword = '';
  /** 当前生效的语句分隔符；`DELIMITER $$` 后由 `;` 变成 `$$`。 */
  let activeDelimiter = ';';
  /** 出现过的自定义分隔符，供缩进阶段判断语句边界。 */
  const customDelimiters: string[] = [];

  const renderKeyword = (text: string) =>
    keywordCase === 'lower'
      ? text.toLowerCase()
      : keywordCase === 'preserve'
        ? text
        : text.toUpperCase();

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

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;

    // MySQL `DELIMITER $$`：原样保留指令行，并切换后续语句分隔符。
    if (supportsDelimiter) {
      const directive = matchDelimiterDirective(tokens, index);
      if (directive) {
        newLine();
        lines.push(
          `${renderKeyword('delimiter')} ${directive.delimiter}${directive.comment ? ` ${directive.comment}` : ''}`,
        );
        current = '';
        pendingSpace = false;
        lastKeyword = '';
        activeDelimiter = directive.delimiter;
        if (
          activeDelimiter !== ';' &&
          !customDelimiters.includes(activeDelimiter)
        ) {
          customDelimiters.push(activeDelimiter);
        }
        index = directive.endIndex;
        continue;
      }
    }

    // 自定义分隔符（`$$`、`//` 等）作为语句结束符留在语句末尾。
    if (activeDelimiter !== ';') {
      const delimiterEnd = matchDelimiterAt(tokens, index, activeDelimiter);
      if (delimiterEnd !== null) {
        trimTrailing();
        current += activeDelimiter;
        newLine();
        lastKeyword = '';
        index = delimiterEnd;
        continue;
      }
    }

    // 存储过程控制语句独占行首时换行（源文件里 `IF` 单独一行才触发）。
    if (
      (token.type === 'keyword' || token.type === 'identifier') &&
      LINE_START_BREAK.has(token.text.toLowerCase()) &&
      isLineStart(tokens, index)
    ) {
      newLine();
      current = renderKeyword(token.text);
      lastKeyword = token.text.toLowerCase();
      pendingSpace = true;
      continue;
    }

    if (token.type === 'identifier' && supportsBatchSeparator) {
      const separator = matchBatchSeparator(tokens, index);
      if (separator) {
        newLine();
        const renderedGo =
          keywordCase === 'lower'
            ? 'go'
            : keywordCase === 'preserve'
              ? token.text
              : 'GO';
        lines.push(
          `${renderedGo}${separator.count ? ` ${separator.count}` : ''}${separator.comment ? ` ${separator.comment}` : ''}`,
        );
        current = '';
        pendingSpace = false;
        lastKeyword = '';
        index = separator.endIndex;
        continue;
      }
    }

    if (token.type === 'whitespace') {
      // 左括号/点号后不留空格，避免 OVER( PARTITION BY id ) 这类型多余空格。
      pendingSpace =
        current.length > 0 && !current.endsWith('(') && !current.endsWith('.');
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
      const rendered = renderKeyword(token.text);
      lastKeyword = token.text.toLowerCase();
      if (BREAK_BEFORE.has(lastKeyword)) {
        newLine();
        current = rendered;
        pendingSpace = true;
      } else {
        append(rendered);
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

    append(token.type === 'function' ? renderKeyword(token.text) : token.text);
    pendingSpace = true;
  }

  newLine();

  // 缩进规则：
  // - GO / DELIMITER 指令行永远顶格；
  // - `BEGIN`…`END` 块内整体缩进两格（`END IF` / `END LOOP` 等不参与配对）；
  // - FROM/WHERE/VALUES 等子句续行再缩进两格，避免多语句被误当成一条。
  const firstWordOf = (line: string) =>
    (line.match(/^[A-Za-z_][\w$]*/) ?? [''])[0].toLowerCase();
  const endsStatement = (line: string) =>
    GO_LINE.test(line) ||
    line.endsWith(';') ||
    customDelimiters.some((delimiter) => line.endsWith(delimiter));
  // SQLite 的 `BEGIN` 是事务语句，不是代码块，不能参与缩进配对。
  const supportsBlocks = options.dialect !== 'sqlite';
  const isBlockOpener = (line: string) => supportsBlocks && /^begin$/i.test(line);
  const isBlockCloser = (line: string) => {
    if (!supportsBlocks) return false;
    const match = /^end\b(.*)$/i.exec(line);
    if (!match) return false;
    let rest = match[1]!.trim();
    for (const delimiter of customDelimiters) {
      if (rest === delimiter) {
        rest = '';
        break;
      }
    }
    // `END IF` / `END LOOP` / `END TRY` 等属于其它结构，不关闭 BEGIN 块。
    return rest === '' || rest === ';';
  };

  let blockDepth = 0;
  const indented = lines.map((line, index) => {
    const trimmed = line.trim();
    if (trimmed.length === 0) return line;
    if (isBlockCloser(trimmed)) blockDepth = Math.max(0, blockDepth - 1);

    const isDirective = GO_LINE.test(trimmed) || /^delimiter\s+\S+$/i.test(trimmed);
    let indent = '';
    if (!isDirective) {
      const previous = index > 0 ? (lines[index - 1]?.trim() ?? '') : '';
      const continuation =
        index > 0 &&
        !endsStatement(previous) &&
        !isBlockOpener(previous) &&
        (CONTINUATION_START.has(firstWordOf(trimmed)) || trimmed.startsWith('--'));
      indent = '  '.repeat(blockDepth) + (continuation ? '  ' : '');
    }
    if (isBlockOpener(trimmed)) blockDepth += 1;
    return indent + trimmed;
  });
  return indented.join('\n');
}

/** MySQL 客户端指令 `DELIMITER`：sql-formatter 不认识，必须走本地格式化。 */
const MYSQL_DELIMITER_DIRECTIVE = /^\s*delimiter\s+\S+/im;

/** T-SQL 批分隔符 `GO`（独占一行）；没有连接方言时用它推断 T-SQL。 */
const TSQL_GO_LINE = /^\s*go(?:\s+\d+)?(?:\s+--.*)?\s*$/im;

function sqlFormatterLanguage(
  dialect: DatabaseType | undefined,
  sql: string,
): SqlLanguage {
  switch (dialect) {
    case 'mssql':
      return 'transactsql';
    case 'mysql':
    case 'percona':
      return 'mysql';
    case 'mariadb':
      return 'mariadb';
    case 'sqlite':
      return 'sqlite';
    default:
      // 没有连接信息时：出现独占一行的 GO 按 T-SQL 处理，否则用标准 SQL。
      return TSQL_GO_LINE.test(sql) && !MYSQL_DELIMITER_DIRECTIVE.test(sql)
        ? 'transactsql'
        : 'sql';
  }
}

/**
 * 格式化入口：优先使用第三方 `sql-formatter`（按方言选择 grammar）。
 * MySQL 存储过程脚本带 `DELIMITER` 客户端指令，第三方解析器会把
 * `END$$` / `DELIMITER ;` 拆坏，这类脚本改用本地保守格式化；
 * 第三方抛错时同样回退本地，保证格式化失败不会丢用户 SQL。
 */
export function formatSql(sql: string, options: FormatSqlOptions = {}): string {
  if (!sql.trim()) return sql;
  const mysqlFamily =
    options.dialect !== undefined && MYSQL_FAMILY_TYPES.has(options.dialect);
  if (
    (mysqlFamily || options.dialect === undefined) &&
    MYSQL_DELIMITER_DIRECTIVE.test(sql)
  ) {
    return formatSqlLocally(sql, options);
  }
  try {
    const keywordCase = options.keywordCase ?? 'upper';
    return formatWithSqlFormatter(sql, {
      language: sqlFormatterLanguage(options.dialect, sql),
      keywordCase,
      // 与旧的本地格式化保持一致：函数名、数据类型跟随关键字大小写设置，
      // 表名/列名等标识符仍按原样保留。
      functionCase: keywordCase,
      dataTypeCase: keywordCase,
      tabWidth: 2,
      expressionWidth: 120,
      linesBetweenQueries: 1,
    });
  } catch {
    return formatSqlLocally(sql, options);
  }
}
