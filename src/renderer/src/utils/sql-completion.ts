import type { DatabaseType } from '../../../shared/ipc-contract';

/** 补全使用的当前单词前缀（允许 `schema.table` 形式）。 */
export interface CompletionContext {
  /** 光标前的完整标识符片段，例如 `u.na`。 */
  prefix: string;
  /** 片段的起始位置。 */
  start: number;
  /** 最后一个点之后要匹配/替换的部分，例如 `na`。 */
  needle: string;
  /** 点之前的部分，例如 `u`；没有点为 ''。 */
  qualifier: string;
  /** 真正替换的起点：保留 `u.`，只替换列前缀。 */
  replaceStart: number;
  /** 光标所在的语句片段（不含前后语句）。 */
  statement: string;
  /** 当前语句中 FROM/JOIN/UPDATE/INTO 引用的表。 */
  tables: TableReference[];
  /** 光标前最近的 SQL 子句。 */
  clause: string;
}

export interface TableReference {
  /** 原样 token，例如 `dbo.users`。 */
  raw: string;
  /** 去掉引号后的分段，例如 `['db', 'dbo', 'users']`。 */
  parts: string[];
  /** 最后一段表名，例如 `users`。 */
  table: string;
  /** 中间一段 schema（MSSQL），例如 `dbo`。 */
  schema?: string;
  /** 第一段数据库（MSSQL/MySQL 三段式）。 */
  database?: string;
  /** 表别名，例如 `u`。 */
  alias?: string;
}

/** 补全候选分类；用于按上下文过滤（例如 FROM 后只给表/视图）。 */
export type CompletionKind =
  | 'keyword'
  | 'function'
  | 'table'
  | 'view'
  | 'procedure'
  | 'database'
  | 'schema'
  | 'column'
  | 'alias';

export interface CompletionCandidate {
  label: string;
  kind: CompletionKind;
}

/** 基础补全数据：关键字/函数/对象/库/Schema。 */
export interface CompletionGroups {
  keywords: string[];
  functions: string[];
  objects: Array<{ name: string; kind: 'table' | 'view' | 'procedure' }>;
  databases: string[];
  schemas: string[];
}

/** FROM/JOIN 等位置只接受表/视图；EXEC 只接受存储过程；USE 只接受数据库。 */
export function relationKindsForClause(clause: string): CompletionKind[] {
  if (clause === 'exec' || clause === 'execute') return ['procedure'];
  if (clause === 'use') return ['database'];
  if (['from', 'join', 'into', 'update', 'table', 'view'].includes(clause)) {
    return ['table', 'view'];
  }
  return [];
}

/**
 * 根据光标所在子句给出基础候选：
 * - `FROM/JOIN/...` → 表/视图；`EXEC` → 存储过程；`USE` → 数据库；
 * - 其他位置 → 关键字 + 函数；
 * - 带限定符（`u.` / `dbo.`）时基础候选为空，由对象查询补充列/库对象。
 */
export function completionCandidatesForContext(
  context: CompletionContext,
  groups: CompletionGroups,
): CompletionCandidate[] {
  if (context.qualifier) return [];
  const kinds = relationKindsForClause(context.clause);
  if (context.clause === 'use') {
    return groups.databases.map((label) => ({ label, kind: 'database' }));
  }
  if (kinds.length > 0) {
    return groups.objects
      .filter((object) => kinds.includes(object.kind))
      .map((object) => ({ label: object.name, kind: object.kind }));
  }
  const candidates: CompletionCandidate[] = [
    ...groups.keywords.map((label) => ({ label, kind: 'keyword' as const })),
    ...groups.functions.map((label) => ({ label, kind: 'function' as const })),
  ];
  return candidates;
}

