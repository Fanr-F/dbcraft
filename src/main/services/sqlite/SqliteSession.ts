import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import type {
  DatabaseInfo,
  DdlObjectKind,
  QueryCell,
  QueryResult,
  SchemaGetOptions,
  SchemaObject,
  TableColumnMeta,
  TableConstraintInfo,
  TableDetail,
  TableExtras,
  TableIndexInfo,
  TableMeta,
  TableTriggerInfo,
} from '../../../shared/ipc-contract';
import type { DatabaseSession } from '../DatabaseSession';
import { quoteIdent } from '../../../shared/dialect/identifiers';
import { extractCheckExpressions } from '../../../shared/dialect/checks';

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

type WorkerRequest =
  | { type: 'open'; filePath: string; readOnly?: boolean }
  | { type: 'query'; sql: string; params?: QueryCell[]; maxRows?: number }
  | { type: 'close' };

type WorkerResponse =
  | { id: number; ok: true; value: unknown }
  | { id: number; ok: false; error: { message: string; code: string | null } };

export class SqliteSession implements DatabaseSession {
  readonly dialect = 'sqlite' as const;
  readonly label = 'SQLite';
  readonly cancelDisconnects = true;
  isReadOnly = false;
  note?: string;
  serverVersion = 'unknown';

  get alive(): boolean {
    return !this.closed;
  }

  private nextId = 1;
  private closed = false;
  private readonly pending = new Map<number, Pending>();

  private constructor(private readonly worker: Worker) {
    worker.on('message', (message: WorkerResponse) => {
      const task = this.pending.get(message.id);
      if (!task) return;
      this.pending.delete(message.id);

      if (message.ok) {
        task.resolve(message.value);
        return;
      }

      const error = new Error(message.error.message);
      (error as Error & { code?: string | null }).code = message.error.code;
      task.reject(error);
    });

    worker.on('error', (error) => {
      this.failAll(error instanceof Error ? error : new Error(String(error)));
    });

    worker.on('exit', (code) => {
      if (!this.closed) {
        this.failAll(new Error(`SQLite worker 已退出（code ${code}）`));
      }
    });
  }

  static async create(filePath: string, readOnly = false): Promise<SqliteSession> {
    const workerPath = join(__dirname, 'sqlite-worker.js').replace(
      'app.asar',
      'app.asar.unpacked',
    );
    const worker = new Worker(workerPath, { name: 'sqlite-conn' });
    const session = new SqliteSession(worker);
    const info = await session.request<{ version: string; readonly: boolean }>({
      type: 'open',
      filePath,
      readOnly,
    });
    session.serverVersion = info.version;
    session.isReadOnly = info.readonly;
    if (info.readonly) {
      session.note = '只读模式：数据库文件被占用或不可写';
    }
    return session;
  }

  query(sql: string, params?: QueryCell[], maxRows?: number): Promise<QueryResult> {
    return this.request<QueryResult>({ type: 'query', sql, params, maxRows });
  }

  async schema(options: SchemaGetOptions = {}): Promise<SchemaObject[]> {
    const systemFilter = options.includeSystemObjects
      ? ''
      : "AND name NOT LIKE 'sqlite_%'";
    const database = options.database?.trim();
    const prefix =
      database && database !== 'main' ? `${quoteIdent('sqlite', database)}.` : '';

    const result = await this.query(
      `SELECT name, type
       FROM ${prefix}sqlite_master
       WHERE type IN ('table', 'view')
         ${systemFilter}
       ORDER BY type, name`,
    );

    return result.rows.map((row) => ({
      name: String(row[0] ?? ''),
      type: row[1] === 'view' ? 'view' : 'table',
    }));
  }

  async databases(): Promise<DatabaseInfo[]> {
    const result = await this.query('PRAGMA database_list');
    return result.rows
      .map((row) => ({ name: String(row[1] ?? ''), current: String(row[1] ?? '') === 'main' }))
      .filter((item) => item.name.length > 0 && item.name !== 'temp');
  }

  async useDatabase(): Promise<void> {
    throw new Error('SQLite 不支持切换数据库。');
  }

