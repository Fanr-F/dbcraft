import mysql from 'mysql2/promise';
import type { FieldPacket, ResultSetHeader } from 'mysql2/promise';
import type {
  MysqlFamilyConnectionInput,
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
}export class MysqlSession implements DatabaseSession {
  readonly label: string;
  readonly serverVersion: string;
  readonly note?: string;

  private constructor(
    private readonly connection: mysql.Connection,
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
    const baseOptions = {
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

    try {
      connection = await mysql.createConnection({ ...baseOptions, ...(ssl ? { ssl } : {}) });
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

    return new MysqlSession(connection, label, info?.version ?? 'unknown', note);
  }

  async query(sql: string): Promise<QueryResult> {
    const startedAt = Date.now();
    const [rows, fields] = await this.connection.query({ sql, rowsAsArray: true });

    if (Array.isArray(fields)) {
      const columns: QueryColumn[] = (fields as FieldPacket[]).map((field) => ({
        name: field.name,
        declaredType:
          field.type === undefined ? null : (MYSQL_TYPE_NAMES[field.type] ?? null),
      }));

      const encoded = (rows as unknown[][]).map((row) => row.map(encodeCell));
      const truncated = encoded.length > MAX_ROWS;

      return {
        columns,
        rows: truncated ? encoded.slice(0, MAX_ROWS) : encoded,
        rowCount: truncated ? MAX_ROWS : encoded.length,
        elapsedMs: Date.now() - startedAt,
        statementType: 'select',
        changes: null,
        truncated,
      };
    }

    const header = rows as ResultSetHeader;
    const changes = Number(header.affectedRows ?? 0);

    return {
      columns: [],
      rows: [],
      rowCount: changes,
      elapsedMs: Date.now() - startedAt,
      statementType: 'change',
      changes,
      truncated: false,
    };
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
}
