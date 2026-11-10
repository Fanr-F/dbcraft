import { connect, Request, TYPES, type Connection, type ConnectionConfiguration } from 'tedious';
import type {
  DatabaseInfo,
  DdlObjectKind,
  MssqlConnectionInput,
  QueryCell,
  QueryColumn,
  QueryMessage,
  QueryResult,
  SchemaGetOptions,
  SchemaObject,
  TableCheckInfo,
  TableColumnMeta,
  TableConstraintInfo,
  TableDetail,
  TableExtras,
  TableForeignKeyInfo,
  TableIndexInfo,
  TableMeta,
  TableTriggerInfo,
} from '../../../shared/ipc-contract';
import { resolveRowLimit } from '../../../shared/settings.ts';
import { normalizeMssqlAddress } from '../../../shared/mssql-address.ts';
import type { DatabaseSession } from '../DatabaseSession';
import { formatMssqlCell } from './values.ts';

const MAX_ROWS = 2000;

interface ColumnMeta {
  colName: string;
  type: { name: string };
}

interface RawCell {
  value: unknown;
  metadata: ColumnMeta;
}

interface ExecResult {
  columns: ColumnMeta[];
  rows: RawCell[][];
  rowCount: number;
  truncated: boolean;
  messages: QueryMessage[];
}

interface ObjectInfo {
  schema: string;
  name: string;
  type: string;
  qualified: string;
}

interface ColumnInfo {
  name: string;
  typeName: string;
  maxLength: number;
  precision: number;
  scale: number;
  nullable: boolean;
  identity: boolean;
  computed: boolean;
  computedDefinition: string | null;
  persisted: boolean;
  defaultDefinition: string | null;
  rowversion: boolean;
  seedValue: number;
  incrementValue: number;
}