  async tableExtras(database: string, table: string): Promise<TableExtras> {
    const schema = database.trim();
    const quotedDatabase =
      schema && schema !== 'main' ? `${quoteIdent('sqlite', schema)}.` : '';
    const quoted = quoteIdent('sqlite', table);

    const info = await this.query(`PRAGMA ${quotedDatabase}table_info(${quoted})`);
    const constraints: TableConstraintInfo[] = [];
    if (info.rows.some((row) => Number(row[5] ?? 0) > 0)) {
      constraints.push({ name: 'PRIMARY KEY', kind: 'PRIMARY KEY' });
    }

    const indexList = await this.query(`PRAGMA ${quotedDatabase}index_list(${quoted})`);
    const indexes: TableIndexInfo[] = [];
    for (const row of indexList.rows) {
      const indexName = String(row[1] ?? '');
      if (!indexName) continue;
      const columns = await this.query(
        `PRAGMA ${quotedDatabase}index_info(${quoteIdent('sqlite', indexName)})`,
      );
      const unique = Number(row[2] ?? 0) !== 0;
      indexes.push({
        name: indexName,
        unique,
        columns: columns.rows.map((item) => String(item[2] ?? '')),
      });
      // origin='u' 是 UNIQUE 约束自动创建的索引；origin='c' 是普通 CREATE INDEX。
      if (String(row[3] ?? '') === 'u') {
        constraints.push({ name: indexName, kind: 'UNIQUE' });
      }
    }

    const foreignKeys = await this.query(`PRAGMA ${quotedDatabase}foreign_key_list(${quoted})`);
    const seenForeignKeys = new Set<number>();
    for (const row of foreignKeys.rows) {
      const id = Number(row[0] ?? 0);
      if (seenForeignKeys.has(id)) continue;
      seenForeignKeys.add(id);
      constraints.push({ name: `FK_${id}`, kind: 'FOREIGN KEY' });
    }

    const triggerRows = await this.query(
      `SELECT name FROM ${quotedDatabase}sqlite_master WHERE type = 'trigger' AND tbl_name = ? ORDER BY name`,
      [table],
    );
    const triggers: TableTriggerInfo[] = triggerRows.rows.map((row) => ({
      name: String(row[0] ?? ''),
      disabled: false,
    }));

    return { constraints, triggers, indexes };
  }

