import { useMemo } from 'react';
import { RevoGrid } from '@revolist/react-datagrid';
import type { QueryCell, QueryColumn } from '@shared/ipc-contract';
import { Icon } from '../../components/Icon';

interface ResultGridProps {
  columns: QueryColumn[];
  rows: QueryCell[][];
}

export function ResultGrid({ columns, rows }: ResultGridProps) {
  const gridColumns = useMemo(() => {
    const sample = rows.slice(0, 50);

    return columns.map((column, index) => {
      const contentWidth = sample.reduce(
        (width, row) => Math.max(width, String(row[index] ?? '').length * 8 + 28),
        0,
      );
      const size = Math.min(360, Math.max(120, column.name.length * 9 + 56, contentWidth));

      return {
        prop: `c${index}`,
        name: column.name,
        size,
        ...(index === 0 ? { pin: 'colPinStart' } : {}),
        filter: 'string',
      };
    }) as any[];
  }, [columns, rows]);

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
        theme="dark"
        columns={gridColumns}
        source={source}
        range={true}
        useClipboard={true}
        readonly={true}
        rowHeaders={true}
        filter={true}
        style={{ height: '100%' }}
      />
    </div>
  );
}
