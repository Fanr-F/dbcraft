import { useEffect, useMemo, useRef, useState } from 'react';
import { RevoGrid } from '@revolist/react-datagrid';
import type { QueryCell, QueryColumn } from '@shared/ipc-contract';
import { Icon } from '../../components/Icon';
import { ContextMenu } from '../../components/ContextMenu';
import { typedEditor } from './typed-editor';

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
  /** 当前聚焦单元格；右键菜单据此定位。 */
  focusedCell?: { rowIndex: number; columnIndex: number } | null;
  /** 待新增的行号集合；这些行可使用数据库默认值。 */
  insertRows?: number[];
  onSetCellNull?: (rowIndex: number, columnIndex: number) => void;
  onSetCellDefault?: (rowIndex: number, columnIndex: number) => void;
  /** 拖拽/Shift 选择的行区间（含端点）。 */
  onRowRangeChange?: (start: number, end: number) => void;
  /** 表数据页的布局记忆键；为空时不做持久化（普通查询结果）。 */
  layoutKey?: string;
}

/** 按表记忆的列布局：拖动后的宽度、隐藏列、固定前 N 列。 */
interface GridColumnLayout {
  widths: Record<string, number>;
  hidden: string[];
  pinned: number;
}

function emptyLayout(): GridColumnLayout {
  return { widths: {}, hidden: [], pinned: 1 };
}

function readLayout(key: string | undefined): GridColumnLayout {
  if (!key) return emptyLayout();
  try {
    const raw = window.localStorage.getItem(`dbcraft.gridLayout.${key}`);
    if (!raw) return emptyLayout();
    const parsed = JSON.parse(raw) as Partial<GridColumnLayout>;
    return {
      widths:
        parsed.widths && typeof parsed.widths === 'object' ? parsed.widths : {},
      hidden: Array.isArray(parsed.hidden)
        ? parsed.hidden.filter((item): item is string => typeof item === 'string')
        : [],
      pinned:
        typeof parsed.pinned === 'number' && parsed.pinned >= 0
          ? Math.floor(parsed.pinned)
          : 1,
    };
  } catch {
    return emptyLayout();
  }
}

