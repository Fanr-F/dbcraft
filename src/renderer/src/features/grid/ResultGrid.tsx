import { useEffect, useMemo, useRef, useState } from 'react';
import { RevoGrid } from '@revolist/react-datagrid';
import type { QueryCell, QueryColumn } from '@shared/ipc-contract';
import { normalizePastedValue, parseClipboardTsv } from '@shared/table-paste';
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
  /** 非空且无自增的必填列名，用于列头标记。 */
  requiredColumns?: string[];
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
  /** Delete 键删除当前选中行。 */
  onDeleteRow?: () => void;
  /** 把当前选中区域交给上层打开导出对话框。 */
  onExportRange?: (columns: QueryColumn[], rows: QueryCell[][]) => void;
  /** 表数据页的布局记忆键；为空时不做持久化（普通查询结果）。 */
  layoutKey?: string;
  /** Excel / TSV 粘贴：行号 + 每个矩阵列对应的实际列下标。 */
  onPasteCells?: (paste: GridPastePayload) => void;
  /** 按 `${rowIndex}:${columnIndex}` 索引的粘贴校验错误，用于把单元格标红。 */
  invalidCells?: Record<string, string>;
}

export interface GridPastePayload {
  startRow: number;
  /** 矩阵第 N 列要写入的实际列下标（已排除隐藏列）。 */
  columnIndexes: number[];
  values: QueryCell[][];
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
    return { title: value.length > 4096 ? `${value.slice(0, 4096)}…` : value };
  }
  return undefined;
}

