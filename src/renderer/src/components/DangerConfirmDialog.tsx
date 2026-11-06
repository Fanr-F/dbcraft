import { useEffect } from 'react';
import type { DangerMatch } from '@shared/dialect/safety';
import { Icon } from './Icon';

interface DangerConfirmDialogProps {
  sql: string;
  match: DangerMatch;
  onCancel: () => void;
  onConfirm: () => void;
}

export function DangerConfirmDialog({
  sql,
  match,
  onCancel,
  onConfirm,
}: DangerConfirmDialogProps) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onCancel]);

  return (
    <div className="modal-backdrop" onMouseDown={onCancel}>
      <div
        className="modal danger-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="danger-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="modal-header">
          <div>
            <h2 id="danger-dialog-title">生产连接：确认执行</h2>
            <p>{match.message}</p>
          </div>
          <button type="button" className="icon-btn" aria-label="关闭" onClick={onCancel}>
            <Icon name="close" />
          </button>
        </header>

        <div className="modal-body">
          <pre className="danger-sql">{sql}</pre>
          <p className="form-note">
            当前连接标记为「生产」。确认后将按上方 SQL 原样执行，且该操作可能无法撤销。
          </p>
        </div>

        <footer className="modal-footer">
          <button type="button" className="btn" onClick={onCancel}>
            取消
          </button>
          <span className="spacer" />
          <button type="button" className="btn btn-danger" onClick={onConfirm}>
            仍然执行
          </button>
        </footer>
      </div>
    </div>
  );
}
