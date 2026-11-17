/**
 * 从 @codemirror/lang-sql 的 dialect spec 重新生成方言关键字快照。
 *
 *   npm i -D @codemirror/lang-sql
 *   npm run sync:keywords
 *
 * 生成结果只包含 `DIALECT_KEYWORD_WORDS` 段，基础关键字列表手工维护。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MSSQL, MySQL, MariaSQL, SQLite } from '@codemirror/lang-sql';

const here = dirname(fileURLToPath(import.meta.url));
const target = resolve(here, '../src/keywords.ts');

const words = (dialect) =>
  `${dialect.spec.keywords ?? ''} ${dialect.spec.types ?? ''}`
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.toUpperCase());

const lists = {
  mssql: words(MSSQL),
  mysql: words(MySQL),
  percona: words(MySQL),
  mariadb: words(MariaSQL),
  sqlite: words(SQLite),
};

const body = Object.entries(lists)
  .map(([dialect, values]) => `  ${dialect}: ${JSON.stringify(values)},`)
  .join('\n');

const generated = `// <generated: dialect keywords>
export const DIALECT_KEYWORD_WORDS: Record<SqlDialect, string[]> = {
${body}
};
// </generated: dialect keywords>`;

const source = readFileSync(target, 'utf8');
const pattern =
  /\/\/ <generated: dialect keywords>[\s\S]*?\/\/ <\/generated: dialect keywords>/;
if (!pattern.test(source)) {
  throw new Error('未找到 generated 段，请检查 src/keywords.ts 的标记。');
}
const next = source.replace(pattern, generated);
writeFileSync(target, next);
console.log(
  `[sync-keywords] ${Object.entries(lists)
    .map(([dialect, values]) => `${dialect}:${values.length}`)
    .join(' ')}`,
);