/** 常用函数（不含方言专有函数；Phase 1 先给出名称，后续可带签名）。 */
export const SQL_FUNCTIONS: Record<DatabaseType, string[]> = {
  sqlite: [
    'COUNT',
    'SUM',
    'AVG',
    'MIN',
    'MAX',
    'COALESCE',
    'IFNULL',
    'NULLIF',
    'LENGTH',
    'SUBSTR',
    'UPPER',
    'LOWER',
    'TRIM',
    'DATE',
    'TIME',
    'DATETIME',
    'STRFTIME',
    'JULIANDAY',
    'ROUND',
    'ABS',
    'RANDOM',
    'TYPEOF',
    'JSON_EXTRACT',
  ],
  mysql: [
    'COUNT',
    'SUM',
    'AVG',
    'MIN',
    'MAX',
    'COALESCE',
    'IFNULL',
    'NULLIF',
    'CONCAT',
    'GROUP_CONCAT',
    'NOW',
    'CURDATE',
    'CURTIME',
    'DATE_FORMAT',
    'STR_TO_DATE',
    'DATEDIFF',
    'DATE_ADD',
    'DATE_SUB',
    'JSON_EXTRACT',
    'JSON_UNQUOTE',
    'ROUND',
    'ABS',
    'LENGTH',
    'SUBSTRING',
    'UPPER',
    'LOWER',
  ],
  percona: [
    'COUNT',
    'SUM',
    'AVG',
    'MIN',
    'MAX',
    'COALESCE',
    'IFNULL',
    'NULLIF',
    'CONCAT',
    'GROUP_CONCAT',
    'NOW',
    'CURDATE',
    'DATE_FORMAT',
    'STR_TO_DATE',
    'JSON_EXTRACT',
    'JSON_UNQUOTE',
    'ROUND',
    'ABS',
  ],
  mariadb: [
    'COUNT',
    'SUM',
    'AVG',
    'MIN',
    'MAX',
    'COALESCE',
    'IFNULL',
    'NULLIF',
    'CONCAT',
    'GROUP_CONCAT',
    'NOW',
    'CURDATE',
    'DATE_FORMAT',
    'STR_TO_DATE',
    'JSON_EXTRACT',
    'JSON_UNQUOTE',
    'ROUND',
    'ABS',
  ],
  mssql: [
    'COUNT',
    'SUM',
    'AVG',
    'MIN',
    'MAX',
    'COALESCE',
    'ISNULL',
    'NULLIF',
    'LEN',
    'CONCAT',
    'GETDATE',
    'SYSDATETIME',
    'DATEADD',
    'DATEDIFF',
    'FORMAT',
    'CONVERT',
    'CAST',
    'STRING_AGG',
    'JSON_VALUE',
    'JSON_QUERY',
    'ROUND',
    'ABS',
    'UPPER',
    'LOWER',
  ],
};

export function functionCompletions(dialect: DatabaseType | null | undefined): string[] {
  return dialect ? SQL_FUNCTIONS[dialect] ?? [] : [];
}

export interface SignatureHelp {
  name: string;
  parameters: string[];
  activeParameter: number;
}

const SIGNATURE_DEFINITIONS: Record<DatabaseType, Record<string, string>> = {
  sqlite: {
    count: 'COUNT(expression)',
    sum: 'SUM(expression)',
    avg: 'AVG(expression)',
    min: 'MIN(expression)',
    max: 'MAX(expression)',
    coalesce: 'COALESCE(value, ...)',
    ifnull: 'IFNULL(value, fallback)',
    nullif: 'NULLIF(value1, value2)',
    length: 'LENGTH(text)',
    substr: 'SUBSTR(text, start, length)',
    upper: 'UPPER(text)',
    lower: 'LOWER(text)',
    trim: 'TRIM(text)',
    date: 'DATE(time-value, modifier, ...)',
    time: 'TIME(time-value, modifier, ...)',
    datetime: 'DATETIME(time-value, modifier, ...)',
    strftime: 'STRFTIME(format, time-value, modifier, ...)',
    julianday: 'JULIANDAY(time-value, modifier, ...)',
    round: 'ROUND(value, digits)',
    abs: 'ABS(value)',
    random: 'RANDOM()',
    typeof: 'TYPEOF(value)',
    json_extract: 'JSON_EXTRACT(json, path)',
  },
  mysql: {
    count: 'COUNT(expression)',
    sum: 'SUM(expression)',
    avg: 'AVG(expression)',
    min: 'MIN(expression)',
    max: 'MAX(expression)',
    coalesce: 'COALESCE(value, ...)',
    ifnull: 'IFNULL(value, fallback)',
    nullif: 'NULLIF(value1, value2)',
    concat: 'CONCAT(str1, str2, ...)',
    group_concat: 'GROUP_CONCAT(expression ORDER BY ... SEPARATOR ...)',
    now: 'NOW()',
    curdate: 'CURDATE()',
    curtime: 'CURTIME()',
    date_format: 'DATE_FORMAT(date, format)',
    str_to_date: 'STR_TO_DATE(str, format)',
    datediff: 'DATEDIFF(date1, date2)',
    date_add: 'DATE_ADD(date, INTERVAL value unit)',
    date_sub: 'DATE_SUB(date, INTERVAL value unit)',
    json_extract: 'JSON_EXTRACT(json, path)',
    json_unquote: 'JSON_UNQUOTE(value)',
    round: 'ROUND(value, digits)',
    abs: 'ABS(value)',
    length: 'LENGTH(str)',
    substring: 'SUBSTRING(str, pos, len)',
    upper: 'UPPER(str)',
    lower: 'LOWER(str)',
  },
  percona: {},
  mariadb: {},
  mssql: {
    count: 'COUNT(expression)',
    sum: 'SUM(expression)',
    avg: 'AVG(expression)',
    min: 'MIN(expression)',
    max: 'MAX(expression)',
    coalesce: 'COALESCE(value, ...)',
    isnull: 'ISNULL(check_expression, replacement)',
    nullif: 'NULLIF(value1, value2)',
    len: 'LEN(string)',
    concat: 'CONCAT(str1, str2, ...)',
    getdate: 'GETDATE()',
    sysdatetime: 'SYSDATETIME()',
    dateadd: 'DATEADD(datepart, number, date)',
    datediff: 'DATEDIFF(datepart, startdate, enddate)',
    format: 'FORMAT(value, format, culture)',
    convert: 'CONVERT(data_type, expression, style)',
    cast: 'CAST(expression AS data_type)',
    string_agg: 'STRING_AGG(expression, separator)',
    json_value: 'JSON_VALUE(expression, path)',
    json_query: 'JSON_QUERY(expression, path)',
    round: 'ROUND(numeric, length)',
    abs: 'ABS(numeric)',
    upper: 'UPPER(text)',
    lower: 'LOWER(text)',
  },
};

