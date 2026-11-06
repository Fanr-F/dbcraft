import { useEffect, useMemo, useState } from 'react';
import type { DatabaseType, DdlColumnDefinition } from '@shared/ipc-contract';
import { buildCreateTable } from '@shared/dialect/ddl';
import { Icon } from './Icon';

interface EditorColumn extends DdlColumnDefinition {
  defaultValue: string;
}

interface TableDesignerProps {
  dialect: DatabaseType;
  onClose: () => void;
  onExecute: (sql: string) => Promise<{ ok: boolean; message: string }>;
}

const TYPE_SUGGESTIONS: Partial<Record<DatabaseType, string[]>> = {
  sqlite: ['INTEGER', 'TEXT', 'REAL', 'BLOB', 'NUMERIC'],
  mysql: ['INT', 'BIGINT', 'VARCHAR(255)', 'TEXT', 'DECIMAL(10,2)', 'DATETIME', 'BOOLEAN', 'JSON'],
  percona: ['INT', 'BIGINT', 'VARCHAR(255)', 'TEXT', 'DECIMAL(10,2)', 'DATETIME', 'BOOLEAN', 'JSON'],
  mariadb: ['INT', 'BIGINT', 'VARCHAR(255)', 'TEXT', 'DECIMAL(10,2)', 'DATETIME', 'BOOLEAN', 'JSON'],
};

function initialColumn(dialect: DatabaseType): EditorColumn {
  return {
    name: 'id',
    type: dialect === 'sqlite' ? 'INTEGER' : 'INT',
    primaryKey: true,
    autoIncrement: true,
    notNull: false,
    unique: false,
    defaultValue: '',
  };
}

