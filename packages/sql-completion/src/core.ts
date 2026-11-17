import type { SqlDialect } from './types.ts';
import { quoteIdentifier } from './quote.ts';
import { DIALECT_KEYWORD_WORDS, SQL_KEYWORD_LIST } from './keywords.ts';

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
  /** 真正替换的终点；通配符展开时会包含 `*` 本身。 */
  replaceEnd: number;
  /** 光标所在的语句片段（不含前后语句）。 */
  statement: string;
  /** 光标所在语句在原文中的起始偏移。 */
  statementStart: number;
  /** 当前语句中 FROM/JOIN/UPDATE/INTO 引用的表（含光标之后的表）。 */
  tables: TableReference[];
  /** 光标前最近的 SQL 子句。 */
  clause: string;
  /** 光标紧跟在 SELECT 列表的 `*` 上（可展开为列清单）。 */
  wildcard: boolean;
  /** 光标位于字符串或注释内；此时不应弹补全。 */
  inLiteral: boolean;
  /** 光标处的括号深度。 */
  depth: number;
  /** 光标位于 `INSERT INTO <table> (` 的列清单里。 */
  insertColumnList: boolean;
  /** 列清单所属的表；`insertColumnList` 为 true 时存在。 */
  insertTable?: TableReference;
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

/** CTE / 派生表推导出的虚拟表。 */
export interface VirtualTable {
  name: string;
  columns: string[];
}

/**
 * 可选的语句分析器。
 *
 * 包本身不依赖 `node-sql-parser`；宿主可以注入 AST 分析（返回表/别名/CTE），
 * 解析失败或未注入时由内置扫描器兜底。
 */
export type StatementAnalyzer = (
  statement: string,
  dialect: SqlDialect,
) => { tables: TableReference[]; ctes: VirtualTable[] } | null;

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
  /** 右侧说明：列类型、对象类型等。 */
  detail?: string;
  /** 实际插入文本；缺省时用 label，并由编辑器跟随输入大小写。 */
  insertText?: string;
  /** 同分时的优先级，数字越小越靠前；缺省 0。 */
  priority?: number;
  /** 上下文加权：正数提前、负数降权（例如系统对象）。与 `priority` 分开。 */
  boost?: number;
  /** 列所属的表（不含限定符），用于语句上下文加权。 */
  table?: string;
  /** 对象所属 schema（MSSQL）；用于 qualifier 匹配。 */
  schema?: string;
  /** 列是否主键；JOIN ... ON 时优先。 */
  primaryKey?: boolean;
}

/** 排序后的补全项，`matches` 是用于高亮的前缀/子序列字符下标。 */
export interface RankedCompletion extends CompletionCandidate {
  matches: number[];
}

