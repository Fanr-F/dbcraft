import { useEffect, useMemo, useRef } from 'react';
import { RevoGrid } from '@revolist/react-datagrid';
import type { QueryCell, QueryColumn } from '@shared/ipc-contract';
import { Icon } from '../../components/Icon';

interface ResultGridProps {
  columns: QueryColumn[];
  rows: QueryCell[][];
  /** 表数据页且存在主键时开启单元格编辑。 */
  editable?: boolean;
  /** 主键 / 生成列等不允许编辑的列名。 */
  readOnlyColumns?: string[];
  /** 无主键高风险模式：小于该行号的行保持只读。 */
  editableFromRow?: number;
  sorts?: Array<{ column: string; direction: 'asc' | 'desc' }>;
  theme?: 'dark' | 'light';
  onCellChange?: (rowIndex: number, columnIndex: number, value: QueryCell) => void;
  onCellsChange?: (changes: GridCellChange[]) => void;
  onHeaderClick?: (columnName: string, additive: boolean) => void;
  onRowFocus?: (rowIndex: number) => void;
  onCellFocus?: (rowIndex: number, columnIndex: number) => void;
}

interface AfterEditDetail {
  rowIndex?: number;
  prop?: string;
  val?: unknown;
  /** 范围编辑（多行粘贴）时携带按行号组织的模型。 */
  data?: Record<string, Record<string, unknown> | undefined>;
}

export interface GridCellChange {
  rowIndex: number;
  columnIndex: number;
  value: QueryCell;
}

function normalizeValue(value: unknown): QueryCell {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  return String(value);
}

/** 单元格展示：NULL 灰斜体、数字右对齐、长文本悬停查看完整值。 */
function cellProperties(
  props: { model?: Record<string, unknown>; prop?: string },
  rightAlign = false,
): Record<string, unknown> | undefined {
  const value = props.prop ? props.model?.[props.prop] : undefined;

  if (value === null || value === undefined) {
    return {
      class: 'grid-cell-null',
      style: { color: '#64748b', fontStyle: 'italic' },
      title: 'NULL',
    };
  }
  if (typeof value === 'number') {
    return { class: 'grid-cell-number', style: { textAlign: 'right' } };
  }
  if (rightAlign) {
    return { class: 'grid-cell-date', style: { textAlign: 'right' } };
  }
  if (typeof value === 'string' && value.length > 120) {
    return { title: value };
  }
  return undefined;
}

