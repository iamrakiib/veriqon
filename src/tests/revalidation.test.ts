import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { DatabaseService } from '../database/database.service';
import { VectorStoreService } from '../vector-store/vector-store.service';
import { RagService } from '../rag/rag.service';
import { RevalidationService } from '../rag/revalidation.service';
import { setTimeout as delay } from 'node:timers/promises';

const oldFact = 'Engineering permits three remote days.';
const newFact = 'Engineering permits one remote day.';
const benefit = 'Benefits include twenty vacation days.';
const saved = (draft = oldFact, extra = {}) => ({ draft, status: 'supported', verificationStatus: 'VERIFIED_UNCHANGED', factCheck: { passed: true, claims: [] }, citations: [], repairHistory: [], requestContext: {}, modelUsage: [], ...extra });

async function fixture() {
  const previous = { ...process.env }, schema = 'reval_' + randomUUID().replace(/-/g, '');
  Object.assign(process.env, { NODE_ENV: 'test', DATABASE_PATH: ':memory:', OPENROUTER_API_KEY: 'fixture-only', EMBEDDING_MODEL: 'fixture', REVALIDATION_PER_HOUR: '100', SEMANTIC_CACHE_ENABLED: 'false', MAX_REPAIR_ATTEMPTS: '1' });
  delete process.env.DATABASE_URL; delete process.env.REDIS_URL;
  const admin = process.env.TEST_DATABASE_URL ? new Pool({ connectionString: process.env.TEST_DATABASE_URL }) : undefined;
  if (admin) {
    await admin.query('CREATE EXTENSION IF NOT EXISTS vector'); await admin.query(`CREATE SCHEMA ${schema}`);
    const url = new URL(process.env.TEST_DATABASE_URL!); url.searchParams.set('options', `-c search_path=${schema},public`); process.env.DATABASE_URL = url.toString();
  }
  const db = new DatabaseService(); await db.initialize();
  for (const id of ['a','b']) await db.run('INSERT INTO users(id,email,name,password_hash,role,created_at) VALUES(?,?,?,?,?,?)', id, `${id}@example.test`, id, 'unused', 'member', Date.now());
  const store = new VectorStoreService(db); store.getEmbedding = async () => [1,0];
  const rag = new RagService(store);
  const doc = async (id: string, text: string) => db.writeDocument('a', { id, text, embeddingModel: store.embeddingConfig.identity, chunks: [{ chunkId: id + '#0', index: 0, source: id + '.txt', version: 'sha256:' + createHash('sha256').update(text).digest('hex'), content: text, embedding: [1,0] }] });
  const message = async (result: unknown, question = 'How many remote days and vacation days?') => { const id = await db.beginMessage('a', 'chat', question); await db.finishMessage('a', id, result); return id; };
  return { db, store, rag, doc, message, close: async () => { await db.onModuleDestroy(); if (admin) { await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); } process.env = previous; } };
}

// Only inference is scripted. Real retrieval, strict contracts, repair and persistence run.
function model(rag: RagService) {
  const state = { calls: 0, failure: false, badRepair: false, conflict: false };
  (rag as any).client = { chat: { completions: { create: async (body: any) => {
    state.calls++;
    if (state.failure) throw Object.assign(new Error('synthetic quota'), { status: 429, headers: { 'retry-after': '7200' } });
    const prompt = body.messages[0].content, input = JSON.parse(body.messages.at(-1).content);
    let content: string;
    if (prompt.startsWith('Decompose')) content = JSON.stringify({ sentences: input.sentences.map((s: any) => { const text = s.text.replace(/\s*\[\d+\]/g, '').trim(); return { id: s.id, kind: 'FACTUAL', claims: [{ text, span: text }] }; }) });
    else if (prompt.startsWith('Assess each')) {
      const claims = input.facts.map((fact: any) => {
        const supporting = input.evidence.find((d: any) => d.text.includes(fact.text));
        const contrary = !supporting && fact.text.includes('remote') ? input.evidence.find((d: any) => d.text.includes(newFact)) : undefined;
        return { id: fact.id, verdict: supporting ? 'SUPPORTED' : contrary ? 'CONTRADICTED' : 'INSUFFICIENT_EVIDENCE', supporting: supporting ? [{ index: supporting.index, quote: fact.text }] : [], contradicting: contrary ? [{ index: contrary.index, quote: newFact }] : [], missingInformation: supporting || contrary ? [] : ['Requested fact'], temporalValidity: 'APPLICABLE', scope: { time: null, place: 'Engineering' } };
      });
      const left = input.evidence.find((d: any) => d.text.includes(oldFact)), right = input.evidence.find((d: any) => d.text.includes(newFact));
      const conflicts = state.conflict && left && right ? [{ claim: 'Engineering remote days', supporting: [{ index: left.index, quote: oldFact }], contradicting: [{ index: right.index, quote: newFact }], scope: { time: null, place: 'Engineering' }, scopeRelation: 'SAME', periodRelation: 'OVERLAPPING', precedence: 'NONE_ESTABLISHED', reason: 'Same scope and no precedence.' }] : [];
      content = JSON.stringify({ claims, conflicts });
    } else if (prompt.startsWith('Correct only')) content = JSON.stringify({ corrections: input.assessment.filter((c: any) => c.verdict === 'CONTRADICTED').map((c: any) => ({ claimId: c.id, replacement: state.badRepair ? 'Engineering permits one remote day and pays travel expenses.' : newFact, evidence: c.contradicting })) });
    else content = oldFact + ' [1] ' + benefit + ' [1]';
    return { model: 'scripted', choices: [{ finish_reason: 'stop', message: { content } }] };
  } } } };
  return state;
}

