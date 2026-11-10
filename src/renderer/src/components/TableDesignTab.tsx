import { useMemo, useState } from 'react';
import type { DatabaseInfo, DatabaseType, TableDetail } from '@shared/ipc-contract';
import { buildTableDesign, type TableDesignColumn } from '@shared/dialect/table-diff';
import { ddlTransactionHint } from '@shared/dialect/ddl';
import { Icon } from './Icon';

interface TableDesignTabProps {
  dialect: DatabaseType;
  mode: 'create' | 'edit';
  initialName: string;
  /** MSSQL 新建表时从对象树带过来的 schema。 */
  initialSchema?: string;
  detail?: TableDetail;
  sessionReady: boolean;
  /** 当前连接可见的数据库；SQLite 为空或只有 main。 */
  databases: DatabaseInfo[];
  currentDatabase: string | null;
  onDatabaseChange: (database: string) => Promise<boolean> | void;
  onExecute: (
    statements: string[],
    options?: { sqliteForeignKeysOff?: boolean },
  ) => Promise<{ ok: boolean; message: string }>;
  onSaved: () => void;
  onCancel: () => void;
}

const TYPE_SUGGESTIONS: Partial<Record<DatabaseType, string[]>> = {
  sqlite: ['INTEGER', 'TEXT', 'REAL', 'BLOB', 'NUMERIC'],
  mssql: [
    'INT',
    'BIGINT',
    'SMALLINT',
    'TINYINT',
    'BIT',
    'NVARCHAR(255)',
    'VARCHAR(255)',
    'DATETIME2',
    'DECIMAL(18,2)',
    'UNIQUEIDENTIFIER',
  ],
  mysql: ['INT', 'BIGINT', 'VARCHAR(255)', 'TEXT', 'DECIMAL(10,2)', 'DATETIME', 'BOOLEAN', 'JSON'],
  percona: ['INT', 'BIGINT', 'VARCHAR(255)', 'TEXT', 'DECIMAL(10,2)', 'DATETIME', 'BOOLEAN', 'JSON'],
  mariadb: ['INT', 'BIGINT', 'VARCHAR(255)', 'TEXT', 'DECIMAL(10,2)', 'DATETIME', 'BOOLEAN', 'JSON'],
};

function newColumn(dialect: DatabaseType): TableDesignColumn {
  return {
    name: '',
    type: dialect === 'sqlite' ? 'TEXT' : 'VARCHAR(255)',
    primaryKey: false,
    autoIncrement: false,
    notNull: false,
    unique: false,
    defaultValue: '',
  };
}

function splitMssqlName(name: string): { schema: string; object: string } {
  const trimmed = name.trim();
  const index = trimmed.indexOf('.');
  if (index > 0) {
    return { schema: trimmed.slice(0, index), object: trimmed.slice(index + 1) };
  }
  return { schema: 'dbo', object: trimmed };
}

function initialColumns(dialect: DatabaseType, detail?: TableDetail): TableDesignColumn[] {
  if (detail) {
    return detail.columns.map((column) => ({
      name: column.name,
      type: column.declaredType,
      primaryKey: column.primaryKey,
      autoIncrement: column.autoIncrement,
      notNull: column.notNull,
      unique: false,
      defaultValue: column.defaultValue ?? '',
      originalName: column.name,
    }));
  }
  return [
    {
      name: 'id',
      type: dialect === 'sqlite' ? 'INTEGER' : 'INT',
      primaryKey: true,
      autoIncrement: true,
      notNull: false,
      unique: false,
      defaultValue: '',
    },
  ];
}

