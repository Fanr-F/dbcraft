import type { Parser as SqlParser } from 'node-sql-parser';
import type { DatabaseType } from '../../../shared/ipc-contract';

/**
 * 用 node-sql-parser（ANTLR/peg 语法）补强语句分析：表引用、别名、CTE。
 *
 * 补全发生在用户输入过程中，语句经常是不完整的；解析失败时返回 null，
 * 调用方必须回退到原有的正则/扫描实现。
 */

export interface AnalyzedTable {
  /** 原样（去引号）的限定名，例如 `dbo.users`。 */
  raw: string;
  /** `['db', 'schema', 'table']` 的分段。 */
  parts: string[];
  /** 最后一段表名。 */
  table: string;
  /** MSSQL/PostgreSQL 的 schema。 */
  schema?: string;
  /** MySQL/SQLite 或三段式 MSSQL/PostgreSQL 的数据库。 */
  database?: string;
  /** 表别名。 */
  alias?: string;
}

export interface AnalyzedCte {
  name: string;
  /** 声明的列或从 SELECT 列表推导出的输出列。 */
  columns: string[];
}

export interface StatementAnalysis {
  tables: AnalyzedTable[];
  ctes: AnalyzedCte[];
}

type ParserDialect = 'mysql' | 'postgresql' | 'sqlite' | 'transactsql';
type ParserConstructor = new () => SqlParser;

type JsonRecord = Record<string, unknown>;

type ParserModule = {
  default?: { Parser?: ParserConstructor };
  Parser?: ParserConstructor;
};

/**
 * 每个方言单独懒加载，避免把 node-sql-parser 的全部方言打进主包。
 * 解析器加载完成前补全走原有扫描实现，加载完成后自动切换。
 */
const loaders: Record<ParserDialect, () => Promise<ParserConstructor>> = {
  mysql: async () => {
    const module = (await import('node-sql-parser/build/mysql.js')) as unknown as ParserModule;
    return (module.default?.Parser ?? module.Parser)!;
  },
  postgresql: async () => {
    const module = (await import(
      'node-sql-parser/build/postgresql.js'
    )) as unknown as ParserModule;
    return (module.default?.Parser ?? module.Parser)!;
  },
  sqlite: async () => {
    const module = (await import('node-sql-parser/build/sqlite.js')) as unknown as ParserModule;
    return (module.default?.Parser ?? module.Parser)!;
  },
  transactsql: async () => {
    const module = (await import(
      'node-sql-parser/build/transactsql.js'
    )) as unknown as ParserModule;
    return (module.default?.Parser ?? module.Parser)!;
  },
};

const parsers = new Map<ParserDialect, SqlParser>();
const loading = new Map<ParserDialect, Promise<void>>();
const cache = new Map<string, StatementAnalysis | null>();
const CACHE_LIMIT = 80;

function parserDialect(dialect: DatabaseType | null | undefined): ParserDialect | null {
  switch (dialect) {
    case 'mysql':
    case 'percona':
    case 'mariadb':
      return 'mysql';
    case 'sqlite':
      return 'sqlite';
    case 'mssql':
      return 'transactsql';
    default:
      return null;
  }
}

function loadParser(dialect: ParserDialect): Promise<void> {
  const existing = loading.get(dialect);
  if (existing) return existing;
  const promise = loaders[dialect]()
    .then((Parser) => {
      parsers.set(dialect, new Parser());
    })
    .catch(() => undefined)
    .finally(() => {
      loading.delete(dialect);
    });
  loading.set(dialect, promise);
  return promise;
}

