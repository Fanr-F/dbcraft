import { useState } from 'react';
import type { DatabaseType } from '@shared/ipc-contract';
import { buildCreateIndex, buildDropIndex, ddlTransactionHint } from '@shared/dialect/ddl';
import { Icon } from './Icon';

export type IndexMode = 'create' | 'drop';

interface IndexDialogProps {
  dialect: DatabaseType;
  tableName: string;
  mode: IndexMode;
  onClose: () => void;
  onExecute: (sql: string) => Promise<{ ok: boolean; message: string }>;
}

export function IndexDialog({
  dialect,
  tableName,
  mode,
  onClose,
  onExecute,
}: IndexDialogProps) {
  const [name, setName] = useState('');
  const [columns, setColumns] = useState('');
  const [unique, setUnique] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const generated =
    mode === 'create'
      ? buildCreateIndex(
          dialect,
          tableName,
          columns.split(',').map((column) => column.trim()),
          { name, unique },
        )
      : buildDropIndex(dialect, name, tableName);

  const run = async () => {
    if (!generated.ok || busy) return;
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
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="index-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="modal-header">
          <div>
            <h2 id="index-dialog-title">{mode === 'create' ? '创建索引' : '删除索引'}</h2>
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
          {mode === 'create' ? (
            <>
              <label className="field">
                <span>列（逗号分隔）</span>
                <input
                  autoFocus
                  value={columns}
                  placeholder="例如：status, created_at"
                  onChange={(event) => setColumns(event.target.value)}
                />
              </label>
              <label className="field">
                <span>索引名（可留空自动生成）</span>
                <input
                  value={name}
                  placeholder="例如：idx_orders_status"
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={unique}
                  onChange={(event) => setUnique(event.target.checked)}
                />
                唯一索引
              </label>
            </>
          ) : (
            <label className="field">
              <span>索引名</span>
              <input
                autoFocus
                value={name}
                placeholder="例如：idx_orders_status"
                onChange={(event) => setName(event.target.value)}
              />
            </label>
          )}

          {generated.ok ? (
            <pre className="danger-sql">{generated.sql}</pre>
          ) : (
            (columns.length > 0 || name.length > 0) && (
              <div className="form-error">{generated.message}</div>
            )
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
            className="btn btn-primary"
            disabled={busy || !generated.ok}
            onClick={() => void run()}
          >
            {busy ? '执行中…' : '执行'}
          </button>
        </footer>
      </div>
    </div>
  );
}