export function ResultGrid({
  columns,
  rows,
  editable = false,
  readOnlyColumns = [],
  requiredColumns = [],
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
  onDeleteRow,
  onExportRange,
  layoutKey,
  onPasteCells,
  invalidCells,
}: ResultGridProps) {
  const gridRef = useRef<HTMLElement | null>(null);
  const readOnlySet = useMemo(() => new Set(readOnlyColumns), [readOnlyColumns]);
  const requiredSet = useMemo(() => new Set(requiredColumns), [requiredColumns]);
  const [layout, setLayout] = useState<GridColumnLayout>(() => readLayout(layoutKey));
  const [cellMenu, setCellMenu] = useState<{
    x: number;
    y: number;
    rowIndex: number;
    columnIndex: number;
  } | null>(null);
  const [selectedRange, setSelectedRange] = useState<{
    x: number;
    y: number;
    x1: number;
    y1: number;
  } | null>(null);
  const selectedRangeRef = useRef(selectedRange);
  selectedRangeRef.current = selectedRange;
  const [copyNotice, setCopyNotice] = useState<string | null>(null);

  useEffect(() => {
    setLayout(readLayout(layoutKey));
  }, [layoutKey]);

  // 表数据页刚打开时，让网格拿到焦点再聚焦第一个可写单元格：
  // 用户从对象树双击表后直接按 Ctrl+V 也能粘贴，而不是因为焦点还在树上被忽略。
  // 只在首次加载/换表时执行，不抢 SQL 编辑器或弹窗输入框的焦点。
  const autoFocused = useRef(false);
  /** 打开表页后自动聚焦的焦点还没被用户改过：此时粘贴按“行尾追加”处理。 */
  const autoPasteAtEnd = useRef(false);
  const rowsLengthRef = useRef(rows.length);
  rowsLengthRef.current = rows.length;
  useEffect(() => {
    autoFocused.current = false;
    autoPasteAtEnd.current = false;
  }, [layoutKey]);
  useEffect(() => {
    const element = gridRef.current;
    if (!element || autoFocused.current || !editable) return;
    const visible = columns.filter((column) => !layout.hidden.includes(column.name));
    const firstWritable = visible.findIndex((column) => !readOnlySet.has(column.name));
    if (firstWritable < 0) return;
    // 自动聚焦/数据刷新后的焦点不是用户选的，粘贴按行尾追加。
    autoPasteAtEnd.current = true;

    let cancelled = false;
    let retry: number | null = null;
    // 用户在打开后已经点了别处（例如继续浏览对象树）就不再抢焦点。
    const interacted = () => {
      cancelled = true;
    };
    document.addEventListener('pointerdown', interacted, { capture: true, once: true });
    const focusGrid = () => {
      if (cancelled || autoFocused.current || !element.isConnected) return;
      const active = document.activeElement as HTMLElement | null;
      if (active?.isContentEditable) return;
      autoFocused.current = true;
      autoPasteAtEnd.current = true;
      element.focus();
      const api = element as unknown as {
        setCellsFocus?: (
          start: { x: number; y: number },
          end: { x: number; y: number },
        ) => Promise<void>;
      };
      const focusCell = () => {
        // 空表没有可聚焦的行；宿主焦点已足够让 Ctrl+V 的 paste 事件落到我们手里。
        if (rowsLengthRef.current <= 0) return;
        void api
          .setCellsFocus?.({ x: firstWritable, y: 0 }, { x: firstWritable, y: 0 })
          .catch(() => undefined);
      };
      focusCell();
      // Stencil 初次渲染/数据到达后再确认一次焦点和单元格。
      retry = window.setTimeout(() => {
        if (cancelled || !element.isConnected) return;
        focusCell();
        if (document.activeElement !== element) {
          const now = document.activeElement as HTMLElement | null;
          if (!now?.isContentEditable) element.focus();
        }
      }, 300);
    };
    // 等表格数据和 Stencil 渲染稳定后再聚焦；过早 focus 会被后续渲染覆盖。
    const timer = window.setTimeout(focusGrid, 200);
    return () => {
      cancelled = true;
      document.removeEventListener('pointerdown', interacted, { capture: true });
      window.clearTimeout(timer);
      if (retry !== null) window.clearTimeout(retry);
    };
  }, [editable, rows.length, columns, layout.hidden, readOnlySet]);

  // 用户一旦在网格里点选或键盘移动到别的单元格，粘贴就按当前焦点改写，
  // 而不是继续使用“打开页签时的行尾追加”语义。
  useEffect(() => {
    const element = gridRef.current;
    if (!element) return;
    const clear = () => {
      autoPasteAtEnd.current = false;
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (
        [
          'ArrowUp',
          'ArrowDown',
          'ArrowLeft',
          'ArrowRight',
          'Tab',
          'Enter',
          'Home',
          'End',
          'PageUp',
          'PageDown',
        ].includes(event.key)
      ) {
        clear();
      }
    };
    element.addEventListener('pointerdown', clear, true);
    element.addEventListener('keydown', onKeyDown, true);
    return () => {
      element.removeEventListener('pointerdown', clear, true);
      element.removeEventListener('keydown', onKeyDown, true);
    };
  }, []);

  // 表数据页的粘贴统一在 workspace 捕获阶段处理。RevoGrid 的 clipboard 组件只在
  // overlay 挂载时存在（空表、翻页/排序后没有内部焦点时会卸载），不能依赖它；
  // 编辑器/输入框保留原生粘贴，其余区域全部按 Excel/TSV 交给上层。
  useEffect(() => {
    const element = gridRef.current;
    if (!element || !editable || !onPasteCells) return;
    const workspace = element.closest('.workspace');
    if (!workspace) return;

    const handler = (nativeEvent: Event) => {
      const event = nativeEvent as ClipboardEvent;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }
      const text = event.clipboardData?.getData('text/plain') ?? '';
      if (!text) return;
      const values = parseClipboardTsv(text).map((row) => row.map(normalizePastedValue));
      // Excel 区域末尾常带空行；整行为空不生成新增行。
      while (
        values.length > 0 &&
        values[values.length - 1]!.every((value) => value === null)
      ) {
        values.pop();
      }
      if (values.length === 0) return;

      const visibleIndexes = columns
        .map((_, index) => index)
        .filter((index) => !layout.hidden.includes(columns[index]!.name));
      const firstWritable = visibleIndexes.findIndex(
        (index) => !readOnlySet.has(columns[index]!.name),
      );
      if (firstWritable < 0) return;
      const width = Math.max(...values.map((row) => row.length));

      // 阻止 RevoGrid 自己的 clipboard 组件再写一遍网格。
      event.preventDefault();
      event.stopPropagation();

      const api = element as unknown as {
        getFocused?: () => Promise<{ cell?: { x: number; y: number } } | null>;
      };
      void (async () => {
        const live = await api.getFocused?.().catch(() => null);
        // 自动焦点/数据刷新后的焦点不是用户选的，按行尾追加；
        // 只有网格当前确实有内部焦点（用户点过单元格）才按该位置改写。
        // 不读 React 的 focusedCell：翻页/排序后它可能是上一页的旧坐标。
        const liveCell = live?.cell;
        const pasteAtEnd = autoPasteAtEnd.current || !liveCell;
        const startRow = pasteAtEnd || !liveCell ? rows.length : liveCell.y;
        const startVisible = pasteAtEnd || !liveCell ? firstWritable : liveCell.x;
        if (startVisible < 0) return;

        const columnIndexes = visibleIndexes.slice(startVisible, startVisible + width);
        if (columnIndexes.length === 0) return;
        onPasteCells({
          startRow,
          columnIndexes,
          values: values.map((row) => row.slice(0, columnIndexes.length)),
        });
      })();
    };

    workspace.addEventListener('paste', handler, true);
    return () => workspace.removeEventListener('paste', handler, true);
  }, [editable, onPasteCells, columns, rows, layout.hidden, readOnlySet]);

  // 追加待提交行（粘贴/新增行）后滚动到新行；否则数据在 200 行之外，
  // 用户看不到任何变化，容易以为粘贴失败。
  const previousInsertCount = useRef(0);
  useEffect(() => {
    const element = gridRef.current;
    const count = insertRows.length;
    if (!element || count <= previousInsertCount.current) {
      previousInsertCount.current = count;
      return;
    }
    previousInsertCount.current = count;
    const target = Math.max(...insertRows);
    const api = element as unknown as {
      scrollToRow?: (row: number) => Promise<void>;
    };
    // RevoGrid 的 source 更新是异步的，立即滚动可能被新数据覆盖；稍后补一次。
    const timers = [120, 500].map((delay) =>
      window.setTimeout(() => {
        void api.scrollToRow?.(target).catch(() => undefined);
      }, delay),
    );
    return () => {
      for (const timer of timers) window.clearTimeout(timer);
    };
  }, [insertRows]);

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
      const label = `${sorted ? `${column.name} ${sortLabel}` : column.name}${
        requiredSet.has(column.name) ? ' *' : ''
      }`;
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
          cellProperties: ((props: {
            rowIndex?: number;
            model?: Record<string, unknown>;
            prop?: string;
          }) => {
            const base: Record<string, unknown> = cellProperties(props, dateLike) ?? {};
            const reason =
              props.rowIndex === undefined
                ? undefined
                : invalidCells?.[`${props.rowIndex}:${index}`];
            if (!reason) return base;
            return {
              ...base,
              class: [base.class, 'grid-cell-invalid'].filter(Boolean).join(' '),
              style: { ...(base.style as Record<string, unknown> | undefined), color: 'var(--danger)' },
              title: reason,
            };
          }) as never,
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
                  title: `${column.name} · ${column.declaredType}${
                    requiredSet.has(column.name) ? ' · 必填' : ''
                  }`,
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
    requiredSet,
    invalidCells,
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
          setSelectedRange({
            x: columnIndex,
            y: detail.rowIndex,
            x1: columnIndex,
            y1: detail.rowIndex,
          });
        }
      }
    };

    element.addEventListener('beforecellfocus', handler);
    return () => element.removeEventListener('beforecellfocus', handler);
  }, [onRowFocus, onCellFocus]);

  // 右键菜单：复制区域，以及可编辑时的 NULL/默认值操作。
  useEffect(() => {
    const element = gridRef.current;
    if (!element) return;

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
  }, [focusedCell]);

  const copySelection = async () => {
    const range =
      selectedRange ??
      (focusedCell
        ? {
            x: focusedCell.columnIndex,
            y: focusedCell.rowIndex,
            x1: focusedCell.columnIndex,
            y1: focusedCell.rowIndex,
          }
        : null);
    if (!range) return;
    const x = Math.min(range.x, range.x1);
    const x1 = Math.max(range.x, range.x1);
    const y = Math.min(range.y, range.y1);
    const y1 = Math.max(range.y, range.y1);
    const text = rows
      .slice(y, y1 + 1)
      .map((row) =>
        row
          .slice(x, x1 + 1)
          .map((value) =>
            value === null || value === undefined
              ? ''
              : String(value).replace(/\t/g, ' ').replace(/\r?\n/g, ' '),
          )
          .join('\t'),
      )
      .join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopyNotice(`已复制 ${y1 - y + 1} 行 × ${x1 - x + 1} 列`);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      const copied = document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopyNotice(copied ? '已复制到剪贴板' : '复制失败');
    }
    window.setTimeout(() => setCopyNotice(null), 1600);
  };

  const exportSelection = () => {
    const range =
      selectedRange ??
      (focusedCell
        ? {
            x: focusedCell.columnIndex,
            y: focusedCell.rowIndex,
            x1: focusedCell.columnIndex,
            y1: focusedCell.rowIndex,
          }
        : null);
    if (!range || !onExportRange) return;
    const x = Math.min(range.x, range.x1);
    const x1 = Math.max(range.x, range.x1);
    const y = Math.min(range.y, range.y1);
    const y1 = Math.max(range.y, range.y1);
    onExportRange(
      columns.slice(x, x1 + 1),
      rows.slice(y, y1 + 1).map((row) => row.slice(x, x1 + 1)),
    );
  };

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
          newRange?: { x?: number; y?: number; x1?: number; y1?: number };
        }>
      ).detail;
      const range = detail?.newRange;
      if (!range || typeof range.y !== 'number' || typeof range.y1 !== 'number') return;
      if (
        typeof range.x === 'number' &&
        typeof range.x1 === 'number'
      ) {
        setSelectedRange({ x: range.x, y: range.y, x1: range.x1, y1: range.y1 });
      }
      onRowRangeChange(Math.min(range.y, range.y1), Math.max(range.y, range.y1));
    };

    element.addEventListener('beforerange', handler);
    return () => element.removeEventListener('beforerange', handler);
  }, [onRowRangeChange]);

  // F2 进入编辑、Delete 删除选中行（PRD §3.2）；编辑器内不拦截。
  useEffect(() => {
    const element = gridRef.current;
    if (!element || !editable) return;

    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target?.closest(
          'input, textarea, select, [contenteditable="true"], .revogr-edit',
        )
      ) {
        return;
      }
      if (event.key === 'F2') {
        event.preventDefault();
        const fallback =
          focusedCell ??
          (selectedRangeRef.current
            ? {
                rowIndex: selectedRangeRef.current.y,
                columnIndex: selectedRangeRef.current.x,
              }
            : null);
        const gridApi = element as unknown as {
          getFocused?: () => Promise<{
            cell?: { x: number; y: number };
          } | null>;
          setCellEdit: (row: number, prop: string) => Promise<void>;
        };
        void (async () => {
          // 焦点状态可能还没同步到 React；优先读 RevoGrid 自己的当前焦点。
          const live = await gridApi.getFocused?.().catch(() => null);
          const cell = live?.cell ?? fallback;
          if (!cell) return;
          const rowIndex = 'rowIndex' in cell ? cell.rowIndex : cell.y;
          const columnIndex = 'columnIndex' in cell ? cell.columnIndex : cell.x;
          await gridApi.setCellEdit(rowIndex, `c${columnIndex}`);
        })();
        return;
      }
      if (event.key === 'Delete') {
        if (!onDeleteRow) return;
        event.preventDefault();
        onDeleteRow();
      }
    };

    element.addEventListener('keydown', handler);
    return () => element.removeEventListener('keydown', handler);
  }, [editable, focusedCell, onDeleteRow]);

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
      {copyNotice && <div className="grid-copy-toast">{copyNotice}</div>}
      {cellMenu && (
        <ContextMenu
          x={cellMenu.x}
          y={cellMenu.y}
          onClose={() => setCellMenu(null)}
          items={[
            {
              label: '复制区域（TSV）',
              onSelect: () => void copySelection(),
            },
            {
              label: '复制单元格',
              onSelect: () => {
                const value = rows[cellMenu.rowIndex]?.[cellMenu.columnIndex];
                void navigator.clipboard
                  .writeText(value === null || value === undefined ? '' : String(value))
                  .catch(() => undefined);
              },
            },
            {
              label: '导出选中区域…',
              disabled: !onExportRange,
              onSelect: exportSelection,
            },
            {
              label: '设为 NULL',
              disabled: !editable || menuReadOnly,
              onSelect: () => onSetCellNull?.(cellMenu.rowIndex, cellMenu.columnIndex),
            },
            {
              label: '使用默认值',
              disabled: !editable || menuReadOnly || !menuIsInsert,
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
