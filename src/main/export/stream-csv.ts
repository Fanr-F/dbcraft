import { createWriteStream, rmSync } from 'node:fs';
import type {
  ExportStreamProgress,
  ExportStreamRequest,
  ExportStreamResult,
  QueryCell,
} from '../../shared/ipc-contract';
import { csvCell } from '../../shared/export/formats';
import { buildTablePageQuery } from '../../shared/dialect/identifiers';
import { buildSubqueryPageSql } from '../../shared/dialect/identifiers';
import { isReadOnlyStatement } from '../../shared/dialect/readonly';
import { getSession } from '../services/ConnectionManager';

const PAGE_SIZE = 5000;
const WARN_BYTES = 100 * 1024 * 1024;

function writeChunk(
  stream: ReturnType<typeof createWriteStream>,
  text: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    stream.write(text, 'utf8', (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function endStream(stream: ReturnType<typeof createWriteStream>): Promise<void> {
  return new Promise((resolve, reject) => {
    stream.end(() => resolve());
    stream.once('error', reject);
  });
}

/** 任意单条 SELECT 的分页包装；MSSQL 的 ORDER BY 限制可能导致部分 SQL 失败。 */
function buildSubqueryPage(
  dialect: string,
  sql: string,
  offset: number,
): string {
  return buildSubqueryPageSql(
    dialect as Parameters<typeof buildSubqueryPageSql>[0],
    sql,
    PAGE_SIZE,
    offset,
  );
}

/**
 * 表数据页的流式 CSV 导出：逐批 SELECT、边查边写，不把全部行留在内存。
 * 任意 SQL 的流式分页仍受方言限制，当前只对表/视图开放。
 */
export async function streamTableCsv(
  request: ExportStreamRequest,
  filePath: string,
  onProgress: (progress: ExportStreamProgress) => void,
  isCanceled: () => boolean,
): Promise<ExportStreamResult> {
  const session = getSession(request.sessionId);
  if (!session) return { ok: false, message: '会话未打开，请重新连接。' };
  if (!session.alive) return { ok: false, message: '会话已失效，请重新连接。' };
  if (!request.table && (!request.sql || !isReadOnlyStatement(request.sql))) {
    return { ok: false, message: '任意 SQL 流式导出只支持单条 SELECT 查询。' };
  }

  const delimiter = request.delimiter || ',';
  const header = request.header !== false;
  const nullMarker = request.nullMarker ?? '';
  const stream = createWriteStream(filePath, 'utf8');
  let rowsWritten = 0;
  let bytes = 0;
  let warned = false;

  const report = () => {
    const progress: ExportStreamProgress = {
      requestId: request.requestId,
      rows: rowsWritten,
      bytes,
    };
    if (!warned && bytes >= WARN_BYTES) {
      warned = true;
      progress.warning = '100mb';
    }
    onProgress(progress);
  };

  try {
    if (request.database && session.dialect !== 'sqlite') {
      await session.useDatabase(request.database);
    }
    await writeChunk(stream, '\uFEFF');
    bytes += 3;
    let columnsWritten = false;

    for (let offset = 0; ; offset += PAGE_SIZE) {
      if (isCanceled()) {
        stream.destroy();
        rmSync(filePath, { force: true });
        return { ok: false, canceled: true, message: '已取消导出。' };
      }

      const page = request.table
        ? buildTablePageQuery(session.dialect, request.table, PAGE_SIZE, offset)
        : {
            sql: buildSubqueryPage(session.dialect, request.sql!, offset),
            params: request.params ?? [],
          };
      const result = await session.query(page.sql, page.params);

      if (!columnsWritten) {
        if (header && result.columns.length > 0) {
          const line = `${result.columns
            .map((column) => csvCell(column.name, delimiter))
            .join(delimiter)}\r\n`;
          await writeChunk(stream, line);
          bytes += Buffer.byteLength(line, 'utf8');
        }
        columnsWritten = true;
      }

      if (result.rows.length === 0) break;

      const chunk = result.rows
        .map((row: QueryCell[]) =>
          row
            .map((value) => csvCell(value === null ? nullMarker : value, delimiter))
            .join(delimiter),
        )
        .join('\r\n')
        .concat('\r\n');
      await writeChunk(stream, chunk);
      rowsWritten += result.rows.length;
      bytes += Buffer.byteLength(chunk, 'utf8');
      report();

      if (result.rows.length < PAGE_SIZE) break;
    }

    await endStream(stream);
    onProgress({ requestId: request.requestId, rows: rowsWritten, bytes });
    return { ok: true, path: filePath, rows: rowsWritten, bytes };
  } catch (error) {
    stream.destroy();
    rmSync(filePath, { force: true });
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
