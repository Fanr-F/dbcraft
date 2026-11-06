import { useState } from 'react';
import type { DatabaseType } from '@shared/ipc-contract';
import { buildCreateView } from '@shared/dialect/ddl';
import { Icon } from './Icon';

interface CreateViewDialogProps {
  dialect: DatabaseType;
  onClose: () => void;
  onExecute: (sql: string) => Promise<{ ok: boolean; message: string }>;
}

export function CreateViewDialog({ dialect, onClose, onExecute }: CreateViewDialogProps) {
  const [name, setName] = useState('');
  const [selectSql, setSelectSql] = useState('SELECT * FROM ');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const generated = buildCreateView(dialect, name, selectSql);

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
        aria-labelledby="create-view-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="modal-header">
          <div>
            <h2 id="create-view-title">新建视图</h2>
            <p>填写视图名与 SELECT 定义，预览后执行。</p>
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
          <div className="designer-column-row add-column-row">
            <input
              autoFocus
              value={name}
              placeholder="视图名"
              aria-label="视图名"
              onChange={(event) => setName(event.target.value)}
            />
          </div>

          <label className="field">
            <span>视图定义（SELECT / WITH）</span>
            <textarea
              className="view-select-input"
              value={selectSql}
              spellCheck={false}
              aria-label="视图定义"
              onChange={(event) => setSelectSql(event.target.value)}
            />
          </label>

          {generated.ok ? (
            <pre className="danger-sql">{generated.sql}</pre>
          ) : (
            (name.length > 0 || selectSql.trim().length > 0) && (
              <div className="form-error">{generated.message}</div>
            )
          )}

          {generated.ok && generated.warnings.length > 0 && (
            <div className="ddl-warnings">
              {generated.warnings.map((warning) => (
                <div key={warning}>⚠ {warning}</div>
              ))}
            </div>
          )}

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
