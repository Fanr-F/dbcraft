import { useState } from 'react';
import type { DatabaseType, TableDetail } from '@shared/ipc-contract';
import { buildAddCheck, buildAddForeignKey, buildAddPrimaryKey, buildCreateIndex, buildDropCheck, buildDropForeignKey, buildDropIndex, buildDropPrimaryKey, buildDropTrigger, buildTableComment } from '@shared/dialect/ddl';
import { buildSqliteRebuildTable } from '@shared/dialect/sqlite-rebuild';
import { Icon } from './Icon';

interface TableStructureDialogProps {
  detail: TableDetail;
  dialect: DatabaseType;
  onExecute?: (sql: string) => Promise<{ ok: boolean; message: string }>;
  onExecuteStatements?: (
    statements: string[],
    options?: { sqliteForeignKeysOff?: boolean },
  ) => Promise<{ ok: boolean; message: string }>;
  onOpenEditor?: (sql: string, title: string) => void;
  onClose: () => void;
}

function triggerTemplate(dialect: DatabaseType, table: string): string {
  if (dialect === 'sqlite') {
    return `CREATE TRIGGER trg_${table}_after_insert\nAFTER INSERT ON "${table}"\nBEGIN\n  -- 在这里编写触发器逻辑\nEND;`;
  }
  if (dialect === 'mssql') {
    return `CREATE TRIGGER [trg_${table}_after_insert]\nON ${table}\nAFTER INSERT\nAS\nBEGIN\n  SET NOCOUNT ON;\n  -- 在这里编写触发器逻辑\nEND;`;
  }
  return `DELIMITER $$\nCREATE TRIGGER trg_${table}_after_insert\nAFTER INSERT ON \`${table}\`\nFOR EACH ROW\nBEGIN\n  -- 在这里编写触发器逻辑\nEND$$\nDELIMITER ;`;
}

function orDash(value: string | null | undefined): string {
  return value === null || value === undefined || value === '' ? '—' : value;
}

