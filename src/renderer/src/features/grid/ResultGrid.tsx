import { RevoGrid } from '@revolist/react-datagrid';
import { demoColumns } from '../../data/mock';
import type { DemoRow } from '../../data/mock';

interface ResultGridProps {
  rows: DemoRow[];
}

export function ResultGrid({ rows }: ResultGridProps) {
  return (
    <div className="grid-host">
      <RevoGrid
        theme="dark"
        columns={demoColumns}
        source={rows}
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