test('deleting a conversation during background verification prevents a late answer version or retry', async () => {
  const f = await fixture();
  try {
    const id = await f.message(saved()); const worker = new RevalidationService(f.db, f.rag);
    await worker.request('a', id);
    let release!: () => void, started!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const entered = new Promise<void>(resolve => { started = resolve; });
    f.rag.queryPipeline = async () => { started(); await held; return saved(newFact) as any; };
    const running = worker.tick(); await entered;
    await f.db.deleteConversation('a', 'chat'); release(); await running;
    assert.equal((await worker.list('a')).jobs.length, 0);
    assert.equal(Number((await f.db.get('SELECT COUNT(*) AS n FROM answer_versions WHERE owner_id=?', 'a'))!.n), 0);
    assert.equal((await f.db.knowledgeEvents('a', id)).length, 0);
  } finally { await f.close(); }
});

test('revalidation retries failed jobs truthfully and preserves cooldown and audit history', async () => {
  const f = await fixture();
  try {
    const id = await f.message(saved()); const worker = new RevalidationService(f.db, f.rag);
    await worker.request('a', id); const job = (await worker.list('a')).jobs[0];
    const reset = Date.now() + 7200000;
    await f.db.run("UPDATE revalidation_jobs SET status='failed',attempts=3,next_at=?,last_error='quota' WHERE id=?", reset, job.id);
    const reply = await worker.request('a', id);
    assert.equal(reply.queued, true); const retried = (await worker.list('a')).jobs[0];
    assert.equal(retried.status, 'queued'); assert.equal(retried.attempts, 0); assert.equal(retried.nextAt, reset);
    assert.ok((await f.db.knowledgeEvents('a', id)).some(e => e.action === 'REVALIDATION_RETRY'));
    await f.db.run("UPDATE revalidation_jobs SET status='completed' WHERE id=?", job.id);
    assert.equal((await worker.request('a', id)).queued, false);
    await assert.rejects(worker.request('b', id), /not found/i);
  } finally { await f.close(); }
});

test('revalidation starts from latest assessment, preserves stored year and avoids unchanged versions', async () => {
  const f = await fixture();
  try {
    const period = { kind: 'year', from: '2024-01-01', to: '2025-01-01' };
    const original = saved(oldFact, { temporalScope: period }); const latest = saved(newFact, { temporalScope: period });
    const id = await f.message(original);
    await f.db.run('INSERT INTO answer_versions VALUES(?,?,?,?,?,?,?)', 'a', id, 1, JSON.stringify(latest), 0, 'Earlier correction', Date.now());
    let options: any;
    const worker = new RevalidationService(f.db, { queryPipeline: async (_q: string, _o: string, _c: unknown, opts: any) => { options = opts; return latest; } } as any);
    await worker.request('a', id); await worker.tick();
    assert.equal(options.originalDraft, newFact); assert.deepEqual(options.savedTemporalScope, period);
    assert.equal((await f.db.answerVersions('a', id)).length, 2);
    assert.ok((await f.db.knowledgeEvents('a', id)).some(e => e.action === 'ANSWER_REVALIDATED_UNCHANGED'));
  } finally { await f.close(); }
});

test('real verifier quota failure schedules its supplied reset without publishing a version', async () => {
  const f = await fixture();
  try {
    await f.doc('policy', oldFact); const inference = model(f.rag); inference.failure = true;
    const id = await f.message(saved()); const worker = new RevalidationService(f.db, f.rag);
    await worker.request('a', id); const start = Date.now(); await worker.tick();
    const job = (await worker.list('a')).jobs[0];
    assert.equal(job.status, 'retry_wait'); assert.ok(job.nextAt >= start + 7200000);
    assert.equal((await f.db.answerVersions('a', id)).length, 1);
    const calls = inference.calls; await worker.tick(); assert.equal(inference.calls, calls);
  } finally { await f.close(); }
});