export function ResultGrid({
  columns,
  rows,
  editable = false,
  readOnlyColumns = [],
  editableFromRow,
  sorts = [],
  theme = 'dark',
  onCellChange,
  onCellsChange,
  onHeaderClick,
  onRowFocus,
  onCellFocus,
}: ResultGridProps) {
  const gridRef = useRef<HTMLElement | null>(null);
  const readOnlySet = useMemo(() => new Set(readOnlyColumns), [readOnlyColumns]);

  const gridColumns = useMemo(() => {
    const sample = rows.slice(0, 50);

    return columns.map((column, index) => {
      const contentWidth = sample.reduce(
        (width, row) => Math.max(width, String(row[index] ?? '').length * 8 + 28),
        0,
      );
      const size = Math.min(360, Math.max(120, column.name.length * 9 + 56, contentWidth));
      const sortIndex = sorts.findIndex((item) => item.column === column.name);
      const sorted = sortIndex >= 0;
      const sortLabel = sorted
        ? `${sorts[sortIndex]!.direction === 'desc' ? '↓' : '↑'}${
            sorts.length > 1 ? String(sortIndex + 1) : ''
          }`
        : '';
      const label = sorted ? `${column.name} ${sortLabel}` : column.name;
      const dateLike = /date|time|year/i.test(column.declaredType ?? '');

      return {
        prop: `c${index}`,
        name: label,
        size,
        ...(index === 0 ? { pin: 'colPinStart' } : {}),
        filter: 'string',
        // 普通查询结果使用网格本地排序；表数据页由列头点击触发服务端 ORDER BY。
        sortable: !onHeaderClick,
        cellProperties: ((props: never) => cellProperties(props, dateLike)) as never,
        readonly:
          !editable || readOnlySet.has(column.name)
            ? true
            : typeof editableFromRow === 'number'
              ? (params: { rowIndex: number }) => params.rowIndex < editableFromRow
              : false,
        // 列头悬停展示数据库返回的类型；没有类型信息时不伪造。
        ...(column.declaredType
          ? {
              columnProperties: () => ({
                title: `${column.name} · ${column.declaredType}`,
              }),
            }
          : {}),
      };
    }) as any[];
  }, [columns, rows, editable, readOnlySet, editableFromRow, sorts]);

  const source = useMemo(
    () =>
      rows.map((row) => {
        const record: Record<string, QueryCell> = {};
        row.forEach((value, index) => {
          record[`c${index}`] = value;
        });
        return record;
      }),
    [rows],
  );

  // RevoGrid 是 Web Component，事件通过 addEventListener 监听更可靠。
  useEffect(() => {
    const element = gridRef.current;
    if (!element || !editable || (!onCellChange && !onCellsChange)) return;

    const handler = (event: Event) => {
      const detail = (event as CustomEvent<AfterEditDetail>).detail;
      if (!detail) return;

      // 多行粘贴：按行号回传所有变化的单元格。
      if (detail.data && typeof detail.data === 'object' && onCellsChange) {
        const changes: GridCellChange[] = [];
        for (const [rowKey, model] of Object.entries(detail.data)) {
          const rowIndex = Number(rowKey);
          if (!Number.isInteger(rowIndex) || !model) continue;
          for (const [prop, value] of Object.entries(model)) {
            if (!prop.startsWith('c')) continue;
            const columnIndex = Number(prop.slice(1));
            if (!Number.isInteger(columnIndex) || columnIndex < 0) continue;
            changes.push({ rowIndex, columnIndex, value: normalizeValue(value) });
          }
        }
        if (changes.length > 0) onCellsChange(changes);
        return;
      }

      if (typeof detail.rowIndex !== 'number' || typeof detail.prop !== 'string') {
        return;
      }
      if (!detail.prop.startsWith('c')) return;

      const columnIndex = Number(detail.prop.slice(1));
      if (!Number.isInteger(columnIndex) || columnIndex < 0) return;
      onCellChange?.(detail.rowIndex, columnIndex, normalizeValue(detail.val));
    };

    element.addEventListener('afteredit', handler);
    return () => element.removeEventListener('afteredit', handler);
  }, [editable, onCellChange, onCellsChange]);

  // 列头点击交给上层生成 ORDER BY（服务端排序）。
  useEffect(() => {
    const element = gridRef.current;
    if (!element || !onHeaderClick) return;

    const handler = (event: Event) => {
      const column = (
        event as CustomEvent<{ prop?: string; originalEvent?: MouseEvent }>
      ).detail;
      if (!column || typeof column.prop !== 'string' || !column.prop.startsWith('c')) return;

      const index = Number(column.prop.slice(1));
      const target = columns[index];
      if (target) {
        onHeaderClick(target.name, Boolean(column.originalEvent?.shiftKey));
      }
    };

    element.addEventListener('headerclick', handler);
    return () => element.removeEventListener('headerclick', handler);
  }, [columns, onHeaderClick]);

  // 记录当前聚焦单元格，供「查看单元格」与「删除选中行」使用。
  useEffect(() => {
    const element = gridRef.current;
    if (!element || (!onRowFocus && !onCellFocus)) return;

    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ rowIndex?: number; prop?: string }>).detail;
      if (!detail || typeof detail.rowIndex !== 'number') return;
      if (typeof detail.prop === 'string' && detail.prop.startsWith('c')) {
        onRowFocus?.(detail.rowIndex);
        const columnIndex = Number(detail.prop.slice(1));
        if (Number.isInteger(columnIndex) && columnIndex >= 0) {
          onCellFocus?.(detail.rowIndex, columnIndex);
        }
      }
    };

    element.addEventListener('beforecellfocus', handler);
    return () => element.removeEventListener('beforecellfocus', handler);
  }, [onRowFocus, onCellFocus]);

  if (columns.length === 0) {
    return (
      <div className="grid-host">
        <div className="grid-empty">
          <Icon name="table" size={26} />
          <strong>还没有结果</strong>
          <span>连接 SQLite 后执行查询，结果会显示在这里。</span>
        </div>
      </div>
    );
  }

  return (
    <div className="grid-host">
      <RevoGrid
        key={columns.map((column) => column.name).join('|')}
        ref={gridRef as never}
        theme={theme}
        columns={gridColumns}
        source={source}
        range={true}
        useClipboard={true}
        readonly={!editable}
        rowHeaders={true}
        filter={true}
        style={{ height: '100%' }}
      />
    </div>
  );
}
