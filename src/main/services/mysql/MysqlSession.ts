import mysql from 'mysql2/promise';
import type { Connection as CoreConnection } from 'mysql2';
import type { ConnectionOptions, FieldPacket, ResultSetHeader } from 'mysql2/promise';
import type {
  DatabaseInfo,
  DatabaseType,
  DdlObjectKind,
  MysqlFamilyConnectionInput,
  QueryCell,
  QueryColumn,
  QueryResult,
  SchemaGetOptions,
  SchemaObject,
  SslMode,
  TableColumnMeta,
  TableConstraintInfo,
  TableDetail,
  TableExtras,
  TableIndexInfo,
  TableMeta,
  TableTriggerInfo,
} from '../../../shared/ipc-contract';
import { quoteIdent } from '../../../shared/dialect/identifiers';
import { parseTimeoutMs } from '../../../shared/timeouts';
import { normalizeRowLimit } from '../../../shared/settings';
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
  readonly dialect: DatabaseType;
  readonly serverVersion: string;
  readonly note?: string;
  readonly alive = true;
  readonly cancelDisconnects = false;
  readonly isReadOnly = false;

  private constructor(
    private readonly connection: mysql.Connection,
    private readonly controlOptions: ConnectionOptions,
    private readonly threadId: number,
    label: string,
    version: string,
    dialect: DatabaseType,
    note?: string,
  ) {
    this.label = label;
    this.serverVersion = version;
    this.dialect = dialect;
    this.note = note;
  }

  static async create(
    config: MysqlFamilyConnectionInput,
    options: { connectTimeoutMs?: number } = {},
  ): Promise<MysqlSession> {
    const label = config.type === 'percona' ? 'Percona' : 'MySQL';
    const baseOptions: ConnectionOptions = {
      host: config.host,
      port: config.port,
      user: config.username,
      password: config.password,
      database: config.database || undefined,
      connectTimeout:
        options.connectTimeoutMs ?? parseTimeoutMs(process.env['DBCRAFT_CONNECT_TIMEOUT_MS'], 8000),
      dateStrings: true,
      supportBigNumbers: true,
      bigNumberStrings: true,
      jsonStrings: true,
      ...(config.charset ? { charset: config.charset } : {}),
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
      config.type,
      note,
    );
  }

  /**
   * 使用流式结果，最多保留 MAX_ROWS 行；其余行继续消费但不入内存，
   * 避免 mysql2 的 query() 把整个结果集物化。
   */
  async query(sql: string, params?: QueryCell[], maxRows?: number): Promise<QueryResult> {
    const startedAt = Date.now();
    const rowLimit = normalizeRowLimit(maxRows, MAX_ROWS);
    // promise 包装器的 Connection 仍持有底层回调式连接，流式接口只在底层提供。
    const core = (this.connection as unknown as { connection: CoreConnection }).connection;
    const stream = core
      .query({ sql, values: params, rowsAsArray: true })
      .stream();

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

        if (rows.length >= rowLimit) {
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

  async databases(): Promise<DatabaseInfo[]> {
    const [currentRows] = await this.connection.query({
      sql: 'SELECT DATABASE()',
      rowsAsArray: true,
    });
    const current = String((currentRows as unknown[][])[0]?.[0] ?? '');
    const [rows] = await this.connection.query({
      sql: 'SHOW DATABASES',
      rowsAsArray: true,
    });
    return (rows as unknown[][]).map((row) => {
      const name = String(row[0] ?? '');
      return { name, current: name === current };
    });
  }

  async useDatabase(database: string): Promise<void> {
    const name = database.trim();
    if (!name) throw new Error('数据库名不能为空。');
    await this.connection.query({ sql: `USE ${quoteIdent(this.dialect, name)}` });
  }

  private async databaseOrDefault(preferred?: string): Promise<string> {
    const name = preferred?.trim();
    if (name) return name;
    const [rows] = await this.connection.query({
      sql: 'SELECT DATABASE()',
      rowsAsArray: true,
    });
    return String((rows as unknown[][])[0]?.[0] ?? '');
  }

  async schema(options: SchemaGetOptions = {}): Promise<SchemaObject[]> {
    const database = await this.databaseOrDefault(options.database);
    if (!database) return [];

    const [rows] = await this.connection.query({
      sql: `SELECT TABLE_NAME AS name, TABLE_TYPE AS type
            FROM information_schema.TABLES
            WHERE TABLE_SCHEMA = ?
            ORDER BY TABLE_TYPE, TABLE_NAME`,
      values: [database],
      rowsAsArray: true,
    });
    const objects: SchemaObject[] = (rows as unknown[][]).map((row) => ({
      name: String(row[0] ?? ''),
      type: row[1] === 'VIEW' ? 'view' : 'table',
    }));

    const [procedures] = await this.connection.query({
      sql: `SELECT ROUTINE_NAME
            FROM information_schema.ROUTINES
            WHERE ROUTINE_SCHEMA = ? AND ROUTINE_TYPE = 'PROCEDURE'
            ORDER BY ROUTINE_NAME`,
      values: [database],
      rowsAsArray: true,
    });
    for (const row of procedures as unknown[][]) {
      objects.push({ name: String(row[0] ?? ''), type: 'procedure' });
    }
    return objects;
  }

  async tableExtras(database: string, table: string): Promise<TableExtras> {
    const db = database.trim();
    if (!db) throw new Error('数据库名不能为空。');

    const [constraintRows] = await this.connection.query({
      sql: `SELECT CONSTRAINT_NAME, CONSTRAINT_TYPE
            FROM information_schema.TABLE_CONSTRAINTS
            WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
            ORDER BY CONSTRAINT_TYPE, CONSTRAINT_NAME`,
      values: [db, table],
      rowsAsArray: true,
    });
    const constraints: TableConstraintInfo[] = (constraintRows as unknown[][]).map((row) => ({
      name: String(row[0] ?? ''),
      kind: String(row[1] ?? ''),
    }));

    const [triggerRows] = await this.connection.query({
      sql: `SELECT TRIGGER_NAME
            FROM information_schema.TRIGGERS
            WHERE TRIGGER_SCHEMA = ? AND EVENT_OBJECT_TABLE = ?
            ORDER BY TRIGGER_NAME`,
      values: [db, table],
      rowsAsArray: true,
    });
    const triggers: TableTriggerInfo[] = (triggerRows as unknown[][]).map((row) => ({
      name: String(row[0] ?? ''),
      disabled: false,
    }));

    const [indexRows] = await this.connection.query({
      sql: `SELECT INDEX_NAME, NON_UNIQUE, COLUMN_NAME
            FROM information_schema.STATISTICS
            WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
            ORDER BY INDEX_NAME, SEQ_IN_INDEX`,
      values: [db, table],
      rowsAsArray: true,
    });
    const indexMap = new Map<string, TableIndexInfo>();
    for (const row of indexRows as unknown[][]) {
      const name = String(row[0] ?? '');
      if (!name) continue;
      const group = indexMap.get(name) ?? {
        name,
        unique: Number(row[1] ?? 1) === 0,
        columns: [],
      };
      group.columns.push(String(row[2] ?? ''));
      indexMap.set(name, group);
    }

    return { constraints, triggers, indexes: [...indexMap.values()] };
  }

  async getDdl(name: string, kind: DdlObjectKind): Promise<string> {
    const target = quoteIdent(this.dialect, name);
    const sql =
      kind === 'view' ? `SHOW CREATE VIEW ${target}` : `SHOW CREATE TABLE ${target}`;
    const [rows] = await this.connection.query({ sql, rowsAsArray: true });
    const ddl = (rows as unknown[][])[0]?.[1];

    if (typeof ddl !== 'string' || ddl.trim().length === 0) {
      throw new Error(`未找到${kind === 'view' ? '视图' : '表'}「${name}」的 DDL。`);
    }
    return ddl;
  }

  async getTableMeta(name: string, kind: DdlObjectKind): Promise<TableMeta> {
    const [tableRows] = await this.connection.query({
      sql: `SELECT TABLE_TYPE FROM information_schema.TABLES
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
      values: [name],
      rowsAsArray: true,
    });
    const tableType = (tableRows as unknown[][])[0]?.[0];
    if (!tableType) {
      throw new Error(`未找到${kind === 'view' ? '视图' : '表'}「${name}」。`);
    }

    const [rows] = await this.connection.query({
      sql: `SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, EXTRA, COLUMN_KEY
            FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
            ORDER BY ORDINAL_POSITION`,
      values: [name],
      rowsAsArray: true,
    });

    const columns: TableColumnMeta[] = (rows as unknown[][]).map((row) => {
      const extra = String(row[4] ?? '');
      const primaryKey = row[5] === 'PRI';
      const generated = /VIRTUAL GENERATED|STORED GENERATED/i.test(extra);
      return {
        name: String(row[0] ?? ''),
        declaredType: String(row[1] ?? ''),
        notNull: row[2] === 'NO',
        primaryKey,
        autoIncrement: /auto_increment/i.test(extra),
        defaultValue: row[3] === null || row[3] === undefined ? null : String(row[3]),
        readOnly: primaryKey || generated,
      };
    });

    const primaryKey = columns.filter((column) => column.primaryKey).map((column) => column.name);
    const isView = String(tableType) === 'VIEW' || kind === 'view';
    const editable = !isView && primaryKey.length > 0 && !this.isReadOnly;

    let reason: string | undefined;
    let reasonCode: TableMeta['reasonCode'];
    if (isView) {
      reason = '视图不可编辑';
      reasonCode = 'view';
    } else if (primaryKey.length === 0) {
      reason = '表没有主键，无法安全定位行';
      reasonCode = 'no-primary-key';
    }

    return {
      name,
      kind: isView ? 'view' : 'table',
      columns,
      primaryKey,
      editable,
      ...(reasonCode ? { reasonCode } : {}),
      ...(reason ? { reason } : {}),
    };
  }

  async getTableDetail(name: string): Promise<TableDetail> {
    const meta = await this.getTableMeta(name, 'table');

    const [indexRows] = await this.connection.query({
      sql: `SELECT INDEX_NAME, NON_UNIQUE, COLUMN_NAME
            FROM information_schema.STATISTICS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
            ORDER BY INDEX_NAME, SEQ_IN_INDEX`,
      values: [name],
      rowsAsArray: true,
    });
    const indexMap = new Map<string, { unique: boolean; columns: string[] }>();
    for (const row of indexRows as unknown[][]) {
      const indexName = String(row[0] ?? '');
      if (!indexName) continue;
      const group = indexMap.get(indexName) ?? {
        unique: Number(row[1] ?? 1) === 0,
        columns: [],
      };
      group.columns.push(String(row[2] ?? ''));
      indexMap.set(indexName, group);
    }

    const [fkRows] = await this.connection.query({
      sql: `SELECT k.CONSTRAINT_NAME, k.COLUMN_NAME, k.REFERENCED_TABLE_NAME,
                   k.REFERENCED_COLUMN_NAME, r.DELETE_RULE, r.UPDATE_RULE
            FROM information_schema.KEY_COLUMN_USAGE k
            LEFT JOIN information_schema.REFERENTIAL_CONSTRAINTS r
              ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA
             AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME
             AND r.TABLE_NAME = k.TABLE_NAME
            WHERE k.TABLE_SCHEMA = DATABASE()
              AND k.TABLE_NAME = ?
              AND k.REFERENCED_TABLE_NAME IS NOT NULL
            ORDER BY k.CONSTRAINT_NAME, k.ORDINAL_POSITION`,
      values: [name],
      rowsAsArray: true,
    });
    const fkMap = new Map<
      string,
      {
        columns: string[];
        referencedTable: string;
        referencedColumns: string[];
        onDelete: string | null;
        onUpdate: string | null;
      }
    >();
    for (const row of fkRows as unknown[][]) {
      const constraint = String(row[0] ?? '');
      const group = fkMap.get(constraint) ?? {
        columns: [],
        referencedTable: String(row[2] ?? ''),
        referencedColumns: [],
        onDelete: row[4] === null || row[4] === undefined ? null : String(row[4]),
        onUpdate: row[5] === null || row[5] === undefined ? null : String(row[5]),
      };
      group.columns.push(String(row[1] ?? ''));
      group.referencedColumns.push(String(row[3] ?? ''));
      fkMap.set(constraint, group);
    }

    const [commentRows] = await this.connection.query({
      sql: `SELECT TABLE_COMMENT FROM information_schema.TABLES
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
      values: [name],
      rowsAsArray: true,
    });
    const commentRaw = String((commentRows as unknown[][])[0]?.[0] ?? '').trim();

    let checks: TableDetail['checks'] = [];
    try {
      const [checkRows] = await this.connection.query({
        sql: `SELECT tc.CONSTRAINT_NAME, cc.CHECK_CLAUSE
              FROM information_schema.TABLE_CONSTRAINTS tc
              JOIN information_schema.CHECK_CONSTRAINTS cc
                ON cc.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA
               AND cc.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
              WHERE tc.TABLE_SCHEMA = DATABASE()
                AND tc.TABLE_NAME = ?
                AND tc.CONSTRAINT_TYPE = 'CHECK'
              ORDER BY tc.CONSTRAINT_NAME`,
        values: [name],
        rowsAsArray: true,
      });
      checks = (checkRows as unknown[][]).map((row) => ({
        name: String(row[0] ?? ''),
        expression: String(row[1] ?? ''),
      }));
    } catch {
      // MySQL 5.7 / 旧 MariaDB 没有 CHECK_CONSTRAINTS，保持空列表。
      checks = [];
    }

    return {
      ...meta,
      indexes: [...indexMap].map(([indexName, group]) => ({ name: indexName, ...group })),
      foreignKeys: [...fkMap].map(([name2, group]) => ({ name: name2, ...group })),
      checks,
      comment: commentRaw.length > 0 ? commentRaw : null,
    };
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
