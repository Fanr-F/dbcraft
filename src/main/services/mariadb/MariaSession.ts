import mariadb from 'mariadb';
import type { Connection as MariaConnection, ConnectionConfig, FieldInfo } from 'mariadb';
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

/** 能确认返回结果集的语句；其余走普通 query 以保留 affectedRows。 */
const ROW_STATEMENT = /^(?:select|show|describe|desc|explain|with|table|values|call)\b/i;

function stripLeadingComments(sql: string): string {
  return sql.replace(/^(?:\s+|--[^\n]*\n?|#[^\n]*\n?|\/\*[\s\S]*?\*\/)+/, '');
}

function isRowStatement(sql: string): boolean {
  return ROW_STATEMENT.test(stripLeadingComments(sql));
}

function sslOption(mode: SslMode): { rejectUnauthorized: boolean } | true | undefined {
  if (mode === 'disable') return undefined;
  return {
    rejectUnauthorized: mode === 'verify-ca' || mode === 'verify-full',
  };
}

function isTlsError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /ssl|tls|secure connection|certificate/i.test(error.message);
}

function fieldName(field: FieldInfo): string {
  const candidate = field as unknown as { name: string | (() => string) };
  return typeof candidate.name === 'function' ? candidate.name() : candidate.name;
}

export class MariaSession implements DatabaseSession {
  readonly label = 'MariaDB';
  readonly serverVersion: string;
  readonly note?: string;
  readonly alive = true;
  readonly cancelDisconnects = false;

  private constructor(
    private readonly connection: MariaConnection,
    private readonly controlOptions: ConnectionConfig,
    private readonly threadId: number | null,
    version: string,
    note?: string,
  ) {
    this.serverVersion = version;
    this.note = note;
  }

  static async create(config: MysqlFamilyConnectionInput): Promise<MariaSession> {
    const baseOptions: ConnectionConfig = {
      host: config.host,
      port: config.port,
      user: config.username,
      password: config.password,
      database: config.database || undefined,
      connectTimeout: 8000,
      dateStrings: true,
      supportBigNumbers: true,
      bigNumberStrings: true,
      decimalAsNumber: false,
      bigIntAsNumber: false,
    };

    const ssl = sslOption(config.sslMode);
    let connection: MariaConnection;
    let note: string | undefined;
    let controlOptions: ConnectionConfig = baseOptions;

    try {
      controlOptions = { ...baseOptions, ...(ssl ? { ssl } : {}) };
      connection = await mariadb.createConnection(controlOptions);
    } catch (error) {
      if (config.sslMode !== 'prefer' || !ssl || !isTlsError(error)) {
        throw error;
      }
      connection = await mariadb.createConnection(baseOptions);
      note = 'TLS 不可用，已回退为明文连接';
    }

    const rows = (await connection.query(
      'SELECT VERSION() AS version, @@version_comment AS comment',
    )) as Array<{ version: string; comment: string }>;

    return new MariaSession(
      connection,
      controlOptions,
      connection.threadId,
      rows[0]?.version ?? 'unknown',
      note,
    );
  }

  async query(sql: string): Promise<QueryResult> {
    // mariadb 的流式接口不会返回 OkPacket（affectedRows），DML/DDL 继续走普通查询。
    if (isRowStatement(sql)) {
      return this.queryStreamed(sql);
    }
    return this.queryBuffered(sql);
  }

  /** 流式读取结果集，最多保留 MAX_ROWS 行，其余行只消费不入内存。 */
  private queryStreamed(sql: string): Promise<QueryResult> {
    const startedAt = Date.now();
    const stream = this.connection.queryStream({ sql, rowsAsArray: true });

    return new Promise<QueryResult>((resolve, reject) => {
      let columns: QueryColumn[] = [];
      let isSelect = false;
      const rows: QueryCell[][] = [];
      let truncated = false;
      let settled = false;

      stream.on('fields', (meta: FieldInfo[] | undefined) => {
        if (!Array.isArray(meta)) return;
        isSelect = true;
        columns = meta.map((field) => ({
          name: fieldName(field),
          declaredType: field.dataTypeName ?? field.type ?? null,
        }));
      });

      stream.on('data', (row: unknown) => {
        if (!Array.isArray(row) || !isSelect) return;

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

  private async queryBuffered(sql: string): Promise<QueryResult> {
    const startedAt = Date.now();
    const rows = await this.connection.query({ sql, rowsAsArray: true });

    if (Array.isArray(rows)) {
      const meta = ((rows as unknown as { meta?: FieldInfo[] }).meta ?? []) as FieldInfo[];
      const columns: QueryColumn[] = meta.map((field) => ({
        name: fieldName(field),
        declaredType: field.dataTypeName ?? field.type ?? null,
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

    const header = rows as unknown as { affectedRows?: number };
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
    const rows = (await this.connection.query({
      sql: `SELECT TABLE_NAME AS name, TABLE_TYPE AS type
            FROM information_schema.TABLES
            WHERE TABLE_SCHEMA = DATABASE()
            ORDER BY TABLE_TYPE, TABLE_NAME`,
      rowsAsArray: true,
    })) as unknown[][];

    return rows.map((row) => ({
      name: String(row[0] ?? ''),
      type: row[1] === 'VIEW' ? 'view' : 'table',
    }));
  }

  async close(): Promise<void> {
    await this.connection.end();
  }

  async cancel(): Promise<void> {
    if (!this.threadId) {
      throw new Error('无法取消：连接没有可用的 thread id');
    }
    const control = await mariadb.createConnection(this.controlOptions);
    try {
      await control.query(`KILL QUERY ${Number(this.threadId)}`);
    } finally {
      await control.end().catch(() => undefined);
    }
  }
}