export function TableDesignTab({
  dialect,
  mode,
  initialName,
  initialSchema,
  detail,
  sessionReady,
  databases,
  currentDatabase,
  onDatabaseChange,
  onExecute,
  onSaved,
  onCancel,
}: TableDesignTabProps) {
  const initialTarget =
    dialect === 'mssql'
      ? { ...splitMssqlName(initialName), ...(initialSchema ? { schema: initialSchema } : {}) }
      : { schema: undefined, object: initialName };
  const [schemaName, setSchemaName] = useState(initialTarget.schema ?? 'dbo');
  const [tableName, setTableName] = useState(initialTarget.object);
  const [columns, setColumns] = useState<TableDesignColumn[]>(() =>
    initialColumns(dialect, detail),
  );
  const [phase, setPhase] = useState<'edit' | 'preview'>('edit');
  const [preview, setPreview] = useState<{
    statements: string[];
    warnings: string[];
    sqliteForeignKeysOff: boolean;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [executing, setExecuting] = useState(false);
  const [switchingDatabase, setSwitchingDatabase] = useState(false);
  const [confirmName, setConfirmName] = useState('');

  const suggestions = useMemo(() => TYPE_SUGGESTIONS[dialect] ?? [], [dialect]);
  const editing = mode === 'edit';
  const canEditPrimary = !editing;
  // SQLite 只有 main（对象树里直接是表），不显示数据库选择。
  const showDatabaseSelect = dialect !== 'sqlite';
  const databaseOptions = useMemo(() => {
    const names = databases.map((database) => database.name);
    if (currentDatabase && !names.includes(currentDatabase)) {
      return [currentDatabase, ...names];
    }
    return names.length > 0 ? names : currentDatabase ? [currentDatabase] : [];
  }, [databases, currentDatabase]);
  const databaseLocked = editing;
  const removedColumns = useMemo(() => {
    if (!editing || !detail) return [];
    const kept = new Set(
      columns
        .map((column) => column.originalName)
        .filter((name): name is string => Boolean(name)),
    );
    return detail.columns.filter((column) => !kept.has(column.name));
  }, [columns, detail, editing]);
  const needsDeleteConfirm = removedColumns.length > 0;
  const deleteConfirmed =
    !needsDeleteConfirm || confirmName.trim() === initialTarget.object;

  const updateColumn = <K extends keyof TableDesignColumn>(
    index: number,
    key: K,
    value: TableDesignColumn[K],
  ) => {
    setColumns((current) =>
      current.map((column, position) =>
        position === index ? { ...column, [key]: value } : column,
      ),
    );
  };

  const addColumn = () => {
    setColumns((current) => [...current, newColumn(dialect)]);
  };

  const removeColumn = (index: number) => {
    setColumns((current) =>
      current.length <= 1 ? current : current.filter((_, position) => position !== index),
    );
  };

  const generate = () => {
    const result = buildTableDesign({
      dialect,
      mode,
      tableName,
      schema: dialect === 'mssql' ? schemaName : undefined,
      detail,
      columns,
    });
    if (!result.ok) {
      setPreview(null);
      setError(result.message);
      return;
    }
    setError(null);
    setPreview({
      statements: result.statements,
      warnings: result.warnings,
      sqliteForeignKeysOff: result.sqliteForeignKeysOff,
    });
    setPhase('preview');
  };

  const changeDatabase = async (database: string) => {
    if (!database || switchingDatabase) return;
    setSwitchingDatabase(true);
    try {
      await onDatabaseChange(database);
    } finally {
      setSwitchingDatabase(false);
    }
  };

  const execute = async () => {
    if (!preview || executing || switchingDatabase || !sessionReady) return;
    setExecuting(true);
    setError(null);
    try {
      const result = await onExecute(preview.statements, {
        sqliteForeignKeysOff: preview.sqliteForeignKeysOff,
      });
      if (result.ok) {
        onSaved();
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
    <div className="table-design-tab">
      <header className="table-design-header">
        <div>
          <h2>{editing ? `编辑表结构 · ${initialName}` : '新建表'}</h2>
          <p>
            {editing
              ? '保存后按列差异生成 DDL；SQLite 修改列类型/默认值/可空时会整表重建。'
              : '填写表名与列，保存后生成 CREATE TABLE 并执行。'}
            {!sessionReady && ' 会话正在打开，完成前不能执行。'}
          </p>
        </div>
        <button type="button" className="icon-btn" aria-label="关闭" onClick={onCancel}>
          <Icon name="close" />
        </button>
      </header>

      {phase === 'edit' ? (
        <>
          <div className="table-design-body">
            <div className="table-design-name-row">
              {dialect === 'mssql' && (
                <label className="field">
                  <span>Schema</span>
                  <input
                    value={schemaName}
                    placeholder="dbo"
                    aria-label="Schema"
                    disabled={editing}
                    title={editing ? '编辑表结构不支持切换 schema' : undefined}
                    onChange={(event) => setSchemaName(event.target.value)}
                  />
                </label>
              )}
              <label className="field">
                <span>表名</span>
                <input
                  autoFocus
                  value={tableName}
                  placeholder="例如：orders"
                  aria-label="表名"
                  onChange={(event) => setTableName(event.target.value)}
                />
              </label>
            </div>

            <div className="designer-columns">
              <div className="designer-column-head">
                <span>列名</span>
                <span>类型</span>
                <span>主键</span>
                <span>{dialect === 'mssql' ? 'Identity' : '自增'}</span>
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
                    title={column.originalName}
                    aria-label={`第 ${index + 1} 列列名`}
                    onChange={(event) => updateColumn(index, 'name', event.target.value)}
                  />
                  <input
                    list="table-design-type-suggestions"
                    value={column.type}
                    placeholder="类型"
                    aria-label={`第 ${index + 1} 列类型`}
                    onChange={(event) => updateColumn(index, 'type', event.target.value)}
                  />
                  <input
                    type="checkbox"
                    checked={Boolean(column.primaryKey)}
                    disabled={!canEditPrimary}
                    title={!canEditPrimary ? '编辑表结构时不能修改主键' : undefined}
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
                    disabled={!canEditPrimary || !column.primaryKey}
                    title={!canEditPrimary ? '编辑表结构时不能修改自增' : undefined}
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
                    disabled={editing}
                    title={editing ? '唯一约束请通过索引管理修改' : undefined}
                    aria-label={`第 ${index + 1} 列唯一`}
                    onChange={(event) => updateColumn(index, 'unique', event.target.checked)}
                  />
                  <input
                    value={column.defaultValue ?? ''}
                    placeholder="默认值"
                    aria-label={`第 ${index + 1} 列默认值`}
                    onChange={(event) =>
                      updateColumn(index, 'defaultValue', event.target.value)
                    }
                  />
                  <button
                    type="button"
                    className="icon-btn"
                    title={
                      column.originalName && column.primaryKey
                        ? '主键列不能删除'
                        : '删除列'
                    }
                    aria-label={`删除第 ${index + 1} 列`}
                    disabled={Boolean(column.originalName && column.primaryKey)}
                    onClick={() => removeColumn(index)}
                  >
                    <Icon name="close" size={13} />
                  </button>
                </div>
              ))}
            </div>

            <datalist id="table-design-type-suggestions">
              {suggestions.map((type) => (
                <option key={type} value={type} />
              ))}
            </datalist>

            <button type="button" className="btn btn-ghost" onClick={addColumn}>
              <Icon name="plus" size={13} />
              添加列
            </button>

            {editing && (
              <p className="form-note">
                主键、自增与唯一约束不在表结构页签中修改；删除主键列会被拒绝。
                修改列类型/默认值/可空时，SQLite 会整表重建并重新创建显式索引。
              </p>
            )}

            {error && <div className="form-error">{error}</div>}
          </div>

          <footer className="table-design-footer">
            <button type="button" className="btn" onClick={onCancel}>
              取消
            </button>
            <span className="spacer" />
            <button type="button" className="btn btn-primary" onClick={generate}>
              保存并生成 DDL
            </button>
          </footer>
        </>
      ) : (
        <>
          <div className="table-design-body">
            <textarea
              className="ddl-preview"
              aria-label="DDL 预览"
              value={preview?.statements.join('\n\n') ?? ''}
              readOnly
              spellCheck={false}
            />
            {needsDeleteConfirm && (
              <div className="ddl-warnings">
                <div>
                  ⚠ 将删除 {removedColumns.length} 列：
                  {removedColumns.map((column) => column.name).join('、')}。删除列不可撤销。
                </div>
              </div>
            )}
            {needsDeleteConfirm && (
              <label className="field">
                <span>输入表名确认删除列：{initialTarget.object}</span>
                <input
                  value={confirmName}
                  aria-label="输入表名确认删除列"
                  placeholder={initialTarget.object}
                  onChange={(event) => setConfirmName(event.target.value)}
                />
              </label>
            )}
            {preview && preview.warnings.length > 0 && (
              <div className="ddl-warnings">
                {preview.warnings.map((warning) => (
                  <div key={warning}>⚠ {warning}</div>
                ))}
              </div>
            )}
            <p className="form-note">{ddlTransactionHint(dialect)}</p>
            {error && <div className="form-error">{error}</div>}
          </div>

          <footer className="table-design-footer">
            <button
              type="button"
              className="btn"
              disabled={executing}
              onClick={() => {
                setPhase('edit');
                setError(null);
                setConfirmName('');
              }}
            >
              返回修改
            </button>
            <span className="spacer" />
            {showDatabaseSelect && (
              <label
                className="table-design-db"
                title={
                  databaseLocked
                    ? '编辑表结构时目标数据库固定为表所在库'
                    : '选择 DDL 执行的目标数据库'
                }
              >
                <span>数据库</span>
                <select
                  aria-label="目标数据库"
                  value={currentDatabase ?? ''}
                  disabled={
                    databaseLocked ||
                    !sessionReady ||
                    switchingDatabase ||
                    databaseOptions.length === 0
                  }
                  onChange={(event) => void changeDatabase(event.target.value)}
                >
                  {databaseOptions.length === 0 && <option value="">（未加载）</option>}
                  {databaseOptions.map((database) => (
                    <option key={database} value={database}>
                      {database}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <button
              type="button"
              className="btn btn-primary"
              disabled={
                executing ||
                switchingDatabase ||
                !sessionReady ||
                !preview ||
                !deleteConfirmed
              }
              onClick={() => void execute()}
            >
              {executing ? '执行中…' : '执行 DDL'}
            </button>
          </footer>
        </>
      )}
    </div>
  );
}