SIGNATURE_DEFINITIONS.percona = SIGNATURE_DEFINITIONS.mysql;
SIGNATURE_DEFINITIONS.mariadb = SIGNATURE_DEFINITIONS.mysql;

function signatureDefinition(dialect: DatabaseType, name: string): string | null {
  return SIGNATURE_DEFINITIONS[dialect]?.[name.toLowerCase()] ?? null;
}

/** 从文本中找光标所在的函数调用（最内层未闭合括号）。 */
export function extractSignatureHelp(
  text: string,
  cursor: number,
  dialect: DatabaseType,
): SignatureHelp | null {
  const safeCursor = Math.max(0, Math.min(cursor, text.length));
  const statementStart = text.lastIndexOf(';', safeCursor - 1) + 1;
  const statement = text.slice(statementStart, safeCursor);

  const stack: number[] = [];
  let state: 'normal' | 'single' | 'double' | 'backtick' | 'bracket' | 'line' | 'block' =
    'normal';
  for (let index = 0; index < statement.length; index += 1) {
    const char = statement[index]!;
    const next = statement[index + 1];
    if (state === 'single') {
      if (char === "'" && next === "'") index += 1;
      else if (char === "'") state = 'normal';
      continue;
    }
    if (state === 'double') {
      if (char === '"' && next === '"') index += 1;
      else if (char === '"') state = 'normal';
      continue;
    }
    if (state === 'backtick') {
      if (char === '`') state = 'normal';
      continue;
    }
    if (state === 'bracket') {
      if (char === ']') state = 'normal';
      continue;
    }
    if (state === 'line') {
      if (char === '\n') state = 'normal';
      continue;
    }
    if (state === 'block') {
      if (char === '*' && next === '/') {
        state = 'normal';
        index += 1;
      }
      continue;
    }

    if (char === "'") state = 'single';
    else if (char === '"') state = 'double';
    else if (char === '`') state = 'backtick';
    else if (char === '[') state = 'bracket';
    else if (char === '-' && next === '-') {
      state = 'line';
      index += 1;
    } else if (char === '/' && next === '*') {
      state = 'block';
      index += 1;
    } else if (char === '(') {
      stack.push(index);
    } else if (char === ')' && stack.length > 0) {
      stack.pop();
    }
  }

  const openIndex = stack[stack.length - 1];
  if (openIndex === undefined) return null;
  const before = statement.slice(0, openIndex);
  const nameMatch = /([A-Za-z_][\w$]*(?:\.[A-Za-z_][\w$]*)*)\s*$/.exec(before);
  if (!nameMatch) return null;
  const fullName = nameMatch[1]!;
  const name = fullName.split('.').pop() ?? fullName;
  const definition = signatureDefinition(dialect, name);
  if (!definition) return null;

  const openParen = definition.indexOf('(');
  const closeParen = definition.lastIndexOf(')');
  if (openParen < 0 || closeParen < openParen) return null;
  const signatureName = definition.slice(0, openParen);
  const parameters = definition
    .slice(openParen + 1, closeParen)
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

  let activeParameter = 0;
  let depth = 0;
  let argumentState: 'normal' | 'single' | 'double' = 'normal';
  for (let index = openIndex + 1; index < statement.length; index += 1) {
    const char = statement[index]!;
    const next = statement[index + 1];
    if (argumentState === 'single') {
      if (char === "'" && next === "'") index += 1;
      else if (char === "'") argumentState = 'normal';
      continue;
    }
    if (argumentState === 'double') {
      if (char === '"' && next === '"') index += 1;
      else if (char === '"') argumentState = 'normal';
      continue;
    }
    if (char === "'") argumentState = 'single';
    else if (char === '"') argumentState = 'double';
    else if (char === '(') depth += 1;
    else if (char === ')') depth = Math.max(0, depth - 1);
    else if (char === ',' && depth === 0) activeParameter += 1;
  }
  if (parameters.length > 0) {
    activeParameter = Math.min(activeParameter, parameters.length - 1);
  }

  return { name: signatureName, parameters, activeParameter };
}


