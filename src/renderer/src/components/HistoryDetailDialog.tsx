import { useState } from 'react';
import type { HistoryRecord } from '@shared/ipc-contract';
import { Icon } from './Icon';

interface HistoryDetailDialogProps {
  record: HistoryRecord;
  /** 脱敏后的 SQL；插入/执行仍使用原始 SQL。 */
  displaySql?: string;
  /** 原连接已从本地连接列表删除。 */
  connectionDeleted?: boolean;
  onClose: () => void;
  onInsert: (sql: string) => void;
  onRun: (record: HistoryRecord) => void;
}

const STATUS_LABELS: Record<HistoryRecord['status'], string> = {
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

export function HistoryDetailDialog({
  record,
  displaySql,
  connectionDeleted,
  onClose,
  onInsert,
  onRun,
}: HistoryDetailDialogProps) {
  const [copied, setCopied] = useState(false);

  const copySql = async () => {
    try {
      await navigator.clipboard.writeText(record.sqlText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal cell-viewer-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="history-detail-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="modal-header">
          <div>
            <h2 id="history-detail-title">历史详情</h2>
            <p>
              {STATUS_LABELS[record.status]} · {record.durationMs} ms ·{' '}
              {SOURCE_LABELS[record.source]}
            </p>
          </div>
          <button type="button" className="icon-btn" aria-label="关闭" onClick={onClose}>
            <Icon name="close" />
          </button>
        </header>

        <div className="modal-body">
          <div className="history-detail-meta">
            <span>连接：{record.connectionName || '—'}</span>
            {connectionDeleted && <span className="badge badge-warn">连接已删除</span>}
            <span>数据库：{record.databaseName || '—'}</span>
            <span>方言：{record.dialect}</span>
            <span>执行次数：{record.execCount}</span>
            <span>最后执行：{new Date(record.lastExecutedAt).toLocaleString('zh-CN')}</span>
            {record.affectedRows !== null && <span>影响行数：{record.affectedRows}</span>}
            {record.returnedRows !== null && <span>返回行数：{record.returnedRows}</span>}
          </div>

          {record.errorMessage && (
            <div className="form-error">{record.errorMessage}</div>
          )}

          <pre className="cell-viewer-value">{displaySql ?? record.sqlText}</pre>
        </div>

        <footer className="modal-footer">
          <button type="button" className="btn" onClick={onClose}>
            关闭
          </button>
          <span className="spacer" />
          <button type="button" className="btn" onClick={() => void copySql()}>
            {copied ? '已复制' : '复制 SQL'}
          </button>
          <button type="button" className="btn" onClick={() => onInsert(record.sqlText)}>
            插入编辑器
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => onRun(record)}
          >
            插入并执行
          </button>
        </footer>
      </div>
    </div>
  );
}
