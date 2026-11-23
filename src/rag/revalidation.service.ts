import { Injectable, OnApplicationBootstrap, OnModuleDestroy, Optional, NotFoundException, BadRequestException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DatabaseService } from '../database/database.service';
import { RedisService } from '../common/redis.service';
import { RagService, type PipelineResult } from './rag.service';
import { boundedInteger } from '../common/ingestion-config';
import { sqlPollingEnabled } from '../common/background-config';
import { providerRetryAfter } from '../common/provider';

/** Compare persisted factual output, excluding latency, model usage and transient repair labels. */
function assessmentIdentity(result: Pick<PipelineResult, 'draft' | 'factCheck' | 'citations' | 'temporalScope' | 'verificationStatus'> & { reason?: PipelineResult['reason'] }) {
  return JSON.stringify({ draft: result.draft, verified: result.factCheck?.passed, reason: result.reason,
    status: result.factCheck?.passed ? 'verified' : result.verificationStatus,
    citations: result.citations, scope: result.temporalScope?.kind === 'current' ? 'current' : result.temporalScope,
    claims: result.factCheck?.atomicClaims?.map(c => ({ text: c.text, verdict: c.verdict, supporting: c.supporting, contradicting: c.contradicting, temporalValidity: c.temporalValidity, scope: c.scope, missingInformation: c.missingInformation })),
    conflicts: result.factCheck?.sourceConflicts, decisions: result.factCheck?.appliedDecisions });
}

