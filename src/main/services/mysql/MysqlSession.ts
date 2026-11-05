import mysql from 'mysql2/promise';
import type { Connection as CoreConnection } from 'mysql2';
import type { ConnectionOptions, FieldPacket, ResultSetHeader } from 'mysql2/promise';
import type {
  MysqlFamilyConnectionInput,
  QueryCell,
  QueryColumn,
  QueryResult,
  SchemaObject,
  SslMode,
} from '../../../shared/ipc-contract';
import type { DatabaseSession } from '../DatabaseSession';
import { encodeCell } from '../query-values';

const MAX_ROWS = 2000;

const MYSQL_TYPE_NAMES: Record<number, string> = {
  0: 'DECIMAL',
  1: 'TINYINT',
  2: 'SMALLINT',
  3: 'INT',
  4: 'FLOAT',
  5: 'DOUBLE',
  6: 'NULL',
  7: 'TIMESTAMP',
  8: 'BIGINT',
  9: 'MEDIUMINT',
  10: 'DATE',
  11: 'TIME',
  12: 'DATETIME',
  13: 'YEAR',
  15: 'VARCHAR',
  16: 'BIT',
  245: 'JSON',
  246: 'DECIMAL',
  247: 'ENUM',
  248: 'SET',
  249: 'TINYBLOB',
  250: 'MEDIUMBLOB',
  251: 'LONGBLOB',
  252: 'BLOB',
  253: 'VAR_STRING',
  254: 'STRING',
  255: 'GEOMETRY',
};

function sslOption(mode: SslMode): { rejectUnauthorized: boolean } | undefined {
  if (mode === 'disable') return undefined;
  return {
    rejectUnauthorized: mode === 'verify-ca' || mode === 'verify-full',
  };
}

function isTlsError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    /ssl|tls|secure connection|certificate/i.test(error.message) ||
    (error as Error & { code?: string }).code === 'HANDSHAKE_SSL_ERROR'
  );
}

export class MysqlSession implements DatabaseSession {
  readonly label: string;
  readonly serverVersion: string;
  readonly note?: string;
  readonly alive = true;
  readonly cancelDisconnects = false;

  private constructor(
    private readonly connection: mysql.Connection,
    private readonly controlOptions: ConnectionOptions,
    private readonly threadId: number,
    label: string,
    version: string,
    note?: string,
  ) {
    this.label = label;
    this.serverVersion = version;
    this.note = note;
  }

  static async create(config: MysqlFamilyConnectionInput): Promise<MysqlSession> {
    const label = config.type === 'percona' ? 'Percona' : 'MySQL';
    const baseOptions: ConnectionOptions = {
      host: config.host,
      port: config.port,
      user: config.username,
      password: config.password,
      database: config.database || undefined,
      connectTimeout: 8000,
      dateStrings: true,
      supportBigNumbers: true,
      bigNumberStrings: true,
      jsonStrings: true,
    };

    const ssl = sslOption(config.sslMode);
    let connection: mysql.Connection;
    let note: string | undefined;
    let controlOptions: ConnectionOptions = baseOptions;

    try {
      controlOptions = { ...baseOptions, ...(ssl ? { ssl } : {}) };
      connection = await mysql.createConnection(controlOptions);
    } catch (error) {
      if (config.sslMode !== 'prefer' || !ssl || !isTlsError(error)) {
        throw error;
      }
      connection = await mysql.createConnection(baseOptions);
      note = 'TLS 不可用，已回退为明文连接';
    }

    const [rows] = await connection.query(
      'SELECT VERSION() AS version, @@version_comment AS comment',
    );
    const info = (rows as Array<{ version: string; comment: string }>)[0];

    return new MysqlSession(
      connection,
      controlOptions,
      connection.threadId,
      label,
      info?.version ?? 'unknown',
      note,
    );
  }

  /**
   * 使用流式结果，最多保留 MAX_ROWS 行；其余行继续消费但不入内存，
   * 避免 mysql2 的 query() 把整个结果集物化。
   */
  async query(sql: string): Promise<QueryResult> {
    const startedAt = Date.now();
    // promise 包装器的 Connection 仍持有底层回调式连接，流式接口只在底层提供。
    const core = (this.connection as unknown as { connection: CoreConnection }).connection;
    const stream = core.query({ sql, rowsAsArray: true }).stream();

    return new Promise<QueryResult>((resolve, reject) => {
      let columns: QueryColumn[] = [];
      let isSelect = false;
      let changeHeader: ResultSetHeader | null = null;
      const rows: QueryCell[][] = [];
      let truncated = false;
      let settled = false;

      stream.on('fields', (fields: FieldPacket[] | undefined) => {
        if (!Array.isArray(fields)) return;
        isSelect = true;
        columns = fields.map((field) => ({
          name: field.name,
          declaredType:
            field.type === undefined ? null : (MYSQL_TYPE_NAMES[field.type] ?? null),
        }));
      });

      stream.on('data', (row: unknown) => {
        if (!Array.isArray(row)) {
          changeHeader = row as ResultSetHeader;
          return;
        }
        if (!isSelect) return;

        if (rows.length >= MAX_ROWS) {
          truncated = true;
          return;
        }
        rows.push(row.map(encodeCell));
      });

      stream.on('error', (error: Error) => {
        if (settled) return;
        settled = true;
        reject(error);
      });

      stream.on('end', () => {
        if (settled) return;
        settled = true;

        if (!isSelect) {
          const changes = Number(changeHeader?.affectedRows ?? 0);
          resolve({
            columns: [],
            rows: [],
            rowCount: changes,
            elapsedMs: Date.now() - startedAt,
            statementType: 'change',
            changes,
            truncated: false,
          });
          return;
        }

        resolve({
          columns,
          rows,
          rowCount: rows.length,
          elapsedMs: Date.now() - startedAt,
          statementType: 'select',
          changes: null,
          truncated,
        });
      });
    });
  }

  async schema(): Promise<SchemaObject[]> {
    const [rows] = await this.connection.query({
      sql: `SELECT TABLE_NAME AS name, TABLE_TYPE AS type
            FROM information_schema.TABLES
            WHERE TABLE_SCHEMA = DATABASE()
            ORDER BY TABLE_TYPE, TABLE_NAME`,
      rowsAsArray: true,
    });

    return (rows as unknown[][]).map((row) => ({
      name: String(row[0] ?? ''),
      type: row[1] === 'VIEW' ? 'view' : 'table',
    }));
  }

  async close(): Promise<void> {
    await this.connection.end();
  }

  async cancel(): Promise<void> {
    const control = await mysql.createConnection(this.controlOptions);
    try {
      await control.query(`KILL QUERY ${Number(this.threadId)}`);
    } finally {
      await control.end().catch(() => undefined);
    }
  }
}
