/**
 * 查询历史存储的纯逻辑测试（不依赖 Electron）。
 *
 * 运行：npm run test:history
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import {
  HISTORY_SCHEMA,
  clearConnectionHistory,
  clearHistory,
  deleteHistory,
  ensureHistoryFts,
  listHistory,
  rebuildHistoryFts,
  recordHistory,
} from '../src/main/storage/history-store.ts';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function entry(overrides = {}) {
  return {
    sqlText: 'SELECT 1;',
    dialect: 'sqlite',
    connectionId: 'conn-1',
    connectionName: '本地库',
    databaseName: '',
    status: 'success',
    errorMessage: null,
    durationMs: 5,
    affectedRows: null,
    returnedRows: 1,
    source: 'editor',
    executedAt: new Date().toISOString(),
    ...overrides,
  };
}

const dir = mkdtempSync(join(tmpdir(), 'dbcraft-history-'));
const file = join(dir, 'meta.db');
const db = new Database(file);
db.exec(HISTORY_SCHEMA);

const t0 = new Date('2026-11-05T08:00:00.000Z');
recordHistory(db, entry({ executedAt: t0.toISOString(), sqlText: 'SELECT 1;' }));

// 60 秒内同连接同 SQL 合并。
recordHistory(
  db,
  entry({
    executedAt: new Date(t0.getTime() + 30_000).toISOString(),
    sqlText: 'SELECT 1;',
    returnedRows: 2,
  }),
);

let rows = listHistory(db);
assert(rows.length === 1, `expected 1 deduped row, got ${rows.length}`);
assert(rows[0].execCount === 2, `expected exec_count 2, got ${rows[0].execCount}`);
assert(rows[0].returnedRows === 2, 'latest result should overwrite');
assert(
  rows[0].lastExecutedAt === new Date(t0.getTime() + 30_000).toISOString(),
  'last_executed_at not updated',
);

// 超出合并窗口后新增一条。
recordHistory(
  db,
  entry({
    executedAt: new Date(t0.getTime() + 120_000).toISOString(),
    sqlText: 'SELECT 1;',
    status: 'failed',
    errorMessage: 'no such table',
  }),
);
rows = listHistory(db);
assert(rows.length === 2, `expected 2 rows, got ${rows.length}`);
assert(rows[0].status === 'failed', 'latest row should be first');

// 不同连接不合并。
recordHistory(
  db,
  entry({
    executedAt: new Date(t0.getTime() + 120_000).toISOString(),
    connectionId: 'conn-2',
    sqlText: 'SELECT 1;',
  }),
);
assert(listHistory(db).length === 3, 'different connection should not dedupe');

// 搜索：按内容包含匹配，且 % 按字面量处理。
recordHistory(
  db,
  entry({
    executedAt: new Date(t0.getTime() + 300_000).toISOString(),
    sqlText: "SELECT * FROM t WHERE note LIKE '100%';",
  }),
);
assert(listHistory(db, { query: '100%' }).length === 1, 'literal % search failed');
assert(listHistory(db, { query: 'no such' }).length === 0, 'search must not scan status/error');

// 组合过滤与排序。
recordHistory(
  db,
  entry({
    executedAt: new Date(t0.getTime() + 400_000).toISOString(),
    sqlText: 'SHOW TABLES;',
    dialect: 'mysql',
    connectionId: 'conn-3',
    source: 'grid-edit',
    durationMs: 500,
    databaseName: 'demo_db',
  }),
);
assert(listHistory(db).length === 5, 'setup row missing');
assert(listHistory(db, { dialect: 'mysql' }).length === 1, 'dialect filter failed');
assert(listHistory(db, { dialect: 'sqlite' }).length === 4, 'dialect filter leaked');
assert(listHistory(db, { status: 'failed' }).length === 1, 'status filter failed');
assert(listHistory(db, { connectionId: 'conn-2' }).length === 1, 'connection filter failed');
assert(listHistory(db, { source: 'grid-edit' }).length === 1, 'source filter failed');
assert(
  listHistory(db, { query: 'SHOW', dialect: 'sqlite' }).length === 0,
  'combined filter failed',
);
assert(
  listHistory(db, { databaseName: 'demo' }).length === 1,
  'database filter failed',
);
assert(
  listHistory(db, { since: new Date(t0.getTime() + 350_000).toISOString() }).length === 1,
  'time range filter failed',
);
const byDuration = listHistory(db, { sortBy: 'duration', sortDir: 'desc' });
assert(byDuration[0].durationMs === 500, 'duration sort failed');
const byDurationAsc = listHistory(db, { sortBy: 'duration', sortDir: 'asc' });
assert(byDurationAsc[0].durationMs === 5, 'duration asc sort failed');

// 按连接清空只影响该连接。
assert(clearConnectionHistory(db, 'conn-2') === 1, 'connection clear failed');
assert(listHistory(db, { connectionId: 'conn-2' }).length === 0, 'connection clear left rows');
assert(listHistory(db).length === 4, 'connection clear removed other rows');

// 删除与清空。
const id = listHistory(db, { query: '100%' })[0].id;
assert(deleteHistory(db, id) === 1, 'delete failed');
assert(listHistory(db, { query: '100%' }).length === 0, 'deleted row still visible');
assert(clearHistory(db) >= 1, 'clear failed');
assert(listHistory(db).length === 0, 'clear left rows');

// 保留上限：只保留最新的 N 条。
const limitDb = new Database(join(dir, 'limit.db'));
limitDb.exec(HISTORY_SCHEMA);
for (let index = 0; index < 4; index += 1) {
  recordHistory(
    limitDb,
    entry({
      executedAt: new Date(t0.getTime() + index * 10_000).toISOString(),
      sqlText: `SELECT ${index};`,
      connectionId: `conn-${index}`,
    }),
    { retentionLimit: 2 },
  );
}
const limited = listHistory(limitDb);
assert(limited.length === 2, `retention expected 2, got ${limited.length}`);
assert(limited[0].sqlText === 'SELECT 3;', 'retention kept wrong rows');

// FTS5 trigram：索引已存在时，>=3 字符走 MATCH，短查询回退 LIKE；
// 先写入历史再建索引，验证 rebuild 能覆盖已有记录。
const ftsDb = new Database(join(dir, 'fts.db'));
ftsDb.exec(HISTORY_SCHEMA);
recordHistory(ftsDb, entry({ sqlText: 'SELECT * FROM customers WHERE city = "上海";' }));
recordHistory(ftsDb, entry({ sqlText: 'UPDATE orders SET status = "paid";' }));
const ftsReady = ensureHistoryFts(ftsDb);
assert(ftsReady, 'FTS5 trigram should be available');
assert(
  listHistory(ftsDb, { query: 'custom' }).length === 1,
  'FTS substring search failed',
);
assert(
  listHistory(ftsDb, { query: 'pai' }).length === 1,
  'FTS short substring search failed',
);
assert(
  listHistory(ftsDb, { query: 'SELECT' }).length === 1,
  'FTS uppercase search failed',
);
// 短查询（<3 字符）回退 LIKE。
assert(
  listHistory(ftsDb, { query: '上海' }).length === 1,
  'short query LIKE fallback failed',
);
// 删除后索引同步。
const ftsId = listHistory(ftsDb, { query: 'orders' })[0].id;
deleteHistory(ftsDb, ftsId);
assert(
  listHistory(ftsDb, { query: 'orders' }).length === 0,
  'FTS delete sync failed',
);
// 索引被清空（损坏/重建场景）时，rebuildHistoryFts 能恢复搜索。
ftsDb.exec("INSERT INTO history_fts(history_fts) VALUES ('delete-all')");
assert(
  listHistory(ftsDb, { query: 'custom' }).length === 0,
  'wiped FTS index should lose matches',
);
assert(rebuildHistoryFts(ftsDb), 'FTS rebuild failed');
assert(
  listHistory(ftsDb, { query: 'custom' }).length === 1,
  'FTS rebuild did not restore matches',
);
ftsDb.close();

limitDb.close();
db.close();
rmSync(dir, { recursive: true, force: true });
console.log('history store check passed');
