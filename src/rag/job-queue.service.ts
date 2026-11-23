import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { Queue, Worker, type RedisOptions } from 'bullmq';
import { backgroundConfig } from '../common/background-config';
import { DatabaseService } from '../database/database.service';
import { IngestionService } from './ingestion.service';
import { RevalidationService } from './revalidation.service';
import { WorkerHeartbeat } from '../common/worker-heartbeat';

type Kind = 'ingestion' | 'revalidation';
const kinds: Kind[] = ['ingestion', 'revalidation'];

export function queueConnection(url: string, consumer: boolean): RedisOptions {
  const parsed = new URL(url);
  if (!['redis:', 'rediss:'].includes(parsed.protocol)) throw new Error('Queue requires a Redis TCP/TLS URL.');
  const db = Number(parsed.pathname.slice(1) || 0);
  if (!Number.isInteger(db) || db < 0 || db > 15) throw new Error('Invalid queue Redis database.');
  return { host: parsed.hostname, port: Number(parsed.port || 6379), db,
    username: decodeURIComponent(parsed.username) || undefined, password: decodeURIComponent(parsed.password) || undefined,
    ...(parsed.protocol === 'rediss:' ? { tls: {} } : {}),
    connectTimeout: 5000, maxRetriesPerRequest: consumer ? null : 1,
    enableOfflineQueue: consumer, ...(consumer ? {} : { commandTimeout: 5000 }),
    retryStrategy: (attempt: number) => Math.min(250 * 2 ** Math.min(attempt, 5), 5000) };
}

/** Redis transports IDs; SQL outbox/checkpoints and lease fences decide execution. */
@Injectable()
export class JobQueueService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(JobQueueService.name);
  private readonly config = backgroundConfig();
  private readonly queues = new Map<Kind, Queue>();
  private readonly workers: Worker[] = [];
  private timer?: NodeJS.Timeout;
  private running?: Promise<void>;
  private closing?: Promise<void>;
  private stopped = false;
  private readonly heartbeat = new WorkerHeartbeat();

  constructor(private readonly database: DatabaseService, private readonly ingestion: IngestionService,
    private readonly revalidation: RevalidationService) {
    database.registerShutdown(() => this.onModuleDestroy());
  }

  async onApplicationBootstrap() {
    if (this.config.role !== 'worker') return;
    this.heartbeat.clear();
    try {
      for (const kind of kinds) {
        if (kind === 'revalidation' && process.env.REVALIDATION_ENABLED === 'false') continue;
        const queue = new Queue(kind, { prefix: this.config.prefix,
          connection: queueConnection(process.env.QUEUE_REDIS_URL!, false),
          streams: { events: { maxLen: 1000 } },
          defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 2000 },
            removeOnComplete: true, removeOnFail: true } });
        this.queues.set(kind, queue);
        queue.on('error', () => this.logger.warn(JSON.stringify({ event: 'queue_unavailable', kind })));
        await this.deadline(queue.waitUntilReady());
        const memory = await (await queue.getBackend().client).info();
        if (!/maxmemory_policy:noeviction\b/.test(memory)) throw new Error('Queue Redis must use noeviction.');
        await queue.setGlobalConcurrency(2);
        const worker = new Worker(kind, async job => {
          if (job.name !== kind || !job.data || Object.keys(job.data).length !== 1 ||
            typeof job.data.id !== 'string' || !/^[a-zA-Z0-9-]{1,128}$/.test(job.data.id) || job.id !== `sql-${job.data.id}`) {
            throw new Error('Invalid queue delivery.');
          }
          const start = Date.now();
          this.logger.log(JSON.stringify({ event: 'job_started', kind, jobId: job.data.id }));
          // Expected provider failures remain SQL retry_wait/failed, not fictitious successful answers.
          if (kind === 'ingestion') await this.ingestion.processJob(job.data.id);
          else await this.revalidation.processJob(job.data.id);
          this.logger.log(JSON.stringify({ event: 'delivery_processed', kind, jobId: job.data.id, durationMs: Date.now() - start }));
        }, { prefix: this.config.prefix, connection: queueConnection(process.env.QUEUE_REDIS_URL!, true),
          concurrency: 1, lockDuration: 60000, stalledInterval: 30000, maxStalledCount: 2 });
        worker.on('error', () => this.logger.warn(JSON.stringify({ event: 'worker_transport_unavailable', kind })));
        worker.on('failed', () => this.logger.warn(JSON.stringify({ event: 'delivery_failed', kind, recovery: 'sql_reconciliation' })));
        this.workers.push(worker);
        await this.deadline(worker.waitUntilReady());
      }
      await this.reconcile();
      this.timer = setInterval(() => { void this.reconcile().catch(() => {
        this.logger.warn(JSON.stringify({ event: 'dispatch_deferred', recovery: 'sql_reconciliation' }));
      }); }, 5000);
    } catch {
      await this.onModuleDestroy();
      throw new Error('Background queue startup failed. Check PostgreSQL, queue Redis access and noeviction policy.');
    }
  }

  private async deadline<T>(promise: Promise<T>) {
    let timer: NodeJS.Timeout | undefined;
    try { return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Queue connection deadline exceeded.')), 10000);
    })]); } finally { clearTimeout(timer); }
  }

  async reconcile() {
    if (this.stopped || this.config.role !== 'worker') return;
    if (this.running) return this.running;
    this.running = this.dispatch();
    try { await this.running; if (!this.stopped) this.heartbeat.record(); } finally { this.running = undefined; }
  }

  private async dispatch() {
    if (process.env.REVALIDATION_ENABLED !== 'false') await this.revalidation.planChanges();
    for (const [kind, queue] of this.queues) {
      const now = Date.now();
      const counts = await queue.getJobCounts('wait', 'active', 'delayed', 'prioritized');
      const slots = Math.max(0, 100 - Object.values(counts).reduce((sum, count) => sum + count, 0));
      if (!slots) continue;
      // Two IDs per owner per pass; no source text, vectors, tokens or answers in Redis.
      // SQL retains work even if the process dies between this read and queue.addBulk.
      const rows = await this.database.all(`WITH due AS (
        SELECT id,next_at,created_at,ROW_NUMBER() OVER (PARTITION BY owner_id ORDER BY next_at,created_at,id) AS rank
        FROM ${kind}_jobs WHERE (status IN ('queued','retry_wait') AND next_at<=?) OR (status='processing' AND lease_until<=?)
      ) SELECT id FROM due WHERE rank<=2 ORDER BY next_at,created_at,id LIMIT ?`, now, now, slots);
      if (rows.length) await queue.addBulk(rows.map(row => ({ name: kind, data: { id: String(row.id) }, opts: { jobId: `sql-${row.id}` } })));
    }
  }

  onModuleDestroy(): Promise<void> {
    if (this.closing) return this.closing;
    this.stopped = true; clearInterval(this.timer);
    if (this.config.role === 'worker') this.heartbeat.clear();
    this.closing = (async () => {
      // Abort processors first so shutdown never waits for a full provider timeout.
      await Promise.all([this.ingestion.onModuleDestroy(), this.revalidation.onModuleDestroy()]);
      await this.running?.catch(() => undefined);
      await Promise.all(this.workers.map(worker => worker.close(true)));
      await Promise.all([...this.queues.values()].map(queue => queue.close()));
    })();
    return this.closing;
  }
}
