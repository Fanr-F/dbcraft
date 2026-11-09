import { useMemo, useState } from 'react';
import type { DatabaseType, DdlStatementResult } from '@shared/ipc-contract';
import { splitSqlStatements } from '../utils/sql-script';
import { Icon } from './Icon';

interface SqlScriptDialogProps {
  dialect: DatabaseType;
  onClose: () => void;
  onExecute: (
    statements: string[],
  ) => Promise<{ ok: boolean; message: string; results?: DdlStatementResult[] }>;
}

export function SqlScriptDialog({ dialect, onClose, onExecute }: SqlScriptDialogProps) {
  const [sql, setSql] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [results, setResults] = useState<DdlStatementResult[] | null>(null);
  const parsed = useMemo(() => splitSqlStatements(sql, 50, dialect), [sql, dialect]);

  const run = async () => {
    if (!parsed.ok || busy) return;
    setBusy(true);
    setMessage(null);
    setResults(null);
    try {
      const result = await onExecute(parsed.statements);
      setResults(result.results ?? null);
      setMessage(
        result.ok
          ? `已执行 ${parsed.statements.length} 条语句。`
          : `执行失败：${result.message}`,
      );
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
        aria-labelledby="sql-script-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="modal-header">
          <div>
            <h2 id="sql-script-title">执行 SQL 脚本</h2>
            <p>
              按顶层分隔符切分，单次最多 50 条；字符串/注释里的分号不会误切，MSSQL `GO`
              与 MySQL `DELIMITER` 也会被识别。
            </p>
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
          <textarea
            className="view-select-input script-input"
            value={sql}
            spellCheck={false}
            autoFocus
            placeholder="-- 例如：\nALTER TABLE users ADD COLUMN note TEXT;\nCREATE INDEX idx_users_note ON users(note);"
            aria-label="SQL 脚本"
            onChange={(event) => {
              setSql(event.target.value);
              setMessage(null);
            }}
          />

          <p className="form-note">
            {dialect === 'sqlite'
              ? 'SQLite 会在一个事务中执行，任一条失败整体回滚。'
              : 'MySQL 系 DDL 会隐式提交；请逐条确认预览后再执行。'}
            {parsed.ok ? ` 当前识别到 ${parsed.statements.length} 条语句。` : ''}
          </p>

          {!parsed.ok && sql.trim().length > 0 && (
            <div className="form-error">{parsed.message}</div>
          )}

          {parsed.ok && (
            <ol className="script-preview">
              {parsed.statements.slice(0, 5).map((statement, index) => (
                <li key={index}>
                  <code>{statement.replace(/\s+/g, ' ').slice(0, 120)}</code>
                </li>
              ))}
              {parsed.statements.length > 5 && (
                <li className="pane-hint">…另有 {parsed.statements.length - 5} 条</li>
              )}
            </ol>
          )}

          {message && <p className="form-note">{message}</p>}

          {results && results.length > 0 && (
            <ul className="structure-list script-results">
              {results.map((result) => (
                <li key={result.index} className={result.ok ? '' : 'is-failed'}>
                  <strong>#{result.index + 1}</strong>
                  <span>{result.ok ? '成功' : '失败'}</span>
                  <span>{result.message}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <footer className="modal-footer">
          <button type="button" className="btn" disabled={busy} onClick={onClose}>
            关闭
          </button>
          <span className="spacer" />
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || !parsed.ok}
            onClick={() => void run()}
          >
            {busy ? '执行中…' : parsed.ok ? `执行 ${parsed.statements.length} 条` : '执行'}
          </button>
        </footer>
      </div>
    </div>
  );
}
