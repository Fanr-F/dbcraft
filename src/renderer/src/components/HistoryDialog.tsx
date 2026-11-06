import { useEffect, useState } from 'react';
import type {
  DatabaseType,
  HistoryRecord,
  QuerySource,
  QueryStatus,
} from '@shared/ipc-contract';
import { DATABASE_TYPES, DATABASE_TYPE_LABELS } from '@shared/ipc-contract';
import type { SavedConnection } from '../types';
import { maskSensitiveSql } from '../utils/sql-mask';
import { HistoryDetailDialog } from './HistoryDetailDialog';
import { Icon } from './Icon';

interface HistoryDialogProps {
  connections: SavedConnection[];
  onClose: () => void;
  onInsert: (sql: string) => void;
  onRun: (sql: string) => void;
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

export function HistoryDialog({ connections, onClose, onInsert, onRun }: HistoryDialogProps) {
  const [query, setQuery] = useState('');
  const [dialect, setDialect] = useState<DatabaseType | ''>('');
  const [status, setStatus] = useState<QueryStatus | ''>('');
  const [source, setSource] = useState<QuerySource | ''>('');
  const [connectionId, setConnectionId] = useState('');
  const [databaseQuery, setDatabaseQuery] = useState('');
  const [timeRange, setTimeRange] = useState<'all' | '1' | '7' | '30'>('all');
  const [sort, setSort] = useState<'time-desc' | 'time-asc' | 'duration-desc' | 'duration-asc'>(
    'time-desc',
  );
  const [refreshToken, setRefreshToken] = useState(0);
  const [records, setRecords] = useState<HistoryRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<HistoryRecord | null>(null);
  const [masked, setMasked] = useState(false);

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
      const since =
        timeRange === 'all'
          ? undefined
          : new Date(Date.now() - Number(timeRange) * 86_400_000).toISOString();
      api.history
        .list({
          query,
          ...(dialect ? { dialect } : {}),
          ...(status ? { status } : {}),
          ...(source ? { source } : {}),
          ...(connectionId ? { connectionId } : {}),
          ...(databaseQuery.trim() ? { databaseName: databaseQuery.trim() } : {}),
          ...(since ? { since } : {}),
          sortBy,
          sortDir,
          limit: 200,
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
  }, [query, dialect, status, source, connectionId, databaseQuery, timeRange, sort, refreshToken]);

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

  const exportHistory = async () => {
    if (records.length === 0) return;
    if (
      !window.confirm(
        '历史记录可能包含敏感 SQL 明文，将导出为 JSON 文件。确定继续吗？',
      )
    ) {
      return;
    }
    const api = window.dbcraft;
    if (!api) return;
    const result = await api.export.save({
      suggestedName: 'dbcraft-history.json',
      content: JSON.stringify(
        masked
          ? records.map((record) => ({ ...record, sqlText: maskSensitiveSql(record.sqlText) }))
          : records,
        null,
        2,
      ),
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
            <p>点击记录插入到当前编辑器；最多展示最近 200 条。</p>
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
              onChange={(event) =>
                setTimeRange(event.target.value as 'all' | '1' | '7' | '30')
              }
            >
              <option value="all">全部时间</option>
              <option value="1">最近 1 天</option>
              <option value="7">最近 7 天</option>
              <option value="30">最近 30 天</option>
            </select>

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
                    <span className="history-sql">{firstLine(displaySql(record))}</span>
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
                    </span>
                  </div>
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
                      onRun(record.sqlText);
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
          <button type="button" className="btn" onClick={reload} disabled={loading}>
            刷新
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => void exportHistory()}
            disabled={records.length === 0}
          >
            导出 JSON
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
          onClose={() => setDetail(null)}
          onInsert={(sql) => {
            setDetail(null);
            onInsert(sql);
          }}
          onRun={(sql) => {
            setDetail(null);
            onRun(sql);
          }}
        />
      )}
    </>
  );
}