test('real continuous correction repairs current answer, preserves historical scope and restores exact citations', async () => {
  const f = await fixture();
  try {
    await f.doc('old-policy', oldFact + ' ' + benefit);
    await f.db.updateMetadata('a', 'old-policy', { scope: 'Engineering', effectiveFrom: '2024-01-01' }, 0, 'Approved initial policy');
    model(f.rag);
    const current = await f.rag.queryPipeline('How many remote days and vacation days currently?', 'a');
    const historical = await f.rag.queryPipeline('How many remote days and vacation days in 2024?', 'a');
    assert.equal(current.factCheck.passed, true); assert.equal(historical.factCheck.passed, true);
    const currentId = await f.message(current, 'How many remote days and vacation days currently?');
    const historicalId = await f.message(historical, 'How many remote days and vacation days in 2024?');
    await f.doc('new-policy', newFact + ' ' + benefit);
    await f.db.updateMetadata('a', 'new-policy', { scope: 'Engineering', effectiveFrom: '2025-01-01', supersedes: 'old-policy' }, 0, 'Approved superseding policy');
    const worker = new RevalidationService(f.db, f.rag);
    for (let i = 0; i < 10; i++) await worker.tick();
    const revised = (await f.db.answerVersions('a', currentId)).at(-1)!.result;
    assert.equal(revised.verificationStatus, 'REPAIRED_VERIFIED');
    assert.ok(revised.draft.includes(newFact)); assert.ok(revised.draft.includes(benefit));
    const preserved = (await f.db.answerVersions('a', historicalId)).at(-1)!.result;
    assert.ok(preserved.draft.includes(oldFact)); assert.equal(preserved.temporalScope.kind, 'year');
    for (const result of [revised, preserved]) {
      assert.equal(result.factCheck.passed, true);
      for (const claim of result.factCheck.claims) if (claim.supported) assert.match(claim.sentence, /\[\d+\]/);
      for (const claim of result.factCheck.atomicClaims) assert.equal(result.draft.slice(claim.span.start, claim.span.end), claim.span.text);
      for (const marker of result.draft.matchAll(/\[(\d+)\]/g)) assert.ok(result.citations.find((c: any) => c.index === Number(marker[1]) && c.version));
    }
    assert.deepEqual((await f.db.answerVersions('a', currentId))[0].result, JSON.parse(JSON.stringify(current)));
    await assert.rejects(f.db.answerVersions('b', currentId), /not found/i);
  } finally { await f.close(); }
});

test('real unresolved conflicts and unsafe repairs stay visible without successful correction labels', async () => {
  for (const conflict of [true, false]) {
    const f = await fixture();
    try {
      await f.doc('old-policy', oldFact + ' ' + benefit);
      const inference = model(f.rag);
      const original = await f.rag.queryPipeline('How many remote days and vacation days?', 'a');
      const id = await f.message(original);
      if (!conflict) await f.db.deleteDocument('a', 'old-policy');
      await f.doc('new-policy', newFact + ' ' + benefit);
      inference.conflict = conflict; inference.badRepair = !conflict;
      const worker = new RevalidationService(f.db, f.rag);
      for (let i = 0; i < 6; i++) await worker.tick();
      const versions = await f.db.answerVersions('a', id), result = versions.at(-1)!.result;
      assert.equal(versions.length, 2);
      assert.equal(result.verificationStatus, conflict ? 'UNRESOLVED_CONFLICT' : 'PARTIALLY_VERIFIED');
      assert.equal(result.factCheck.passed, false); assert.equal(result.correction, null);
      assert.ok(!result.draft.includes('travel'));
      if (!conflict) assert.ok(result.repairHistory.some((event: any) => event.after && event.after.passed === false && event.accepted === false), 'Final verification must reject the introduced fact');
      if (conflict) assert.equal((await f.db.conflictRecords('a')).records.length, 1);
      else assert.ok(result.draft.includes(benefit));
      assert.equal(versions[0].result.draft, original.draft);
    } finally { await f.close(); }
  }
});

test('source deletion produces an explicit missing-source assessment and preserves original evidence', async () => {
  const f = await fixture();
  try {
    await f.doc('policy', oldFact + ' ' + benefit); model(f.rag);
    const question = 'According to policy.txt, how many remote days and vacation days?';
    const original = await f.rag.queryPipeline(question, 'a'); const id = await f.message(original, question);
    await f.db.deleteDocument('a', 'policy');
    const worker = new RevalidationService(f.db, f.rag);
    for (let i = 0; i < 4; i++) await worker.tick();
    const versions = await f.db.answerVersions('a', id);
    assert.equal(versions.length, 2); assert.equal(versions[1].result.verificationStatus, 'INSUFFICIENT_EVIDENCE');
    assert.equal(versions[1].result.reason, 'source_selection_required');
    assert.equal(versions[0].result.citations[0].excerpt, oldFact + ' ' + benefit);
  } finally { await f.close(); }
});

