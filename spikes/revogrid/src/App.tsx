import { useEffect, useMemo, useRef, useState } from 'react';
import { RevoGrid } from '@revolist/react-datagrid';
import {
  BOOLEAN_EDITOR,
  DATE_EDITOR,
  NOTE_EDITOR,
  STATUS_EDITOR,
  editors,
} from './editors';

type Row = Record<string, any>;

type MenuState = {
  x: number;
  y: number;
  row: number;
  col: number;
  prop: string;
};

const ROW_COUNT = 25_000;
const STATUSES = ['active', 'pending', 'blocked'];
const DEPARTMENTS = ['Platform', 'Frontend', 'Backend', 'Data', 'QA'];
const CITIES = ['Shanghai', 'Beijing', 'Shenzhen', 'Hangzhou', 'Chengdu'];
const COUNTRIES = ['China', 'Singapore', 'Japan', 'Germany', 'USA'];

function pad(value: number, length = 2) {
  return String(value).padStart(length, '0');
}

function generateRows(count: number): Row[] {
  const rows: Row[] = [];
  for (let i = 0; i < count; i += 1) {
    const day = (i % 28) + 1;
    const month = (i % 12) + 1;
    const row: Row = {
      id: i + 1,
      name: `User ${i + 1}`,
      email: `user${i + 1}@example.com`,
      status: STATUSES[i % STATUSES.length],
      age: 20 + (i % 45),
      active: i % 3 !== 0,
      created_at: `2026-${pad(month)}-${pad(day)}`,
      score: ((i * 17) % 1000) / 10,
      department: DEPARTMENTS[i % DEPARTMENTS.length],
      city: CITIES[i % CITIES.length],
      country: COUNTRIES[i % COUNTRIES.length],
      phone: `+86 138 ${pad(i % 10000, 4)} ${pad((i * 7) % 10000, 4)}`,
      notes: i % 7 === 0 ? null : `Row ${i + 1} note · 中文内容 · ${'x'.repeat(i % 40)}`,
    };
    for (let col = 14; col <= 30; col += 1) {
      row[`col${col}`] = `R${i + 1}-C${col}`;
    }
    rows.push(row);
  }
  return rows;
}

const baseColumns = [
  { prop: 'id', name: 'ID', size: 80, pin: 'colPinStart', filter: 'number' },
  { prop: 'name', name: 'Name', size: 160, filter: 'string' },
  { prop: 'email', name: 'Email', size: 220, filter: 'string' },
  { prop: 'status', name: 'Status', size: 120, editor: STATUS_EDITOR, filter: 'string' },
  { prop: 'age', name: 'Age', size: 80, filter: 'number' },
  { prop: 'active', name: 'Active', size: 100, editor: BOOLEAN_EDITOR, filter: 'boolean' },
  { prop: 'created_at', name: 'Created', size: 140, editor: DATE_EDITOR, filter: 'string' },
  { prop: 'score', name: 'Score', size: 90, filter: 'number' },
  { prop: 'department', name: 'Department', size: 140, filter: 'string' },
  { prop: 'city', name: 'City', size: 120, filter: 'string' },
  { prop: 'country', name: 'Country', size: 120, filter: 'string' },
  { prop: 'phone', name: 'Phone', size: 170, filter: 'string' },
  { prop: 'notes', name: 'Notes', size: 280, editor: NOTE_EDITOR, filter: 'string' },
];

const columns: any[] = [
  ...baseColumns,
  ...Array.from({ length: 17 }, (_, index) => {
    const number = index + 14;
    return {
      prop: `col${number}`,
      name: `Field ${number}`,
      size: 120,
      filter: 'string',
    };
  }),
];