/** Durable revalidation, conservatively covering every saved answer after a library change. */
@Injectable()
export class RevalidationService implements OnApplicationBootstrap, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private running?: Promise<void>;
  private stopped = false;
  private readonly shutdown = new AbortController();
  constructor(private readonly database: DatabaseService, private readonly rag: RagService, @Optional() private readonly redis?: RedisService) {
    database.registerShutdown(() => this.onModuleDestroy());
  }
  onApplicationBootstrap() {
    if (!sqlPollingEnabled() || process.env.NODE_ENV === 'test' || process.env.REVALIDATION_ENABLED === 'false') return;
    this.timer = setInterval(() => { void this.tick(); }, 5000); this.timer.unref();
  }
  async onModuleDestroy() { this.stopped = true; clearInterval(this.timer); this.shutdown.abort(); await this.running; }
  private async lock() { if (this.database.dialect === 'postgresql') await this.database.get('SELECT pg_advisory_xact_lock(742903)'); }
  async planChanges() {
    await this.database.transaction(async () => {
      await this.lock();
      const change = await this.database.get("SELECT * FROM library_changes WHERE status='queued' ORDER BY created_at,revision LIMIT 1");
      if (!change) return;
      if (Number(change.revision) !== await this.database.revision(change.owner_id)) {
        await this.database.run("UPDATE library_changes SET status='superseded' WHERE owner_id=? AND revision=?", change.owner_id, change.revision); return;
      }
      // Paging over all saved answers catches NEW competing evidence, not just changed citation IDs.
      const messages = await this.database.all('SELECT id,result FROM messages WHERE owner_id=? AND id>? AND result IS NOT NULL ORDER BY id LIMIT 100', change.owner_id, change.cursor);
      for (const message of messages) {
        const result = JSON.parse(String(message.result));
        if (!result || result.answerOrigin) continue;
        await this.enqueue(change.owner_id, message.id, Number(change.revision));
      }
      await this.database.run('UPDATE library_changes SET cursor=?,status=? WHERE owner_id=? AND revision=?', messages.at(-1)?.id || change.cursor, messages.length < 100 ? 'completed' : 'queued', change.owner_id, change.revision);
    });
  }
  private async enqueue(owner: string, message: string, revision: number) {
    const now = Date.now();
    await this.database.run(`INSERT INTO revalidation_jobs(id,owner_id,message_id,target_revision,next_at,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?) ON CONFLICT(owner_id,message_id,target_revision) DO NOTHING`, randomUUID(), owner, message, revision, now, now, now);
  }
  async request(owner: string, id: string) {
    if (process.env.REVALIDATION_ENABLED === 'false') throw new BadRequestException('Revalidation is disabled.');
    return this.database.transaction(async () => {
      await this.lock();
      const message = await this.database.get('SELECT result FROM messages WHERE owner_id=? AND id=?', owner, id);
      if (!message) throw new NotFoundException('Saved answer not found.');
      if (!message.result || JSON.parse(String(message.result)).answerOrigin) throw new BadRequestException('Only completed document answers can be revalidated.');
      const revision = await this.database.revision(owner);
      await this.enqueue(owner, id, revision);
      const job = (await this.database.get('SELECT id,status,attempts,last_error,next_at FROM revalidation_jobs WHERE owner_id=? AND message_id=? AND target_revision=?', owner, id, revision))!;
      if (job.status === 'failed') {
        await this.database.auditKnowledge(owner, id, 'REVALIDATION_RETRY', 'Account owner requested another bounded attempt budget.', { jobId: job.id, previous: job });
        await this.database.run("UPDATE revalidation_jobs SET status='queued',attempts=0,last_error=NULL,lease_token=NULL,lease_until=0,updated_at=? WHERE id=?", Date.now(), job.id);
        job.status = 'queued';
      }
      return { queued: ['queued','retry_wait','processing'].includes(job.status), jobId: String(job.id), status: String(job.status), nextAt: Number(job.next_at) };
    });
  }
  async list(owner: string) {
    const jobs = await this.database.all(`SELECT j.id,j.message_id,j.target_revision,j.status,j.attempts,j.last_error,j.next_at,j.updated_at,m.question
      FROM revalidation_jobs j JOIN messages m ON m.owner_id=j.owner_id AND m.id=j.message_id WHERE j.owner_id=? ORDER BY j.updated_at DESC,j.id LIMIT 100`, owner);
    return { enabled: process.env.REVALIDATION_ENABLED !== 'false', hourlyBudget: boundedInteger('REVALIDATION_PER_HOUR', 10, 1, 100), jobs: jobs.map(j => ({ id: j.id, messageId: j.message_id, targetRevision: Number(j.target_revision), status: j.status, attempts: Number(j.attempts), error: j.last_error, nextAt: Number(j.next_at), updatedAt: Number(j.updated_at), question: j.question })) };
  }
  async tick() {
    if (this.running || this.stopped) return;
    this.running = this.processOne().catch(() => { console.error('Revalidation worker could not access its queue; it will retry.'); }).finally(() => { this.running = undefined; });
    await this.running;
  }
  async processJob(id: string) {
    if (this.stopped || process.env.REVALIDATION_ENABLED === 'false') return;
    if (this.running) throw new Error('Revalidation processor is already occupied.');
    this.running = this.processOne(id);
    try { await this.running; } finally { this.running = undefined; }
  }
  private async processOne(id?: string) {
    if (!id) await this.planChanges();
    const job = await this.database.transaction(async () => {
      await this.lock(); const now = Date.now();
      await this.database.run("UPDATE revalidation_jobs SET status='superseded',last_error='A newer library revision is queued.' WHERE status IN ('queued','retry_wait') AND target_revision<>(SELECT document_revision FROM users WHERE users.id=revalidation_jobs.owner_id)");
      await this.database.run("UPDATE revalidation_jobs SET status='failed',last_error='Retry budget exhausted after interrupted attempts',lease_token=NULL WHERE status='processing' AND lease_until<=? AND attempts>=3", now);
      const active = await this.database.get("SELECT COUNT(*) AS n FROM revalidation_jobs WHERE status='processing' AND lease_until>?", now);
      if (Number(active?.n) >= 2) return;
      const candidate = await this.database.get(`SELECT * FROM revalidation_jobs j WHERE ${id ? 'j.id=? AND' : ''} attempts<3 AND
        ((status IN ('queued','retry_wait') AND next_at<=?) OR (status='processing' AND lease_until<=?))
        AND NOT EXISTS (SELECT 1 FROM revalidation_jobs a WHERE a.owner_id=j.owner_id AND a.status='processing' AND a.lease_until>?)
        ORDER BY next_at,created_at LIMIT 1${this.database.dialect === 'postgresql' ? ' FOR UPDATE OF j SKIP LOCKED' : ''}`, ...(id ? [id] : []), now, now, now);
      if (!candidate) return;
      const budgetKey = 'revalidation:hourly', budget = boundedInteger('REVALIDATION_PER_HOUR', 10, 1, 100);
      await this.database.run('DELETE FROM auth_limits WHERE key=? AND reset_at<=?', budgetKey, now);
      const usage = await this.database.get('SELECT count,reset_at FROM auth_limits WHERE key=?', budgetKey);
      if (Number(usage?.count || 0) >= budget) {
        // Do not keep redispatching an unaffordable job on every reconciliation pass.
        await this.database.run('UPDATE revalidation_jobs SET next_at=? WHERE id=?', Number(usage!.reset_at), candidate.id);
        return;
      }
      await this.database.run('INSERT INTO auth_limits VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=auth_limits.count+1', budgetKey, now + 3600000);
      const token = randomUUID();
      await this.database.run("UPDATE revalidation_jobs SET status='processing',attempts=attempts+1,lease_token=?,lease_until=?,updated_at=? WHERE id=?", token, now + 240000, now, candidate.id);
      return { id: String(candidate.id), owner_id: String(candidate.owner_id), message_id: String(candidate.message_id), target_revision: Number(candidate.target_revision), token, attempts: Number(candidate.attempts) + 1 };
    });
    if (!job) return;
    const lostLease = new AbortController();
    const heartbeat = setInterval(() => {
      void this.database.run("UPDATE revalidation_jobs SET lease_until=? WHERE id=? AND lease_token=? AND status='processing' AND lease_until>?",
        Date.now() + 240000, job.id, job.token, Date.now()).then(result => { if (!result.changes) lostLease.abort(); }).catch(() => lostLease.abort());
    }, 30000);
    heartbeat.unref();
    const complete = async (status: string, error: string | null = null) => {
      await this.database.run('UPDATE revalidation_jobs SET status=?,last_error=?,lease_token=NULL,lease_until=0,updated_at=? WHERE id=? AND lease_token=?', status, error, Date.now(), job.id, job.token);
    };
    try {
      if (await this.database.revision(job.owner_id) !== Number(job.target_revision)) { await complete('superseded', 'A newer library change is queued.'); return; }
      const message = await this.database.get('SELECT question,result FROM messages WHERE owner_id=? AND id=?', job.owner_id, job.message_id);
      if (!message?.result) { await complete('skipped', 'No completed answer remains.'); return; }
      const original = JSON.parse(String(message.result)) as PipelineResult & { sourceRevision?: number };
      const latest = await this.database.get('SELECT result FROM answer_versions WHERE owner_id=? AND message_id=? ORDER BY sequence DESC LIMIT 1', job.owner_id, job.message_id);
      const baseline = latest ? JSON.parse(String(latest.result)) as PipelineResult : original;
      if (original.contextUsed && !original.requestContext) { await complete('skipped', 'Legacy follow-up has no saved reference context. Ask the question again.'); return; }
      const run = () => this.rag.queryPipeline(message.question, job.owner_id, undefined, {
        bypassCache: true, snapshot: original.requestContext, signal: AbortSignal.any([this.shutdown.signal, lostLease.signal, AbortSignal.timeout(180000)]),
        savedTemporalScope: original.temporalScope,
        originalDraft: baseline.factCheck?.passed && !baseline.answerOrigin ? baseline.draft.replace(/\s*\[\d+\]/g, '') : undefined
      });
      const result = this.redis?.enabled ? await this.redis.run(job.owner_id, run) : await run();
      if (this.stopped) throw new Error('shutdown');
      if (result.sourcesChanged || await this.database.revision(job.owner_id) !== job.target_revision) { await complete('superseded', 'Library changed during verification.'); return; }
      if (('reason' in result && (result.reason === 'generation_failed' || result.reason === 'verification_failed')) || result.verificationStatus === 'VERIFICATION_FAILED') throw Object.assign(new Error('The provider or verifier could not complete revalidation.'), 'providerFailure' in result ? result.providerFailure : undefined);
      await this.database.transaction(async () => {
        if (this.database.dialect === 'postgresql') await this.database.get('SELECT id FROM users WHERE id=? FOR UPDATE', job.owner_id);
        const lease = await this.database.get(`SELECT lease_token,lease_until FROM revalidation_jobs WHERE id=?${this.database.dialect === 'postgresql' ? ' FOR UPDATE' : ''}`, job.id);
        if (lease?.lease_token !== job.token || Number(lease.lease_until) <= Date.now()) return;
        if (await this.database.revision(job.owner_id) !== Number(job.target_revision) || result.sourcesChanged) { await complete('superseded', 'Library changed during verification.'); return; }
        await this.database.run('INSERT INTO answer_versions VALUES(?,?,0,?,?,?,?) ON CONFLICT(owner_id,message_id,sequence) DO NOTHING', job.owner_id, job.message_id, JSON.stringify(original), Number(original.sourceRevision || 0), 'Original answer', Date.now());
        if (assessmentIdentity(baseline) === assessmentIdentity(result)) {
          await this.database.auditKnowledge(job.owner_id, job.message_id, 'ANSWER_REVALIDATED_UNCHANGED', 'Evidence and factual output unchanged; no duplicate answer version appended.', { jobId: job.id, targetRevision: job.target_revision, verificationStatus: result.verificationStatus, modelUsage: result.modelUsage, durationMs: result.durationMs });
          await complete('completed'); return;
        }
        const previous = await this.database.get('SELECT MAX(sequence) AS sequence FROM answer_versions WHERE owner_id=? AND message_id=?', job.owner_id, job.message_id);
        await this.database.run('INSERT INTO answer_versions VALUES(?,?,?,?,?,?,?)', job.owner_id, job.message_id, Number(previous?.sequence || 0) + 1, JSON.stringify(result), job.target_revision, 'Revalidated after a library change', Date.now());
        await this.database.persistAnswerConflicts(job.owner_id, job.message_id, result);
        await this.database.auditKnowledge(job.owner_id, job.message_id, 'ANSWER_REVALIDATED', 'Original answer preserved; new assessment appended.', { targetRevision: job.target_revision, verificationStatus: result.verificationStatus });
        await complete('completed');
      });
    } catch (error) {
      const stopping = this.stopped;
      const failure = error as { retryable?: boolean; retryAfterSeconds?: number };
      const supplied = failure.retryAfterSeconds ?? providerRetryAfter(error);
      const cooldown = typeof supplied === 'number' && Number.isFinite(supplied) && supplied >= 0 ? supplied * 1000 : 0;
      const nextAt = Date.now() + (stopping ? 0 : Math.max(60000 * 2 ** (job.attempts - 1), cooldown));
      await this.database.run(`UPDATE revalidation_jobs SET status=?,attempts=attempts-?,last_error=?,next_at=?,lease_token=NULL,lease_until=0,updated_at=? WHERE id=? AND lease_token=?`,
        stopping ? 'queued' : job.attempts >= 3 || failure.retryable === false ? 'failed' : 'retry_wait', stopping ? 1 : 0,
        stopping ? null : 'Revalidation could not complete. The original answer is preserved; check provider availability and retry after the cooldown.', nextAt, Date.now(), job.id, job.token);
    } finally { clearInterval(heartbeat); }
  }
}