export function TableDesigner({ dialect, onClose, onExecute }: TableDesignerProps) {
  const [tableName, setTableName] = useState('');
  const [columns, setColumns] = useState<EditorColumn[]>([initialColumn(dialect)]);
  const [phase, setPhase] = useState<'edit' | 'preview'>('edit');
  const [sql, setSql] = useState('');
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [executing, setExecuting] = useState(false);

  const suggestions = useMemo(() => TYPE_SUGGESTIONS[dialect] ?? [], [dialect]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !executing) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, executing]);

  const updateColumn = <K extends keyof EditorColumn>(
    index: number,
    key: K,
    value: EditorColumn[K],
  ) => {
    setColumns((current) =>
      current.map((column, position) =>
        position === index ? { ...column, [key]: value } : column,
      ),
    );
  };

  const addColumn = () => {
    setColumns((current) => [
      ...current,
      {
        name: '',
        type: dialect === 'sqlite' ? 'TEXT' : 'VARCHAR(255)',
        primaryKey: false,
        autoIncrement: false,
        notNull: false,
        unique: false,
        defaultValue: '',
      },
    ]);
  };

  const removeColumn = (index: number) => {
    setColumns((current) =>
      current.length <= 1 ? current : current.filter((_, position) => position !== index),
    );
  };

  const generate = () => {
    const result = buildCreateTable(dialect, {
      name: tableName,
      columns: columns.map((column) => ({
        ...column,
        defaultValue: column.defaultValue.trim() || undefined,
      })),
    });

    if (!result.ok) {
      setError(result.message);
      return;
    }

    setError(null);
    setWarnings(result.warnings);
    setSql(result.sql);
    setPhase('preview');
  };

  const execute = async () => {
    if (!sql.trim() || executing) return;
    setExecuting(true);
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
      setExecuting(false);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={() => !executing && onClose()}>
      <div
        className="modal designer-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="designer-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="modal-header">
          <div>
            <h2 id="designer-title">{phase === 'preview' ? 'DDL 预览' : '新建表'}</h2>
            <p>
              {phase === 'preview'
                ? '确认后将执行上方 SQL；SQLite 会包裹在事务中，失败自动回滚。'
                : '填写表名与列，生成 DDL 后预览执行。'}
            </p>
          </div>
          <button
            type="button"
            className="icon-btn"
            aria-label="关闭"
            onClick={() => !executing && onClose()}
          >
            <Icon name="close" />
          </button>
        </header>

        <div className="modal-body">
          {phase === 'edit' ? (
            <>
              <label className="field">
                <span>表名</span>
                <input
                  autoFocus
                  value={tableName}
                  placeholder="例如：orders"
                  onChange={(event) => setTableName(event.target.value)}
                />
              </label>

              <div className="designer-columns">
                <div className="designer-column-head">
                  <span>列名</span>
                  <span>类型</span>
                  <span>主键</span>
                  <span>自增</span>
                  <span>非空</span>
                  <span>唯一</span>
                  <span>默认值</span>
                  <span />
                </div>

                {columns.map((column, index) => (
                  <div className="designer-column-row" key={index}>
                    <input
                      value={column.name}
                      placeholder="列名"
                      aria-label={`第 ${index + 1} 列列名`}
                      onChange={(event) => updateColumn(index, 'name', event.target.value)}
                    />
                    <input
                      list="ddl-type-suggestions"
                      value={column.type}
                      placeholder="类型"
                      aria-label={`第 ${index + 1} 列类型`}
                      onChange={(event) => updateColumn(index, 'type', event.target.value)}
                    />
                    <input
                      type="checkbox"
                      checked={Boolean(column.primaryKey)}
                      aria-label={`第 ${index + 1} 列主键`}
                      onChange={(event) => {
                        const checked = event.target.checked;
                        updateColumn(index, 'primaryKey', checked);
                        if (!checked) updateColumn(index, 'autoIncrement', false);
                      }}
                    />
                    <input
                      type="checkbox"
                      checked={Boolean(column.autoIncrement)}
                      disabled={!column.primaryKey}
                      aria-label={`第 ${index + 1} 列自增`}
                      onChange={(event) => {
                        const checked = event.target.checked;
                        updateColumn(index, 'autoIncrement', checked);
                        if (checked && dialect === 'sqlite') {
                          updateColumn(index, 'type', 'INTEGER');
                        }
                      }}
                    />
                    <input
                      type="checkbox"
                      checked={Boolean(column.notNull)}
                      aria-label={`第 ${index + 1} 列非空`}
                      onChange={(event) => updateColumn(index, 'notNull', event.target.checked)}
                    />
                    <input
                      type="checkbox"
                      checked={Boolean(column.unique)}
                      aria-label={`第 ${index + 1} 列唯一`}
                      onChange={(event) => updateColumn(index, 'unique', event.target.checked)}
                    />
                    <input
                      value={column.defaultValue}
                      placeholder="默认值"
                      aria-label={`第 ${index + 1} 列默认值`}
                      onChange={(event) =>
                        updateColumn(index, 'defaultValue', event.target.value)
                      }
                    />
                    <button
                      type="button"
                      className="icon-btn"
                      title="删除列"
                      aria-label={`删除第 ${index + 1} 列`}
                      onClick={() => removeColumn(index)}
                    >
                      <Icon name="close" size={13} />
                    </button>
                  </div>
                ))}
              </div>

              <datalist id="ddl-type-suggestions">
                {suggestions.map((type) => (
                  <option key={type} value={type} />
                ))}
              </datalist>

              <button type="button" className="btn btn-ghost" onClick={addColumn}>
                <Icon name="plus" size={13} />
                添加列
              </button>

              {error && <div className="form-error">{error}</div>}
            </>
          ) : (
            <>
              <textarea
                className="ddl-preview"
                aria-label="DDL 预览"
                value={sql}
                spellCheck={false}
                onChange={(event) => setSql(event.target.value)}
              />

              {warnings.length > 0 && (
                <div className="ddl-warnings">
                  {warnings.map((warning) => (
                    <div key={warning}>⚠ {warning}</div>
                  ))}
                </div>
              )}

              {error && <div className="form-error">{error}</div>}
            </>
          )}
        </div>

        <footer className="modal-footer">
          {phase === 'edit' ? (
            <>
              <button type="button" className="btn" onClick={onClose}>
                取消
              </button>
              <span className="spacer" />
              <button type="button" className="btn btn-primary" onClick={generate}>
                生成预览
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="btn"
                disabled={executing}
                onClick={() => {
                  setPhase('edit');
                  setError(null);
                }}
              >
                返回修改
              </button>
              <span className="spacer" />
              <button
                type="button"
                className="btn btn-primary"
                disabled={executing || !sql.trim()}
                onClick={() => void execute()}
              >
                {executing ? '执行中…' : '执行'}
              </button>
            </>
          )}
        </footer>
      </div>
    </div>
  );
}
