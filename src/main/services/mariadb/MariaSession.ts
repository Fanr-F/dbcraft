import mariadb from 'mariadb';
import type { Connection as MariaConnection, ConnectionConfig, FieldInfo } from 'mariadb';
import type {
  DatabaseInfo,
  DdlObjectKind,
  MysqlFamilyConnectionInput,
  QueryCell,
  QueryColumn,
  QueryMessage,
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
import { quoteIdent } from '../../../shared/dialect/identifiers.ts';
import { parseTimeoutMs } from '../../../shared/timeouts.ts';
import { resolveRowLimit } from '../../../shared/settings.ts';
import type { DatabaseSession } from '../DatabaseSession';
import { encodeCell } from '../query-values.ts';

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
  readonly dialect = 'mariadb' as const;
  readonly label = 'MariaDB';
  readonly serverVersion: string;
  readonly note?: string;
  readonly alive = true;
  readonly cancelDisconnects = false;
  readonly isReadOnly = false;

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

  static async create(
    config: MysqlFamilyConnectionInput,
    options: { connectTimeoutMs?: number } = {},
  ): Promise<MariaSession> {
    const baseOptions: ConnectionConfig = {
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
      decimalAsNumber: false,
      bigIntAsNumber: false,
      ...(config.charset ? { charset: config.charset } : {}),
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

  async query(sql: string, params?: QueryCell[], maxRows?: number): Promise<QueryResult> {
    // mariadb 的流式接口不会返回 OkPacket（affectedRows），DML/DDL 继续走普通查询。
    if (isRowStatement(sql)) {
      return this.queryStreamed(sql, params, maxRows);
    }
    return this.queryBuffered(sql, params, maxRows);
  }

  /** 流式读取结果集，最多保留 maxRows 行，其余行只消费不入内存。 */
  private async readWarnings(): Promise<QueryMessage[]> {
    try {
      const rows = await this.connection.query('SHOW WARNINGS');
      return (rows as Array<{ Level?: string; Code?: number; Message?: string }>).map((row) => {
        const level = String(row.Level ?? '').toLowerCase();
        return {
          level: level.includes('error') ? 'error' : level.includes('warn') ? 'warn' : 'info',
          text: `${row.Code ?? ''}: ${row.Message ?? ''}`,
        };
      });
    } catch {
      return [];
    }
  }

  private queryStreamed(
    sql: string,
    params?: QueryCell[],
    maxRows?: number,
  ): Promise<QueryResult> {
    const startedAt = Date.now();
    const rowLimit = resolveRowLimit(maxRows, MAX_ROWS);
    const stream = this.connection.queryStream({ sql, rowsAsArray: true }, params);

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

      stream.on('end', async () => {
        if (settled) return;
        settled = true;
        const messages = await this.readWarnings();

        resolve({
          columns,
          rows,
          rowCount: rows.length,
          elapsedMs: Date.now() - startedAt,
          statementType: 'select',
          changes: null,
          truncated,
          ...(messages.length > 0 ? { messages } : {}),
        });
      });
    });
  }

  private async queryBuffered(
    sql: string,
    params?: QueryCell[],
    maxRows?: number,
  ): Promise<QueryResult> {
    const startedAt = Date.now();
    const rowLimit = resolveRowLimit(maxRows, MAX_ROWS);
    const rows = await this.connection.query({ sql, rowsAsArray: true }, params);
    const messages = await this.readWarnings();

    if (Array.isArray(rows)) {
      const meta = ((rows as unknown as { meta?: FieldInfo[] }).meta ?? []) as FieldInfo[];
      const columns: QueryColumn[] = meta.map((field) => ({
        name: fieldName(field),
        declaredType: field.dataTypeName ?? field.type ?? null,
      }));

      const encoded = (rows as unknown[][]).map((row) => row.map(encodeCell));
      const truncated = encoded.length > rowLimit;

      return {
        columns,
        rows: truncated ? encoded.slice(0, rowLimit) : encoded,
        rowCount: truncated ? rowLimit : encoded.length,
        elapsedMs: Date.now() - startedAt,
        statementType: 'select',
        changes: null,
        truncated,
        ...(messages.length > 0 ? { messages } : {}),
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
      ...(messages.length > 0 ? { messages } : {}),
    };
  }

  async databases(): Promise<DatabaseInfo[]> {
    const currentRows = (await this.connection.query({
      sql: 'SELECT DATABASE()',
      rowsAsArray: true,
    })) as unknown[][];
    const current = String(currentRows[0]?.[0] ?? '');
    const rows = (await this.connection.query({
      sql: 'SHOW DATABASES',
      rowsAsArray: true,
    })) as unknown[][];
    return rows.map((row) => {
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
    const rows = (await this.connection.query({
      sql: 'SELECT DATABASE()',
      rowsAsArray: true,
    })) as unknown[][];
    return String(rows[0]?.[0] ?? '');
  }

  async schema(options: SchemaGetOptions = {}): Promise<SchemaObject[]> {
    const database = await this.databaseOrDefault(options.database);
    if (!database) return [];

    const rows = (await this.connection.query(
      {
        sql: `SELECT TABLE_NAME AS name, TABLE_TYPE AS type
              FROM information_schema.TABLES
              WHERE TABLE_SCHEMA = ?
              ORDER BY TABLE_TYPE, TABLE_NAME`,
        rowsAsArray: true,
      },
      [database],
    )) as unknown[][];
    const objects: SchemaObject[] = rows.map((row) => ({
      name: String(row[0] ?? ''),
      type: row[1] === 'VIEW' ? 'view' : 'table',
    }));

    const procedures = (await this.connection.query(
      {
        sql: `SELECT ROUTINE_NAME
              FROM information_schema.ROUTINES
              WHERE ROUTINE_SCHEMA = ? AND ROUTINE_TYPE = 'PROCEDURE'
              ORDER BY ROUTINE_NAME`,
        rowsAsArray: true,
      },
      [database],
    )) as unknown[][];
    for (const row of procedures) {
      objects.push({ name: String(row[0] ?? ''), type: 'procedure' });
    }
    return objects;
  }

  async tableExtras(database: string, table: string): Promise<TableExtras> {
    const db = database.trim();
    if (!db) throw new Error('数据库名不能为空。');

    const constraintRows = (await this.connection.query(
      {
        sql: `SELECT CONSTRAINT_NAME, CONSTRAINT_TYPE
              FROM information_schema.TABLE_CONSTRAINTS
              WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
              ORDER BY CONSTRAINT_TYPE, CONSTRAINT_NAME`,
        rowsAsArray: true,
      },
      [db, table],
    )) as unknown[][];
    const constraints: TableConstraintInfo[] = constraintRows.map((row) => ({
      name: String(row[0] ?? ''),
      kind: String(row[1] ?? ''),
    }));

    const triggerRows = (await this.connection.query(
      {
        sql: `SELECT TRIGGER_NAME
              FROM information_schema.TRIGGERS
              WHERE TRIGGER_SCHEMA = ? AND EVENT_OBJECT_TABLE = ?
              ORDER BY TRIGGER_NAME`,
        rowsAsArray: true,
      },
      [db, table],
    )) as unknown[][];
    const triggers: TableTriggerInfo[] = triggerRows.map((row) => ({
      name: String(row[0] ?? ''),
      disabled: false,
    }));

    const indexRows = (await this.connection.query(
      {
        sql: `SELECT INDEX_NAME, NON_UNIQUE, COLUMN_NAME
              FROM information_schema.STATISTICS
              WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
              ORDER BY INDEX_NAME, SEQ_IN_INDEX`,
        rowsAsArray: true,
      },
      [db, table],
    )) as unknown[][];
    const indexMap = new Map<string, TableIndexInfo>();
    for (const row of indexRows) {
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
    const rows = (await this.connection.query({ sql, rowsAsArray: true })) as unknown[][];
    const ddl = rows[0]?.[1];

    if (typeof ddl !== 'string' || ddl.trim().length === 0) {
      throw new Error(`未找到${kind === 'view' ? '视图' : '表'}「${name}」的 DDL。`);
    }
    return ddl;
  }

  async getTableMeta(name: string, kind: DdlObjectKind): Promise<TableMeta> {
    const tableRows = (await this.connection.query(
      {
        sql: `SELECT TABLE_TYPE FROM information_schema.TABLES
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
        rowsAsArray: true,
      },
      [name],
    )) as unknown[][];
    const tableType = tableRows[0]?.[0];
    if (!tableType) {
      throw new Error(`未找到${kind === 'view' ? '视图' : '表'}「${name}」。`);
    }

    const rows = (await this.connection.query(
      {
        sql: `SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, EXTRA, COLUMN_KEY
              FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
              ORDER BY ORDINAL_POSITION`,
        rowsAsArray: true,
      },
      [name],
    )) as unknown[][];

    const columns: TableColumnMeta[] = rows.map((row) => {
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

    const indexRows = (await this.connection.query(
      {
        sql: `SELECT INDEX_NAME, NON_UNIQUE, COLUMN_NAME
              FROM information_schema.STATISTICS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
              ORDER BY INDEX_NAME, SEQ_IN_INDEX`,
        rowsAsArray: true,
      },
      [name],
    )) as unknown[][];
    const indexMap = new Map<string, { unique: boolean; columns: string[] }>();
    for (const row of indexRows) {
      const indexName = String(row[0] ?? '');
      if (!indexName) continue;
      const group = indexMap.get(indexName) ?? {
        unique: Number(row[1] ?? 1) === 0,
        columns: [],
      };
      group.columns.push(String(row[2] ?? ''));
      indexMap.set(indexName, group);
    }

    const fkRows = (await this.connection.query(
      {
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
        rowsAsArray: true,
      },
      [name],
    )) as unknown[][];
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
    for (const row of fkRows) {
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

    const commentRows = (await this.connection.query(
      {
        sql: `SELECT TABLE_COMMENT FROM information_schema.TABLES
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
        rowsAsArray: true,
      },
      [name],
    )) as unknown[][];
    const commentRaw = String(commentRows[0]?.[0] ?? '').trim();

    let checks: TableDetail['checks'] = [];
    try {
      const checkRows = (await this.connection.query(
        {
          sql: `SELECT tc.CONSTRAINT_NAME, cc.CHECK_CLAUSE
                FROM information_schema.TABLE_CONSTRAINTS tc
                JOIN information_schema.CHECK_CONSTRAINTS cc
                  ON cc.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA
                 AND cc.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
                WHERE tc.TABLE_SCHEMA = DATABASE()
                  AND tc.TABLE_NAME = ?
                  AND tc.CONSTRAINT_TYPE = 'CHECK'
                ORDER BY tc.CONSTRAINT_NAME`,
          rowsAsArray: true,
        },
        [name],
      )) as unknown[][];
      checks = checkRows.map((row) => ({
        name: String(row[0] ?? ''),
        expression: String(row[1] ?? ''),
      }));
    } catch {
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
