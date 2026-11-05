import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import type { QueryResult, SchemaObject } from '../../../shared/ipc-contract';
import type { DatabaseSession } from '../DatabaseSession';

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

type WorkerRequest =
  | { type: 'open'; filePath: string }
  | { type: 'query'; sql: string }
  | { type: 'close' };

type WorkerResponse =
  | { id: number; ok: true; value: unknown }
  | { id: number; ok: false; error: { message: string; code: string | null } };

export class SqliteSession implements DatabaseSession {
  readonly label = 'SQLite';
  serverVersion = 'unknown';

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

  static async create(filePath: string): Promise<SqliteSession> {
    const workerPath = join(__dirname, 'sqlite-worker.js').replace(
      'app.asar',
      'app.asar.unpacked',
    );
    const worker = new Worker(workerPath, { name: 'sqlite-conn' });
    const session = new SqliteSession(worker);
    const info = await session.request<{ version: string }>({ type: 'open', filePath });
    session.serverVersion = info.version;
    return session;
  }

  query(sql: string): Promise<QueryResult> {
    return this.request<QueryResult>({ type: 'query', sql });
  }

  async schema(): Promise<SchemaObject[]> {
    const result = await this.query(
      `SELECT name, type
       FROM sqlite_master
       WHERE type IN ('table', 'view')
         AND name NOT LIKE 'sqlite_%'
       ORDER BY type, name`,
    );

    return result.rows.map((row) => ({
      name: String(row[0] ?? ''),
      type: row[1] === 'view' ? 'view' : 'table',
    }));
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
