import type { DatabaseType, TableDetail } from '../ipc-contract';
import {
  buildAddColumn,
  buildCreateTable,
  buildDropColumn,
  buildModifyColumn,
  buildRenameColumn,
  buildRenameTable,
  type DdlGenerateResult,
} from './ddl.ts';
import { buildSqliteRebuildTable, type RebuildTableColumn } from './sqlite-rebuild.ts';

export interface TableDesignColumn extends RebuildTableColumn {
  /** 编辑模式下对应原列名；新增列省略。 */
  originalName?: string;
}

export interface TableDesignInput {
  dialect: DatabaseType;
  mode: 'create' | 'edit';
  /** 目标表名；编辑模式可与原表名不同。 */
  tableName: string;
  /** MSSQL 的 schema；其他方言忽略。 */
  schema?: string;
  columns: TableDesignColumn[];
  /** 编辑模式必传，用于计算差异。 */
  detail?: TableDetail;
}

export type TableDesignResult =
  | {
      ok: true;
      statements: string[];
      warnings: string[];
      /** SQLite 整表重建需要在执行期间关闭外键检查。 */
      sqliteForeignKeysOff: boolean;
    }
  | { ok: false; message: string; warnings: string[] };

function normalize(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function optionValue(column: TableDesignColumn): string {
  return column.defaultValue?.trim() ?? '';
}

/**
 * 新建表 / 编辑表结构共用的 DDL 生成入口。
 * 新建走 CREATE TABLE；编辑按列差异生成 ALTER，SQLite 修改列时整表重建。
 */
export function buildTableDesign(input: TableDesignInput): TableDesignResult {
  const warnings: string[] = [];
  const tableName = input.tableName.trim();
  if (!tableName) {
    return { ok: false, message: '表名不能为空。', warnings };
  }
  if (input.columns.length === 0) {
    return { ok: false, message: '至少需要一列。', warnings };
  }

  const names = new Set<string>();
  for (const column of input.columns) {
    const name = column.name.trim();
    if (!name) {
      return { ok: false, message: '列名不能为空。', warnings };
    }
    if (!column.type.trim()) {
      return { ok: false, message: `列「${name}」缺少类型。`, warnings };
    }
    const key = name.toLowerCase();
    if (names.has(key)) {
      return { ok: false, message: `列名重复：${name}。`, warnings };
    }
    names.add(key);
  }

  if (input.mode === 'create') {
    const created = buildCreateTable(input.dialect, {
      name: tableName,
      schema: input.dialect === 'mssql' ? input.schema : undefined,
      columns: input.columns.map((column) => ({
        name: column.name.trim(),
        type: column.type.trim(),
        primaryKey: column.primaryKey,
        autoIncrement: column.autoIncrement,
        notNull: column.notNull,
        unique: column.unique,
        defaultValue: optionValue(column) || undefined,
      })),
    });
    if (!created.ok) return { ok: false, message: created.message, warnings: created.warnings };
    return {
      ok: true,
      statements: [created.sql],
      warnings: created.warnings,
      sqliteForeignKeysOff: false,
    };
  }

  const detail = input.detail;
  if (!detail) {
    return { ok: false, message: '编辑表结构缺少原始表信息。', warnings };
  }
  if (detail.kind !== 'table') {
    return { ok: false, message: '视图不能编辑表结构。', warnings };
  }

  const targetName =
    input.dialect === 'mssql' && input.schema?.trim()
      ? `${input.schema.trim()}.${tableName}`
      : tableName;
  if (input.dialect === 'mssql' && detail.name.includes('.')) {
    const originalSchema = detail.name.slice(0, detail.name.indexOf('.'));
    if (input.schema?.trim() && input.schema.trim() !== originalSchema) {
      return {
        ok: false,
        message: '编辑表结构不支持切换 schema；如需移动表请使用 SQL 编辑器。',
        warnings,
      };
    }
  }

  const originals = new Map(detail.columns.map((column) => [column.name, column]));

  /** 未显式提供的属性沿用原列定义，避免 UI 只改一列时误判其他属性。 */
  const resolve = (column: TableDesignColumn) => {
    const original = column.originalName ? originals.get(column.originalName) : undefined;
    return {
      name: column.name.trim(),
      type: column.type.trim(),
      primaryKey: column.primaryKey ?? original?.primaryKey ?? false,
      autoIncrement: column.autoIncrement ?? original?.autoIncrement ?? false,
      notNull: column.notNull ?? original?.notNull ?? false,
      unique: column.unique ?? false,
      defaultValue:
        column.defaultValue === undefined
          ? (original?.defaultValue ?? undefined)
          : optionValue(column) || undefined,
      originalName: column.originalName,
    };
  };
  const resolved = input.columns.map(resolve);

  const usedOriginalNames = new Set<string>();
  for (const column of resolved) {
    if (!column.originalName) continue;
    const original = originals.get(column.originalName);
    if (!original) {
      return {
        ok: false,
        message: `原列「${column.originalName}」不存在，可能已被其他会话修改，请关闭页签后重试。`,
        warnings,
      };
    }
    if (usedOriginalNames.has(column.originalName)) {
      return { ok: false, message: `原列「${column.originalName}」被重复使用。`, warnings };
    }
    usedOriginalNames.add(column.originalName);
    if (column.primaryKey !== original.primaryKey) {
      return { ok: false, message: '主键列不能在表结构编辑中新增或取消。', warnings };
    }
    if (column.autoIncrement !== original.autoIncrement) {
      return { ok: false, message: '自增属性不能在表结构编辑中修改。', warnings };
    }
    if (
      (column.primaryKey || column.autoIncrement) &&
      (normalize(column.type) !== normalize(original.declaredType) ||
        column.notNull !== original.notNull ||
        normalize(column.defaultValue) !== normalize(original.defaultValue))
    ) {
      return {
        ok: false,
        message: '主键/自增列的列定义不能在编辑页签中修改；请使用 SQL 编辑器。',
        warnings,
      };
    }
  }

  const removed = detail.columns.filter((column) => !usedOriginalNames.has(column.name));
  if (removed.some((column) => column.primaryKey || column.autoIncrement)) {
    return { ok: false, message: '主键/自增列不能删除。', warnings };
  }

  const added = resolved.filter((column) => !column.originalName);
  if (added.some((column) => column.primaryKey || column.autoIncrement)) {
    return {
      ok: false,
      message: '新增列不能直接设为主键/自增；请新建表或使用 SQL 编辑器。',
      warnings,
    };
  }

  const renamed = resolved.filter(
    (column) => column.originalName && column.originalName !== column.name,
  );
  const modified = resolved.filter((column) => {
    if (!column.originalName) return false;
    const original = originals.get(column.originalName);
    if (!original) return false;
    return (
      normalize(column.type) !== normalize(original.declaredType) ||
      column.notNull !== original.notNull ||
      normalize(column.defaultValue) !== normalize(original.defaultValue)
    );
  });

  if (input.dialect === 'mssql') {
    const defaultChanged = modified.some((column) => {
      const original = column.originalName ? originals.get(column.originalName) : undefined;
      return (
        original !== undefined &&
        normalize(column.defaultValue) !== normalize(original.defaultValue)
      );
    });
    if (defaultChanged) {
      return {
        ok: false,
        message:
          'MSSQL 修改默认值需要先删除默认约束；当前表结构页签只支持修改类型和可空性，请使用 SQL 编辑器。',
        warnings,
      };
    }
  }

  // SQLite 不支持 MODIFY COLUMN；有任何列定义变化就整表重建。
  if (input.dialect === 'sqlite' && modified.length > 0) {
    const rebuilt = buildSqliteRebuildTable(detail, resolved, tableName);
    if (!rebuilt.ok) {
      return { ok: false, message: rebuilt.message, warnings: [...warnings, ...rebuilt.warnings] };
    }
    warnings.push(...rebuilt.warnings);
    return {
      ok: true,
      statements: rebuilt.statements,
      warnings,
      sqliteForeignKeysOff: true,
    };
  }

  const statements: string[] = [];
  let currentTable = targetName;
  if (targetName !== detail.name) {
    const renamedTable = buildRenameTable(input.dialect, detail.name, tableName);
    if (!renamedTable.ok) {
      return { ok: false, message: renamedTable.message, warnings: [...warnings, ...renamedTable.warnings] };
    }
    statements.push(renamedTable.sql);
    warnings.push(...renamedTable.warnings);
  }

  for (const column of renamed) {
    const built = buildRenameColumn(
      input.dialect,
      currentTable,
      column.originalName!,
      column.name.trim(),
    );
    if (!built.ok) return { ok: false, message: built.message, warnings: [...warnings, ...built.warnings] };
    statements.push(built.sql);
    warnings.push(...built.warnings);
  }

  for (const column of added) {
    const built = buildAddColumn(input.dialect, currentTable, {
      name: column.name.trim(),
      type: column.type.trim(),
      primaryKey: column.primaryKey,
      autoIncrement: column.autoIncrement,
      notNull: column.notNull,
      unique: column.unique,
      defaultValue: optionValue(column) || undefined,
    });
    if (!built.ok) return { ok: false, message: built.message, warnings: [...warnings, ...built.warnings] };
    statements.push(built.sql);
    warnings.push(...built.warnings);
  }

  for (const column of removed) {
    const built = buildDropColumn(input.dialect, currentTable, column.name);
    if (!built.ok) return { ok: false, message: built.message, warnings: [...warnings, ...built.warnings] };
    statements.push(built.sql);
    warnings.push(...built.warnings);
  }

  for (const column of modified) {
    const built: DdlGenerateResult = buildModifyColumn(
      input.dialect,
      currentTable,
      column.name.trim(),
      {
        name: column.name.trim(),
        type: column.type.trim(),
        primaryKey: column.primaryKey,
        autoIncrement: column.autoIncrement,
        notNull: column.notNull,
        unique: column.unique,
        defaultValue: optionValue(column) || undefined,
      },
    );
    if (!built.ok) return { ok: false, message: built.message, warnings: [...warnings, ...built.warnings] };
    statements.push(built.sql);
    warnings.push(...built.warnings);
  }

  if (statements.length === 0) {
    return { ok: false, message: '没有检测到结构变化。', warnings };
  }

  return { ok: true, statements, warnings, sqliteForeignKeysOff: false };
}