  async getDdl(name: string, kind: DdlObjectKind): Promise<string> {
    if (kind === 'procedure') throw new Error('SQLite 不支持存储过程。');
    const escaped = name.replace(/'/g, "''");
    const type = kind === 'view' ? 'view' : 'table';
    const result = await this.query(
      `SELECT sql FROM sqlite_master WHERE name = '${escaped}' AND type = '${type}'`,
    );

    const ddl = result.rows[0]?.[0];
    if (typeof ddl !== 'string' || ddl.trim().length === 0) {
      throw new Error(`未找到${type === 'view' ? '视图' : '表'}「${name}」的 DDL。`);
    }
    return ddl;
  }

  async getTableMeta(name: string, kind: DdlObjectKind): Promise<TableMeta> {
    const dot = name.lastIndexOf('.');
    const schemaName = dot > 0 ? name.slice(0, dot) : null;
    const tableName = dot > 0 ? name.slice(dot + 1) : name;
    const prefix =
      schemaName && schemaName !== 'main'
        ? `${quoteIdent('sqlite', schemaName)}.`
        : '';
    const object = await this.query(
      `SELECT name, type, sql FROM ${prefix}sqlite_master
       WHERE name = ? AND type = ?`,
      [tableName, kind === 'view' ? 'view' : 'table'],
    );

    if (object.rows.length === 0) {
      throw new Error(`未找到${kind === 'view' ? '视图' : '表'}「${name}」。`);
    }

    const info = await this.query(
      `PRAGMA ${prefix}table_info(${quoteIdent('sqlite', tableName)})`,
    );
    const columns: TableColumnMeta[] = info.rows.map((row) => {
      const declaredType = String(row[2] ?? '');
      const primaryKey = Number(row[5] ?? 0) > 0;
      return {
        name: String(row[1] ?? ''),
        declaredType,
        notNull: Number(row[3] ?? 0) !== 0,
        primaryKey,
        // INTEGER PRIMARY KEY 是 rowid 别名；AUTOINCREMENT 只是额外的单调约束。
        autoIncrement: primaryKey && /^integer$/i.test(declaredType.trim()),
        defaultValue: row[4] === null || row[4] === undefined ? null : String(row[4]),
        readOnly: primaryKey,
      };
    });

    const primaryKey = columns.filter((column) => column.primaryKey).map((column) => column.name);
    const isView = kind === 'view' || object.rows[0]?.[1] === 'view';
    const tableSql = String(object.rows[0]?.[2] ?? '');
    const withoutRowid = /WITHOUT\s+ROWID/i.test(tableSql);
    const columnNames = new Set(columns.map((column) => column.name.toLowerCase()));
    const rowidAlias =
      !isView && !withoutRowid && primaryKey.length === 0
        ? ['rowid', '_rowid_', 'oid'].find(
            (alias) => !columnNames.has(alias.toLowerCase()),
          )
        : undefined;
    const effectiveKey = rowidAlias ? [rowidAlias] : primaryKey;
    const editable =
      !isView && effectiveKey.length > 0 && !this.isReadOnly;

    let reason: string | undefined;
    let reasonCode: TableMeta['reasonCode'];
    if (isView) {
      reason = '视图不可编辑';
      reasonCode = 'view';
    } else if (this.isReadOnly) {
      reason = '当前会话为只读模式';
      reasonCode = 'readonly-session';
    } else if (effectiveKey.length === 0) {
      reason = '表没有主键，无法安全定位行';
      reasonCode = 'no-primary-key';
    }

    return {
      name,
      kind: isView ? 'view' : 'table',
      columns,
      primaryKey: effectiveKey,
      ...(rowidAlias ? { rowidAlias } : {}),
      editable,
      ...(reasonCode ? { reasonCode } : {}),
      ...(reason ? { reason } : {}),
    };
  }

  async getTableDetail(name: string): Promise<TableDetail> {
    const meta = await this.getTableMeta(name, 'table');
    // rowid 是编辑用的隐式键，不应出现在表设计器的“真实主键”里。
    const displayMeta = meta.rowidAlias ? { ...meta, primaryKey: [] } : meta;
    const quoted = quoteIdent('sqlite', name);

    const indexes: TableDetail['indexes'] = [];
    const indexList = await this.query(`PRAGMA index_list(${quoted})`);
    for (const row of indexList.rows) {
      const indexName = String(row[1] ?? '');
      if (!indexName) continue;
      const columns = await this.query(`PRAGMA index_info(${quoteIdent('sqlite', indexName)})`);
      indexes.push({
        name: indexName,
        unique: Number(row[2] ?? 0) !== 0,
        columns: columns.rows
          .map((info) => String(info[2] ?? ''))
          .filter((column) => column.length > 0),
      });
    }

    const foreignKeys: TableDetail['foreignKeys'] = [];
    const fkRows = await this.query(`PRAGMA foreign_key_list(${quoted})`);
    const byId = new Map<
      string,
      {
        columns: string[];
        referencedTable: string;
        referencedColumns: string[];
        onDelete: string | null;
        onUpdate: string | null;
      }
    >();
    for (const row of fkRows.rows) {
      const id = String(row[0] ?? '0');
      const group = byId.get(id) ?? {
        columns: [],
        referencedTable: String(row[2] ?? ''),
        referencedColumns: [],
        onDelete: row[6] === null || row[6] === undefined ? null : String(row[6]),
        onUpdate: row[5] === null || row[5] === undefined ? null : String(row[5]),
      };
      group.columns.push(String(row[3] ?? ''));
      group.referencedColumns.push(String(row[4] ?? ''));
      byId.set(id, group);
    }
    for (const [id, group] of byId) {
      foreignKeys.push({ name: `fk_${id}`, ...group });
    }

    const ddlRow = await this.query(
      `SELECT sql FROM sqlite_master WHERE name = ? AND type = 'table'`,
      [name],
    );
    const ddl = typeof ddlRow.rows[0]?.[0] === 'string' ? String(ddlRow.rows[0][0]) : '';

    const triggerRows = await this.query(
      `SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND tbl_name = ? ORDER BY name`,
      [name],
    );
    const triggers = triggerRows.rows
      .map((row) => ({
        name: String(row[0] ?? ''),
        disabled: false,
        ...(typeof row[1] === 'string' ? { sql: row[1] } : {}),
      }))
      .filter((trigger) => trigger.name.length > 0);

    const viewRows = await this.query(
      `SELECT name, sql FROM sqlite_master
       WHERE type = 'view' AND sql IS NOT NULL AND instr(lower(sql), lower(?)) > 0
       ORDER BY name`,
      [name],
    );
    const dependentViews = viewRows.rows
      .map((row) => ({ name: String(row[0] ?? ''), sql: String(row[1] ?? '') }))
      .filter((view) => view.name.length > 0 && view.sql.length > 0);

    return {
      ...displayMeta,
      indexes,
      foreignKeys,
      checks: extractCheckExpressions(ddl),
      triggers,
      dependentViews,
      tableSql: ddl,
      comment: null,
    };
  }

  async close(): Promise<void> {
    if (this.closed) return;

    try {
      await this.request({ type: 'close' });
    } catch {
      // worker 可能已退出，terminate 兜底。
    } finally {
      this.closed = true;
      this.failAll(new Error('SQLite 连接已关闭'));
      await this.worker.terminate();
    }
  }

  async cancel(): Promise<void> {
    if (this.closed) return;

    this.closed = true;
    this.failAll(new Error('查询已取消'));
    await this.worker.terminate();
  }

  private request<T>(payload: WorkerRequest): Promise<T> {
    if (this.closed) {
      return Promise.reject(new Error('SQLite 连接已关闭'));
    }

    const id = this.nextId;
    this.nextId += 1;

    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
      });
      this.worker.postMessage({ id, ...payload });
    });
  }

  private failAll(error: Error): void {
    for (const task of this.pending.values()) {
      task.reject(error);
    }
    this.pending.clear();
  }
}
