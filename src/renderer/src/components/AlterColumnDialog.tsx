import { useEffect, useMemo, useState } from 'react';
import type { DatabaseType, TableColumnMeta, TableDetail } from '@shared/ipc-contract';
import { buildModifyColumn, buildRenameColumn, ddlTransactionHint } from '@shared/dialect/ddl';
import { buildSqliteRebuild } from '@shared/dialect/sqlite-rebuild';
import { Icon } from './Icon';

interface AlterColumnDialogProps {
  dialect: DatabaseType;
  tableName: string;
  mode: 'rename' | 'modify';
  columns: TableColumnMeta[];
  detail?: TableDetail;
  onClose: () => void;
  onExecute: (sql: string) => Promise<{ ok: boolean; message: string }>;
  onExecuteScript?: (
    statements: string[],
    options?: { sqliteForeignKeysOff?: boolean },
  ) => Promise<{ ok: boolean; message: string }>;
}

const TYPE_SUGGESTIONS: Record<string, string[]> = {
  sqlite: ['INTEGER', 'TEXT', 'REAL', 'BLOB', 'NUMERIC'],
  mysql: ['INT', 'BIGINT', 'VARCHAR(255)', 'TEXT', 'DECIMAL(10,2)', 'DATETIME', 'BOOLEAN', 'JSON'],
  percona: [
    'INT',
    'BIGINT',
    'VARCHAR(255)',
    'TEXT',
    'DECIMAL(10,2)',
    'DATETIME',
    'BOOLEAN',
    'JSON',
  ],
  mariadb: [
    'INT',
    'BIGINT',
    'VARCHAR(255)',
    'TEXT',
    'DECIMAL(10,2)',
    'DATETIME',
    'BOOLEAN',
    'JSON',
  ],
};

export function AlterColumnDialog({
  dialect,
  tableName,
  mode,
  columns,
  detail,
  onClose,
  onExecute,
  onExecuteScript,
}: AlterColumnDialogProps) {
  // 主键/自增列不能通过 MODIFY 改写，否则会丢失主键定义。
  const selectable = useMemo(
    () =>
      mode === 'modify'
        ? columns.filter((column) => !column.primaryKey && !column.autoIncrement)
        : columns,
    [columns, mode],
  );

  const [columnName, setColumnName] = useState(selectable[0]?.name ?? '');
  const [newName, setNewName] = useState('');
  const [type, setType] = useState('');
  const [notNull, setNotNull] = useState(false);
  const [defaultValue, setDefaultValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const selected = columns.find((column) => column.name === columnName);

  useEffect(() => {
    if (!selected) return;
    setType(selected.declaredType);
    setNotNull(selected.notNull);
    setDefaultValue(selected.defaultValue ?? '');
  }, [selected]);

  const generated =
    mode === 'rename'
      ? buildRenameColumn(dialect, tableName, columnName, newName)
      : buildModifyColumn(dialect, tableName, columnName, {
          name: columnName,
          type,
          notNull,
          defaultValue: defaultValue.trim() || undefined,
        });

  // SQLite 不支持 MODIFY COLUMN：改为重建表，并保留显式索引。
  const rebuild = useMemo(() => {
    if (mode !== 'modify' || dialect !== 'sqlite' || !detail) return null;
    return buildSqliteRebuild(detail, {
      name: columnName,
      type,
      notNull,
      defaultValue: defaultValue.trim() || undefined,
    });
  }, [mode, dialect, detail, columnName, type, notNull, defaultValue]);

  const canExecute = rebuild ? rebuild.ok : generated.ok;
  const preview = rebuild
    ? rebuild.ok
      ? rebuild.statements.join('\n\n')
      : null
    : generated.ok
      ? generated.sql
      : null;
  const warnings = rebuild
    ? rebuild.ok
      ? rebuild.warnings
      : []
    : generated.ok
      ? generated.warnings
      : [];
  const generationError = rebuild
    ? rebuild.ok
      ? null
      : rebuild.message
    : generated.ok
      ? null
      : generated.message;

  const run = async () => {
    if (!canExecute || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = rebuild
        ? await onExecuteScript?.(rebuild.ok ? rebuild.statements : [], {
            sqliteForeignKeysOff: true,
          })
        : await onExecute(generated.ok ? generated.sql : '');
      if (!result) {
        setError('当前操作没有可用的执行入口。');
        return;
      }
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

  const title = mode === 'rename' ? '重命名列' : '修改列';

  return (
    <div className="modal-backdrop" onMouseDown={() => !busy && onClose()}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="alter-column-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="modal-header">
          <div>
            <h2 id="alter-column-title">{title}</h2>
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
          {selectable.length === 0 ? (
            <div className="form-error">
              没有可修改的列（主键/自增列不能通过 MODIFY 改写）。
            </div>
          ) : (
            <>
              <div className="designer-column-row add-column-row">
                <select
                  value={columnName}
                  aria-label="选择列"
                  onChange={(event) => setColumnName(event.target.value)}
                >
                  {selectable.map((column) => (
                    <option key={column.name} value={column.name}>
                      {column.name}
                    </option>
                  ))}
                </select>

                {mode === 'rename' ? (
                  <input
                    autoFocus
                    value={newName}
                    placeholder="新列名"
                    aria-label="新列名"
                    onChange={(event) => setNewName(event.target.value)}
                  />
                ) : (
                  <>
                    <input
                      list="alter-column-types"
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
                    <input
                      value={defaultValue}
                      placeholder="默认值（SQL 表达式）"
                      aria-label="默认值"
                      onChange={(event) => setDefaultValue(event.target.value)}
                    />
                  </>
                )}
              </div>

              <datalist id="alter-column-types">
                {(TYPE_SUGGESTIONS[dialect] ?? []).map((item) => (
                  <option key={item} value={item} />
                ))}
              </datalist>

              {preview ? (
                <pre className="danger-sql">{preview}</pre>
              ) : (
                columnName.length > 0 &&
                generationError && <div className="form-error">{generationError}</div>
              )}

              {preview && warnings.length > 0 && (
                <div className="ddl-warnings">
                  {warnings.map((warning) => (
                    <div key={warning}>⚠ {warning}</div>
                  ))}
                </div>
              )}
              <p className="form-note">{ddlTransactionHint(dialect)}</p>
            </>
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
            disabled={busy || !canExecute}
            onClick={() => void run()}
          >
            {busy ? '执行中…' : '执行'}
          </button>
        </footer>
      </div>
    </div>
  );
}
