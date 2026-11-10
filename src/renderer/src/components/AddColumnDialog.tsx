import { useState } from 'react';
import type { DatabaseType } from '@shared/ipc-contract';
import { buildAddColumn, ddlTransactionHint } from '@shared/dialect/ddl';
import { Icon } from './Icon';

interface AddColumnDialogProps {
  dialect: DatabaseType;
  tableName: string;
  onClose: () => void;
  onExecute: (sql: string) => Promise<{ ok: boolean; message: string }>;
}

const TYPE_SUGGESTIONS: Partial<Record<DatabaseType, string[]>> = {
  sqlite: ['INTEGER', 'TEXT', 'REAL', 'BLOB', 'NUMERIC'],
  mysql: ['INT', 'BIGINT', 'VARCHAR(255)', 'TEXT', 'DECIMAL(10,2)', 'DATETIME', 'BOOLEAN', 'JSON'],
  percona: ['INT', 'BIGINT', 'VARCHAR(255)', 'TEXT', 'DECIMAL(10,2)', 'DATETIME', 'BOOLEAN', 'JSON'],
  mariadb: ['INT', 'BIGINT', 'VARCHAR(255)', 'TEXT', 'DECIMAL(10,2)', 'DATETIME', 'BOOLEAN', 'JSON'],
};

export function AddColumnDialog({
  dialect,
  tableName,
  onClose,
  onExecute,
}: AddColumnDialogProps) {
  const [name, setName] = useState('');
  const [type, setType] = useState(dialect === 'sqlite' ? 'TEXT' : 'VARCHAR(255)');
  const [notNull, setNotNull] = useState(false);
  const [unique, setUnique] = useState(false);
  const [defaultValue, setDefaultValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const generated = buildAddColumn(dialect, tableName, {
    name,
    type,
    notNull,
    unique,
    defaultValue: defaultValue.trim() || undefined,
  });

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
        aria-labelledby="add-column-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="modal-header">
          <div>
            <h2 id="add-column-title">添加列</h2>
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
          <div className="designer-column-row add-column-row">
            <input
              autoFocus
              value={name}
              placeholder="列名"
              aria-label="列名"
              onChange={(event) => setName(event.target.value)}
            />
            <input
              list="add-column-types"
              value={type}
              placeholder="类型"
              aria-label="列类型"
              onChange={(event) => setType(event.target.value)}
            />
            <label className="check">
              <input
                type="checkbox"
                checked={notNull}
                onChange={(event) => setNotNull(event.target.checked)}
              />
              非空
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={unique}
                onChange={(event) => setUnique(event.target.checked)}
              />
              唯一
            </label>
            <input
              value={defaultValue}
              placeholder="默认值"
              aria-label="默认值"
              onChange={(event) => setDefaultValue(event.target.value)}
            />
          </div>

          <datalist id="add-column-types">
            {(TYPE_SUGGESTIONS[dialect] ?? []).map((item) => (
              <option key={item} value={item} />
            ))}
          </datalist>

          {generated.ok ? (
            <pre className="danger-sql">{generated.sql}</pre>
          ) : (
            name.length > 0 && <div className="form-error">{generated.message}</div>
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
