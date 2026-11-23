import { BadRequestException, ConflictException, HttpException, Injectable, Logger, NotFoundException, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { DatabaseService, OriginalFile } from '../database/database.service';
import { Row } from '../database/sql-store';
import { chunkText } from '../common/utils';
import { MAX_DOCUMENT_CHARACTERS, MAX_DOCUMENT_CHUNKS, boundedInteger } from '../common/ingestion-config';
import { IndexingDeferred } from '../common/embedding-pacer';
import { providerError } from '../common/provider';
import { VectorStoreService } from '../vector-store/vector-store.service';
import { sqlPollingEnabled } from '../common/background-config';

const LEASE_MS = 240_000;
const RETENTION_MS = 7 * 86400_000;
const publicColumns = 'id,document_id,source,status,total_chunks,completed_chunks,attempts,last_error,next_at,created_at,updated_at';
export type IngestionJob = {
  id: string; documentId: string; source: string;
  status: 'queued' | 'processing' | 'retry_wait' | 'failed' | 'completed';
  totalChunks: number; completedChunks: number; attempts: number; error?: string; nextAt: number;
};
function view(row: Row): IngestionJob {
  return { id: row.id, documentId: row.document_id, source: row.source, status: row.status,
    totalChunks: Number(row.total_chunks), completedChunks: Number(row.completed_chunks), attempts: Number(row.attempts),
    error: row.last_error || undefined, nextAt: Number(row.next_at) };
}

/** Durable, bounded DB queue. Only fully committed documents are visible to retrieval. */
@Injectable()
export class IngestionService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(IngestionService.name);
  private timer?: NodeJS.Timeout;
  private running?: Promise<void>;
  private stopped = false;
  private readonly shutdown = new AbortController();
  private readonly activeControllers = new Map<string, AbortController>();
  constructor(private readonly database: DatabaseService, private readonly store: VectorStoreService) {
    database.registerShutdown(() => this.onModuleDestroy());
  }

  private fingerprint() {
    const { identity, chunkSize, overlap } = this.store.embeddingConfig;
    return createHash('sha256').update(JSON.stringify({ identity, chunkSize, overlap, chunker: 1 })).digest('hex');
  }
  private async queueLock() {
    if (this.database.dialect === 'postgresql') await this.database.get('SELECT pg_advisory_xact_lock(742902)');
  }
  private async cleanup(now: number) {
    await this.database.run("DELETE FROM ingestion_jobs WHERE status IN ('completed','failed') AND updated_at<?", now - RETENTION_MS);
  }
  async enqueue(owner: string, documentId: string, text: string, file: OriginalFile): Promise<IngestionJob> {
    if (!text.trim() || text.length > MAX_DOCUMENT_CHARACTERS) throw new BadRequestException('Uploads support up to 500,000 extracted characters.');
    return this.database.transaction(async () => {
      await this.queueLock();
      const now = Date.now();
      await this.cleanup(now);
      const existing = await this.database.get(`SELECT ${publicColumns},fingerprint FROM ingestion_jobs WHERE owner_id=? AND document_id=?`, owner, documentId);
      if (existing && (existing.status !== 'completed' || existing.fingerprint === this.fingerprint())) return view(existing);
      if (existing) await this.database.run('DELETE FROM ingestion_jobs WHERE owner_id=? AND id=?', owner, existing.id);
      // Staged data has a separate bound; document quota is also rechecked at publication.
      const counts = await this.database.get(`SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN owner_id=? THEN 1 ELSE 0 END),0) AS owned
        FROM ingestion_jobs WHERE status<>'completed'`, owner);
      if (Number(counts!.owned) >= 3 || Number(counts!.total) >= 100) throw new HttpException('The upload queue is full. Finish or discard pending uploads before adding more.', 429);
      await this.database.preflightDocument(owner, documentId, text, file);
      const total = chunkText(text, this.store.embeddingConfig.chunkSize, this.store.embeddingConfig.overlap).length;
      if (total > MAX_DOCUMENT_CHUNKS) throw new BadRequestException('This document exceeds 1,000 indexing passages. Split it into smaller documents.');
      const id = randomUUID();
      await this.database.run(`INSERT INTO ingestion_jobs(id,owner_id,document_id,source,text,original_file,original_mime,fingerprint,status,total_chunks,next_at,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,'queued',?,?,?,?)`, id, owner, documentId, file.name, text, file.bytes, file.mime, this.fingerprint(), total, now, now, now);
      return view((await this.database.get(`SELECT ${publicColumns} FROM ingestion_jobs WHERE id=?`, id))!);
    });
  }
  async list(owner: string) {
    return (await this.database.all(`SELECT ${publicColumns} FROM ingestion_jobs WHERE owner_id=? ORDER BY created_at DESC LIMIT 100`, owner)).map(view);
  }
  async retry(owner: string, id: string) {
    return this.database.transaction(async () => {
      const row = await this.database.get(`SELECT ${publicColumns},fingerprint FROM ingestion_jobs WHERE owner_id=? AND id=?${this.database.dialect === 'postgresql' ? ' FOR UPDATE' : ''}`, owner, id);
      if (!row) throw new NotFoundException('Upload not found.');
      if (row.status !== 'failed') throw new ConflictException('Only a failed upload can be retried.');
      if (Number(row.attempts) >= 6) throw new BadRequestException('This upload has reached its retry budget. Check the provider configuration before discarding and uploading again.');
      if (row.fingerprint !== this.fingerprint()) throw new ConflictException('Embedding settings changed. Discard this upload and upload it again with the new settings.');
      await this.database.run("UPDATE ingestion_jobs SET status='queued',last_error=NULL,next_at=?,updated_at=? WHERE owner_id=? AND id=?", Date.now(), Date.now(), owner, id);
      return view({ ...row, status: 'queued', last_error: null, next_at: Date.now() });
    });
  }
  async discard(owner: string, id: string) {
    const result = await this.database.run('DELETE FROM ingestion_jobs WHERE owner_id=? AND id=?', owner, id);
    if (!result.changes) throw new NotFoundException('Upload not found.');
    this.activeControllers.get(id)?.abort();
    // Deleting the lease fences an already running worker from publishing.
    return { success: true };
  }
  onApplicationBootstrap() {
    if (!sqlPollingEnabled()) return;
    this.timer = setInterval(() => { void this.tick(); }, 2000);
    this.timer.unref();
  }
  async onModuleDestroy() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.shutdown.abort();
    await this.running;
  }
  async tick() {
    if (this.stopped) return;
    if (this.running) return this.running;
    this.running = this.processOne().catch(() => { this.logger.warn('Upload worker paused after a storage error; the lease will be recovered.'); });
    try { await this.running; } finally { this.running = undefined; }
  }
  private async claim(id?: string): Promise<Row | undefined> {
    return this.database.transaction(async () => {
      await this.queueLock();
      const now = Date.now();
      await this.cleanup(now);
      // A crashed final attempt must become visible as failed, not remain processing forever.
      await this.database.run(`UPDATE ingestion_jobs SET status='failed',lease_token=NULL,lease_until=0,last_error=?,updated_at=?
        WHERE status='processing' AND lease_until<? AND attempts>=6`, 'Indexing was interrupted. Discard this upload and upload it again.', now, now);
      const active = await this.database.all("SELECT owner_id FROM ingestion_jobs WHERE status='processing' AND lease_until>?", now);
      if (active.length >= 2) return;
      const row = await this.database.get(`SELECT * FROM ingestion_jobs j WHERE
        ${id ? 'j.id=? AND' : ''} ((status IN ('queued','retry_wait') AND next_at<=?) OR (status='processing' AND lease_until<=?)) AND attempts<6
        AND NOT EXISTS (SELECT 1 FROM ingestion_jobs a WHERE a.owner_id=j.owner_id AND a.status='processing' AND a.lease_until>?)
        ORDER BY next_at,created_at LIMIT 1${this.database.dialect === 'postgresql' ? ' FOR UPDATE OF j SKIP LOCKED' : ''}`, ...(id ? [id] : []), now, now, now);
      if (!row) return;
      const token = randomUUID();
      await this.database.run("UPDATE ingestion_jobs SET status='processing',attempts=attempts+1,lease_token=?,lease_until=?,updated_at=? WHERE id=?", token, now + LEASE_MS, now, row.id);
      return { ...row, attempts: Number(row.attempts) + 1, lease_token: token };
    });
  }
  private async fenced(row: Row) {
    const lock = this.database.dialect === 'postgresql' ? ' FOR UPDATE' : '';
    const current = await this.database.get(`SELECT id FROM ingestion_jobs WHERE id=? AND owner_id=? AND status='processing' AND lease_token=? AND lease_until>?${lock}`, row.id, row.owner_id, row.lease_token, Date.now());
    if (!current) throw new ConflictException('This upload was cancelled or reassigned.');
  }
  /** Queue deliveries select exactly one SQL job; SQL leases remain authoritative. */
  async processJob(id: string) {
    if (this.stopped) return;
    if (this.running) throw new Error('Ingestion processor is already occupied.');
    this.running = this.processOne(id);
    try { await this.running; } finally { this.running = undefined; }
  }
  private async processOne(id?: string) {
    const row = await this.claim(id);
    if (!row) return;
    const cancellation = new AbortController();
    this.activeControllers.set(row.id, cancellation);
    try {
      if (row.fingerprint !== this.fingerprint()) throw new ConflictException('Embedding settings changed. Discard this upload and upload it again.');
      const saved = await this.database.all('SELECT chunk_index,embedding FROM ingestion_vectors WHERE job_id=? ORDER BY chunk_index', row.id);
      if (saved.some((v, i) => Number(v.chunk_index) !== i) || saved.length !== Number(row.completed_chunks)) throw new BadRequestException('Invalid indexing checkpoint. Discard this upload and upload it again.');
      const signal = AbortSignal.any([this.shutdown.signal, cancellation.signal, AbortSignal.timeout(300_000)]);
      const turnStarted = Date.now();
      const batchBudget = boundedInteger('EMBEDDING_JOB_BATCHES_PER_TURN', 25, 1, 1000);
      await this.store.addDocument(row.document_id, row.text, { source: row.source }, row.owner_id,
        { bytes: Buffer.from(row.original_file), name: row.source, mime: row.original_mime }, signal, {
          vectors: saved.map(v => JSON.parse(v.embedding)),
          beforeBatch: offset => {
            if (offset - saved.length >= batchBudget * this.store.embeddingConfig.batchSize || Date.now() - turnStarted > 120_000) {
              throw new IndexingDeferred(Date.now() + 2000);
            }
          },
          save: (offset, vectors) => this.database.transaction(async () => {
            signal.throwIfAborted();
            await this.fenced(row);
            for (let i = 0; i < vectors.length; i++) await this.database.run('INSERT INTO ingestion_vectors VALUES(?,?,?)', row.id, offset + i, JSON.stringify(vectors[i]));
            // Persist the reset with the vectors, so a crash before the catch/yield
            // handler cannot make productive work look like six failed attempts.
            await this.database.run('UPDATE ingestion_jobs SET completed_chunks=?,attempts=1,lease_until=?,updated_at=? WHERE id=?', offset + vectors.length, Date.now() + LEASE_MS, Date.now(), row.id);
          }),
          commit: publish => this.database.transaction(async () => {
            signal.throwIfAborted();
            await this.fenced(row);
            await publish();
            await this.database.run(`UPDATE ingestion_jobs SET status='completed',completed_chunks=total_chunks,text=NULL,original_file=NULL,
              lease_token=NULL,lease_until=0,last_error=NULL,updated_at=? WHERE id=?`, Date.now(), row.id);
            await this.database.run('DELETE FROM ingestion_vectors WHERE job_id=?', row.id);
          })
        });
    } catch (error) {
      if (error instanceof IndexingDeferred || this.shutdown.signal.aborted) {
        const cooldown = error instanceof IndexingDeferred && error.cooldown;
        // A normal process shutdown/yield is not a provider failure. Progress during
        // this turn breaks the prior failure streak, even when no error was raised.
        await this.database.run(`UPDATE ingestion_jobs SET status=?,
          attempts=CASE WHEN completed_chunks>? THEN 0 ELSE attempts-1 END,
          last_error=?,next_at=?,lease_token=NULL,lease_until=0,updated_at=?
          WHERE id=? AND lease_token=?`, cooldown ? 'retry_wait' : 'queued', row.completed_chunks,
          cooldown ? error.message : null, error instanceof IndexingDeferred ? error.resumeAt : Date.now(), Date.now(), row.id, row.lease_token);
        return;
      }
      const failure = providerError(error, 'Document indexing failed');
      const details = failure as HttpException & { retryable?: boolean; retryAfterSeconds?: number };
      const progress = await this.database.get('SELECT completed_chunks FROM ingestion_jobs WHERE id=? AND lease_token=?', row.id, row.lease_token);
      const advanced = Number(progress?.completed_chunks || 0) > Number(row.completed_chunks);
      // Successful checkpointed work is progress, not repeated failure. Only consecutive unproductive attempts exhaust retries.
      const attempts = advanced ? 0 : Number(row.attempts);
      const retry = details.retryable !== false && [429,502,503,504].includes(failure.getStatus()) && attempts < 3;
      const wait = Math.max(30_000 * 2 ** Math.max(0, attempts - 1), (details.retryAfterSeconds || 0) * 1000);
      await this.database.run(`UPDATE ingestion_jobs SET status=?,attempts=?,last_error=?,next_at=?,lease_token=NULL,lease_until=0,updated_at=?
        WHERE id=? AND lease_token=?`, retry ? 'retry_wait' : 'failed', retry ? attempts : row.attempts, failure.message, Date.now() + wait, Date.now(), row.id, row.lease_token);
    } finally {
      this.activeControllers.delete(row.id);
    }
  }
}