/** 基础补全数据：关键字/函数/对象/库/Schema。 */
export interface CompletionGroups {
  keywords: string[];
  functions: string[];
  objects: Array<{ name: string; kind: 'table' | 'view' | 'procedure'; schema?: string }>;
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

const COLUMN_CLAUSES = new Set([
  'select',
  'where',
  'on',
  'set',
  'order by',
  'group by',
  'having',
  'returning',
  'values',
]);
const TABLE_CLAUSES = new Set(['from', 'join', 'into', 'update', 'table', 'view']);

/** 光标位置「期望」哪类候选；用于评分加/减权，不负责生成候选。 */
export interface CompletionExpectation {
  /** 语句位置应该出现列。 */
  columns: boolean;
  /** 语句位置应该出现表/视图。 */
  tables: boolean;
  /** 语句位置应该出现存储过程。 */
  procedures: boolean;
  /** 语句位置应该出现 schema。 */
  schemas: boolean;
  /** 语句位置应该出现数据库。 */
  databases: boolean;
  /** 光标在 JOIN ... ON 条件里。 */
  joinOn: boolean;
  /** 光标在 INSERT 列清单里。 */
  columnNames: boolean;
}

export function completionExpectation(context: CompletionContext): CompletionExpectation {
  const clause = context.clause;
  const tablePosition = TABLE_CLAUSES.has(clause);
  return {
    columns: context.insertColumnList || COLUMN_CLAUSES.has(clause),
    tables: tablePosition,
    procedures: clause === 'exec' || clause === 'execute',
    schemas: tablePosition,
    databases: tablePosition || clause === 'use',
    joinOn: clause === 'on',
    columnNames: context.insertColumnList,
  };
}

/** 补全项类型的默认展示优先级（数字越小越靠前）。 */
export function completionKindPriority(kind: CompletionKind): number {
  switch (kind) {
    case 'column':
      return 0;
    case 'alias':
      return 1;
    case 'table':
      return 2;
    case 'view':
      return 3;
    case 'procedure':
      return 4;
    case 'schema':
      return 5;
    case 'database':
      return 6;
    case 'function':
      return 7;
    default:
      return 8;
  }
}

/**
 * 根据光标所在子句给出基础候选：
 * - `FROM/JOIN/...` → 表/视图 + 库/Schema；`EXEC` → 存储过程；`USE` → 数据库；
 * - `DBCC` 后 → DBCC 子命令；`DBCC ... WITH` 后 → 常用选项；
 * - 其他位置 → 关键字 + 函数；
 * - 带限定符或通配符时基础候选为空，由对象查询补充列/库对象。
 */
export function completionCandidatesForContext(
  context: CompletionContext,
  groups: CompletionGroups,
): CompletionCandidate[] {
  // INSERT 列清单里只应出现该表的列（由异步元数据补充），不要混入表名/关键字。
  if (context.insertColumnList) return [];
  if (context.qualifier || context.wildcard) return [];
  if (context.clause === 'dbcc' || context.clause === 'dbcc-with') {
    const labels = context.clause === 'dbcc' ? DBCC_COMMANDS : DBCC_OPTIONS;
    return labels.map((label) => ({
      label,
      kind: 'keyword' as const,
      priority: completionKindPriority('keyword'),
      boost: 20,
    }));
  }
  const kinds = relationKindsForClause(context.clause);
  if (context.clause === 'use') {
    return groups.databases.map((label) => ({
      label,
      kind: 'database',
      priority: completionKindPriority('database'),
    }));
  }
  if (kinds.length > 0) {
    const candidates: CompletionCandidate[] = groups.objects
      .filter((object) => kinds.includes(object.kind))
      .map((object) => ({
        label: object.name,
        kind: object.kind as CompletionKind,
        priority: completionKindPriority(object.kind),
        schema: object.schema,
      }));
    // FROM/JOIN 之后也允许先写库名/Schema 名，再点出对象；EXEC 只给存储过程。
    if (kinds.includes('table')) {
      candidates.push(
        ...groups.schemas.map((label) => ({
          label,
          kind: 'schema' as const,
          priority: completionKindPriority('schema'),
        })),
        ...groups.databases.map((label) => ({
          label,
          kind: 'database' as const,
          priority: completionKindPriority('database'),
        })),
      );
    }
    return candidates;
  }
  return [
    ...groups.keywords.map((label) => ({
      label,
      kind: 'keyword' as const,
      priority: completionKindPriority('keyword'),
    })),
    ...groups.functions.map((label) => ({
      label,
      kind: 'function' as const,
      priority: completionKindPriority('function'),
    })),
  ];
}

/** 常用函数（不含方言专有函数；Phase 1 先给出名称，后续可带签名）。 */
export const SQL_FUNCTIONS: Record<SqlDialect, string[]> = {
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

export function functionCompletions(dialect: SqlDialect | null | undefined): string[] {
  return dialect ? SQL_FUNCTIONS[dialect] ?? [] : [];
}

/** 解析服务器版本号；返回 [major, minor]，无法解析时返回 null。 */
export function parseServerVersion(version: string | null | undefined): [number, number] | null {
  const match = /(\d+)\.(\d+)/.exec(version ?? '');
  if (!match) return null;
  return [Number(match[1]), Number(match[2])];
}

function versionAtLeast(
  version: string | null | undefined,
  major: number,
  minor: number,
): boolean {
  const parsed = parseServerVersion(version);
  // 版本未知时保持宽松，宁可多给候选也不要少给。
  if (!parsed) return true;
  return parsed[0] > major || (parsed[0] === major && parsed[1] >= minor);
}

export type SqlFeature = 'cte' | 'window' | 'returning' | 'strict';

/** 按方言与服务器版本判断补全特性是否可用。 */
export function supportsSqlFeature(
  dialect: SqlDialect | null | undefined,
  version: string | null | undefined,
  feature: SqlFeature,
): boolean {
  if (!dialect) return true;
  switch (feature) {
    case 'cte':
      if (dialect === 'mysql' || dialect === 'percona') return versionAtLeast(version, 8, 0);
      if (dialect === 'mariadb') return versionAtLeast(version, 10, 2);
      if (dialect === 'sqlite') return versionAtLeast(version, 3, 8);
      return true;
    case 'window':
      if (dialect === 'mysql' || dialect === 'percona') return versionAtLeast(version, 8, 0);
      if (dialect === 'mariadb') return versionAtLeast(version, 10, 2);
      if (dialect === 'sqlite') return versionAtLeast(version, 3, 25);
      return true;
    case 'returning':
      if (dialect === 'sqlite') return versionAtLeast(version, 3, 35);
      if (dialect === 'mariadb') return versionAtLeast(version, 10, 5);
      return false;
    case 'strict':
      return dialect === 'sqlite' && versionAtLeast(version, 3, 37);
    default:
      return true;
  }
}

/** 方言专有关键字；基础关键字列表来自语法高亮模块。 */
const DIALECT_KEYWORDS: Record<SqlDialect, string[]> = {
  sqlite: ['ATTACH', 'DETACH', 'PRAGMA', 'VACUUM', 'REINDEX', 'STRICT', 'EXPLAIN'],
  mysql: ['SHOW', 'DESCRIBE', 'EXPLAIN', 'REPLACE', 'IGNORE'],
  percona: ['SHOW', 'DESCRIBE', 'EXPLAIN', 'REPLACE', 'IGNORE'],
  mariadb: ['SHOW', 'DESCRIBE', 'EXPLAIN', 'REPLACE', 'IGNORE'],
  mssql: [
    'TOP',
    'EXEC',
    'EXECUTE',
    'DECLARE',
    'PRINT',
    'MERGE',
    'PIVOT',
    'UNPIVOT',
    'TRY',
    'CATCH',
    'FETCH',
    'NEXT',
    'OUTPUT',
  ],
};

/**
 * 方言关键字/类型词表由 `keywords.ts` 提供；内容派生自
 * `@codemirror/lang-sql` 的 dialect spec（MIT），见该文件头部说明。
 */
function dialectKeywords(dialect: SqlDialect): string[] {
  return DIALECT_KEYWORD_WORDS[dialect] ?? [];
}

/**
 * 关键字候选：基础关键字 + 方言关键字，并按版本过滤 CTE/窗口函数/RETURNING/STRICT。
 * 版本未知时保持当前宽松行为。
 */
export function keywordCompletions(
  dialect: SqlDialect | null | undefined,
  version?: string | null,
): string[] {
  const candidates = new Set(SQL_KEYWORD_LIST);
  if (dialect) {
    for (const keyword of dialectKeywords(dialect)) candidates.add(keyword);
    for (const keyword of DIALECT_KEYWORDS[dialect] ?? []) {
      candidates.add(keyword.toUpperCase());
    }
  }

  return [...candidates].filter((keyword) => {
    if (keyword === 'WITH') return supportsSqlFeature(dialect, version, 'cte');
    if (keyword === 'OVER' || keyword === 'PARTITION') {
      return supportsSqlFeature(dialect, version, 'window');
    }
    if (keyword === 'RETURNING') return supportsSqlFeature(dialect, version, 'returning');
    if (keyword === 'STRICT') return supportsSqlFeature(dialect, version, 'strict');
    if (keyword === 'LIMIT' && dialect === 'mssql') return false;
    return true;
  });
}

const SIMPLE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_$]*$/;

/**
 * 补全插入标识符：能裸写就裸写；含空格/符号或是关键字时按方言加引号。
 * 返回的文本不会在插入时再改变大小写。
 */
export function quoteCompletionIdentifier(
  dialect: SqlDialect | null | undefined,
  name: string,
): string {
  const trimmed = name.trim();
  if (!trimmed) return name;
  if (SIMPLE_IDENTIFIER.test(trimmed) && !isKeyword(trimmed)) return trimmed;
  return quoteIdentifier(dialect ?? 'sqlite', trimmed);
}

/**
 * MySQL `lower_case_table_names=1` 时目录里的对象名本来就是小写；
 * 补全插入显式按设置折成小写，其余取值（0/2/未知）保留对象原名。
 */
export function normalizeCompletionNameCase(
  name: string,
  lowerCaseTableNames?: number | null,
): string {
  return lowerCaseTableNames === 1 ? name.toLowerCase() : name;
}

/** 找与 `open` 处左括号配对的右括号；找不到返回 -1。 */
function matchingParen(text: string, open: number): number {
  let depth = 0;
  for (let index = open; index < text.length; index += 1) {
    const char = text[index];
    if (char === '(') depth += 1;
    else if (char === ')') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

/** 找顶层（括号深度 0）的 FROM 关键字位置；没有返回 -1。 */
function topLevelFrom(text: string): number {
  let depth = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '(') depth += 1;
    else if (char === ')') depth = Math.max(0, depth - 1);
    else if (depth === 0 && /^from\b/i.test(text.slice(index, index + 4))) return index;
  }
  return -1;
}

/** 从 SELECT 语句里提取列名：显式别名优先，其次简单列引用。 */
function selectListColumns(selectSql: string): string[] {
  const text = selectSql.trim();
  if (!/^select\b/i.test(text)) return [];
  const body = text.replace(/^select\s+(?:distinct\s+|all\s+)?/i, '');
  const fromIndex = topLevelFrom(body);
  const list = fromIndex >= 0 ? body.slice(0, fromIndex) : body;

  const items: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of list) {
    if (char === '(') depth += 1;
    else if (char === ')') depth = Math.max(0, depth - 1);
    if (char === ',' && depth === 0) {
      items.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  if (current.trim()) items.push(current);

  const columns: string[] = [];
  for (const item of items) {
    const expression = item.trim();
    if (!expression || expression === '*' || /\.\*$/.test(expression)) continue;
    const asAlias = /^(.*?)\s+as\s+([A-Za-z_][\w$]*)$/i.exec(expression);
    const bare = /^(?:[A-Za-z_][\w$]*\.)*([A-Za-z_][\w$]*)$/.exec(expression);
    let name = '';
    if (asAlias) {
      name = asAlias[2]!;
    } else if (bare) {
      name = bare[1]!;
    } else {
      const trailing = /^(.*[^\s])\s+([A-Za-z_][\w$]*)$/.exec(expression);
      // `a + b` 这类表达式的最后一段不是别名。
      if (trailing && !/[+\-*/%|&<>=]\s*$/.test(trailing[1]!)) {
        name = trailing[2]!;
      }
    }
    if (name && !isKeyword(name)) columns.push(name);
  }
  return [...new Set(columns)];
}

/**
 * 提取语句里的 CTE 与派生表列清单，用于 `WITH x AS (...)`、`FROM (SELECT ...) x`
 * 之后的列补全。无法静态展开的 `*` 会跳过。
 */
export function extractVirtualTables(
  statement: string,
  dialect?: SqlDialect | null,
  analyze?: StatementAnalyzer,
): VirtualTable[] {
  if (statement.length > 50_000) return [];
  // 宿主注入 AST 分析时优先用 AST 推导 CTE 输出列；否则回退到正则/括号扫描。
  const analyzed = dialect && analyze ? analyze(statement, dialect) : null;
  if (analyzed && analyzed.ctes.length > 0) return analyzed.ctes;
  if (!/\bwith\b|\(\s*select\b/i.test(statement)) return [];
  const masked = scanSql(statement, statement.length).masked;
  const tables: VirtualTable[] = [];
  const seen = new Set<string>();

  const push = (name: string, columns: string[]) => {
    const key = name.toLowerCase();
    if (!name || columns.length === 0 || seen.has(key)) return;
    seen.add(key);
    tables.push({ name, columns });
  };

  // CTE：`WITH name [(col,...)] AS ( SELECT ... )`，支持多个逗号分隔的 CTE。
  const ctePattern = /([A-Za-z_][\w$]*)\s*(?:\(([^()]*)\))?\s+as\s*\(/gi;
  let cte: RegExpExecArray | null;
  while ((cte = ctePattern.exec(masked)) !== null) {
    const open = ctePattern.lastIndex - 1;
    const close = matchingParen(masked, open);
    if (close < 0) continue;
    const explicit = (cte[2] ?? '')
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean);
    const columns = explicit.length > 0 ? explicit : selectListColumns(masked.slice(open + 1, close));
    push(cte[1]!, columns);
    ctePattern.lastIndex = close + 1;
  }

  // 派生表：`FROM ( SELECT ... ) [AS] alias`。
  const derivedPattern = /\(\s*select\b/gi;
  let derived: RegExpExecArray | null;
  while ((derived = derivedPattern.exec(masked)) !== null) {
    const open = derived.index;
    const close = matchingParen(masked, open);
    if (close < 0) continue;
    const tail = /^\s*(?:as\s+)?([A-Za-z_][\w$]*)/i.exec(masked.slice(close + 1));
    if (!tail) continue;
    const alias = tail[1]!;
    if (isKeyword(alias)) continue;
    const before = masked.slice(0, open);
    // 只有 FROM/JOIN/逗号之后的子查询才是派生表。
    if (!/(?:from|join|,)\s*$/i.test(before)) continue;
    push(alias, selectListColumns(masked.slice(open + 1, close)));
  }

  return tables;
}


export interface SignatureHelp {
  name: string;
  parameters: string[];
  activeParameter: number;
}

const SIGNATURE_DEFINITIONS: Record<SqlDialect, Record<string, string>> = {
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

function signatureDefinition(dialect: SqlDialect, name: string): string | null {
  return SIGNATURE_DEFINITIONS[dialect]?.[name.toLowerCase()] ?? null;
}

/** 从文本中找光标所在的函数调用（最内层未闭合括号）。 */
export function extractSignatureHelp(
  text: string,
  cursor: number,
  dialect: SqlDialect,
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


/** 常用 SQL 关键字：同分时排在低频方言关键字（FREE/FREETEXT 等）前面。 */
const COMMON_KEYWORDS = new Set([
  'SELECT',
  'FROM',
  'WHERE',
  'GROUP',
  'ORDER',
  'BY',
  'HAVING',
  'JOIN',
  'LEFT',
  'RIGHT',
  'INNER',
  'OUTER',
  'FULL',
  'CROSS',
  'ON',
  'AS',
  'AND',
  'OR',
  'NOT',
  'NULL',
  'IS',
  'IN',
  'LIKE',
  'BETWEEN',
  'EXISTS',
  'CASE',
  'WHEN',
  'THEN',
  'ELSE',
  'END',
  'DISTINCT',
  'TOP',
  'LIMIT',
  'OFFSET',
  'UNION',
  'ALL',
  'INSERT',
  'INTO',
  'VALUES',
  'UPDATE',
  'SET',
  'DELETE',
  'CREATE',
  'TABLE',
  'VIEW',
  'INDEX',
  'ALTER',
  'DROP',
  'ADD',
  'COLUMN',
  'PRIMARY',
  'KEY',
  'FOREIGN',
  'REFERENCES',
  'UNIQUE',
  'DEFAULT',
  'CHECK',
  'CONSTRAINT',
  'EXEC',
  'EXECUTE',
  'DECLARE',
  'BEGIN',
  'COMMIT',
  'ROLLBACK',
  'USE',
  'WITH',
  'RETURNING',
  'OVER',
  'PARTITION',
]);

/**
 * DBCC 子命令是 T-SQL 命令而不是目录对象，sys.all_objects 里查不到，
 * 需要单独维护词表；只用于 `DBCC <光标>` 的第一段补全。
 */
export const DBCC_COMMANDS = [
  'CHECKALLOC',
  'CHECKCATALOG',
  'CHECKCONSTRAINTS',
  'CHECKDB',
  'CHECKFILEGROUP',
  'CHECKIDENT',
  'CHECKPRIMARYFILE',
  'CHECKSTORAGE',
  'CHECKTABLE',
  'CLEANTABLE',
  'CLONEDATABASE',
  'DBINFO',
  'DBREINDEX',
  'DBREPAIR',
  'DROPCLEANBUFFERS',
  'FLUSHAUTHCACHE',
  'FLUSHPROCINDB',
  'FREEPROCCACHE',
  'FREESESSIONCACHE',
  'FREESYSTEMCACHE',
  'FREETABLECACHE',
  'HELP',
  'IND',
  'INDEXDEFRAG',
  'INPUTBUFFER',
  'LOGINFO',
  'OPENTRAN',
  'OUTPUTBUFFER',
  'PAGE',
  'PINTABLE',
  'PROCCACHE',
  'REINDEX',
  'SHOWCONTIG',
  'SHOWSTATISTICS',
  'SHOW_STATISTICS',
  'SHRINKDATABASE',
  'SHRINKFILE',
  'SQLPERF',
  'TRACEOFF',
  'TRACEON',
  'TRACESTATUS',
  'UNPINTABLE',
  'UPDATEUSAGE',
  'USEROPTIONS',
  'WRITETRACEFILE',
] as const;

/**
 * DBCC ... WITH 的常用选项。故意不包含 REPAIR_ALLOW_DATA_LOSS 等破坏性选项，
 * 避免补全鼓励直接修库。
 */
export const DBCC_OPTIONS = [
  'ALL_ERRORMSGS',
  'DATA_PURITY',
  'ESTIMATEONLY',
  'EXTENDED_LOGICAL_CHECKS',
  'HISTOGRAM',
  'MAXDOP',
  'NO_INFOMSGS',
  'NOINDEX',
  'PHYSICAL_ONLY',
  'STAT_IO',
  'STAT_TIME',
  'TABLERESULT',
  'TABLERESULTS',
] as const;

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

/**
 * 已经输入 `schema.` 时去掉对象名里的同名前缀（MSSQL 非 dbo 对象的 name 是
 * `schema.table`）。避免把 `sys.` + `sys.tables` 插成 `sys.sys.tables`。
 */
export function stripSchemaPrefix(name: string, schema: string): string {
  const prefix = `${schema}.`;
  return name.toLowerCase().startsWith(prefix.toLowerCase())
    ? name.slice(prefix.length)
    : name;
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

/** 语句内扫描状态；用于跳过字符串/注释里的 `;`、FROM 等。 */
type ScanMode = 'normal' | 'single' | 'double' | 'backtick' | 'bracket' | 'line' | 'block';

interface SqlScanResult {
  /** 字符串/注释内容替换成空格后的文本，长度与原文一致。 */
  masked: string;
  /** 光标处状态；非 normal 表示在字符串/注释/引号标识符内。 */
  mode: ScanMode;
  /** 光标处括号深度。 */
  depth: number;
  /** 光标所在语句的起止偏移（不含分号）。 */
  statementStart: number;
  statementEnd: number;
}

function scanSql(text: string, cursor: number): SqlScanResult {
  const length = text.length;
  const masked = text.split('');
  let mode: ScanMode = 'normal';
  let depth = 0;
  let cursorMode: ScanMode = 'normal';
  let cursorDepth = 0;
  let statementStart = 0;
  let statementEnd = length;
  let endFound = false;

  const blank = (index: number) => {
    if (masked[index] !== '\n') masked[index] = ' ';
  };

  for (let index = 0; index < length; index += 1) {
    if (index === cursor) {
      cursorMode = mode;
      cursorDepth = depth;
    }
    const char = text[index]!;
    const next = text[index + 1];

    if (mode === 'single') {
      blank(index);
      if (char === '\\' && next !== undefined) {
        blank(index + 1);
        index += 1;
      } else if (char === "'" && next === "'") {
        blank(index + 1);
        index += 1;
      } else if (char === "'") {
        mode = 'normal';
      }
      continue;
    }
    if (mode === 'double') {
      // 双引号在不同方言里可能是字符串或标识符；保留内容让 FROM "users" 仍可解析。
      if (char === '"' && next === '"') {
        index += 1;
      } else if (char === '"') {
        mode = 'normal';
      }
      continue;
    }
    if (mode === 'backtick') {
      if (char === '`') mode = 'normal';
      continue;
    }
    if (mode === 'bracket') {
      if (char === ']' && next === ']') {
        index += 1;
      } else if (char === ']') {
        mode = 'normal';
      }
      continue;
    }
    if (mode === 'line') {
      blank(index);
      if (char === '\n') mode = 'normal';
      continue;
    }
    if (mode === 'block') {
      blank(index);
      if (char === '*' && next === '/') {
        blank(index + 1);
        mode = 'normal';
        index += 1;
      }
      continue;
    }

    // normal
    if (char === "'") {
      mode = 'single';
      blank(index);
    } else if (char === '"') {
      mode = 'double';
      blank(index);
    } else if (char === '`') {
      mode = 'backtick';
      blank(index);
    } else if (char === '[') {
      mode = 'bracket';
      blank(index);
    } else if (char === '-' && next === '-') {
      mode = 'line';
      blank(index);
      blank(index + 1);
      index += 1;
    } else if (char === '/' && next === '*') {
      mode = 'block';
      blank(index);
      blank(index + 1);
      index += 1;
    } else if (char === '(') {
      depth += 1;
    } else if (char === ')') {
      depth = Math.max(0, depth - 1);
    } else if (char === ';') {
      if (index < cursor) {
        statementStart = index + 1;
      } else if (!endFound) {
        statementEnd = index;
        endFound = true;
      }
    }
  }
  if (cursor >= length) {
    cursorMode = mode;
    cursorDepth = depth;
  }

  return {
    masked: masked.join(''),
    mode: cursorMode,
    depth: cursorDepth,
    statementStart,
    statementEnd,
  };
}

/** 把 `FROM/JOIN/UPDATE/INTO` 后面的表引用（含逗号列表、别名）解析出来。 */
function parseTables(statement: string): TableReference[] {
  const tables: TableReference[] = [];
  const relation = /\b(FROM|JOIN|UPDATE|INTO)\b/gi;
  const stop =
    /\b(?:WHERE|ON|JOIN|INNER|LEFT|RIGHT|FULL|CROSS|GROUP|ORDER|HAVING|LIMIT|OFFSET|UNION|EXCEPT|INTERSECT|SET|VALUES|RETURNING|WINDOW|FOR|OPTION|OUTPUT)\b/i;
  const token =
    /^([`"\[]?[\w$#@]+[`"\]]?(?:\s*\.\s*[`"\[]?[\w$#@]+[`"\]]?){0,2})(?:\s+(?:AS\s+)?([A-Za-z_][\w$]*))?/i;

  for (const relationMatch of statement.matchAll(relation)) {
    const segmentStart = (relationMatch.index ?? 0) + relationMatch[0].length;
    const rest = statement.slice(segmentStart);
    const stopMatch = stop.exec(rest);
    const segment = stopMatch ? rest.slice(0, stopMatch.index) : rest;

    // 顶级逗号分表；括号内的子查询/列清单不拆。
    const items: string[] = [];
    let depth = 0;
    let current = '';
    for (const char of segment) {
      if (char === '(') depth += 1;
      else if (char === ')') depth = Math.max(0, depth - 1);
      if (char === ',' && depth === 0) {
        items.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    if (current.trim()) items.push(current);

    for (const item of items) {
      const trimmed = item.trim();
      if (!trimmed || trimmed.startsWith('(')) continue;
      const parsed = token.exec(trimmed);
      if (!parsed) continue;
      const raw = parsed[1] ?? '';
      const parts = splitIdentifier(raw);
      if (parts.length === 0) continue;
      const aliasCandidate = parsed[2] ?? '';
      const alias = aliasCandidate && !isKeyword(aliasCandidate) ? aliasCandidate : undefined;
      const table = parts[parts.length - 1]!;
      const schema = parts.length >= 3 ? parts[parts.length - 2] : undefined;
      const database = parts.length >= 3 ? parts[0] : undefined;
      tables.push({
        raw: raw.replace(/\s+/g, ''),
        parts,
        table,
        ...(schema ? { schema } : {}),
        ...(database ? { database } : {}),
        ...(alias ? { alias } : {}),
      });
    }
  }
  return tables;
}

function clauseAt(statement: string): string {
  const matches = statement.match(
    /\b(SELECT|FROM|JOIN|WHERE|ON|SET|GROUP\s+BY|ORDER\s+BY|HAVING|LIMIT|OFFSET|FETCH|VALUES|UPDATE|INSERT|INTO|RETURNING|EXEC|EXECUTE|USE)\b/gi,
  );
  return (matches?.[matches.length - 1] ?? '').replace(/\s+/g, ' ').toLowerCase();
}

/**
 * 找 SELECT 列表里的通配符：光标在 `*` 上或紧跟其后，且不在括号内。
 * 只接受 `SELECT *` / `SELECT DISTINCT *` / `SELECT a, *` 这类位置，避免把乘号当通配符。
 */
function wildcardStarIndex(text: string, cursor: number, depth: number): number | null {
  if (depth !== 0) return null;
  let star = -1;
  if (text[cursor] === '*') {
    star = cursor;
  } else {
    let index = cursor - 1;
    while (index >= 0 && /\s/.test(text[index]!)) index -= 1;
    if (text[index] === '*') star = index;
  }
  if (star < 0) return null;

  let before = star - 1;
  while (before >= 0 && /\s/.test(text[before]!)) before -= 1;
  if (before < 0) return star;
  if (text[before] === ',' || text[before] === '(') return star;
  let wordStart = before;
  while (wordStart >= 0 && /[A-Za-z_]/.test(text[wordStart]!)) wordStart -= 1;
  const word = text.slice(wordStart + 1, before + 1).toLowerCase();
  return ['select', 'distinct', 'all', 'top'].includes(word) ? star : null;
}

/**
 * 光标是否位于 `INSERT INTO <table> (` 的列清单里。
 * 只检查光标前最近的未闭合左括号，并要求它前面紧邻 `INSERT [OR ...] INTO <表名>`，
 * 避免把函数、子查询、`VALUES (` 里的括号误判成列清单。
 */
function insertColumnTable(
  maskedBefore: string,
  originalBefore: string,
): TableReference | null {
  let depth = 0;
  let open = -1;
  for (let index = maskedBefore.length - 1; index >= 0; index -= 1) {
    const char = maskedBefore[index];
    if (char === ')') {
      depth += 1;
    } else if (char === '(') {
      if (depth === 0) {
        open = index;
        break;
      }
      depth -= 1;
    }
  }
  if (open < 0) return null;

  // 括号位置用掩码文本找（避免字符串/注释里的括号），表名用原文取
  // （掩码会把 `[` 等引号吃掉，导致 `[dbo].[users]` 被拆成多段）。
  const before = originalBefore.slice(0, open);
  const match =
    /(?:^|[;\n])\s*insert\s+(?:ignore\s+|or\s+(?:replace|ignore)\s+)?into\s+([`"\[\]\w$#.]+)\s*$/i.exec(
      before,
    );
  if (!match) return null;

  const raw = match[1]!.replace(/\s+/g, '');
  const parts = splitIdentifier(raw);
  if (parts.length === 0) return null;
  const table = parts[parts.length - 1]!;
  const schema = parts.length >= 3 ? parts[parts.length - 2] : undefined;
  const database = parts.length >= 3 ? parts[0] : undefined;
  return {
    raw,
    parts,
    table,
    ...(schema ? { schema } : {}),
    ...(database ? { database } : {}),
  };
}

export function extractCompletionContext(
  text: string,
  cursor: number,
  dialect?: SqlDialect | null,
  analyze?: StatementAnalyzer,
): CompletionContext {
  const safeCursor = Math.max(0, Math.min(cursor, text.length));
  let start = safeCursor;
  // 引号标识符（`[a]` / `` `a` ``）也算标识符片段，便于 `[dbo].[us` 这种限定名。
  while (start > 0 && /[A-Za-z0-9_$\u0080-\uffff.\[\]`]/.test(text[start - 1]!)) {
    start -= 1;
  }
  let prefix = text.slice(start, safeCursor);
  const dot = prefix.lastIndexOf('.');
  let qualifier = dot >= 0 ? prefix.slice(0, dot) : '';
  let needle = dot >= 0 ? prefix.slice(dot + 1) : prefix;
  let replaceStart = start + (dot >= 0 ? dot + 1 : 0);

  const scan = scanSql(text, safeCursor);
  const statement = text.slice(scan.statementStart, scan.statementEnd);
  const maskedStatement = scan.masked.slice(scan.statementStart, scan.statementEnd);
  const maskedBefore = scan.masked.slice(scan.statementStart, safeCursor);
  const literalModes: ScanMode[] = ['single', 'double', 'line', 'block'];
  const inLiteral = literalModes.includes(scan.mode);
  const star = wildcardStarIndex(text, safeCursor, scan.depth);
  let replaceEnd = safeCursor;
  if (star !== null && !inLiteral) {
    prefix = '';
    qualifier = '';
    needle = '';
    replaceStart = star;
    replaceEnd = star + 1;
  } else if (scan.mode === 'bracket' || scan.mode === 'backtick') {
    // 在 `[us` / `` `us` `` 内补全：连开引号一起替换，插入时带完整引号。
    const quote = scan.mode === 'bracket' ? '[' : '`';
    const closeQuote = scan.mode === 'bracket' ? ']' : '`';
    const segmentStart = start + (dot >= 0 ? dot + 1 : 0);
    if (text[segmentStart] === quote) {
      replaceStart = segmentStart;
      if (needle.startsWith(quote)) needle = needle.slice(1);
      replaceEnd = safeCursor + (text[safeCursor] === closeQuote ? 1 : 0);
    }
  }

  const insertTable = inLiteral
    ? null
    : insertColumnTable(maskedBefore, text.slice(scan.statementStart, safeCursor));
  // 宿主注入 AST 时优先取表/别名；解析失败（输入中的语句很常见）回退到扫描。
  const analyzed = dialect && analyze ? analyze(statement, dialect) : null;
  const tables =
    analyzed && analyzed.tables.length > 0 ? analyzed.tables : parseTables(maskedStatement);
  // DBCC 子命令只在「DBCC + 空白」或「DBCC + 正在输入的第一个词」时提示；
  // 子命令后已有空格/参数时不再重复给命令列表。
  const dbccContext =
    /\bDBCC\s*$/i.test(maskedBefore) ||
    /\bDBCC\s+[A-Za-z_][\w$]*$/i.test(maskedBefore);
  const dbccWithContext =
    /\bDBCC\s+[A-Za-z_][\w$]*\s+WITH\s*$/i.test(maskedBefore) ||
    /\bDBCC\s+[A-Za-z_][\w$]*\s+WITH\s+[A-Za-z_][\w$]*$/i.test(maskedBefore);

  return {
    prefix,
    start,
    needle,
    qualifier,
    replaceStart,
    replaceEnd,
    statement,
    statementStart: scan.statementStart,
    tables,
    clause: dbccContext
      ? 'dbcc'
      : dbccWithContext
        ? 'dbcc-with'
        : clauseAt(maskedBefore),
    wildcard: star !== null,
    inLiteral,
    depth: scan.depth,
    insertColumnList: insertTable !== null,
    ...(insertTable ? { insertTable } : {}),
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

export interface CompletionRankOptions {
  /** 光标上下文；用于子句期望、qualifier 与所属表加减权。 */
  context?: CompletionContext;
  /** 最多返回的候选数；默认 50。 */
  limit?: number;
}

/**
 * 补全结果条数上限。
 *
 * - 普通位置（关键字/列/表混排）保持 50 条，避免列表过长；
 * - 限定符补全（`sys.`、`dbo.`、`u.`）必须给全量候选，否则按名称排序靠后
 *   的对象会被截断（例如 `sys.databases` 在 `sys.` 列表里排第 60 位，
 *   默认 50 条时完全看不到）。CodeMirror 只渲染可视窗口，条数多不会卡 UI。
 */
export function completionResultLimit(context: CompletionContext): number {
  return context.qualifier ? 2000 : 50;
}

/**
 * 带排序的补全过滤：
 * - 有前缀命中（含完全相等）时只保留前缀命中，不再混入词首/子序列候选；
 * - 例外：多段输入（含 `_`）按段命中时保留，例如 `dm_sql` → `dm_exec_sql_text`；
 *   限定符补全下单段也按段命中，例如 `sys.sql` → `dm_exec_sql_text`；
 * - 没有前缀命中时才回退到「单词开头 > 模糊子序列」；
 * - 匹配质量 > 类型权重（列 > 别名 > 表 > 视图 > 存储过程 > Schema > 库 > 函数 > 关键字）；
 * - `boost` 参与加权（正数提前、负数降权），`priority` 只在同分时作为稳定次序；
 * - 传入 `context` 时，再叠加子句期望、列所属表、qualifier/schema 匹配与 JOIN ON 主键权重；
 * - 同一标签只保留分数最高的一项；
 * - 返回匹配字符下标，供弹层高亮。
 */
export function rankCompletions(
  candidates: CompletionCandidate[],
  needle: string,
  options: CompletionRankOptions = {},
): RankedCompletion[] {
  const query = needle.trim().toLowerCase();
  const limit = options.limit ?? 50;
  const rankContext = describeRankContext(options.context);
  const ranked: RankedCompletion[] = [];

  for (const candidate of candidates) {
    const label = candidate.label.trim();
    if (!label) continue;

    const lower = label.toLowerCase();
    let matches: number[] = [];
    if (!query) {
      // 无前缀时全部保留，按类型权重与字母序排列。
    } else if (lower === query) {
      matches = Array.from({ length: Math.min(label.length, query.length) }, (_, index) => index);
    } else if (lower.startsWith(query)) {
      matches = Array.from({ length: query.length }, (_, index) => index);
    } else {
      const subsequence = matchSubsequence(lower, query);
      if (!subsequence) continue;
      matches = subsequence;
    }

    ranked.push({
      ...candidate,
      label,
      matches,
    });
  }

  const priorityOf = (item: RankedCompletion) =>
    item.priority ?? completionKindPriority(item.kind);
  // 限定符补全时允许单段命中文档中的某个词段：`sys.sql` → `dm_exec_sql_text`。
  // 非限定符输入仍保持严格前缀，避免 `se` → `user_sessions` 的噪音。
  const allowSegmentSingle = Boolean(options.context?.qualifier);
  const scored = ranked.map((item) => {
    const tier = matchTier(item, query);
    // 多段前缀：`dm_sql` 命中 `dm_exec_sql_text` 的 `dm` + `sql` 两段。
    const segment =
      tier > 1 &&
      matchSegmentPrefix(item.label.toLowerCase(), query, allowSegmentSingle);
    return {
      item,
      tier,
      segment,
      score:
        matchScore(tier) +
        (segment ? 900 : 0) +
        completionKindScore(item.kind) +
        (item.boost ?? 0) +
        contextScore(item, rankContext),
    };
  });
  let visible = scored;
  if (query.length > 0) {
    // 严格前缀：只要存在完全相等/前缀命中，就丢掉词首与子序列命中。否则输入
    // `se` 时 `users`（u-s-e-r-s）会排在列表末尾，候选随每次按键跳动。
    // 例外：多段输入（`dm_sql`）或限定符下单段（`sys.sql`）命中了对象
    // 的后段（`dm_exec_sql_text`），保留候选并排在真正前缀之后。
    const hasPrefixMatch = scored.some((entry) => entry.tier <= 1);
    if (hasPrefixMatch) {
      visible = scored.filter((entry) => entry.tier <= 1 || entry.segment);
    } else {
      // 一个前缀都没有时才启用模糊兜底；仍有词首命中时，过滤纯子序列的
      // 关键字/函数噪音（例如 `na` 不再列出 CURRENT_TIMESTAMP）。
      const hasWordStart = scored.some((entry) => entry.tier === 2);
      if (hasWordStart) {
        visible = scored.filter(
          (entry) =>
            !(
              entry.tier === 3 &&
              (entry.item.kind === 'keyword' || entry.item.kind === 'function')
            ),
        );
      }
    }
  }
  const isCommonKeyword = (item: RankedCompletion) =>
    item.kind === 'keyword' &&
    COMMON_KEYWORDS.has(item.label.toUpperCase());
  visible.sort((left, right) => {
    if (left.score !== right.score) return right.score - left.score;
    const priority = priorityOf(left.item) - priorityOf(right.item);
    if (priority !== 0) return priority;
    // 关键字之间：SELECT/FROM/WHERE 等常用词优先于 FREE/FREETEXT 等低频词。
    const common =
      Number(isCommonKeyword(right.item)) - Number(isCommonKeyword(left.item));
    if (common !== 0) return common;
    return left.item.label.localeCompare(right.item.label, 'en');
  });
  // 同一标签只保留分数最高的一项（排序后先到先得），避免异步元数据与
  // 基础候选重复时把低分项留在列表里。
  const seen = new Set<string>();
  const result: RankedCompletion[] = [];
  const cap = Math.max(1, limit);
  for (const entry of visible) {
    const key = entry.item.label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(entry.item);
    if (result.length >= cap) break;
  }
  return result;
}

/** 匹配层级：0 完全相等，1 前缀，2 词首子序列，3 任意子序列，4 无输入。 */
function matchTier(item: RankedCompletion, query: string): number {
  if (!query) return 4;
  const lower = item.label.toLowerCase();
  if (lower === query) return 0;
  if (lower.startsWith(query)) return 1;
  const wordStarts = item.matches.every(
    (index) => index === 0 || !/[A-Za-z0-9]/.test(lower[index - 1] ?? ''),
  );
  return wordStarts ? 2 : 3;
}

/** 匹配质量权重：远大于类型与上下文权重，保证 exact > prefix > 模糊。 */
function matchScore(tier: number): number {
  switch (tier) {
    case 0:
      return 2000;
    case 1:
      return 1600;
    case 2:
      return 600;
    case 3:
      return 200;
    default:
      return 0;
  }
}

/** 类型权重：列 > 别名 > 表 > 视图 > 存储过程 > Schema > 库 > 函数 > 关键字。 */
function completionKindScore(kind: CompletionKind): number {
  switch (kind) {
    case 'column':
      return 120;
    case 'alias':
      return 110;
    case 'table':
      return 100;
    case 'view':
      return 95;
    case 'procedure':
      return 85;
    case 'schema':
      return 60;
    case 'database':
      return 50;
    case 'function':
      return 30;
    default:
      return 10;
  }
}

interface RankContextInfo {
  expectation: CompletionExpectation;
  mentionedTables: Set<string>;
  qualifier: string;
  qualifierTable?: string;
  qualifierSchema?: string;
}

function describeRankContext(context: CompletionContext | undefined): RankContextInfo | null {
  if (!context) return null;
  const mentionedTables = new Set(
    context.tables
      .map((table) => table.table.toLowerCase())
      .filter(Boolean),
  );
  const qualifier = context.qualifier.trim().toLowerCase();
  let qualifierTable: string | undefined;
  let qualifierSchema: string | undefined;
  if (qualifier) {
    for (const table of context.tables) {
      const tableName = table.table.toLowerCase();
      if (
        table.alias?.toLowerCase() === qualifier ||
        tableName === qualifier ||
        table.parts.join('.').toLowerCase() === qualifier
      ) {
        qualifierTable = tableName;
      }
      if (table.schema?.toLowerCase() === qualifier) qualifierSchema = qualifier;
      if (table.database?.toLowerCase() === qualifier) qualifierSchema = qualifier;
    }
  }
  return {
    expectation: completionExpectation(context),
    mentionedTables,
    qualifier,
    qualifierTable,
    qualifierSchema,
  };
}

/** 上下文加权：子句期望、列所属表、qualifier/schema 匹配、JOIN ON 主键。 */
function contextScore(candidate: CompletionCandidate, info: RankContextInfo | null): number {
  if (!info) return 0;
  let score = 0;
  const { expectation } = info;
  switch (candidate.kind) {
    case 'column':
      score += expectation.columns ? 40 : -20;
      if (expectation.joinOn && candidate.primaryKey) score += 40;
      break;
    case 'alias':
      score += expectation.columns ? 40 : -10;
      break;
    case 'table':
    case 'view':
      score += expectation.tables ? 40 : -30;
      break;
    case 'procedure':
      score += expectation.procedures ? 40 : -30;
      break;
    case 'function':
      score += expectation.columns ? 20 : -10;
      break;
    case 'schema':
      score += expectation.schemas ? 20 : -10;
      break;
    case 'database':
      score += expectation.databases ? 20 : -10;
      break;
    default:
      break;
  }
  const table = candidate.table?.toLowerCase();
  if (table) {
    if (info.mentionedTables.has(table)) score += 60;
    if (info.qualifierTable && table === info.qualifierTable) score += 120;
    if (info.qualifier && table === info.qualifier) score += 80;
  }
  const schema = candidate.schema?.toLowerCase();
  if (schema && info.qualifier) {
    if (schema === info.qualifier) score += 80;
    else if (info.qualifierSchema && schema === info.qualifierSchema) score += 60;
  }
  return score;
}

export interface ForeignKeyJoinReference {
  /** 当前语句里已引用的源表。 */
  table: string;
  columns: string[];
  /** 外键指向的表。 */
  referencedTable: string;
  referencedColumns: string[];
}

/**
 * 从已引用表的外键里挑选可 JOIN 的目标表：跳过语句已引用的表，按目标表
 * 去重（保留第一组外键用于展示）。
 */
export function foreignKeyJoinTargets(
  references: ForeignKeyJoinReference[],
  referencedTables: readonly string[],
): ForeignKeyJoinReference[] {
  const referenced = new Set(
    referencedTables
      .map((name) => name.split('.').pop()?.toLowerCase() ?? '')
      .filter(Boolean),
  );
  const seen = new Set<string>();
  const result: ForeignKeyJoinReference[] = [];
  for (const reference of references) {
    const target = reference.referencedTable.split('.').pop()?.toLowerCase() ?? '';
    if (!target || referenced.has(target) || seen.has(target)) continue;
    seen.add(target);
    result.push(reference);
  }
  return result;
}

/**
 * 从外键里挑选可写成 `ON` 等式的关系：目标表必须在当前语句中已引用，
 * 跳过自引用，并按 源表 + 目标表 + 列对 去重。
 */
export function foreignKeyEqualities(
  references: ForeignKeyJoinReference[],
  referencedTables: readonly string[],
): ForeignKeyJoinReference[] {
  const lastOf = (name: string) => name.split('.').pop()?.toLowerCase() ?? '';
  const referenced = new Set(referencedTables.map(lastOf).filter(Boolean));
  const seen = new Set<string>();
  const result: ForeignKeyJoinReference[] = [];
  for (const reference of references) {
    const source = lastOf(reference.table);
    const target = lastOf(reference.referencedTable);
    if (!source || !target || source === target || !referenced.has(target)) continue;
    const key = `${source}:${target}:${reference.columns.join(',')}:${reference.referencedColumns.join(',')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(reference);
  }
  return result;
}

/** 为 JOIN 目标表生成不冲突的短别名（首字符 + 序号，例如 orders → o1）。 */
export function suggestJoinAlias(
  tableName: string,
  usedAliases: Iterable<string>,
): string {
  const bare =
    tableName
      .split('.')
      .pop()
      ?.replace(/^["`\[]|["`\]]$/g, '')
      .toLowerCase() ?? tableName.toLowerCase();
  const base = bare.match(/[a-z]/)?.[0] ?? 't';
  const used = new Set(Array.from(usedAliases, (alias) => alias.toLowerCase()));
  for (let index = 1; index < 1000; index += 1) {
    const alias = `${base}${index}`;
    if (!used.has(alias)) return alias;
  }
  return `${base}${Date.now()}`;
}

/** 拼 `a.col = b.col [AND ...]`；`referencedColumns` 缺失时回退同名列。 */
export function buildJoinCondition(
  sourceRef: string,
  targetRef: string,
  columns: readonly string[],
  referencedColumns: readonly string[],
): string {
  return columns
    .map((column, index) => {
      const referenced = referencedColumns[index] || column;
      return `${sourceRef}.${column} = ${targetRef}.${referenced}`;
    })
    .join(' AND ');
}

/**
 * FROM/INTO/UPDATE 等位置不重复提示语句里已经引用的表；JOIN 允许自连接，
 * 不排除。只过滤表/视图候选，列、别名、Schema、库等原样保留。
 */
export function excludeReferencedTables(
  candidates: CompletionCandidate[],
  context: CompletionContext,
): CompletionCandidate[] {
  if (!['from', 'into', 'update', 'table', 'view'].includes(context.clause)) {
    return candidates;
  }
  // 光标正在编辑的标识符可能正是语句里已有的表名（例如把光标放到
  // `sys.databases` 的 `sys.` 后面）。此时不能按“已引用”排除，否则当前
  // 对象自己反而没有候选；只排除与正在输入的 token 无关的表。
  const typing = context.prefix.trim().toLowerCase();
  const referenced = new Set(
    context.tables
      .filter((table) => {
        if (!typing) return true;
        const raw = table.raw.toLowerCase();
        const qualified = table.parts.join('.').toLowerCase();
        return !(raw.startsWith(typing) || qualified.startsWith(typing));
      })
      .map((table) => table.table.toLowerCase())
      .filter(Boolean),
  );
  if (referenced.size === 0) return candidates;
  return candidates.filter((candidate) => {
    if (candidate.kind !== 'table' && candidate.kind !== 'view') return true;
    const last = candidate.label.split('.').pop()?.toLowerCase() ?? '';
    return !referenced.has(last);
  });
}

/**
 * 词段前缀匹配：按 `_` 切分输入。
 *
 * - 多段输入（`dm_sql`）：首段必须命中候选名字第一段，后续段按顺序命中候选
 *   的某个段前缀，例如 `dm_sql` 命中 `dm_exec_sql_text`；
 * - 单段输入默认不启用（保持严格前缀）；只有限定符补全传入
 *   `allowSingleSegment` 时才允许，例如 `sys.sql` 命中 `dm_exec_sql_text`。
 */
function matchSegmentPrefix(
  value: string,
  query: string,
  allowSingleSegment = false,
): boolean {
  const querySegments = query.split('_').filter(Boolean);
  if (querySegments.length === 0) return false;
  // 单段输入默认不走段匹配（避免 `se` 命中 `user_sessions` 这类噪音）；
  // 限定符补全（`sys.`/`别名.`）下允许，例如 `sys.sql` → `dm_exec_sql_text`。
  if (querySegments.length === 1 && !allowSingleSegment) return false;
  const valueSegments = value.split('_');
  let cursor = 0;
  for (let index = 0; index < querySegments.length; index += 1) {
    const segment = querySegments[index]!;
    let found = -1;
    for (let position = cursor; position < valueSegments.length; position += 1) {
      if (valueSegments[position]!.startsWith(segment)) {
        found = position;
        break;
      }
    }
    // 多段输入的首段必须命中名字第一段，避免 `sql_text` 把任意中间段当成开头。
    if (
      found < 0 ||
      (index === 0 && querySegments.length > 1 && found !== 0)
    ) {
      return false;
    }
    cursor = found + 1;
  }
  return true;
}

/** 贪心匹配子序列，优先命中单词开头，返回命中的字符下标；匹配失败返回 null。 */
function matchSubsequence(value: string, query: string): number[] | null {
  const indices: number[] = [];
  let position = 0;
  for (const char of query) {
    let found = -1;
    for (let index = position; index < value.length; index += 1) {
      if (value[index] !== char) continue;
      const boundary = index === 0 || !/[A-Za-z0-9]/.test(value[index - 1] ?? '');
      if (boundary) {
        found = index;
        break;
      }
    }
    if (found < 0) found = value.indexOf(char, position);
    if (found < 0) return null;
    indices.push(found);
    position = found + 1;
  }
  return indices;
}


/** 补全大小写跟随输入：
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

/** 输入空格后，若刚输入的是期望对象名/列名的关键字，则自动打开补全。 */
export function shouldAutoTriggerCompletion(text: string, cursor: number): boolean {
  const before = text.slice(0, Math.max(0, Math.min(cursor, text.length)));
  // JOIN ... ON 需要列补全；CREATE INDEX ... ON 需要表补全，所以 ON 只在 JOIN 语句里自动触发。
  if (/\bON\s+$/i.test(before) && /\bJOIN\b/i.test(before)) return true;
  // DBCC ... WITH 后给常用选项。
  if (/\bDBCC\b[\s\S]*\bWITH\s+$/i.test(before)) return true;
  return /(?:^|[^\w])(SELECT|DISTINCT|FROM|JOIN|INTO|UPDATE|TABLE|VIEW|EXEC|EXECUTE|USE|SET|WHERE|HAVING|ORDER\s+BY|GROUP\s+BY|DBCC)\s+$/i.test(
    before,
  );
}

/** 每次输入后判断是否应自动弹补全（含普通单词输入）。 */
export function shouldOpenCompletionOnInput(
  text: string,
  cursor: number,
  options: { inserted?: boolean; context?: CompletionContext } = {},
): boolean {
  const safeCursor = Math.max(0, Math.min(cursor, text.length));
  // PRD §4.2.4：超长 SQL 禁用补全，避免每次输入都做全量扫描。
  if (text.length > 1_000_000) return false;
  const typed = text[safeCursor - 1] ?? '';
  // 编辑器已经算过上下文时直接复用，避免每次输入重复扫描整条语句。
  const context = options.context ?? extractCompletionContext(text, safeCursor);
  // 字符串/注释内不自动弹补全（手动 Ctrl+Space 也由编辑器按 inLiteral 拦掉）。
  if (context.inLiteral) return false;
  if (typed === '.') return true;
  if (shouldAutoTriggerCompletion(text, safeCursor)) return true;
  if (options.inserted === false) return false;
  const beforeCursor = text.slice(0, safeCursor);
  const afterSeparator = /,\s*$/.test(beforeCursor);
  // INSERT \u5217\u6e05\u5355\uff1a\u8f93\u5165 `(`\u3001\u9017\u53f7\u6216\u9017\u53f7\u540e\u7684\u7a7a\u767d/\u6362\u884c\u540e\u90fd\u7ed9\u5217\u3002
  if (
    context.insertColumnList &&
    (typed === '(' ||
      typed === ',' ||
      (/\s/.test(typed) && (afterSeparator || /\(\s*$/.test(beforeCursor))))
  ) {
    return true;
  }
  // \u9017\u53f7\u540e\u7eed\u5217\u8868\uff1aSELECT \u5217\u3001FROM \u591a\u8868\u3001WHERE/ORDER BY \u591a\u5217\u7b49\u3002
  if (
    afterSeparator &&
    [
      'select',
      'from',
      'join',
      'update',
      'into',
      'where',
      'on',
      'set',
      'order by',
      'group by',
      'having',
    ].includes(context.clause)
  ) {
    return true;
  }
  if (!/[A-Za-z0-9_$\u0080-\uffff]/.test(typed)) return false;
  return context.needle.length > 0;
}

/**
 * 用补全项替换 [start, end) 区间，返回新文本与光标位置。
 * 传 `options.insertText` 时原样插入（标识符已按方言加引号），不再改写大小写。
 */
export function applyCompletion(
  text: string,
  start: number,
  end: number,
  completion: string,
  options: { insertText?: string } = {},
): { text: string; cursor: number } {
  const safeStart = Math.max(0, Math.min(start, text.length));
  const safeEnd = Math.max(safeStart, Math.min(end, text.length));
  const typed = text.slice(safeStart, safeEnd);
  const value =
    options.insertText !== undefined
      ? options.insertText
      : matchCompletionCase(completion, typed);
  const next = `${text.slice(0, safeStart)}${value}${text.slice(safeEnd)}`;
  return { text: next, cursor: safeStart + value.length };
}