export default function App() {
  const [rows, setRows] = useState<Row[]>(() => generateRows(ROW_COUNT));
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [editCount, setEditCount] = useState(0);
  const [copyCount, setCopyCount] = useState(0);
  const [pasteCount, setPasteCount] = useState(0);
  const [lastAction, setLastAction] = useState('等待操作');
  const [renderMs] = useState(() => {
    const started = performance.now();
    generateRows(1000);
    return Math.round(performance.now() - started);
  });
  const gridRef = useRef<any>(null);

  useEffect(() => {
    const closeMenu = () => setMenu(null);
    window.addEventListener('click', closeMenu);
    window.addEventListener('blur', closeMenu);
    return () => {
      window.removeEventListener('click', closeMenu);
      window.removeEventListener('blur', closeMenu);
    };
  }, []);

  useEffect(() => {
    (window as any).__spikeGrid = gridRef.current;
  }, []);

  useEffect(() => {
    const element = gridRef.current;
    if (!element) return;

    const handleCopy = () => {
      setCopyCount((count) => count + 1);
      setLastAction('已复制选中区域（TSV）');
    };
    const handlePaste = () => {
      setPasteCount((count) => count + 1);
      setLastAction('已粘贴区域数据');
    };

    element.addEventListener('clipboardrangecopy', handleCopy);
    element.addEventListener('clipboardrangepaste', handlePaste);
    return () => {
      element.removeEventListener('clipboardrangecopy', handleCopy);
      element.removeEventListener('clipboardrangepaste', handlePaste);
    };
  }, []);

  const selectedRange = useMemo(() => {
    if (!menu) return null;
    const column = columns[menu.col];
    return {
      row: menu.row + 1,
      column: column?.name ?? `#${menu.col}`,
      prop: menu.prop,
    };
  }, [menu]);

  const focusFirstStatus = async () => {
    await gridRef.current?.scrollToRow?.(0);
    await gridRef.current?.setCellEdit?.(0, 'status');
    setLastAction('已打开首行 Status 编辑器');
  };

  const scrollToMiddle = async () => {
    await gridRef.current?.scrollToRow?.(Math.floor(ROW_COUNT / 2));
    setLastAction(`已滚动到第 ${Math.floor(ROW_COUNT / 2) + 1} 行`);
  };

  const handleContextMenu = async (event: React.MouseEvent) => {
    event.preventDefault();
    const range = await gridRef.current?.getSelectedRange?.();
    if (!range) return;

    // RevoGrid's range.x indexes the data column area, excluding pinned columns.
    const pinnedStart = columns.filter((column) => column.pin === 'colPinStart');
    const pinnedEnd = columns.filter((column) => column.pin === 'colPinEnd');
    const dataColumns = columns.filter((column) => !column.pin);
    const column =
      range.colType === 'colPinStart'
        ? pinnedStart[range.x]
        : range.colType === 'colPinEnd'
          ? pinnedEnd[range.x]
          : dataColumns[range.x];

    if (!column) return;
    setMenu({
      x: event.clientX,
      y: event.clientY,
      row: range.y,
      col: range.x,
      prop: column.prop,
    });
  };

  const setSelectedCellNull = () => {
    if (!menu) return;
    setRows((current) => {
      const next = current.slice();
      next[menu.row] = { ...next[menu.row], [menu.prop]: null };
      return next;
    });
    setLastAction(`已将第 ${menu.row + 1} 行 ${menu.prop} 设为 NULL`);
    setMenu(null);
  };

  const resetCounters = () => {
    setEditCount(0);
    setCopyCount(0);
    setPasteCount(0);
    setLastAction('计数已重置');
  };

  return (
    <main className="app">
      <header className="toolbar">
        <div>
          <h1>RevoGrid Core Spike</h1>
          <p>
            {ROW_COUNT.toLocaleString()} 行 × {columns.length} 列 · 生成 1,000 行耗时约 {renderMs}ms
          </p>
        </div>
        <div className="toolbar-actions">
          <button onClick={focusFirstStatus}>编辑首行 Status</button>
          <button onClick={scrollToMiddle}>滚动到 12,500 行</button>
          <button onClick={resetCounters}>重置计数</button>
        </div>
      </header>

      <section className="statusbar">
        <span>编辑：{editCount}</span>
        <span>复制：{copyCount}</span>
        <span>粘贴：{pasteCount}</span>
        <span className="last-action">{lastAction}</span>
        {selectedRange && (
          <span className="selection">
            当前：第 {selectedRange.row} 行 / {selectedRange.column} / {selectedRange.prop}
          </span>
        )}
      </section>

      <section className="grid-wrap" onContextMenu={handleContextMenu}>
        <RevoGrid
          ref={gridRef}
          columns={columns}
          source={rows}
          editors={editors}
          range={true}
          useClipboard={true}
          rowHeaders={true}
          filter={true}
          onAfteredit={() => {
            setEditCount((count) => count + 1);
            setLastAction('单元格编辑完成');
          }}
          style={{ height: '100%' }}
        />
      </section>

      <footer className="hints">
        <span>区域选择：鼠标拖拽 / Shift+点击</span>
        <span>复制：Ctrl+C，粘贴到 Excel</span>
        <span>粘贴回来：Ctrl+V</span>
        <span>右键：打开 Spike 菜单并测试设为 NULL</span>
      </footer>

      {menu && (
        <div className="context-menu" style={{ left: menu.x, top: menu.y }}>
          <div className="context-menu-title">
            第 {menu.row + 1} 行 · {menu.prop}
          </div>
          <button onClick={setSelectedCellNull}>设为 NULL</button>
          <button onClick={() => setMenu(null)}>关闭</button>
        </div>
      )}
    </main>
  );
}
