import { useEffect, useState } from 'react';
import type { DatabaseType, ExportFormat, QueryCell, QueryColumn } from '@shared/ipc-contract';
import { toCsv, toJson, toSqlInsert } from '@shared/export/formats';
import { Icon } from './Icon';

interface ExportDataset {
  label: string;
  columns: QueryColumn[];
  rows: QueryCell[][];
}

interface ExportDialogProps {
  dialect: DatabaseType;
  columns: QueryColumn[];
  rows: QueryCell[][];
  /** 多语句执行时可选的结果集；提供后对话框内可切换。 */
  datasets?: ExportDataset[];
  /** 表数据页可用：启用服务端流式 CSV（全部行）。 */
  streamTable?: { sessionId: string; table: string };
  onClose: () => void;
  onSave: (
    content: string,
    suggestedName: string,
  ) => Promise<{ ok: boolean; message?: string }>;
  onSaveXlsx: (
    columns: QueryColumn[],
    rows: QueryCell[][],
    suggestedName: string,
  ) => Promise<{ ok: boolean; message?: string }>;
  onLoadAll?: () => Promise<{
    ok: boolean;
    message?: string;
    columns?: QueryColumn[];
    rows?: QueryCell[][];
    truncated?: boolean;
  }>;
}

const FORMAT_LABELS: Record<ExportFormat, string> = {
  csv: 'CSV（Excel 兼容）',
  json: 'JSON',
  sql: 'SQL Insert',
  xlsx: 'Excel（.xlsx）',
};

const EXTENSIONS: Record<ExportFormat, string> = {
  csv: 'csv',
  json: 'json',
  sql: 'sql',
  xlsx: 'xlsx',
};

function safeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_').trim() || 'result';
}

