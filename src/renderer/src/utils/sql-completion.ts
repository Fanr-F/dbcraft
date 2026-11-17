/**
 * DBCraft 的补全入口。
 *
 * 核心逻辑已抽到 `packages/sql-completion`；这里只负责把本项目的
 * `node-sql-parser` 语句分析器注入进去，保持现有调用方 API 不变。
 */
import {
  extractCompletionContext as extractCoreContext,
  extractVirtualTables as extractCoreVirtualTables,
  type SqlDialect,
  type StatementAnalyzer,
} from '@dbcraft/sql-completion';
import { analyzeStatement } from './sql-analysis.ts';

export * from '@dbcraft/sql-completion';

/** 本项目的 AST 分析器；包本身不依赖 node-sql-parser。 */
const appAnalyzer: StatementAnalyzer = (statement, dialect) =>
  analyzeStatement(statement, dialect);

export function extractCompletionContext(
  text: string,
  cursor: number,
  dialect?: SqlDialect | null,
  analyze?: StatementAnalyzer,
) {
  return extractCoreContext(text, cursor, dialect, analyze ?? appAnalyzer);
}

export function extractVirtualTables(
  statement: string,
  dialect?: SqlDialect | null,
  analyze?: StatementAnalyzer,
) {
  return extractCoreVirtualTables(statement, dialect, analyze ?? appAnalyzer);
}