/** 预加载某个方言的解析器；在方言切换时调用，首次补全即可用 AST。 */
export function warmUpSqlAnalysis(dialect: DatabaseType | null | undefined): Promise<void> {
  const target = parserDialect(dialect);
  if (!target || parsers.has(target)) return Promise.resolve();
  return loadParser(target);
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 从标识符/列引用 AST 里取文本；兼容 `{value}`、`{column}` 与 `{column:{expr}}`。 */
function textValue(value: unknown): string | null {
  if (typeof value === 'string') return value.length > 0 ? value : null;
  if (!isRecord(value)) return null;
  if (typeof value.value === 'string' && value.value.length > 0) return value.value;
  const column = value.column;
  if (typeof column === 'string' && column.length > 0) return column;
  if (isRecord(column)) {
    const expr = column.expr;
    if (isRecord(expr) && typeof expr.value === 'string' && expr.value.length > 0) {
      return expr.value;
    }
  }
  return null;
}

function tableKey(table: AnalyzedTable): string {
  return `${table.parts.join('.').toLowerCase()}::${table.alias?.toLowerCase() ?? ''}`;
}

function pushTable(
  entry: JsonRecord,
  dialect: ParserDialect,
  out: StatementAnalysis,
  seen: Set<string>,
): void {
  if (typeof entry.table !== 'string' || entry.table.length === 0) return;
  const table = entry.table;
  const alias =
    typeof entry.as === 'string' && entry.as.length > 0 ? entry.as : undefined;
  const db = typeof entry.db === 'string' && entry.db.length > 0 ? entry.db : undefined;
  const schemaName =
    typeof entry.schema === 'string' && entry.schema.length > 0
      ? entry.schema
      : undefined;

  let parts: string[];
  let schema: string | undefined;
  let database: string | undefined;
  if (dialect === 'transactsql' || dialect === 'postgresql') {
    // 两段式是 schema.table，三段式是 database.schema.table。
    if (db && schemaName) {
      parts = [db, schemaName, table];
      schema = schemaName;
      database = db;
    } else if (db) {
      parts = [db, table];
      schema = db;
    } else {
      parts = [table];
    }
  } else {
    // MySQL/SQLite 的 db 是数据库（SQLite 为 main/temp/ATTACH 别名）。
    if (db) {
      parts = [db, table];
      database = db;
    } else {
      parts = [table];
    }
  }

  const analyzed: AnalyzedTable = {
    raw: parts.join('.'),
    parts,
    table,
    ...(schema ? { schema } : {}),
    ...(database ? { database } : {}),
    ...(alias ? { alias } : {}),
  };
  const key = tableKey(analyzed);
  if (seen.has(key)) return;
  seen.add(key);
  out.tables.push(analyzed);
}

function cteColumns(cte: JsonRecord): string[] {
  const declared = Array.isArray(cte.columns) ? cte.columns : [];
  const fromDeclared = declared
    .map((column) => textValue(column))
    .filter((name): name is string => Boolean(name));
  if (fromDeclared.length > 0) return fromDeclared;

  const stmt = isRecord(cte.stmt) ? cte.stmt : null;
  const ast = stmt && isRecord(stmt.ast) ? stmt.ast : stmt;
  if (!isRecord(ast) || ast.type !== 'select' || !Array.isArray(ast.columns)) {
    return [];
  }
  const columns: string[] = [];
  for (const column of ast.columns) {
    if (!isRecord(column)) continue;
    if (typeof column.as === 'string' && column.as.length > 0) {
      columns.push(column.as);
      continue;
    }
    const name = textValue(column.expr);
    // `SELECT *` / `t.*` 没有可命名的输出列。
    if (name && name !== '*') columns.push(name);
  }
  return columns;
}

function walk(
  value: unknown,
  dialect: ParserDialect,
  out: StatementAnalysis,
  seenTables: Set<string>,
  seenCtes: Set<string>,
  seenObjects: Set<object>,
): void {
  if (Array.isArray(value)) {
    for (const item of value) walk(item, dialect, out, seenTables, seenCtes, seenObjects);
    return;
  }
  if (!isRecord(value)) return;
  if (seenObjects.has(value)) return;
  seenObjects.add(value);

  if (Array.isArray(value.with)) {
    for (const cte of value.with) {
      if (!isRecord(cte)) continue;
      const name = textValue(cte.name);
      if (!name) continue;
      const key = name.toLowerCase();
      if (seenCtes.has(key)) continue;
      seenCtes.add(key);
      out.ctes.push({ name, columns: cteColumns(cte) });
    }
  }

  // 表引用只出现在 from 数组（含 JOIN）或单表节点里；column_ref 的 `table`
  // 是别名而不是表，不能按 `table` 键盲目收集。
  for (const key of ['from', 'table']) {
    const entries = value[key];
    if (Array.isArray(entries)) {
      for (const entry of entries) {
        if (isRecord(entry)) pushTable(entry, dialect, out, seenTables);
      }
    } else if (isRecord(entries)) {
      pushTable(entries, dialect, out, seenTables);
    }
  }

  for (const [key, child] of Object.entries(value)) {
    if (key === 'loc' || key === 'tableList' || key === 'columnList') continue;
    walk(child, dialect, out, seenTables, seenCtes, seenObjects);
  }
}

function collect(ast: unknown, dialect: ParserDialect): StatementAnalysis {
  const out: StatementAnalysis = { tables: [], ctes: [] };
  walk(ast, dialect, out, new Set(), new Set(), new Set());
  return out;
}

function remember(key: string, analysis: StatementAnalysis | null): StatementAnalysis | null {
  cache.set(key, analysis);
  if (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return analysis;
}

/**
 * 解析当前语句并提取表/别名/CTE。解析失败、方言不支持或空语句返回 null。
 * 结果按「方言 + 语句」缓存，避免补全每次按键都重复解析。
 */
export function analyzeStatement(
  statement: string,
  dialect: DatabaseType | null | undefined,
): StatementAnalysis | null {
  const target = parserDialect(dialect);
  if (!target || statement.trim().length === 0) return null;
  // 与 extractVirtualTables 的上限保持一致，避免超大语句解析和缓存占用内存。
  if (statement.length > 50_000) return null;
  const parser = parsers.get(target);
  // 解析器还没加载完：触发懒加载但本次不缓存 null，否则加载完成后仍会
  // 命中旧缓存而永远走不到 AST。
  if (!parser) {
    void warmUpSqlAnalysis(dialect);
    return null;
  }
  const key = `${target}\u0000${statement}`;
  if (cache.has(key)) return cache.get(key) ?? null;
  try {
    const parsed = parser.parse(statement, { database: target });
    const ast = Array.isArray(parsed.ast) ? parsed.ast[0] : parsed.ast;
    if (!ast) return remember(key, null);
    return remember(key, collect(ast, target));
  } catch {
    return remember(key, null);
  }
}