export function TableStructureDialog({
  detail,
  dialect,
  onExecute,
  onExecuteStatements,
  onOpenEditor,
  onClose,
}: TableStructureDialogProps) {
  const [comment, setComment] = useState(detail.comment ?? '');
  const [draft, setDraft] = useState(comment);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [fkColumns, setFkColumns] = useState('');
  const [fkRefTable, setFkRefTable] = useState('');
  const [fkRefColumns, setFkRefColumns] = useState('');
  const [fkName, setFkName] = useState('');
  const [fkOnDelete, setFkOnDelete] = useState('NO ACTION');
  const [fkOnUpdate, setFkOnUpdate] = useState('NO ACTION');
  const [uniqueName, setUniqueName] = useState('');
  const [uniqueColumns, setUniqueColumns] = useState('');
  const [checkName, setCheckName] = useState('');
  const [checkExpression, setCheckExpression] = useState('');
  const [pkColumns, setPkColumns] = useState(detail.primaryKey.join(', '));
  const [pkName, setPkName] = useState(detail.primaryKeyName ?? '');

  const generated = editing ? buildTableComment(dialect, detail.name, draft) : null;

  const saveComment = async () => {
    if (!generated?.ok || busy || !onExecute) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await onExecute(generated.sql);
      if (result.ok) {
        setComment(draft);
        setEditing(false);
        setMessage('表注释已更新。');
      } else {
        setMessage(result.message);
      }
    } finally {
      setBusy(false);
    }
  };

  const executeConstraint = async (
    result: { ok: true; sql: string } | { ok: false; message: string },
    success: string,
    confirmed = false,
  ) => {
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    if (!onExecute || busy) return;
    if (!confirmed && !window.confirm(`将执行：\n${result.sql}\n\n继续吗？`)) return;
    setBusy(true);
    setMessage(null);
    try {
      const executed = await onExecute(result.sql);
      setMessage(executed.ok ? success : executed.message);
    } finally {
      setBusy(false);
    }
  };

  const addForeignKey = async () => {
    await executeConstraint(
      buildAddForeignKey(dialect, detail.name, {
        name: fkName,
        columns: fkColumns.split(','),
        referencedTable: fkRefTable,
        referencedColumns: fkRefColumns.split(','),
        onDelete: fkOnDelete,
        onUpdate: fkOnUpdate,
      }),
      '外键已添加；请关闭后重新打开查看最新结构。',
    );
  };

  const dropForeignKey = async (name: string) => {
    if (!window.confirm(`删除外键「${name}」？`)) return;
    await executeConstraint(
      buildDropForeignKey(dialect, detail.name, name),
      '外键已删除；请关闭后重新打开查看最新结构。',
      true,
    );
  };

  const addUnique = async () => {
    await executeConstraint(
      buildCreateIndex(dialect, detail.name, uniqueColumns.split(','), {
        name: uniqueName,
        unique: true,
      }),
      '唯一索引已创建；请关闭后重新打开查看最新结构。',
    );
  };

  const dropUnique = async (name: string) => {
    if (!window.confirm(`删除唯一索引「${name}」？`)) return;
    await executeConstraint(
      buildDropIndex(dialect, name, detail.name),
      '唯一索引已删除；请关闭后重新打开查看最新结构。',
      true,
    );
  };

  const addCheck = async () => {
    await executeConstraint(
      buildAddCheck(dialect, detail.name, checkName, checkExpression),
      'CHECK 约束已添加；请关闭后重新打开查看最新结构。',
    );
  };

  const dropCheck = async (name: string) => {
    if (!window.confirm(`删除 CHECK 约束「${name}」？`)) return;
    await executeConstraint(
      buildDropCheck(dialect, detail.name, name),
      'CHECK 约束已删除；请关闭后重新打开查看最新结构。',
      true,
    );
  };

  const dropTrigger = async (name: string) => {
    if (!window.confirm(`删除触发器「${name}」？`)) return;
    await executeConstraint(
      buildDropTrigger(dialect, name),
      '触发器已删除；请关闭后重新打开查看最新结构。',
      true,
    );
  };

  const changePrimaryKey = async () => {
    const next = pkColumns
      .split(',')
      .map((column) => column.trim())
      .filter(Boolean);
    if (next.length === 0) {
      setMessage('主键至少需要一列；当前版本不提供删除主键入口。');
      return;
    }
    const current = detail.primaryKey.map((column) => column.toLowerCase());
    if (
      current.length === next.length &&
      current.every((column, index) => column === next[index]!.toLowerCase())
    ) {
      setMessage('主键没有变化。');
      return;
    }
    if (!window.confirm(`把主键修改为 (${next.join(', ')})？`)) return;
    setBusy(true);
    setMessage(null);
    try {
      let result: { ok: boolean; message: string };
      if (dialect === 'sqlite') {
        const nextSet = new Set(next.map((column) => column.toLowerCase()));
        const columns = detail.columns.map((column) => ({
          name: column.name,
          type: column.declaredType,
          primaryKey: nextSet.has(column.name.toLowerCase()),
          autoIncrement: column.autoIncrement,
          notNull: column.notNull,
          defaultValue: column.defaultValue ?? undefined,
          originalName: column.name,
        }));
        const rebuilt = buildSqliteRebuildTable(detail, columns, detail.name);
        if (!rebuilt.ok) {
          setMessage(rebuilt.message);
          return;
        }
        result = onExecuteStatements
          ? await onExecuteStatements(rebuilt.statements, { sqliteForeignKeysOff: true })
          : { ok: false, message: '当前入口不支持多语句执行。' };
      } else {
        const statements: string[] = [];
        if (detail.primaryKey.length > 0) {
          const dropped = buildDropPrimaryKey(dialect, detail.name, pkName || undefined);
          if (!dropped.ok) {
            setMessage(dropped.message);
            return;
          }
          statements.push(dropped.sql);
        }
        const added = buildAddPrimaryKey(dialect, detail.name, next, pkName || undefined);
        if (!added.ok) {
          setMessage(added.message);
          return;
        }
        statements.push(added.sql);
        result = onExecuteStatements
          ? await onExecuteStatements(statements)
          : { ok: false, message: '当前入口不支持多语句执行。' };
      }
      setMessage(result.ok ? '主键已修改；请关闭后重新打开查看最新结构。' : result.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal structure-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="structure-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="modal-header">
          <div>
            <h2 id="structure-title">表结构 · {detail.name}</h2>
            <p>结构展示；表注释可直接编辑，其他修改请使用 DDL 预览或查询编辑器。</p>
          </div>
          <button type="button" className="icon-btn" aria-label="关闭" onClick={onClose}>
            <Icon name="close" />
          </button>
        </header>

        <div className="modal-body structure-body">
          <div className="structure-comment-row">
            <span className="pane-hint">表注释：{comment || '（无）'}</span>
            {dialect !== 'sqlite' && !editing && (
              <button
                type="button"
                className="btn"
                disabled={!onExecute}
                onClick={() => {
                  setDraft(comment);
                  setEditing(true);
                }}
              >
                编辑注释
              </button>
            )}
          </div>

          {editing && (
            <div className="structure-comment-edit">
              <input
                autoFocus
                className="structure-comment-input"
                value={draft}
                placeholder="表注释（可留空）"
                aria-label="表注释"
                onChange={(event) => setDraft(event.target.value)}
              />
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() => setEditing(false)}
              >
                取消
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy || !generated?.ok || !onExecute}
                onClick={() => void saveComment()}
              >
                {busy ? '保存中…' : '保存注释'}
              </button>
            </div>
          )}

          {generated && !generated.ok && <div className="form-error">{generated.message}</div>}
          {message && <p className="form-note">{message}</p>}

          <h3>列（{detail.columns.length}）</h3>
          <div className="structure-scroll">
            <table className="structure-table">
              <thead>
                <tr>
                  <th>列名</th>
                  <th>类型</th>
                  <th>可空</th>
                  <th>默认值</th>
                  <th>主键</th>
                  <th>自增</th>
                </tr>
              </thead>
              <tbody>
                {detail.columns.map((column) => (
                  <tr key={column.name}>
                    <td>{column.name}</td>
                    <td>{column.declaredType}</td>
                    <td>{column.notNull ? '否' : '是'}</td>
                    <td>{orDash(column.defaultValue)}</td>
                    <td>{column.primaryKey ? '是' : '—'}</td>
                    <td>{column.autoIncrement ? '是' : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3>主键（{detail.primaryKey.length > 0 ? detail.primaryKey.join(', ') : '无'}）</h3>
          <div className="structure-constraint-form">
            <label className="field">
              <span>主键列（逗号分隔）</span>
              <input value={pkColumns} onChange={(event) => setPkColumns(event.target.value)} />
            </label>
            {dialect === 'mssql' && (
              <label className="field">
                <span>约束名</span>
                <input value={pkName} onChange={(event) => setPkName(event.target.value)} />
              </label>
            )}
            <button
              type="button"
              className="btn"
              disabled={busy || !onExecuteStatements}
              onClick={() => void changePrimaryKey()}
            >
              修改主键
            </button>
          </div>
          <p className="form-note">
            {dialect === 'sqlite'
              ? 'SQLite 会整表重建并将数据复制到新表。'
              : '修改主键会先删除旧主键约束，再创建新约束。'}
          </p>

          <h3>索引（{detail.indexes.length}）</h3>
          {detail.indexes.length === 0 ? (
            <p className="pane-hint">没有显式索引。</p>
          ) : (
            <ul className="structure-list">
              {detail.indexes.map((index) => (
                <li key={index.name}>
                  <strong>{index.name}</strong>
                  <span>{index.unique ? '唯一' : '普通'}</span>
                  <span>({index.columns.join(', ')})</span>
                  {index.unique && (
                    <button
                      type="button"
                      className="btn btn-danger"
                      disabled={busy || !onExecute}
                      onClick={() => void dropUnique(index.name)}
                    >
                      删除
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}

          <h3>CHECK（{detail.checks.length}）</h3>
          {detail.checks.length === 0 ? (
            <p className="pane-hint">没有 CHECK 约束。</p>
          ) : (
            <ul className="structure-list">
              {detail.checks.map((check, index) => (
                <li key={`${check.name ?? 'check'}-${index}`}>
                  <strong>{check.name ?? `CHECK ${index + 1}`}</strong>
                  <span>{check.expression}</span>
                  {check.name && (
                    <button
                      type="button"
                      className="btn btn-danger"
                      disabled={busy || !onExecute}
                      onClick={() => void dropCheck(check.name!)}
                    >
                      删除
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}

          <h3>添加 CHECK</h3>
          <div className="structure-constraint-form">
            <label className="field">
              <span>约束名</span>
              <input value={checkName} onChange={(event) => setCheckName(event.target.value)} />
            </label>
            <label className="field">
              <span>表达式</span>
              <input
                value={checkExpression}
                placeholder="如 amount > 0"
                onChange={(event) => setCheckExpression(event.target.value)}
              />
            </label>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || !onExecute}
              onClick={() => void addCheck()}
            >
              添加 CHECK
            </button>
          </div>

          <h3>外键（{detail.foreignKeys.length}）</h3>
          {detail.foreignKeys.length === 0 ? (
            <p className="pane-hint">没有外键。</p>
          ) : (
            <ul className="structure-list">
              {detail.foreignKeys.map((foreignKey) => (
                <li key={foreignKey.name}>
                  <strong>{foreignKey.name}</strong>
                  <span>
                    ({foreignKey.columns.join(', ')}) → {foreignKey.referencedTable}
                    {foreignKey.referencedColumns.length > 0
                      ? ` (${foreignKey.referencedColumns.join(', ')})`
                      : ''}
                  </span>
                  <span>ON DELETE {orDash(foreignKey.onDelete)}</span>
                  <span>ON UPDATE {orDash(foreignKey.onUpdate)}</span>
                  <button
                    type="button"
                    className="btn btn-danger"
                    disabled={busy || !onExecute}
                    onClick={() => void dropForeignKey(foreignKey.name)}
                  >
                    删除
                  </button>
                </li>
              ))}
            </ul>
          )}

          <h3>触发器（{(detail.triggers ?? []).length}）</h3>
          {(detail.triggers ?? []).length === 0 ? (
            <p className="pane-hint">没有触发器。</p>
          ) : (
            <ul className="structure-list">
              {(detail.triggers ?? []).map((trigger) => (
                <li key={trigger.name}>
                  <strong>{trigger.name}</strong>
                  <span>{trigger.disabled ? '已禁用' : '已启用'}</span>
                  <button
                    type="button"
                    className="btn btn-danger"
                    disabled={busy || !onExecute}
                    onClick={() => void dropTrigger(trigger.name)}
                  >
                    删除
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button
            type="button"
            className="btn"
            disabled={!onOpenEditor}
            onClick={() =>
              onOpenEditor?.(triggerTemplate(dialect, detail.name), `触发器 · ${detail.name}`)
            }
          >
            在编辑器中新建触发器
          </button>

          <h3>添加外键</h3>
          <div className="structure-constraint-form">
            <label className="field">
              <span>本表列（逗号分隔）</span>
              <input value={fkColumns} onChange={(event) => setFkColumns(event.target.value)} />
            </label>
            <label className="field">
              <span>引用表</span>
              <input
                value={fkRefTable}
                placeholder="如 dbo.users"
                onChange={(event) => setFkRefTable(event.target.value)}
              />
            </label>
            <label className="field">
              <span>引用列（逗号分隔）</span>
              <input
                value={fkRefColumns}
                onChange={(event) => setFkRefColumns(event.target.value)}
              />
            </label>
            <label className="field">
              <span>约束名（可留空）</span>
              <input value={fkName} onChange={(event) => setFkName(event.target.value)} />
            </label>
            <label className="field">
              <span>ON DELETE</span>
              <select value={fkOnDelete} onChange={(event) => setFkOnDelete(event.target.value)}>
                {['NO ACTION', 'CASCADE', 'SET NULL', 'RESTRICT'].map((action) => (
                  <option key={action} value={action}>{action}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>ON UPDATE</span>
              <select value={fkOnUpdate} onChange={(event) => setFkOnUpdate(event.target.value)}>
                {['NO ACTION', 'CASCADE', 'SET NULL', 'RESTRICT'].map((action) => (
                  <option key={action} value={action}>{action}</option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || !onExecute}
              onClick={() => void addForeignKey()}
            >
              添加外键
            </button>
          </div>

          <h3>添加唯一索引</h3>
          <div className="structure-constraint-form">
            <label className="field">
              <span>列（逗号分隔）</span>
              <input
                value={uniqueColumns}
                onChange={(event) => setUniqueColumns(event.target.value)}
              />
            </label>
            <label className="field">
              <span>索引名（可留空）</span>
              <input value={uniqueName} onChange={(event) => setUniqueName(event.target.value)} />
            </label>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || !onExecute}
              onClick={() => void addUnique()}
            >
              创建唯一索引
            </button>
          </div>

          <p className="form-note">
            主键仍为只读；需要改主键请使用表设计页签（SQLite 会整表重建）或 SQL 编辑器。
          </p>
        </div>

        <footer className="modal-footer">
          <button type="button" className="btn" onClick={onClose}>
            关闭
          </button>
        </footer>
      </div>
    </div>
  );
}
