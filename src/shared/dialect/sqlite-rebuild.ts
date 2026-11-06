import type { DdlColumnDefinition, TableDetail } from '../ipc-contract';
import { buildCreateIndex, buildCreateTable } from './ddl.ts';
import { quoteIdent } from './identifiers.ts';

export interface RebuildColumnChange {
  name: string;
  type: string;
  notNull: boolean;
  defaultValue?: string | null;
}

export type SqliteRebuildResult =
  | { ok: true; statements: string[]; warnings: string[] }
  | { ok: false; message: string; warnings: string[] };

/**
 * SQLite 修改列（类型/默认值/可空）需要重建表。
 * 只按当前列定义 + 显式索引重建；CHECK、外键、触发器无法从当前元数据还原，
 * 因此必须在 UI 明确警告并由用户确认预览。
 */
export function buildSqliteRebuild(
  detail: TableDetail,
  change: RebuildColumnChange,
): SqliteRebuildResult {
  const warnings: string[] = [];

  if (detail.kind !== 'table') {
    return { ok: false, message: '只有表可以重建。', warnings };
  }

  const target = detail.columns.find((column) => column.name === change.name);
  if (!target) {
    return { ok: false, message: `列「${change.name}」不存在。`, warnings };
  }
  if (!change.type.trim()) {
    return { ok: false, message: `列「${change.name}」缺少类型。`, warnings };
  }

  const primaryKeys = detail.columns.filter((column) => column.primaryKey);

  const tempName = `__dbcraft_rebuild_${detail.name}`;
  const columns: DdlColumnDefinition[] = detail.columns.map((column) => {
    const isTarget = column.name === change.name;
    return {
      name: column.name,
      type: isTarget ? change.type.trim() : column.declaredType,
      primaryKey: column.primaryKey,
      notNull: isTarget ? change.notNull : column.notNull,
      // 不擅自加 AUTOINCREMENT；SQLite 的 INTEGER PRIMARY KEY 本身即可自增。
      autoIncrement: false,
      defaultValue: isTarget
        ? change.defaultValue?.trim() || undefined
        : column.defaultValue?.trim() || undefined,
    };
  });

  let createSql: string;
  if (primaryKeys.length > 1) {
    // 复合主键需要表级 PRIMARY KEY；buildCreateTable 只支持单列主键。
    const lines = columns.map((column) => `  ${renderCompositeColumn(column)}`);
    lines.push(
      `  PRIMARY KEY (${primaryKeys
        .map((column) => quoteIdent('sqlite', column.name))
        .join(', ')})`,
    );
    createSql = `CREATE TABLE ${quoteIdent('sqlite', tempName)} (\n${lines.join(
      ',\n',
    )}\n);`;
  } else {
    const create = buildCreateTable('sqlite', { name: tempName, columns });
    if (!create.ok) {
      return { ok: false, message: create.message, warnings };
    }
    createSql = create.sql;
  }

  const columnList = detail.columns
    .map((column) => quoteIdent('sqlite', column.name))
    .join(', ');
  const statements = [
    createSql,
    `INSERT INTO ${quoteIdent('sqlite', tempName)} (${columnList}) SELECT ${columnList} FROM ${quoteIdent(
      'sqlite',
      detail.name,
    )};`,
    `DROP TABLE ${quoteIdent('sqlite', detail.name)};`,
    `ALTER TABLE ${quoteIdent('sqlite', tempName)} RENAME TO ${quoteIdent(
      'sqlite',
      detail.name,
    )};`,
  ];

  for (const index of detail.indexes) {
    if (/^sqlite_autoindex_/i.test(index.name)) continue;
    if (index.columns.length === 0) {
      return {
        ok: false,
        message: `索引「${index.name}」是表达式索引，当前无法自动重建。`,
        warnings,
      };
    }
    const built = buildCreateIndex('sqlite', detail.name, index.columns, {
      name: index.name,
      unique: index.unique,
    });
    if (!built.ok) {
      return { ok: false, message: `索引「${index.name}」生成失败：${built.message}`, warnings };
    }
    statements.push(built.sql);
  }

  if (detail.foreignKeys.length > 0) {
    warnings.push(`原表有 ${detail.foreignKeys.length} 个外键定义，重建后不会保留。`);
  }
  warnings.push('重建不会保留 CHECK 约束、触发器和表注释；请在预览中核对这些差异。');
  warnings.push('外键检查通过后才会提交；失败会整体回滚。');

  return { ok: true, statements, warnings };
}

function renderCompositeColumn(column: DdlColumnDefinition): string {
  const parts = [
    quoteIdent('sqlite', column.name),
    column.type.trim(),
  ];
  if (column.notNull) parts.push('NOT NULL');
  const defaultValue = column.defaultValue?.trim();
  if (defaultValue) parts.push(`DEFAULT ${defaultValue}`);
  return parts.join(' ');
}
