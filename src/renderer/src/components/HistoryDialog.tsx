import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type {
  DatabaseType,
  HistoryRecord,
  QuerySource,
  QueryStatus,
} from '@shared/ipc-contract';
import { DATABASE_TYPES, DATABASE_TYPE_LABELS } from '@shared/ipc-contract';
import { historyToCsv, historyToSql } from '@shared/history-export';
import type { SavedConnection } from '../types';
import { maskSensitiveSql } from '../utils/sql-mask';
import { HistoryDetailDialog } from './HistoryDetailDialog';
import { Icon } from './Icon';

interface HistoryDialogProps {
  connections: SavedConnection[];
  /** 设置里的脱敏默认值；用户仍可在面板内临时切换。 */
  defaultMasked: boolean;
  onClose: () => void;
  onInsert: (sql: string) => void;
  /** 再次执行：由外层决定回到原连接/原库，原连接不存在时退化为插入。 */
  onRun: (record: HistoryRecord) => void;
}

const STATUS_LABELS: Record<QueryStatus, string> = {
  success: '成功',
  failed: '失败',
  cancelled: '已取消',
};

const SOURCE_LABELS: Record<HistoryRecord['source'], string> = {
  editor: '编辑器',
  'ddl-preview': 'DDL',
  'grid-edit': '网格',
  'agent-control': 'Agent',
  'table-page': '表数据',
  export: '导出',
};

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString('zh-CN', { hour12: false });
}

function firstLine(sql: string): string {
  const line = sql.split(/\r?\n/)[0] ?? '';
  return line.length > 120 ? `${line.slice(0, 120)}…` : line;
}

/** 命中在后续行时截取命中附近片段，避免高亮只存在于首行而看不到。 */
function snippetFor(sql: string, query: string): string {
  const needle = query.trim();
  if (!needle) return firstLine(sql);
  const index = sql.toLowerCase().indexOf(needle.toLowerCase());
  if (index < 0) return firstLine(sql);

  const start = Math.max(0, index - 40);
  const end = Math.min(sql.length, index + needle.length + 80);
  const fragment = sql.slice(start, end).replace(/\s+/g, ' ');
  return `${start > 0 ? '…' : ''}${fragment}${end < sql.length ? '…' : ''}`;
}

/** 把输入框里的本地时间转成 ISO；空值/非法值返回 undefined。 */
function toIso(value: string): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/** 搜索结果高亮：大小写不敏感，按字面量匹配，不解析正则。 */
function highlightMatch(text: string, query: string): ReactNode {
  const needle = query.trim();
  if (!needle) return text;
  const lowerText = text.toLowerCase();
  const lowerNeedle = needle.toLowerCase();
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let key = 0;

  while (cursor < text.length) {
    const index = lowerText.indexOf(lowerNeedle, cursor);
    if (index < 0) {
      nodes.push(text.slice(cursor));
      break;
    }
    if (index > cursor) nodes.push(text.slice(cursor, index));
    nodes.push(
      <mark key={`match-${key++}`} className="history-match">
        {text.slice(index, index + needle.length)}
      </mark>,
    );
    cursor = index + needle.length;
  }

  return nodes.length > 0 ? nodes : text;
}

type TimeRange = 'all' | 'today' | '1' | '7' | '30' | 'custom';