const KEYWORDS = new Set([
  'select',
  'from',
  'where',
  'join',
  'left',
  'right',
  'inner',
  'outer',
  'full',
  'cross',
  'on',
  'using',
  'group',
  'by',
  'order',
  'having',
  'limit',
  'offset',
  'union',
  'all',
  'insert',
  'into',
  'values',
  'update',
  'set',
  'delete',
  'create',
  'alter',
  'drop',
  'table',
  'view',
  'index',
  'as',
  'and',
  'or',
  'not',
  'null',
  'is',
  'in',
  'exists',
  'between',
  'like',
  'case',
  'when',
  'then',
  'else',
  'end',
  'with',
  'returning',
]);

/** 去掉标识符两侧的引号/反引号/方括号。 */
function unquoteIdentifier(value: string): string {
  return value.replace(/^[`"\[]+|[`"\]]+$/g, '');
}

/** 把 `db.schema.table` / `[schema].[table]` 拆成段。 */
function splitIdentifier(token: string): string[] {
  return token
    .split('.')
    .map((part) => unquoteIdentifier(part.trim()))
    .filter(Boolean);
}

/** 拆分补全限定符 `db.[schema].table`，并去掉引号。 */
export function splitQualifier(value: string): string[] {
  return splitIdentifier(value);
}

function isKeyword(value: string): boolean {
  return KEYWORDS.has(value.toLowerCase());
}

function parseTables(statement: string): TableReference[] {
  const tables: TableReference[] = [];
  // FROM/JOIN/UPDATE/INTO 后面的表 token；支持引号、点号和可选的 AS 别名。
  const pattern =
    /\b(FROM|JOIN|UPDATE|INTO)\s+([`"\[]?[\w$#@]+[`"\]]?(?:\s*\.\s*[`"\[]?[\w$#@]+[`"\]]?){0,2})(?:\s+(?:AS\s+)?([A-Za-z_][\w$]*))?/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(statement)) !== null) {
    const token = match[2] ?? '';
    const parts = splitIdentifier(token);
    if (parts.length === 0) continue;
    const aliasCandidate = match[3] ?? '';
    const alias = aliasCandidate && !isKeyword(aliasCandidate) ? aliasCandidate : undefined;
    const table = parts[parts.length - 1];
    const schema = parts.length >= 3 ? parts[parts.length - 2] : undefined;
    const database = parts.length >= 3 ? parts[0] : undefined;
    tables.push({
      raw: token.replace(/\s+/g, ''),
      parts,
      table,
      ...(schema ? { schema } : {}),
      ...(database ? { database } : {}),
      ...(alias ? { alias } : {}),
    });
  }
  return tables;
}

function clauseAt(statement: string): string {
  const before = statement.slice(0, statement.length);
  const matches = before.match(
    /\b(SELECT|FROM|JOIN|WHERE|ON|SET|GROUP\s+BY|ORDER\s+BY|HAVING|LIMIT|OFFSET|VALUES|UPDATE|INSERT|INTO|RETURNING|EXEC|EXECUTE|USE)\b/gi,
  );
  return (matches?.[matches.length - 1] ?? '').toLowerCase();
}

export function extractCompletionContext(text: string, cursor: number): CompletionContext {
  const safeCursor = Math.max(0, Math.min(cursor, text.length));
  let start = safeCursor;
  while (start > 0 && /[A-Za-z0-9_$\u0080-\uffff.]/.test(text[start - 1]!)) {
    start -= 1;
  }
  const prefix = text.slice(start, safeCursor);
  const dot = prefix.lastIndexOf('.');
  const qualifier = dot >= 0 ? prefix.slice(0, dot) : '';
  const needle = dot >= 0 ? prefix.slice(dot + 1) : prefix;
  const replaceStart = start + (dot >= 0 ? dot + 1 : 0);

  const statementStart = text.lastIndexOf(';', safeCursor - 1) + 1;
  const nextSemicolon = text.indexOf(';', safeCursor);
  const statementEnd = nextSemicolon === -1 ? text.length : nextSemicolon;
  const statement = text.slice(statementStart, statementEnd);
  const beforeCursor = text.slice(statementStart, safeCursor);

  return {
    prefix,
    start,
    needle,
    qualifier,
    replaceStart,
    statement,
    tables: parseTables(beforeCursor),
    clause: clauseAt(beforeCursor),
  };
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

/**
 * 补全大小写跟随输入：
 * - `sel` → `select`，`SEL` → `SELECT`；
 * - 补全项本身是混合大小写（例如真实表名 `DemoUsers`）时保持原样，避免改坏标识符。
 */
export function matchCompletionCase(completion: string, typed: string): string {
  const typedLetters = typed.replace(/[^A-Za-z]/g, '');
  if (!typedLetters) return completion;
  const completionLetters = completion.replace(/[^A-Za-z]/g, '');
  if (!completionLetters) return completion;
  const allLower = completionLetters === completionLetters.toLowerCase();
  const allUpper = completionLetters === completionLetters.toUpperCase();
  if (!allLower && !allUpper) return completion;
  if (typedLetters === typedLetters.toUpperCase()) return completion.toUpperCase();
  if (typedLetters === typedLetters.toLowerCase()) return completion.toLowerCase();
  return completion;
}

/** 从脚本中解析 SQLite `ATTACH ... AS alias` 的库别名。 */
export function extractAttachedDatabases(text: string): string[] {
  const aliases: string[] = [];
  const pattern =
    /\bATTACH\s+(?:DATABASE\s+)?(?:'[^']*'|"[^"]*")\s+AS\s+([`"\[]?[\w$]+[`"\]]?)/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const alias = unquoteIdentifier(match[1] ?? '');
    if (alias && !aliases.some((item) => item.toLowerCase() === alias.toLowerCase())) {
      aliases.push(alias);
    }
  }
  return aliases;
}

/** 输入空格后，若刚输入的是期望对象名的关键字，则自动打开补全。 */
export function shouldAutoTriggerCompletion(text: string, cursor: number): boolean {
  const before = text.slice(0, Math.max(0, Math.min(cursor, text.length)));
  return /(?:^|[^\w])(FROM|JOIN|INTO|UPDATE|TABLE|VIEW|EXEC|EXECUTE|USE|SET)\s+$/i.test(
    before,
  );
}

/** 每次输入后判断是否应自动弹补全（含普通单词输入）。 */
export function shouldOpenCompletionOnInput(
  text: string,
  cursor: number,
  options: { inserted?: boolean } = {},
): boolean {
  const safeCursor = Math.max(0, Math.min(cursor, text.length));
  const typed = text[safeCursor - 1] ?? '';
  if (typed === '.') return true;
  if (shouldAutoTriggerCompletion(text, safeCursor)) return true;
  if (options.inserted === false) return false;
  if (!/[A-Za-z0-9_$\u0080-\uffff]/.test(typed)) return false;
  return extractCompletionContext(text, safeCursor).needle.length > 0;
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
  const typed = text.slice(safeStart, safeEnd);
  const value = matchCompletionCase(completion, typed);
  const next = `${text.slice(0, safeStart)}${value}${text.slice(safeEnd)}`;
  return { text: next, cursor: safeStart + value.length };
}
