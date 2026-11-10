import { useState } from 'react';
import type { DatabaseType } from '@shared/ipc-contract';
import { buildDropColumn, ddlTransactionHint } from '@shared/dialect/ddl';
import { Icon } from './Icon';

interface DropColumnDialogProps {
  dialect: DatabaseType;
  tableName: string;
  onClose: () => void;
  onExecute: (sql: string) => Promise<{ ok: boolean; message: string }>;
}

export function DropColumnDialog({
  dialect,
  tableName,
  onClose,
  onExecute,
}: DropColumnDialogProps) {
  const [columnName, setColumnName] = useState('');
  const [confirmName, setConfirmName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const generated = buildDropColumn(dialect, tableName, columnName);
  const confirmed =
    columnName.trim().length > 0 && confirmName.trim() === columnName.trim();

  const run = async () => {
    if (!generated.ok || !confirmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await onExecute(generated.sql);
      if (result.ok) {
        onClose();
      } else {
        setError(result.message);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={() => !busy && onClose()}>
      <div
        className="modal danger-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="drop-column-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="modal-header">
          <div>
            <h2 id="drop-column-title">删除列</h2>
            <p>表：{tableName}</p>
          </div>
          <button
            type="button"
            className="icon-btn"
            aria-label="关闭"
            onClick={() => !busy && onClose()}
          >
            <Icon name="close" />
          </button>
        </header>

        <div className="modal-body">
          <label className="field">
            <span>列名</span>
            <input
              autoFocus
              value={columnName}
              placeholder="例如：note"
              onChange={(event) => setColumnName(event.target.value)}
            />
          </label>

          <label className="field">
            <span>再次输入列名确认</span>
            <input
              value={confirmName}
              placeholder={columnName || '输入列名'}
              onChange={(event) => setConfirmName(event.target.value)}
            />
          </label>

          {generated.ok ? (
            <pre className="danger-sql">{generated.sql}</pre>
          ) : (
            columnName.length > 0 && <div className="form-error">{generated.message}</div>
          )}

          {generated.ok && generated.warnings.length > 0 && (
            <div className="ddl-warnings">
              {generated.warnings.map((warning) => (
                <div key={warning}>⚠ {warning}</div>
              ))}
            </div>
          )}
          <p className="form-note">{ddlTransactionHint(dialect)}</p>

          {error && <div className="form-error">{error}</div>}
        </div>

        <footer className="modal-footer">
          <button type="button" className="btn" disabled={busy} onClick={onClose}>
            取消
          </button>
          <span className="spacer" />
          <button
            type="button"
            className="btn btn-danger"
            disabled={busy || !generated.ok || !confirmed}
            onClick={() => void run()}
          >
            {busy ? '执行中…' : '执行'}
          </button>
        </footer>
      </div>
    </div>
  );
}
