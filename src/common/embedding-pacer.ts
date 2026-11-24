import { HttpException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { DatabaseService } from '../database/database.service';
import { providerRetryAfter } from './provider';

/** A scheduling pause is not a failed provider attempt. Kept as an HttpException through error sanitization. */
export class IndexingDeferred extends HttpException {
  readonly deferred = true;
  readonly retryable = true;
  readonly retryAfterSeconds: number;
  constructor(readonly resumeAt: number, readonly cooldown = false) {
    const seconds = Math.max(1, Math.ceil((resumeAt - Date.now()) / 1000));
    super(cooldown ? `Embedding requests are paused after a provider rate limit. Progress is saved; retrying in ${seconds} seconds.` : 'Indexing progress saved. Continuing in the next worker turn.', cooldown ? 429 : 503);
    this.retryAfterSeconds = seconds;
  }
}

/** Shared across API processes using the same DB. No API key or document content is persisted. */
export class EmbeddingPacer {
  private readonly key: string;
  constructor(private readonly database: DatabaseService, private readonly intervalMs: number, model: string) {
    this.key = 'embedding-pacing:' + createHash('sha256').update(JSON.stringify([
      process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1', process.env.OPENROUTER_API_KEY || '', model
    ])).digest('hex');
  }
  private async locked<T>(work: () => Promise<T>) {
    return this.database.transaction(async () => {
      if (this.database.dialect === 'postgresql') await this.database.get('SELECT pg_advisory_xact_lock(742903)');
      return work();
    });
  }
  private async read() {
    const row = await this.database.get('SELECT value FROM settings WHERE key=?', this.key);
    const value = row ? JSON.parse(String(row.value)) : {};
    return { nextAt: Number(value.nextAt) || 0, cooldownUntil: Number(value.cooldownUntil) || 0 };
  }
  private async write(value: { nextAt: number; cooldownUntil: number }) {
    await this.database.run('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', this.key, JSON.stringify(value));
  }
  async acquire(signal: AbortSignal) {
    for (;;) {
      signal.throwIfAborted();
      const wait = await this.locked(async () => {
        const state = await this.read(), now = Date.now();
        if (state.cooldownUntil > now) throw new IndexingDeferred(state.cooldownUntil, true);
        if (state.nextAt > now) return state.nextAt - now;
        await this.write({ nextAt: now + this.intervalMs, cooldownUntil: 0 });
        return 0;
      });
      if (!wait) return;
      await delay(wait, undefined, { signal }); // Never hold a DB lock while waiting on time or a provider.
    }
  }
  async recordLimit(error: unknown) {
    const status = error instanceof HttpException ? error.getStatus() : (error as { status?: number })?.status;
    if (status !== 429 || error instanceof IndexingDeferred) return;
    const supplied = (error as { retryAfterSeconds?: number })?.retryAfterSeconds ?? providerRetryAfter(error);
    const seconds = supplied !== undefined && Number.isFinite(supplied) ? Math.max(1, supplied) : 60;
    await this.locked(async () => {
      const state = await this.read();
      state.cooldownUntil = Math.max(state.cooldownUntil, Date.now() + seconds * 1000);
      await this.write(state);
    });
  }
}
