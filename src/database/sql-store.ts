import { AsyncLocalStorage } from 'node:async_hooks';
import { DatabaseSync, SQLInputValue } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { Pool, PoolClient } from 'pg';

export type Row = Record<string, any>;

/** One asynchronous SQL boundary; SQLite is supported only for local development/tests. */
export class SqlStore {
  readonly dialect: 'postgresql' | 'sqlite';
  protected readonly filename: string;
  private sqlite?: DatabaseSync;
  private pool?: Pool;
  private closed = false;
  private context = new AsyncLocalStorage<PoolClient | 'sqlite'>();
  private queue: Promise<unknown> = Promise.resolve();

  constructor(sqliteSchema: string) {
    this.filename = process.env.DATABASE_PATH || join(process.cwd(), 'data', 'veriqon.sqlite');
    this.dialect = process.env.DATABASE_URL ? 'postgresql' : 'sqlite';
    if (this.dialect === 'postgresql') {
      this.pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5, connectionTimeoutMillis: 10000,
        idleTimeoutMillis: 30000, statement_timeout: 15000, idle_in_transaction_session_timeout: 20000,
        application_name: 'veriqon-api' });
      this.pool.on('error', () => console.error('PostgreSQL connection failed; the pool will reconnect.'));
    } else {
      if (process.env.NODE_ENV === 'production') throw new Error('DATABASE_URL is required in production. SQLite is local development only.');
      if (this.filename !== ':memory:') mkdirSync(dirname(this.filename), { recursive: true });
      this.sqlite = new DatabaseSync(this.filename);
      this.sqlite.exec(sqliteSchema);
    }
  }

  // Exposed for local fixtures only. Application code uses get/all/run/transaction.
  get db(): DatabaseSync {
    if (!this.sqlite) throw new Error('Direct SQLite access is unavailable with PostgreSQL.');
    return this.sqlite;
  }

  async initialize(migrate = process.env.DB_MIGRATE_ON_START !== 'false') {
    if (!this.pool) return;
    if (migrate) {
      const sql = readFileSync(join(process.cwd(), 'migrations', '001_postgresql.sql'), 'utf8').replace(/\r\n/g, '\n');
      const checksum = createHash('sha256').update(sql).digest('hex');
      await this.transaction(async () => {
        await this.get('SELECT pg_advisory_xact_lock(742901)');
        await this.run('CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, checksum TEXT NOT NULL, applied_at BIGINT NOT NULL)');
        const existing = await this.get('SELECT checksum FROM schema_migrations WHERE version=1');
        if (existing && existing.checksum !== checksum) throw new Error('Migration checksum mismatch. Add a new migration instead of modifying an applied migration.');
        if (!existing) {
          await (this.context.getStore() as PoolClient).query(sql);
          await this.run('INSERT INTO schema_migrations VALUES(1,?,?)', checksum, Date.now());
        }
      });
    }
    const version = await this.get('SELECT MAX(version) AS version FROM schema_migrations');
    if (Number(version?.version) !== 1) throw new Error('Database migrations are not current. Run npm run db:migrate.');
  }

  private serialized<T>(task: () => Promise<T>): Promise<T> {
    const running = this.queue.then(task, task);
    this.queue = running.catch(() => undefined);
    return running;
  }

  private async query(sql: string, values: unknown[] = []) {
    if (this.pool) {
      // All SQL is application-owned; placeholders are never interpolated values.
      let index = 0;
      const statement = sql.replace(/\?/g, () => `$${++index}`);
      const client = this.context.getStore();
      return (client && client !== 'sqlite' ? client : this.pool).query(statement, values);
    }
    const execute = async () => {
      const prepared = this.db.prepare(sql);
      const args = values as SQLInputValue[];
      if (prepared.columns().length) return { rows: prepared.all(...args) as Row[], rowCount: 0 };
      return { rows: [] as Row[], rowCount: Number(prepared.run(...args).changes) };
    };
    return this.context.getStore() === 'sqlite' ? execute() : this.serialized(execute);
  }
  async all(sql: string, ...values: unknown[]): Promise<Row[]> { return (await this.query(sql, values)).rows; }
  async get(sql: string, ...values: unknown[]): Promise<Row | undefined> { return (await this.all(sql, ...values))[0]; }
  async run(sql: string, ...values: unknown[]) { return { changes: (await this.query(sql, values)).rowCount || 0 }; }

  async transaction<T>(action: () => Promise<T>): Promise<T> {
    if (this.context.getStore()) return action();
    if (this.pool) {
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');
        const result = await this.context.run(client, action);
        await client.query('COMMIT');
        return result;
      } catch (error) { await client.query('ROLLBACK'); throw error; }
      finally { client.release(); }
    }
    return this.serialized(async () => {
      this.db.exec('BEGIN IMMEDIATE');
      try {
        const result = await this.context.run('sqlite', action);
        this.db.exec('COMMIT'); return result;
      } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    });
  }
  async ping() { await this.get('SELECT 1 AS ready'); }
  async onModuleDestroy() {
    if (this.closed) return;
    this.closed = true;
    await this.queue;
    if (this.pool) await this.pool.end();
    this.sqlite?.close();
  }
}