export function HistoryDialog({
  connections,
  defaultMasked,
  onClose,
  onInsert,
  onRun,
}: HistoryDialogProps) {
  const [query, setQuery] = useState('');
  const [dialect, setDialect] = useState<DatabaseType | ''>('');
  const [status, setStatus] = useState<QueryStatus | ''>('');
  const [source, setSource] = useState<QuerySource | ''>('');
  const [connectionId, setConnectionId] = useState('');
  const [databaseQuery, setDatabaseQuery] = useState('');
  const [timeRange, setTimeRange] = useState<TimeRange>('all');
  const [customSince, setCustomSince] = useState('');
  const [customUntil, setCustomUntil] = useState('');
  const [sort, setSort] = useState<'time-desc' | 'time-asc' | 'duration-desc' | 'duration-asc'>(
    'time-desc',
  );
  const [refreshToken, setRefreshToken] = useState(0);
  const [records, setRecords] = useState<HistoryRecord[]>([]);
  const [limit, setLimit] = useState(200);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [detail, setDetail] = useState<HistoryRecord | null>(null);
  const [masked, setMasked] = useState(defaultMasked);

  const knownConnectionIds = useMemo(
    () => new Set(connections.map((connection) => connection.id)),
    [connections],
  );
  const isDeletedConnection = (record: HistoryRecord) =>
    record.connectionId.length > 0 && !knownConnectionIds.has(record.connectionId);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      const api = window.dbcraft;
      if (!api) {
        setError('未检测到 Electron IPC 桥接。');
        return;
      }

      setLoading(true);
      const [sortBy, sortDir] = sort.split('-') as ['time' | 'duration', 'asc' | 'desc'];
      let since: string | undefined;
      if (timeRange === 'today') {
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);
        since = startOfDay.toISOString();
      } else if (timeRange === 'custom') {
        since = toIso(customSince);
      } else if (timeRange !== 'all') {
        since = new Date(Date.now() - Number(timeRange) * 86_400_000).toISOString();
      }
      const until = timeRange === 'custom' ? toIso(customUntil) : undefined;
      api.history
        .list({
          query,
          ...(dialect ? { dialect } : {}),
          ...(status ? { status } : {}),
          ...(source ? { source } : {}),
          ...(connectionId ? { connectionId } : {}),
          ...(databaseQuery.trim() ? { databaseName: databaseQuery.trim() } : {}),
          ...(since ? { since } : {}),
          ...(until ? { until } : {}),
          sortBy,
          sortDir,
          limit,
        })
        .then((result) => {
          if (cancelled) return;
          if (result.ok) {
            setRecords(result.records);
            setError(null);
          } else {
            setError(result.message);
          }
        })
        .catch((caught) => {
          if (!cancelled) {
            setError(caught instanceof Error ? caught.message : String(caught));
          }
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 200);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    query,
    dialect,
    status,
    source,
    connectionId,
    databaseQuery,
    timeRange,
    customSince,
    customUntil,
    sort,
    refreshToken,
    limit,
  ]);

  const displaySql = (record: HistoryRecord) =>
    masked ? maskSensitiveSql(record.sqlText) : record.sqlText;

  const reload = () => setRefreshToken((current) => current + 1);

  const hasFilters = Boolean(
    query.trim() ||
      dialect ||
      status ||
      source ||
      connectionId ||
      databaseQuery.trim() ||
      timeRange !== 'all',
  );

  const exportHistory = async (format: 'json' | 'sql' | 'csv') => {
    if (records.length === 0) return;
    const label = format === 'json' ? 'JSON' : format === 'sql' ? 'SQL' : 'CSV';
    if (
      !window.confirm(
        `历史记录可能包含敏感 SQL 明文，将导出为 ${label} 文件。确定继续吗？`,
      )
    ) {
      return;
    }
    const api = window.dbcraft;
    if (!api) return;
    const exportRecords = masked
      ? records.map((record) => ({ ...record, sqlText: maskSensitiveSql(record.sqlText) }))
      : records;
    const content =
      format === 'json'
        ? JSON.stringify(exportRecords, null, 2)
        : format === 'sql'
          ? historyToSql(exportRecords)
          : historyToCsv(exportRecords);
    const result = await api.export.save({
      suggestedName: `dbcraft-history.${format}`,
      content,
    });
    if (!result.ok && !result.canceled) {
      setError(result.message);
    }
  };

  const removeRecord = async (id: number) => {
    const api = window.dbcraft;
    if (!api) return;
    const result = await api.history.remove(id);
    if (!result.ok) {
      setError(result.message ?? '删除失败。');
      return;
    }
    setRecords((current) => current.filter((record) => record.id !== id));
  };

  const copySql = async (record: HistoryRecord) => {
    try {
      await navigator.clipboard.writeText(record.sqlText);
      setMessage('SQL 已复制到剪贴板。');
    } catch {
      setError('复制失败，请打开详情手动选择。');
    }
  };

  const filterByConnection = (record: HistoryRecord) => {
    if (!record.connectionId) {
      setMessage('该记录没有连接信息，无法按连接筛选。');
      return;
    }
    setConnectionId(record.connectionId);
    const suffix = knownConnectionIds.has(record.connectionId) ? '' : '（连接已删除）';
    setMessage(`已筛选连接：${record.connectionName || record.connectionId}${suffix}`);
  };

  const clearAll = async () => {
    if (!window.confirm('清空全部查询历史？该操作不可撤销。')) return;
    const api = window.dbcraft;
    if (!api) return;
    const result = await api.history.clear();
    if (!result.ok) {
      setError(result.message ?? '清空失败。');
      return;
    }
    setRecords([]);
  };

  const clearCurrentConnection = async () => {
    if (!connectionId) return;
    const name =
      connections.find((connection) => connection.id === connectionId)?.input.name ??
      records.find((record) => record.connectionId === connectionId)?.connectionName ??
      '当前连接';
    if (!window.confirm(`清空「${name}」的全部查询历史？该操作不可撤销。`)) return;

    const api = window.dbcraft;
    if (!api) return;
    const result = await api.history.clearConnection(connectionId);
    if (!result.ok) {
      setError(result.message ?? '清空失败。');
      return;
    }
    reload();
  };

  return (
    <>
      <div className="modal-backdrop" onMouseDown={onClose}>
        <div
          className="modal history-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="history-title"
          onMouseDown={(event) => event.stopPropagation()}
        >
        <header className="modal-header">
          <div>
            <h2 id="history-title">查询历史</h2>
            <p>点击记录插入到编辑器光标处；当前最多展示 {limit} 条，可按 200 条加载更多。Ctrl+E 可随时打开。</p>
          </div>
          <button type="button" className="icon-btn" aria-label="关闭" onClick={onClose}>
            <Icon name="close" />
          </button>
        </header>

        <div className="modal-body history-body">
          <div className="sidebar-search history-search">
            <Icon name="search" size={13} />
            <input
              autoFocus
              value={query}
              placeholder="按 SQL 内容搜索…"
              aria-label="搜索查询历史"
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>

          <div className="history-filters">
            <select
              aria-label="按数据库类型过滤"
              value={dialect}
              onChange={(event) => setDialect(event.target.value as DatabaseType | '')}
            >
              <option value="">全部类型</option>
              {DATABASE_TYPES.map((type) => (
                <option key={type} value={type}>
                  {DATABASE_TYPE_LABELS[type]}
                </option>
              ))}
            </select>

            <select
              aria-label="按状态过滤"
              value={status}
              onChange={(event) => setStatus(event.target.value as QueryStatus | '')}
            >
              <option value="">全部状态</option>
              {(Object.keys(STATUS_LABELS) as QueryStatus[]).map((item) => (
                <option key={item} value={item}>
                  {STATUS_LABELS[item]}
                </option>
              ))}
            </select>

            <select
              aria-label="按来源过滤"
              value={source}
              onChange={(event) => setSource(event.target.value as QuerySource | '')}
            >
              <option value="">全部来源</option>
              {(Object.keys(SOURCE_LABELS) as QuerySource[]).map((item) => (
                <option key={item} value={item}>
                  {SOURCE_LABELS[item]}
                </option>
              ))}
            </select>

            <select
              aria-label="按连接过滤"
              value={connectionId}
              onChange={(event) => setConnectionId(event.target.value)}
            >
              <option value="">全部连接</option>
              {connectionId && !knownConnectionIds.has(connectionId) && (
                <option value={connectionId}>
                  {records.find((record) => record.connectionId === connectionId)
                    ?.connectionName || connectionId}
                  （已删除）
                </option>
              )}
              {connections.map((connection) => (
                <option key={connection.id} value={connection.id}>
                  {connection.input.name}
                </option>
              ))}
            </select>

            <select
              aria-label="排序"
              value={sort}
              onChange={(event) =>
                setSort(event.target.value as typeof sort)
              }
            >
              <option value="time-desc">时间 · 最新</option>
              <option value="time-asc">时间 · 最早</option>
              <option value="duration-desc">耗时 · 最长</option>
              <option value="duration-asc">耗时 · 最短</option>
            </select>

            <select
              aria-label="时间范围"
              value={timeRange}
              onChange={(event) => setTimeRange(event.target.value as TimeRange)}
            >
              <option value="all">全部时间</option>
              <option value="today">今天</option>
              <option value="1">最近 1 天</option>
              <option value="7">最近 7 天</option>
              <option value="30">最近 30 天</option>
              <option value="custom">自定义…</option>
            </select>

            {timeRange === 'custom' && (
              <div className="history-custom-range">
                <input
                  type="datetime-local"
                  aria-label="开始时间"
                  value={customSince}
                  onChange={(event) => setCustomSince(event.target.value)}
                />
                <span>至</span>
                <input
                  type="datetime-local"
                  aria-label="结束时间"
                  value={customUntil}
                  onChange={(event) => setCustomUntil(event.target.value)}
                />
              </div>
            )}

            <input
              className="table-filter-input"
              aria-label="按数据库名过滤"
              placeholder="数据库包含…"
              value={databaseQuery}
              onChange={(event) => setDatabaseQuery(event.target.value)}
            />

            <label className="check">
              <input
                type="checkbox"
                checked={masked}
                onChange={(event) => setMasked(event.target.checked)}
              />
              脱敏显示
            </label>
          </div>

          {error && <div className="form-error">{error}</div>}
          {message && <div className="form-note history-message">{message}</div>}

          {loading ? (
            <div className="history-empty">正在加载…</div>
          ) : records.length === 0 ? (
            <div className="history-empty">
              {hasFilters ? '没有匹配的历史记录' : '执行任意 SQL 后，这里会自动保存记录'}
            </div>
          ) : (
            <div className="history-list">
              {records.map((record) => (
                <div
                  key={record.id}
                  className="history-row"
                  role="button"
                  tabIndex={0}
                  onClick={() => onInsert(record.sqlText)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      onInsert(record.sqlText);
                    }
                  }}
                  title={displaySql(record)}
                >
                  <div className="history-main">
                    <span className="history-sql">
                      {highlightMatch(snippetFor(displaySql(record), query), query)}
                    </span>
                    <span className="history-meta">
                      <span className={`badge status-${record.status}`}>
                        {STATUS_LABELS[record.status]}
                      </span>
                      <span>{formatTime(record.lastExecutedAt)}</span>
                      <span>{record.durationMs} ms</span>
                      {record.execCount > 1 && <span>×{record.execCount}</span>}
                      <span>{DATABASE_TYPE_LABELS[record.dialect] ?? record.dialect}</span>
                      <span>{SOURCE_LABELS[record.source]}</span>
                      {record.connectionName && <span>{record.connectionName}</span>}
                      {isDeletedConnection(record) && (
                        <span className="badge badge-warn" title={record.connectionName}>
                          连接已删除
                        </span>
                      )}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="icon-btn history-delete"
                    title="复制 SQL"
                    aria-label="复制此条 SQL"
                    onClick={(event) => {
                      event.stopPropagation();
                      void copySql(record);
                    }}
                  >
                    <Icon name="copy" size={12} />
                  </button>
                  <button
                    type="button"
                    className="icon-btn history-delete"
                    title="仅看此连接"
                    aria-label="仅看此连接的历史"
                    disabled={!record.connectionId}
                    onClick={(event) => {
                      event.stopPropagation();
                      filterByConnection(record);
                    }}
                  >
                    <Icon name="filter" size={12} />
                  </button>
                  <button
                    type="button"
                    className="icon-btn history-delete"
                    title="详情"
                    aria-label="查看历史详情"
                    onClick={(event) => {
                      event.stopPropagation();
                      setDetail(record);
                    }}
                  >
                    <Icon name="search" size={12} />
                  </button>
                  <button
                    type="button"
                    className="icon-btn history-delete"
                    title="插入并执行"
                    aria-label="插入并执行此条历史"
                    onClick={(event) => {
                      event.stopPropagation();
                      onRun(record);
                    }}
                  >
                    <Icon name="play" size={12} />
                  </button>
                  <button
                    type="button"
                    className="icon-btn history-delete"
                    title="删除此条"
                    aria-label="删除此条历史"
                    onClick={(event) => {
                      event.stopPropagation();
                      void removeRecord(record.id);
                    }}
                  >
                    <Icon name="close" size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <footer className="modal-footer">
          <button type="button" className="btn" onClick={onClose}>
            关闭
          </button>
          <span className="spacer" />
          {records.length >= limit && limit < 1000 && (
            <button
              type="button"
              className="btn"
              disabled={loading}
              onClick={() => setLimit((value) => Math.min(1000, value + 200))}
            >
              加载更多
            </button>
          )}
          <button type="button" className="btn" onClick={reload} disabled={loading}>
            刷新
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => void exportHistory('json')}
            disabled={records.length === 0}
          >
            导出 JSON
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => void exportHistory('sql')}
            disabled={records.length === 0}
          >
            导出 SQL
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => void exportHistory('csv')}
            disabled={records.length === 0}
          >
            导出 CSV
          </button>
          {connectionId && (
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => void clearCurrentConnection()}
            >
              清空当前连接
            </button>
          )}
          <button type="button" className="btn btn-danger" onClick={() => void clearAll()}>
            清空全部
          </button>
        </footer>
        </div>
      </div>

      {detail && (
        <HistoryDetailDialog
          record={detail}
          displaySql={displaySql(detail)}
          connectionDeleted={isDeletedConnection(detail)}
          onClose={() => setDetail(null)}
          onInsert={(sql) => {
            setDetail(null);
            onInsert(sql);
          }}
          onRun={(record) => {
            setDetail(null);
            onRun(record);
          }}
        />
      )}
    </>
  );
}