test('competing workers and source or lease changes cannot publish stale assessments', async () => {
  for (const invalidate of ['revision','lease']) {
    const f = await fixture();
    try {
      await f.doc('policy', oldFact); const id = await f.message(saved());
      let enter!: () => void, release!: () => void, calls = 0;
      const entered = new Promise<void>(done => { enter = done; }), gate = new Promise<void>(done => { release = done; });
      const rag = { queryPipeline: async () => { calls++; enter(); await gate; return saved(newFact); } } as any;
      const first = new RevalidationService(f.db, rag), second = new RevalidationService(f.db, rag);
      await first.request('a', id); const job = (await first.list('a')).jobs[0];
      const running = first.processJob(job.id); await entered;
      try {
        await second.processJob(job.id); assert.equal(calls, 1);
        if (invalidate === 'revision') await f.doc('competing', newFact);
        else await f.db.run('UPDATE revalidation_jobs SET lease_until=0 WHERE id=?', job.id);
      } finally { release(); await running; }
      assert.equal((await f.db.answerVersions('a', id)).length, 1);
      if (invalidate === 'revision') assert.equal((await first.list('a')).jobs[0].status, 'superseded');
    } finally { await f.close(); }
  }
});

test('new competing evidence schedules every saved answer across bounded pages without duplicate jobs', async () => {
  const f = await fixture();
  try {
    await f.doc('original', oldFact);
    await f.db.transaction(async () => { for (let i = 0; i < 101; i++) await f.message(saved()); });
    await f.doc('new-competing', newFact);
    const revision = await f.db.revision('a'), worker = new RevalidationService(f.db, f.rag);
    for (let i = 0; i < 5; i++) await worker.planChanges();
    const count = await f.db.get('SELECT COUNT(*) AS n FROM revalidation_jobs WHERE owner_id=? AND target_revision=?', 'a', revision);
    assert.equal(Number(count!.n), 101);
    assert.equal(Number((await f.db.get('SELECT COUNT(*) AS n FROM revalidation_jobs WHERE owner_id=?', 'b'))!.n), 0);
  } finally { await f.close(); }
});

test('saved historical ranges override ambiguous follow-ups and unchanged real assessments use audit events', async () => {
  const f = await fixture();
  try {
    await f.doc('old-policy', oldFact + ' ' + benefit);
    await f.db.updateMetadata('a', 'old-policy', { effectiveFrom: '2024-01-01', scope: 'Engineering' }, 0, 'Initial historical policy');
    model(f.rag);
    const scope = { kind: 'range' as const, from: '2024-01-01', to: '2025-01-01' };
    const original = await f.rag.queryPipeline('How many remote days and vacation days?', 'a', undefined, { savedTemporalScope: scope });
    assert.ok('temporalScope' in original && original.temporalScope?.kind === 'range');
    const id = await f.message(original);
    await f.doc('new-policy', newFact + ' ' + benefit);
    await f.db.updateMetadata('a', 'new-policy', { effectiveFrom: '2025-01-01', scope: 'Engineering', supersedes: 'old-policy' }, 0, 'New current policy');
    const worker = new RevalidationService(f.db, f.rag);
    for (let i = 0; i < 6; i++) await worker.tick();
    assert.equal((await f.db.answerVersions('a', id)).length, 1, 'Identical historical answer/evidence needs an audit, not another version');
    assert.ok((await f.db.knowledgeEvents('a', id)).some(e => e.action === 'ANSWER_REVALIDATED_UNCHANGED'));
  } finally { await f.close(); }
});

test('PostgreSQL claimant skips an expired job locked by a publishing transaction', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const f = await fixture(); const external = new Pool({ connectionString: process.env.DATABASE_URL });
  let calls = 0; const worker = new RevalidationService(f.db, { queryPipeline: async () => { calls++; return saved(newFact); } } as any);
  try {
    const id = await f.message(saved()); await worker.request('a', id); const job = (await worker.list('a')).jobs[0];
    await f.db.run("UPDATE revalidation_jobs SET status='processing',attempts=1,lease_until=0 WHERE id=?", job.id);
    const connection = await external.connect(); let running: Promise<void> | undefined, completed = false;
    try {
      await connection.query('BEGIN'); await connection.query('SELECT id FROM revalidation_jobs WHERE id=$1 FOR UPDATE', [job.id]);
      running = worker.processJob(job.id).then(() => { completed = true; });
      await Promise.race([running, delay(1000)]);
      assert.equal(completed, true, 'A claimant must skip publication-locked rows instead of using a stale unlocked read');
      assert.equal(calls, 0);
    } finally { await connection.query('ROLLBACK'); connection.release(); await running; }
  } finally { await external.end(); await f.close(); }
});