function asString(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

function asNumber(value: unknown): number {
  return typeof value === 'number' ? value : Number(value ?? 0);
}

function asBoolean(value: unknown): boolean {
  return value === true || value === 1 || value === '1';
}

/** dbo 下的对象保持短名，其他 schema 用 `schema.name` 以区分同名表。 */
function qualifiedName(schema: string, name: string): string {
  return schema === 'dbo' ? name : `${schema}.${name}`;
}

/** 对象树里的表名可能是 `schema.table`；没写 schema 时按 dbo 处理。 */
function splitSchemaName(name: string): { schema: string; name: string } {
  const trimmed = name.trim();
  const dot = trimmed.indexOf('.');
  if (dot <= 0) return { schema: 'dbo', name: trimmed };
  return { schema: trimmed.slice(0, dot), name: trimmed.slice(dot + 1) };
}

function constraintKind(typeDesc: string): string {
  switch (typeDesc) {
    case 'PRIMARY_KEY_CONSTRAINT':
      return 'PRIMARY KEY';
    case 'UNIQUE_CONSTRAINT':
      return 'UNIQUE';
    case 'FOREIGN_KEY_CONSTRAINT':
      return 'FOREIGN KEY';
    case 'CHECK_CONSTRAINT':
      return 'CHECK';
    case 'DEFAULT_CONSTRAINT':
      return 'DEFAULT';
    default:
      return typeDesc;
  }
}

/** SQL Server 列类型还原成 UI/DDL 可读的声明类型。 */
function formatColumnType(column: ColumnInfo): string {
  const type = column.typeName.toLowerCase();
  if (type === 'timestamp' || type === 'rowversion') return 'rowversion';
  if (type === 'varchar' || type === 'char' || type === 'varbinary' || type === 'binary') {
    return column.maxLength === -1 ? `${type}(max)` : `${type}(${column.maxLength})`;
  }
  if (type === 'nvarchar' || type === 'nchar') {
    return column.maxLength === -1 ? `${type}(max)` : `${type}(${column.maxLength / 2})`;
  }
  if (type === 'decimal' || type === 'numeric') {
    return `${type}(${column.precision},${column.scale})`;
  }
  if (type === 'datetime2' || type === 'time' || type === 'datetimeoffset') {
    return `${type}(${column.scale})`;
  }
  return type;
}

function referentialAction(action: string): string {
  return action && action !== 'NO_ACTION' ? ` ON ${action.replace('_', ' ')}` : '';
}

/**
 * MSSQL 会话：一个标签一个 tedious Connection（一个物理连接），不引入连接池。
 * 查询走事件式结果读取，超过 maxRows 后只丢弃后续行，避免整表进内存。
 */
export class MssqlSession implements DatabaseSession {
  readonly dialect = 'mssql' as const;
  readonly label = 'MSSQL';
  readonly isReadOnly = false;
  readonly serverVersion: string;
  readonly cancelDisconnects = false;
  alive = true;

  private currentRequest: Request | null = null;

  private readonly connection: Connection;

  private constructor(connection: Connection, version: string) {
    this.connection = connection;
    this.serverVersion = version;
  }

  static async create(
    input: MssqlConnectionInput,
    options: { connectTimeoutMs?: number } = {},
  ): Promise<MssqlSession> {
    // 兼容导入配置里的 `host\instance`；命名实例忽略端口，由 SQL Browser 解析。
    const address = normalizeMssqlAddress(input.host, input.port, input.instanceName);
    const config: ConnectionConfiguration = {
      server: address.host,
      authentication: {
        type: 'default',
        options: { userName: input.username, password: input.password },
      },
      options: {
        ...(address.instanceName ? { instanceName: address.instanceName } : { port: address.port }),
        ...(input.database ? { database: input.database } : {}),
        encrypt: input.encrypt,
        trustServerCertificate: input.trustServerCertificate,
        useUTC: true,
        requestTimeout: 0,
        connectTimeout: options.connectTimeoutMs ?? 8000,
        enableArithAbort: true,
        appName: 'DBCraft',
      },
    };

    let opened: Connection | null = null;
    const connection = await new Promise<Connection>((resolve, reject) => {
      let settled = false;
      opened = connect(config, (error) => {
        if (settled) return;
        settled = true;
        if (error) reject(error);
        else if (opened) resolve(opened);
      });
      opened.once('error', (error) => {
        if (settled) return;
        settled = true;
        reject(error);
      });
    });

    // 与 SSMS 默认会话选项对齐，避免 DDL/索引依赖 ANSI_NULLS / QUOTED_IDENTIFIER。
    try {
      await execOn(connection, 'SET ANSI_NULLS ON; SET QUOTED_IDENTIFIER ON;');
    } catch {
      // 设置失败不阻塞连接；后续 DDL 执行会暴露真实错误。
    }

    let version = 'unknown';
    try {
      const result = await execOn(connection, 'SELECT @@VERSION AS version');
      const firstLine = asString(result.rows[0]?.[0]?.value).split(/\r?\n/)[0]?.trim();
      version = firstLine || 'unknown';
    } catch {
      // 版本读取失败不阻塞会话；后续查询会暴露真实错误。
    }

    const session = new MssqlSession(connection, version);
    connection.on('error', () => {
      session.alive = false;
    });
    connection.on('end', () => {
      session.alive = false;
    });
    return session;
  }

  /** 查询并维护当前请求句柄，供 cancel() 使用。 */
  private run(sql: string, params: QueryCell[] = [], rowLimit?: number): Promise<ExecResult> {
    return execOn(this.connection, sql, params, rowLimit, (request) => {
      this.currentRequest = request;
    });
  }

  async query(sql: string, params?: QueryCell[], maxRows?: number): Promise<QueryResult> {
    const startedAt = Date.now();
    const rowLimit = resolveRowLimit(maxRows, MAX_ROWS);
    const result = await this.run(sql, params ?? [], rowLimit);
    const hasColumns = result.columns.length > 0;
    const formatRow = (row: RawCell[]): QueryCell[] =>
      row.map((cell) => formatMssqlCell(cell.value, cell.metadata?.type?.name ?? ''));

    if (!hasColumns) {
      const changes = result.rowCount;
      return {
        columns: [],
        rows: [],
        rowCount: changes,
        elapsedMs: Date.now() - startedAt,
        statementType: 'change',
        changes,
        truncated: false,
        ...(result.messages.length > 0 ? { messages: result.messages } : {}),
      };
    }

    const rows = result.rows.map(formatRow);
    const columns: QueryColumn[] = result.columns.map((column) => ({
      name: column.colName,
      declaredType: column.type?.name ?? null,
    }));

    return {
      columns,
      rows,
      rowCount: rows.length,
      elapsedMs: Date.now() - startedAt,
      statementType: 'select',
      changes: null,
      truncated: result.truncated,
      ...(result.messages.length > 0 ? { messages: result.messages } : {}),
    };
  }

  async databases(): Promise<DatabaseInfo[]> {
    const currentResult = await this.run('SELECT DB_NAME()');
    const current = asString(currentResult.rows[0]?.[0]?.value);
    const result = await this.run(
      `SELECT name FROM sys.databases
       WHERE HAS_DBACCESS(name) = 1 AND state = 0
       ORDER BY name`,
    );
    return result.rows.map((row) => {
      const name = asString(row[0]?.value);
      return { name, current: name === current };
    });
  }

  async useDatabase(database: string): Promise<void> {
    const name = database.trim();
    if (!name) throw new Error('数据库名不能为空。');
    await this.run(`USE ${quoteMssql(name)}`);
  }

  async schema(options: SchemaGetOptions = {}): Promise<SchemaObject[]> {
    const database = options.database?.trim();
    const prefix = database ? `${quoteMssql(database)}.` : '';
    const result = await this.run(
      `SELECT s.name AS schema_name, o.name, o.type
       FROM ${prefix}sys.objects o
       JOIN ${prefix}sys.schemas s ON s.schema_id = o.schema_id
       WHERE o.type IN ('U', 'V', 'P', 'PC')
         ${options.includeSystemObjects ? '' : 'AND o.is_ms_shipped = 0'}
       ORDER BY s.name, o.name`,
    );

    return result.rows.map((row) => {
      // sys.objects.type 是 char(2)，会带尾部空格。
      const type = asString(row[2]?.value).trim();
      const schema = asString(row[0]?.value);
      return {
        name: qualifiedName(schema, asString(row[1]?.value)),
        type: type === 'V' ? ('view' as const) : type === 'U' ? ('table' as const) : ('procedure' as const),
        schema,
      };
    });
  }

  async tableExtras(database: string, table: string): Promise<TableExtras> {
    const db = database.trim();
    if (!db) throw new Error('数据库名不能为空。');
    const prefix = `${quoteMssql(db)}.`;
    const target = splitSchemaName(table);

    const idResult = await this.run(
      `SELECT o.object_id
       FROM ${prefix}sys.objects o
       JOIN ${prefix}sys.schemas s ON s.schema_id = o.schema_id
       WHERE s.name = @p1 AND o.name = @p2 AND o.type = 'U'`,
      [target.schema, target.name],
    );
    const objectId = asNumber(idResult.rows[0]?.[0]?.value);
    if (!objectId) throw new Error(`表「${table}」不存在。`);

    const constraintRows = await this.run(
      `SELECT kc.name, kc.type_desc
       FROM ${prefix}sys.objects kc
       WHERE kc.parent_object_id = @p1 AND kc.type IN ('PK', 'UQ', 'F', 'C', 'D')
       ORDER BY kc.type, kc.name`,
      [objectId],
    );
    const constraints: TableConstraintInfo[] = constraintRows.rows.map((row) => ({
      name: asString(row[0]?.value),
      kind: constraintKind(asString(row[1]?.value)),
    }));

    const triggerRows = await this.run(
      `SELECT tr.name, tr.is_disabled
       FROM ${prefix}sys.triggers tr
       WHERE tr.parent_id = @p1
       ORDER BY tr.name`,
      [objectId],
    );
    const triggers: TableTriggerInfo[] = triggerRows.rows.map((row) => ({
      name: asString(row[0]?.value),
      disabled: asBoolean(row[1]?.value),
    }));

    const indexRows = await this.run(
      `SELECT i.name, i.is_unique, i.is_primary_key, c.name, ic.key_ordinal
       FROM ${prefix}sys.indexes i
       JOIN ${prefix}sys.index_columns ic
         ON ic.object_id = i.object_id AND ic.index_id = i.index_id
       JOIN ${prefix}sys.columns c
         ON c.object_id = ic.object_id AND c.column_id = ic.column_id
       WHERE i.object_id = @p1 AND i.name IS NOT NULL
       ORDER BY i.name, ic.key_ordinal, ic.index_column_id`,
      [objectId],
    );
    const indexMap = new Map<string, TableIndexInfo & { primary: boolean }>();
    for (const row of indexRows.rows) {
      const name = asString(row[0]?.value);
      if (!name) continue;
      const group = indexMap.get(name) ?? {
        name,
        unique: asBoolean(row[1]?.value),
        primary: asBoolean(row[2]?.value),
        columns: [],
      };
      group.columns.push(asString(row[3]?.value));
      indexMap.set(name, group);
    }

    return {
      constraints,
      triggers,
      indexes: [...indexMap.values()].map(({ name, unique, columns }) => ({
        name,
        unique,
        columns,
      })),
    };
  }

  async getDdl(name: string, kind: DdlObjectKind): Promise<string> {
    const object = await this.objectInfo(name);
    if (!object) throw new Error(`对象「${name}」不存在。`);

    if (object.type === 'V' || object.type === 'P') {
      const definition = await this.run(
        'SELECT definition FROM sys.sql_modules WHERE object_id = OBJECT_ID(@p1)',
        [name],
      );
      const ddl = asString(definition.rows[0]?.[0]?.value).trim();
      if (!ddl) throw new Error(`无法读取对象「${name}」的定义（可能已加密）。`);
      return ddl;
    }

    const columns = await this.columnInfo(name);
    const primaryKey = await this.primaryKeyInfo(name);
    const detail = await this.getTableDetail(name);

    const lines = columns.map((column) => this.columnDdl(column));
    if (primaryKey.columns.length > 0) {
      const constraint = primaryKey.name
        ? `CONSTRAINT ${quoteMssql(primaryKey.name)} `
        : '';
      lines.push(
        `${constraint}PRIMARY KEY (${primaryKey.columns.map((column) => quoteMssql(column)).join(', ')})`,
      );
    }
    for (const check of detail.checks) {
      lines.push(
        `CONSTRAINT ${quoteMssql(check.name ?? `CK_${object.name}`)} CHECK ${check.expression}`,
      );
    }
    for (const foreignKey of detail.foreignKeys) {
      const actions = `${referentialAction(foreignKey.onDelete ?? '')}${referentialAction(
        foreignKey.onUpdate ?? '',
      )}`;
      lines.push(
        `CONSTRAINT ${quoteMssql(foreignKey.name)} FOREIGN KEY (${foreignKey.columns
          .map((column) => quoteMssql(column))
          .join(', ')}) REFERENCES ${quoteQualified(
          foreignKey.referencedTable,
        )} (${foreignKey.referencedColumns.map((column) => quoteMssql(column)).join(', ')})${actions}`,
      );
    }

    const target = `${quoteMssql(object.schema)}.${quoteMssql(object.name)}`;
    const statements = [
      `CREATE TABLE ${target} (\n${lines
        .map((line) => `  ${line}`)
        .join(',\n')}\n);`,
    ];

    const primaryKeyName = primaryKey.name;
    for (const index of detail.indexes) {
      if (primaryKeyName && index.name === primaryKeyName) continue;
      statements.push(
        `CREATE ${index.unique ? 'UNIQUE ' : ''}INDEX ${quoteMssql(index.name)} ON ${target} (${index.columns
          .map((column) => quoteMssql(column))
          .join(', ')});`,
      );
    }

    void kind;
    return statements.join('\n\n');
  }

  async getTableMeta(name: string, kind: DdlObjectKind): Promise<TableMeta> {
    const object = await this.objectInfo(name);
    if (!object) throw new Error(`对象「${name}」不存在。`);
    if (kind === 'view' && object.type !== 'V') {
      throw new Error(`「${name}」不是视图。`);
    }

    const columns = await this.columnInfo(name);
    const primaryKey =
      object.type === 'V' ? { name: '', columns: [] } : await this.primaryKeyInfo(name);
    const primaryKeySet = new Set(primaryKey.columns);
    const isView = object.type === 'V';

    const metaColumns: TableColumnMeta[] = columns.map((column) => {
      const readOnly =
        isView ||
        primaryKeySet.has(column.name) ||
        column.identity ||
        column.computed ||
        column.rowversion;
      return {
        name: column.name,
        declaredType: formatColumnType(column),
        notNull: !column.nullable,
        primaryKey: primaryKeySet.has(column.name),
        autoIncrement: column.identity,
        defaultValue: column.defaultDefinition,
        readOnly,
      };
    });

    const editable =
      !this.isReadOnly && !isView && metaColumns.length > 0 && primaryKey.columns.length > 0;
    return {
      name: object.qualified,
      kind: isView ? 'view' : 'table',
      columns: metaColumns,
      primaryKey: primaryKey.columns,
      editable,
      ...(editable
        ? {}
        : {
            reasonCode: this.isReadOnly
              ? ('readonly-session' as const)
              : isView
                ? ('view' as const)
                : ('no-primary-key' as const),
            reason: this.isReadOnly
              ? '当前会话为只读'
              : isView
                ? '视图不能直接编辑'
                : '该表没有主键，无法安全定位行',
          }),
    };
  }

  async getTableDetail(name: string): Promise<TableDetail> {
    const object = await this.objectInfo(name);
    if (!object) throw new Error(`对象「${name}」不存在。`);
    const kind: DdlObjectKind = object.type === 'V' ? 'view' : 'table';
    const meta = await this.getTableMeta(name, kind);

    // 一个物理连接同一时刻只能跑一个请求，元数据查询必须串行。
    const indexRows = await this.run(
      `SELECT i.name, i.is_unique, c.name AS column_name, ic.key_ordinal, ic.is_included_column
       FROM sys.indexes i
       JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
       JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
       WHERE i.object_id = OBJECT_ID(@p1) AND i.name IS NOT NULL AND i.is_primary_key = 0
       ORDER BY i.name, ic.key_ordinal, ic.index_column_id`,
      [name],
    );
    const foreignKeyRows = await this.run(
      `SELECT fk.name, pc.name AS column_name, rs.name AS ref_schema, rt.name AS ref_table,
              rc.name AS ref_column, fk.delete_referential_action_desc,
              fk.update_referential_action_desc, fkc.constraint_column_id
       FROM sys.foreign_keys fk
       JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
       JOIN sys.columns pc ON pc.object_id = fkc.parent_object_id
                           AND pc.column_id = fkc.parent_column_id
       JOIN sys.tables rt ON rt.object_id = fkc.referenced_object_id
       JOIN sys.schemas rs ON rs.schema_id = rt.schema_id
       JOIN sys.columns rc ON rc.object_id = fkc.referenced_object_id
                           AND rc.column_id = fkc.referenced_column_id
       WHERE fk.parent_object_id = OBJECT_ID(@p1)
       ORDER BY fk.name, fkc.constraint_column_id`,
      [name],
    );
    const checkRows = await this.run(
      `SELECT name, definition FROM sys.check_constraints
       WHERE parent_object_id = OBJECT_ID(@p1) ORDER BY name`,
      [name],
    );
    const commentRows = await this.run(
      `SELECT CAST(ep.value AS nvarchar(max)) AS comment
       FROM sys.extended_properties ep
       WHERE ep.major_id = OBJECT_ID(@p1) AND ep.minor_id = 0 AND ep.name = 'MS_Description'`,
      [name],
    );

    const indexMap = new Map<string, TableIndexInfo>();
    for (const row of indexRows.rows) {
      const indexName = asString(row[0]?.value);
      if (!indexName) continue;
      const existing = indexMap.get(indexName) ?? {
        name: indexName,
        unique: asBoolean(row[1]?.value),
        columns: [],
      };
      existing.columns.push(asString(row[2]?.value));
      indexMap.set(indexName, existing);
    }

    const foreignKeyMap = new Map<string, TableForeignKeyInfo>();
    for (const row of foreignKeyRows.rows) {
      const fkName = asString(row[0]?.value);
      if (!fkName) continue;
      const existing = foreignKeyMap.get(fkName) ?? {
        name: fkName,
        columns: [],
        referencedTable: qualifiedName(asString(row[2]?.value), asString(row[3]?.value)),
        referencedColumns: [],
        onDelete: asString(row[5]?.value) || null,
        onUpdate: asString(row[6]?.value) || null,
      };
      existing.columns.push(asString(row[1]?.value));
      existing.referencedColumns.push(asString(row[4]?.value));
      foreignKeyMap.set(fkName, existing);
    }

    const checks: TableCheckInfo[] = checkRows.rows.map((row) => ({
      name: asString(row[0]?.value) || null,
      expression: asString(row[1]?.value),
    }));

    const comment = commentRows.rows[0]?.[0]?.value;
    return {
      ...meta,
      indexes: [...indexMap.values()],
      foreignKeys: [...foreignKeyMap.values()],
      checks,
      comment: comment === null || comment === undefined ? null : asString(comment),
    };
  }

  async cancel(): Promise<void> {
    try {
      this.currentRequest?.cancel();
    } catch {
      // 请求已经结束时 cancel 可能抛错，忽略即可。
    }
  }

  async close(): Promise<void> {
    this.alive = false;
    this.currentRequest?.cancel();
    this.connection.close();
  }

  private async objectInfo(name: string): Promise<ObjectInfo | null> {
    const result = await this.run(
      `SELECT s.name AS schema_name, o.name, o.type
       FROM sys.objects o JOIN sys.schemas s ON s.schema_id = o.schema_id
       WHERE o.object_id = OBJECT_ID(@p1)`,
      [name],
    );
    const row = result.rows[0];
    if (!row) return null;
    const schema = asString(row[0]?.value);
    const objectName = asString(row[1]?.value);
    return {
      schema,
      name: objectName,
      type: asString(row[2]?.value).trim(),
      qualified: qualifiedName(schema, objectName),
    };
  }

  private async columnInfo(name: string): Promise<ColumnInfo[]> {
    const result = await this.run(
      `SELECT c.name, ty.name AS type_name, c.max_length, c.precision, c.scale,
              c.is_nullable, c.is_identity, c.is_computed,
              cc.definition AS computed_definition, cc.is_persisted,
              dc.definition AS default_definition,
              CASE WHEN ty.name IN ('timestamp', 'rowversion') THEN 1 ELSE 0 END AS is_rowversion,
              ident.seed_value, ident.increment_value
       FROM sys.columns c
       JOIN sys.types ty ON ty.user_type_id = c.user_type_id
       LEFT JOIN sys.computed_columns cc
         ON cc.object_id = c.object_id AND cc.column_id = c.column_id
       LEFT JOIN sys.default_constraints dc
         ON dc.parent_object_id = c.object_id AND dc.parent_column_id = c.column_id
       LEFT JOIN sys.identity_columns ident
         ON ident.object_id = c.object_id AND ident.column_id = c.column_id
       WHERE c.object_id = OBJECT_ID(@p1)
       ORDER BY c.column_id`,
      [name],
    );

    return result.rows.map((row) => ({
      name: asString(row[0]?.value),
      typeName: asString(row[1]?.value),
      maxLength: asNumber(row[2]?.value),
      precision: asNumber(row[3]?.value),
      scale: asNumber(row[4]?.value),
      nullable: asBoolean(row[5]?.value),
      identity: asBoolean(row[6]?.value),
      computed: asBoolean(row[7]?.value),
      computedDefinition: row[8]?.value === null ? null : asString(row[8]?.value),
      persisted: asBoolean(row[9]?.value),
      defaultDefinition: row[10]?.value === null ? null : asString(row[10]?.value),
      rowversion: asBoolean(row[11]?.value),
      seedValue: asNumber(row[12]?.value || 1),
      incrementValue: asNumber(row[13]?.value || 1),
    }));
  }

  private async primaryKeyInfo(name: string): Promise<{ name: string; columns: string[] }> {
    const result = await this.run(
      `SELECT kc.name AS constraint_name, c.name AS column_name
       FROM sys.key_constraints kc
       JOIN sys.index_columns ic
         ON ic.object_id = kc.parent_object_id AND ic.index_id = kc.unique_index_id
       JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
       WHERE kc.parent_object_id = OBJECT_ID(@p1) AND kc.type = 'PK'
       ORDER BY ic.key_ordinal`,
      [name],
    );
    return {
      name: asString(result.rows[0]?.[0]?.value),
      columns: result.rows.map((row) => asString(row[1]?.value)),
    };
  }

  private columnDdl(column: ColumnInfo): string {
    if (column.computed) {
      const persisted = column.persisted ? ' PERSISTED' : '';
      return `${quoteMssql(column.name)} AS (${column.computedDefinition ?? ''})${persisted}`;
    }

    const parts = [quoteMssql(column.name), formatColumnType(column)];
    if (column.identity) {
      parts.push(`IDENTITY(${column.seedValue},${column.incrementValue})`);
    }
    if (!column.nullable) parts.push('NOT NULL');
    if (column.defaultDefinition) parts.push(`DEFAULT ${column.defaultDefinition}`);
    return parts.join(' ');
  }
}

/** 执行一条语句；行数据通过事件读取，超过上限后丢弃后续行。 */
function execOn(
  connection: Connection,
  sql: string,
  params: QueryCell[] = [],
  rowLimit?: number,
  onRequest?: (request: Request | null) => void,
): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const rows: RawCell[][] = [];
    const messages: QueryMessage[] = [];
    let columns: ColumnMeta[] = [];
    let truncated = false;
    let settled = false;

    const onInfo = (info: { message?: string; class?: number }) => {
      const text = info.message?.trim();
      if (!text) return;
      messages.push({
        level: info.class && info.class >= 11 ? 'warn' : 'info',
        text,
      });
    };
    const cleanup = () => connection.removeListener('infoMessage', onInfo);
    connection.on('infoMessage', onInfo);

    const request = new Request(sql, (error, rowCount) => {
      if (settled) return;
      settled = true;
      cleanup();
      onRequest?.(null);
      if (error) {
        reject(error);
        return;
      }
      resolve({ columns, rows, rowCount: rowCount ?? rows.length, truncated, messages });
    });

    // 单语句语义：只保留第一个结果集的列。
    request.on('columnMetadata', (metadata) => {
      if (columns.length === 0) columns = metadata as unknown as ColumnMeta[];
    });
    request.on('row', (cells) => {
      if (typeof rowLimit === 'number' && rows.length >= rowLimit) {
        truncated = true;
        return;
      }
      rows.push(cells as RawCell[]);
    });

    for (let index = 0; index < params.length; index += 1) {
      const parameter = parameterFor(params[index] ?? null);
      request.addParameter(`p${index + 1}`, parameter.type, parameter.value);
    }

    onRequest?.(request);
    try {
      connection.execSql(request);
    } catch (error) {
      settled = true;
      cleanup();
      onRequest?.(null);
      reject(error);
    }
  });
}

type ParameterType = (typeof TYPES)[keyof typeof TYPES];

function parameterFor(value: QueryCell): { type: ParameterType; value: unknown } {
  if (value === null) return { type: TYPES.NVarChar, value: null };
  if (typeof value === 'boolean') return { type: TYPES.Bit, value };
  if (typeof value === 'number') {
    if (Number.isInteger(value)) {
      if (value >= -2_147_483_648 && value <= 2_147_483_647) {
        return { type: TYPES.Int, value };
      }
      return { type: TYPES.BigInt, value: String(value) };
    }
    return { type: TYPES.Float, value };
  }
  return { type: TYPES.NVarChar, value };
}

function quoteMssql(name: string): string {
  return `[${name.replace(/]/g, ']]')}]`;
}

/** 表名可能是 `schema.table`；逐段引用，避免把点当成标识符的一部分。 */
function quoteQualified(name: string): string {
  return name.split('.').map(quoteMssql).join('.');
}
