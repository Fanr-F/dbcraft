import { useState } from 'react';
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

function isHexLike(text: string): boolean {
  if (!/^0x/i.test(text)) return false;
  const body = text.slice(2).replace(/…$/, '');
  return body.length === 0 || (body.length % 2 === 0 && /^[0-9a-f]+$/i.test(body));
}

/** 16 字节一行：offset + hex + ASCII。 */
function hexDump(text: string): string {
  const truncated = text.endsWith('…');
  const hex = text.slice(2, truncated ? -1 : undefined).toLowerCase();
  const bytes: number[] = [];
  for (let index = 0; index + 2 <= hex.length; index += 2) {
    bytes.push(Number.parseInt(hex.slice(index, index + 2), 16));
  }
  const lines: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 16) {
    const slice = bytes.slice(offset, offset + 16);
    const hexPart = slice.map((byte) => byte.toString(16).padStart(2, '0')).join(' ');
    const ascii = slice
      .map((byte) => (byte >= 32 && byte < 127 ? String.fromCharCode(byte) : '.'))
      .join('');
    lines.push(
      `${offset.toString(16).padStart(8, '0')}  ${hexPart.padEnd(47)}  |${ascii.padEnd(16)}|`,
    );
  }
  if (truncated) lines.push('… 超过 4 KB，仅显示前部字节');
  return lines.join('\n');
}

export function CellViewerDialog({
  column,
  value,
  rowIndex,
  onClose,
}: CellViewerDialogProps) {
  const text = displayValue(value);
  const hexAvailable = isHexLike(text);
  const [view, setView] = useState<'text' | 'hex'>('text');
  const rendered = view === 'hex' && hexAvailable ? hexDump(text) : text;
  const bytes = hexAvailable ? Math.floor((text.replace(/^0x|…$/g, '').length) / 2) : 0;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(rendered);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = rendered;
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
              {value === null
                ? ' · NULL'
                : hexAvailable
                  ? ` · ${bytes} 字节${text.endsWith('…') ? '（截断）' : ''}`
                  : ` · ${text.length} 字符`}
            </p>
            {hexAvailable && (
              <div className="cell-viewer-tabs" role="tablist" aria-label="查看方式">
                <button
                  type="button"
                  role="tab"
                  aria-selected={view === 'text'}
                  className={`btn ${view === 'text' ? 'btn-primary' : ''}`}
                  onClick={() => setView('text')}
                >
                  文本
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={view === 'hex'}
                  className={`btn ${view === 'hex' ? 'btn-primary' : ''}`}
                  onClick={() => setView('hex')}
                >
                  Hex
                </button>
              </div>
            )}
          </div>
          <button type="button" className="icon-btn" aria-label="关闭" onClick={onClose}>
            <Icon name="close" />
          </button>
        </header>

        <div className="modal-body">
          <pre className="cell-viewer-value">{rendered}</pre>
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
