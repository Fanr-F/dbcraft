/**
 * 纯逻辑性能基线：SQL 词法、格式化、补全过滤。
 * 运行：npm run perf:baseline
 * 输出 JSON，便于在 CI/本地比较；不设置硬阈值，避免机器差异造成误报。
 */
import { performance } from 'node:perf_hooks';
import { tokenizeSql } from '../src/renderer/src/utils/sql-highlight.ts';
import { formatSql } from '../src/renderer/src/utils/sql-format.ts';
import { filterCompletions } from '../src/renderer/src/utils/sql-completion.ts';

const columns = Array.from({ length: 200 }, (_, index) => `column_${index}`);
const rows = Array.from({ length: 2000 }, (_, index) => {
  const picked = columns.slice(0, 8).map((column, columnIndex) => {
    return `${column} = ${columnIndex === 0 ? index : `'value_${index}'`}`;
  });
  return `SELECT ${columns.slice(0, 6).join(', ')} FROM table_${index % 10} WHERE ${picked.join(' AND ')};`;
});
const sql = rows.join('\n');

function measure(label, action) {
  const start = performance.now();
  const result = action();
  const elapsed = performance.now() - start;
  return { label, ms: Number(elapsed.toFixed(2)), size: result };
}

const report = {
  inputBytes: Buffer.byteLength(sql, 'utf8'),
  results: [
    measure('tokenize', () => tokenizeSql(sql).length),
    measure('format', () => formatSql(sql).length),
    measure('completionFilter', () => filterCompletions(columns, 'col').length),
  ],
};
console.log(JSON.stringify(report, null, 2));