function writeLayout(key: string | undefined, layout: GridColumnLayout): void {
  if (!key) return;
  try {
    window.localStorage.setItem(`dbcraft.gridLayout.${key}`, JSON.stringify(layout));
  } catch {
    // localStorage 不可用时只影响记忆，不影响本次布局。
  }
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
  focusedCell,
  insertRows = [],
  onSetCellNull,
  onSetCellDefault,
  onRowRangeChange,
  layoutKey,
}: ResultGridProps) {
  const gridRef = useRef<HTMLElement | null>(null);
  const readOnlySet = useMemo(() => new Set(readOnlyColumns), [readOnlyColumns]);
  const [layout, setLayout] = useState<GridColumnLayout>(() => readLayout(layoutKey));
  const [cellMenu, setCellMenu] = useState<{
    x: number;
    y: number;
    rowIndex: number;
    columnIndex: number;
  } | null>(null);

  useEffect(() => {
    setLayout(readLayout(layoutKey));
  }, [layoutKey]);

  const updateLayout = (next: GridColumnLayout) => {
    setLayout(next);
    writeLayout(layoutKey, next);
  };

  const toggleColumn = (name: string) => {
    const visible = columns.filter((column) => !layout.hidden.includes(column.name));
    if (!layout.hidden.includes(name) && visible.length <= 1) return;
    const hidden = layout.hidden.includes(name)
      ? layout.hidden.filter((item) => item !== name)
      : [...layout.hidden, name];
    updateLayout({ ...layout, hidden });
  };

  const gridColumns = useMemo(() => {
    const sample = rows.slice(0, 50);
    let visibleIndex = 0;

    return columns.flatMap((column, index) => {
      if (layout.hidden.includes(column.name)) return [];
      const contentWidth = sample.reduce(
        (width, row) => Math.max(width, String(row[index] ?? '').length * 8 + 28),
        0,
      );
      const autoSize = Math.min(360, Math.max(120, column.name.length * 9 + 56, contentWidth));
      const size = layout.widths[column.name] ?? autoSize;
      const sortIndex = sorts.findIndex((item) => item.column === column.name);
      const sorted = sortIndex >= 0;
      const sortLabel = sorted
        ? `${sorts[sortIndex]!.direction === 'desc' ? '↓' : '↑'}${
            sorts.length > 1 ? String(sortIndex + 1) : ''
          }`
        : '';
      const label = sorted ? `${column.name} ${sortLabel}` : column.name;
      const dateLike = /date|time|year/i.test(column.declaredType ?? '');
      const pinned = visibleIndex < layout.pinned;
      const editor = typedEditor(column.declaredType);
      visibleIndex += 1;

      return [
        {
          prop: `c${index}`,
          name: label,
          size,
          ...(pinned ? { pin: 'colPinStart' } : {}),
          filter: 'string',
          ...(editor ? { editor } : {}),
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
        },
      ];
    }) as any[];
  }, [
    columns,
    rows,
    editable,
    readOnlySet,
    editableFromRow,
    sorts,
    layout.hidden,
    layout.widths,
    layout.pinned,
    onHeaderClick,
  ]);

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

  // 右键菜单：设为 NULL / 使用默认值（仅新增行）。
  useEffect(() => {
    const element = gridRef.current;
    if (!element || !editable || (!onSetCellNull && !onSetCellDefault)) return;

    const handler = (event: MouseEvent) => {
      if (!focusedCell) return;
      event.preventDefault();
      setCellMenu({
        x: event.clientX,
        y: event.clientY,
        rowIndex: focusedCell.rowIndex,
        columnIndex: focusedCell.columnIndex,
      });
    };

    element.addEventListener('contextmenu', handler);
    return () => element.removeEventListener('contextmenu', handler);
  }, [editable, focusedCell, onSetCellNull, onSetCellDefault]);

  const menuColumn = cellMenu ? columns[cellMenu.columnIndex] : undefined;
  const menuReadOnly = menuColumn ? readOnlySet.has(menuColumn.name) : true;
  const menuIsInsert = cellMenu ? insertRows.includes(cellMenu.rowIndex) : false;

  // 记录拖拽/Shift 选择的行区间，供批量删除。
  useEffect(() => {
    const element = gridRef.current;
    if (!element || !onRowRangeChange) return;

    const handler = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          newRange?: { y?: number; y1?: number };
        }>
      ).detail;
      const range = detail?.newRange;
      if (!range || typeof range.y !== 'number' || typeof range.y1 !== 'number') return;
      onRowRangeChange(Math.min(range.y, range.y1), Math.max(range.y, range.y1));
    };

    element.addEventListener('beforerange', handler);
    return () => element.removeEventListener('beforerange', handler);
  }, [onRowRangeChange]);

  // 列宽拖动结束后按表记忆。
  useEffect(() => {
    const element = gridRef.current;
    if (!element || !layoutKey) return;

    const handler = (event: Event) => {
      const detail = (
        event as CustomEvent<Record<string, { prop?: string; size?: number }>>
      ).detail;
      if (!detail) return;
      const widths = { ...layout.widths };
      let changed = false;
      for (const item of Object.values(detail)) {
        if (!item || typeof item.prop !== 'string' || typeof item.size !== 'number') continue;
        const index = Number(item.prop.slice(1));
        const column = Number.isInteger(index) ? columns[index] : undefined;
        if (!column) continue;
        widths[column.name] = item.size;
        changed = true;
      }
      if (changed) updateLayout({ ...layout, widths });
    };

    element.addEventListener('aftercolumnresize', handler);
    return () => element.removeEventListener('aftercolumnresize', handler);
  }, [layoutKey, layout, columns]);

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
      {cellMenu && (
        <ContextMenu
          x={cellMenu.x}
          y={cellMenu.y}
          onClose={() => setCellMenu(null)}
          items={[
            {
              label: '设为 NULL',
              disabled: menuReadOnly,
              onSelect: () => onSetCellNull?.(cellMenu.rowIndex, cellMenu.columnIndex),
            },
            {
              label: '使用默认值',
              disabled: menuReadOnly || !menuIsInsert,
              onSelect: () =>
                onSetCellDefault?.(cellMenu.rowIndex, cellMenu.columnIndex),
            },
          ]}
        />
      )}
      {layoutKey && (
        <div className="grid-layout">
          <details>
            <summary>列</summary>
            <div className="grid-layout-panel">
              <label className="grid-layout-pin">
                固定前
                <select
                  value={layout.pinned}
                  aria-label="固定前几列"
                  onChange={(event) =>
                    updateLayout({ ...layout, pinned: Number(event.target.value) })
                  }
                >
                  {[0, 1, 2, 3, 4, 5].map((count) => (
                    <option key={count} value={count}>
                      {count}
                    </option>
                  ))}
                </select>
                列
              </label>
              <div className="grid-layout-columns">
                {columns.map((column) => (
                  <label key={column.name} title={column.declaredType ?? undefined}>
                    <input
                      type="checkbox"
                      checked={!layout.hidden.includes(column.name)}
                      onChange={() => toggleColumn(column.name)}
                    />
                    {column.name}
                  </label>
                ))}
              </div>
              <button
                type="button"
                className="btn"
                onClick={() => updateLayout(emptyLayout())}
              >
                重置列宽与隐藏
              </button>
            </div>
          </details>
        </div>
      )}
      <RevoGrid
        key={columns.map((column) => column.name).join('|')}
        ref={gridRef as never}
        theme={theme}
        columns={gridColumns}
        source={source}
        range={true}
        useClipboard={true}
        resize={true}
        readonly={!editable}
        rowHeaders={true}
        filter={true}
        style={{ height: '100%' }}
      />
    </div>
  );
}