export function ExportDialog({
  dialect,
  columns,
  rows,
  datasets,
  streamTable,
  onClose,
  onSave,
  onSaveXlsx,
  onLoadAll,
}: ExportDialogProps) {
  const [format, setFormat] = useState<ExportFormat>('csv');
  const [tableName, setTableName] = useState('export_data');
  const [csvDelimiter, setCsvDelimiter] = useState(',');
  const [csvHeader, setCsvHeader] = useState(true);
  const [csvNullMarker, setCsvNullMarker] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [datasetIndex, setDatasetIndex] = useState(0);
  const [exportColumns, setExportColumns] = useState(
    datasets?.[0]?.columns ?? columns,
  );
  const [exportRows, setExportRows] = useState(datasets?.[0]?.rows ?? rows);
  const [loadMessage, setLoadMessage] = useState<string | null>(null);
  const [loadingAll, setLoadingAll] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [streamRequestId, setStreamRequestId] = useState<string | null>(null);
  const [streamRows, setStreamRows] = useState(0);
  const [streamBytes, setStreamBytes] = useState(0);
  const [streamMessage, setStreamMessage] = useState<string | null>(null);
  const [streamWarning, setStreamWarning] = useState(false);
  const canLoadAll = Boolean(onLoadAll) && datasetIndex === 0;

  useEffect(() => {
    const api = window.dbcraft;
    if (!api || !streamTable) return;
    return api.export.onStreamProgress((progress) => {
      if (progress.requestId !== streamRequestId) return;
      setStreamRows(progress.rows);
      setStreamBytes(progress.bytes);
      if (progress.warning === '100mb') setStreamWarning(true);
    });
  }, [streamTable, streamRequestId]);

  const startStream = async () => {
    const api = window.dbcraft;
    if (!api || !streamTable || streaming) return;
    const requestId = `stream-${Date.now().toString(36)}`;
    setStreamRequestId(requestId);
    setStreaming(true);
    setStreamRows(0);
    setStreamBytes(0);
    setStreamWarning(false);
    setStreamMessage('正在流式导出…');
    try {
      const result = await api.export.streamCsv({
        requestId,
        sessionId: streamTable.sessionId,
        table: streamTable.table,
        suggestedName: 'result.csv',
        delimiter: csvDelimiter,
        header: csvHeader,
        nullMarker: csvNullMarker,
      });
      setStreamMessage(
        result.ok
          ? `已导出 ${result.rows} 行（${(result.bytes / 1024 / 1024).toFixed(1)} MB）到 ${result.path}`
          : result.canceled
            ? '已取消流式导出。'
            : `流式导出失败：${result.message}`,
      );
    } catch (cause) {
      setStreamMessage(
        `流式导出失败：${cause instanceof Error ? cause.message : String(cause)}`,
      );
    } finally {
      setStreaming(false);
    }
  };

  const cancelStream = async () => {
    const api = window.dbcraft;
    if (!api || !streamRequestId) return;
    await api.export.cancelStream(streamRequestId);
    setStreamMessage('正在取消…');
  };

  const chooseDataset = (index: number) => {
    setDatasetIndex(index);
    const dataset = datasets?.[index];
    setExportColumns(dataset?.columns ?? columns);
    setExportRows(dataset?.rows ?? rows);
    setLoadMessage(null);
  };

  const loadAll = async () => {
    if (!onLoadAll || loadingAll) return;
    setLoadingAll(true);
    setError(null);
    try {
      const result = await onLoadAll();
      if (!result.ok) {
        setError(result.message ?? '加载全部失败。');
        return;
      }
      if (result.columns) setExportColumns(result.columns);
      if (result.rows) setExportRows(result.rows);
      setLoadMessage(
        result.truncated
          ? `已加载前 ${result.rows?.length ?? 0} 行（超过上限，仍为截断结果）。`
          : `已加载 ${result.rows?.length ?? 0} 行。`,
      );
    } finally {
      setLoadingAll(false);
    }
  };

  const run = async () => {
    if (busy) return;

    if (format === 'xlsx') {
      setBusy(true);
      setError(null);
      try {
        const result = await onSaveXlsx(exportColumns, exportRows, 'result.xlsx');
        if (result.ok) {
          onClose();
        } else {
          setError(result.message ?? '导出失败。');
        }
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
      } finally {
        setBusy(false);
      }
      return;
    }

    let content: string;
    if (format === 'csv') {
      content = toCsv(exportColumns, exportRows, {
        delimiter: csvDelimiter,
        header: csvHeader,
        nullMarker: csvNullMarker,
      });
    } else if (format === 'json') {
      content = toJson(exportColumns, exportRows);
    } else {
      const table = tableName.trim();
      if (!table) {
        setError('SQL Insert 需要填写目标表名。');
        return;
      }
      content = toSqlInsert(dialect, table, exportColumns, exportRows);
    }

    if (!content) {
      setError('没有可导出的内容。');
      return;
    }

    const baseName = format === 'sql' ? safeFileName(tableName) : 'result';
    const suggestedName = `${baseName}.${EXTENSIONS[format]}`;

    setBusy(true);
    setError(null);
    try {
      const result = await onSave(content, suggestedName);
      if (result.ok) {
        onClose();
      } else {
        setError(result.message ?? '导出失败。');
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={() => !busy && onClose()}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="modal-header">
          <div>
            <h2 id="export-dialog-title">导出结果</h2>
            <p>
              将 {exportRows.length} 行 × {exportColumns.length} 列导出为文件；数据以数据库返回值为准。
            </p>
            {datasets && datasets.length > 0 && (
              <label className="field">
                <span>结果集</span>
                <select
                  value={datasetIndex}
                  onChange={(event) => chooseDataset(Number(event.target.value))}
                >
                  {datasets.map((dataset, index) => (
                    <option key={`${dataset.label}-${index}`} value={index}>
                      {dataset.label}（{dataset.rows.length} 行）
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <button
            type="button"
            className="icon-btn"
            aria-label="关闭"
            onClick={() => !busy && onClose()}
          >
            <Icon name="close" />
          </button>
        </header>

        <div className="modal-body">
          <p className="form-note export-sensitive-note">
            导出文件将包含完整查询结果；如包含密码、令牌或个人数据，请妥善保管并在必要时脱敏。
          </p>
          <div className="field">
            <span>格式</span>
            <div className="export-formats">
              {(Object.keys(FORMAT_LABELS) as ExportFormat[]).map((value) => (
                <label className="check" key={value}>
                  <input
                    type="radio"
                    name="export-format"
                    checked={format === value}
                    onChange={() => setFormat(value)}
                  />
                  {FORMAT_LABELS[value]}
                </label>
              ))}
            </div>
          </div>

          {format === 'csv' && (
            <div className="field">
              <span>CSV 选项</span>
              <div className="export-formats">
                <label className="check">
                  分隔符
                  <select
                    value={csvDelimiter}
                    onChange={(event) => setCsvDelimiter(event.target.value)}
                  >
                    <option value=",">逗号</option>
                    <option value=";">分号</option>
                    <option value={'\t'}>Tab</option>
                  </select>
                </label>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={csvHeader}
                    onChange={(event) => setCsvHeader(event.target.checked)}
                  />
                  包含表头
                </label>
                <label className="check">
                  NULL 标记
                  <select
                    value={csvNullMarker}
                    onChange={(event) => setCsvNullMarker(event.target.value)}
                  >
                    <option value="">空字段</option>
                    <option value="\\N">\N</option>
                  </select>
                </label>
              </div>
            </div>
          )}

          {format === 'sql' && (
            <label className="field">
              <span>目标表名</span>
              <input
                value={tableName}
                placeholder="例如：orders"
                onChange={(event) => setTableName(event.target.value)}
              />
            </label>
          )}

          <p className="form-note">
            CSV 使用 UTF-8 BOM + CRLF，NULL 为空字段；JSON 区分 null 与空串；
            SQL Insert 按 {dialect} 方言转义标识符与字符串；Excel 生成单工作表 .xlsx，
            数字保持数值、NULL 留空。导出只包含已加载的 {exportRows.length} 行。
          </p>

          {streamTable && (
            <div className="export-load-all">
              <button
                type="button"
                className="btn"
                disabled={streaming || busy}
                onClick={() => void startStream()}
              >
                {streaming
                  ? `流式导出中… ${streamRows} 行`
                  : '流式导出全部行（CSV）'}
              </button>
              {streaming && (
                <button type="button" className="btn btn-danger" onClick={() => void cancelStream()}>
                  取消
                </button>
              )}
              {(streaming || streamRows > 0) && (
                <span className="pane-hint">
                  {streamRows} 行 · {(streamBytes / 1024 / 1024).toFixed(1)} MB
                </span>
              )}
              {streamWarning && (
                <span className="form-error">文件已超过 100 MB，请确认磁盘空间。</span>
              )}
              {streamMessage && <span className="pane-hint">{streamMessage}</span>}
            </div>
          )}

          {canLoadAll && (
            <div className="export-load-all">
              <button
                type="button"
                className="btn"
                disabled={loadingAll || busy}
                onClick={() => void loadAll()}
              >
                {loadingAll ? '加载中…' : '加载全部（最多 10000 行）'}
              </button>
              {loadMessage && <span className="pane-hint">{loadMessage}</span>}
            </div>
          )}

          {error && <div className="form-error">{error}</div>}
        </div>

        <footer className="modal-footer">
          <button type="button" className="btn" disabled={busy} onClick={onClose}>
            取消
          </button>
          <span className="spacer" />
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || exportRows.length === 0}
            onClick={() => void run()}
          >
            {busy ? '导出中…' : '导出'}
          </button>
        </footer>
      </div>
    </div>
  );
}
