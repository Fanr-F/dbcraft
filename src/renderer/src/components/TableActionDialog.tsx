import { useState } from 'react';
import type { DatabaseType } from '@shared/ipc-contract';
import { buildDropObject, buildRenameTable } from '@shared/dialect/ddl';
import { Icon } from './Icon';

export type TableActionMode = 'rename' | 'drop-table' | 'drop-view';

interface TableActionDialogProps {
  dialect: DatabaseType;
  mode: TableActionMode;
  name: string;
  onClose: () => void;
  onExecute: (sql: string) => Promise<{ ok: boolean; message: string }>;
}

export function TableActionDialog({
  dialect,
  mode,
  name,
  onClose,
  onExecute,
}: TableActionDialogProps) {
  const [newName, setNewName] = useState('');
  const [confirmName, setConfirmName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const kind = mode === 'drop-view' ? 'view' : 'table';
  const generated =
    mode === 'rename'
      ? buildRenameTable(dialect, name, newName)
      : buildDropObject(dialect, name, kind);

  const sql = generated.ok ? generated.sql : '';
  const confirmed = mode === 'rename' || confirmName.trim() === name;

  const run = async () => {
    if (!generated.ok || !sql || !confirmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await onExecute(sql);
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

  const title =
    mode === 'rename'
      ? `重命名${kind === 'view' ? '视图' : '表'}`
      : `删除${kind === 'view' ? '视图' : '表'}`;

  return (
    <div className="modal-backdrop" onMouseDown={() => !busy && onClose()}>
      <div
        className="modal danger-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="table-action-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="modal-header">
          <div>
            <h2 id="table-action-title">{title}</h2>
            <p>对象：{name}</p>
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
          {mode === 'rename' ? (
            <label className="field">
              <span>新表名</span>
              <input
                autoFocus
                value={newName}
                placeholder="例如：orders_new"
                onChange={(event) => setNewName(event.target.value)}
              />
            </label>
          ) : (
            <label className="field">
              <span>输入对象名确认</span>
              <input
                autoFocus
                value={confirmName}
                placeholder={name}
                onChange={(event) => setConfirmName(event.target.value)}
              />
            </label>
          )}

          {generated.ok ? (
            <pre className="danger-sql">{generated.sql}</pre>
          ) : (
            newName.length > 0 && <div className="form-error">{generated.message}</div>
          )}

          {generated.ok && generated.warnings.length > 0 && (
            <div className="ddl-warnings">
              {generated.warnings.map((warning) => (
                <div key={warning}>⚠ {warning}</div>
              ))}
            </div>
          )}

          {mode !== 'rename' && (
            <p className="form-note">
              确认名称匹配后才能执行；删除操作不可撤销，建议先备份。
            </p>
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
            className={`btn ${mode === 'rename' ? 'btn-primary' : 'btn-danger'}`}
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
