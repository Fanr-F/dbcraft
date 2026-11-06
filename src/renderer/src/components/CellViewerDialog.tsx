import type { QueryCell, QueryColumn } from '@shared/ipc-contract';
import { Icon } from './Icon';

interface CellViewerDialogProps {
  column: QueryColumn;
  value: QueryCell;
  rowIndex: number;
  onClose: () => void;
}

function displayValue(value: QueryCell): string {
  if (value === null) return 'NULL';
  if (typeof value === 'string') return value;
  return String(value);
}

export function CellViewerDialog({
  column,
  value,
  rowIndex,
  onClose,
}: CellViewerDialogProps) {
  const text = displayValue(value);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal cell-viewer-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cell-viewer-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="modal-header">
          <div>
            <h2 id="cell-viewer-title">{column.name}</h2>
            <p>
              第 {rowIndex + 1} 行
              {column.declaredType ? ` · ${column.declaredType}` : ''}
              {value === null ? ' · NULL' : ` · ${text.length} 字符`}
            </p>
          </div>
          <button type="button" className="icon-btn" aria-label="关闭" onClick={onClose}>
            <Icon name="close" />
          </button>
        </header>

        <div className="modal-body">
          <pre className="cell-viewer-value">{text}</pre>
        </div>

        <footer className="modal-footer">
          <button type="button" className="btn" onClick={onClose}>
            关闭
          </button>
          <span className="spacer" />
          <button type="button" className="btn btn-primary" onClick={() => void copy()}>
            复制内容
          </button>
        </footer>
      </div>
    </div>
  );
}
