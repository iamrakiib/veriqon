import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { DatabaseService } from '../database/database.service';
import { VectorStoreService } from '../vector-store/vector-store.service';
import { IngestionService } from '../rag/ingestion.service';
import { extractDocument } from '../rag/document-parser';
import { embeddingSettings } from '../common/ingestion-config';
import { setTimeout as delay } from 'node:timers/promises';
import { EmbeddingPacer, IndexingDeferred } from '../common/embedding-pacer';
import { chunkText } from '../common/utils';
import { Global, HttpException, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

async function fixture() {
  const previous = { ...process.env }, directory = mkdtempSync(join(tmpdir(), 'veriqon-ingestion-'));
  Object.assign(process.env, { NODE_ENV: 'test', DATABASE_PATH: join(directory, 'app.sqlite'), DOCUMENT_STORE_PATH: join(directory, 'absent.json'),
    SETUP_CODE_PATH: join(directory, 'setup.txt'), OPENROUTER_API_KEY: 'synthetic-test-only', EMBEDDING_MODEL: 'synthetic-embedding', EMBEDDING_BATCH_SIZE: '2', CHUNK_SIZE: '800', CHUNK_OVERLAP: '120' });
  delete process.env.DATABASE_URL; delete process.env.REDIS_URL;
  delete process.env.EMBEDDING_DOCUMENT_INPUT_TYPE; delete process.env.EMBEDDING_QUERY_INPUT_TYPE;
  const admin = process.env.TEST_DATABASE_URL ? new Pool({ connectionString: process.env.TEST_DATABASE_URL }) : undefined;
  const schema = 'test_' + randomUUID().replace(/-/g, '');
  if (admin) {
    await admin.query('CREATE EXTENSION IF NOT EXISTS vector'); await admin.query(`CREATE SCHEMA ${schema}`);
    const url = new URL(process.env.TEST_DATABASE_URL!); url.searchParams.set('options', `-c search_path=${schema},public`); process.env.DATABASE_URL = url.toString();
  }
  const database = new DatabaseService(); await database.initialize();
  for (const id of ['a','b','c']) await database.run('INSERT INTO users(id,email,name,password_hash,role,created_at) VALUES(?,?,?,?,?,?)', id, `${id}@example.test`, id, 'unused', 'member', Date.now());
  const store = new VectorStoreService(database), service = new IngestionService(database, store);
  const requests: string[][] = [];
  const success = async (body: { input: string[] }) => { requests.push(body.input); return { data: body.input.map((_, index) => ({ index, embedding: [1, 0] })) }; };
  const client = (create: (body: any) => Promise<any>) => { (store as any).client = { embeddings: { create } }; };
  client(success);
  const enqueue = (owner = 'a', id = 'document', text = 'A synthetic passage. '.repeat(130)) => service.enqueue(owner, id, text, { bytes: Buffer.from(text), name: `${id}.txt`, mime: 'text/plain' });
  const close = async () => {
    await service.onModuleDestroy(); await database.onModuleDestroy();
    if (admin) { await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); }
    rmSync(directory, { recursive: true, force: true }); process.env = previous;
  };
  return { database, store, service, requests, success, client, enqueue, close };
}

test('durable upload checkpoints survive a provider limit and resume without re-embedding saved chunks', async () => {
  const f = await fixture();
  try {
    const job = await f.enqueue();
    f.client(async body => {
      if (f.requests.length === 1) throw Object.assign(new Error('secret provider error'), { status: 429, headers: { 'retry-after': '120' } });
      return f.success(body);
    });
    await f.service.tick();
    let saved = (await f.service.list('a'))[0];
    assert.equal(saved.status, 'retry_wait'); assert.equal(saved.completedChunks, 2);
    assert.ok(saved.nextAt > Date.now() + 115000); assert.ok(!saved.error!.includes('secret'));
    assert.equal((await f.store.getAllDocs('a')).length, 0, 'Partial index is not searchable');
    await f.database.run('UPDATE ingestion_jobs SET next_at=0 WHERE id=?', job.id);
    // Simulate the provider reset as well as the job becoming due.
    await f.database.run("DELETE FROM settings WHERE key LIKE 'embedding-pacing:%'");
    const restarted = new IngestionService(f.database, f.store);
    f.client(f.success);
    await restarted.tick(); await restarted.onModuleDestroy();
    saved = (await f.service.list('a'))[0];
    assert.equal(saved.status, 'completed'); assert.equal(saved.completedChunks, saved.totalChunks);
    assert.equal(f.requests.flat().length, saved.totalChunks, 'No repeated successful embeddings');
    assert.equal((await f.store.getAllDocs('a')).length, 1);
    assert.equal((await f.store.getOriginal('a', 'document')).name, 'document.txt');
    const payload = await f.database.get('SELECT text,original_file FROM ingestion_jobs WHERE id=?', job.id);
    assert.equal(payload!.text, null); assert.equal(payload!.original_file, null);
    assert.equal(Number((await f.database.get('SELECT COUNT(*) AS n FROM ingestion_vectors'))!.n), 0);
    assert.equal((await f.enqueue()).id, job.id, 'Duplicate upload is idempotent');
    const resumed = (await f.database.readDocuments('a')).find(d => d.id === 'document')!;
    await f.store.addDocument('control', resumed.text, { source: 'control.txt' }, 'b');
    const uninterrupted = (await f.database.readDocuments('b')).find(d => d.id === 'control')!;
    const contents = (record: typeof resumed) => record.chunks.map(c => ({ index: c.index, content: c.content, embedding: c.embedding }));
    assert.deepEqual(contents(resumed), contents(uninterrupted), 'Resumed publication matches uninterrupted indexing exactly');
  } finally { await f.close(); }
});

test('large uploads yield fairly without consuming failure attempts or repeating saved embeddings', async () => {
  const f = await fixture();
  try {
    process.env.EMBEDDING_JOB_BATCHES_PER_TURN = '2';
    const job = await f.enqueue('a', 'large', 'Checkpointed passage with indexed facts. '.repeat(5000));
    assert.ok(job.totalChunks >= 275);
    let turns = 0;
    for (;;) {
      await f.service.tick(); turns++;
      const saved = (await f.service.list('a'))[0];
      assert.notEqual(saved.status, 'failed');
      if (saved.status === 'completed') { assert.equal(saved.attempts, 1); break; }
      assert.equal(saved.status, 'queued'); assert.equal(saved.attempts, 0);
      assert.equal((await f.store.getAllDocs('a')).length, 0);
      assert.ok(turns < 200);
      await f.database.run('UPDATE ingestion_jobs SET next_at=0 WHERE id=?', job.id);
    }
    assert.ok(turns > 6, 'A cooperative yield must not exhaust the six-attempt manual retry cap');
    assert.equal(f.requests.flat().length, job.totalChunks);
    assert.equal(await f.database.revision('a'), 1);
  } finally { await f.close(); }
});

test('embedding request pacing and provider cooldowns are shared across worker instances', async () => {
  const f = await fixture();
  try {
    const first = new EmbeddingPacer(f.database, 35, 'paced-model');
    const second = new EmbeddingPacer(f.database, 35, 'paced-model');
    const times: number[] = [];
    await Promise.all([first, second, first].map(async pacer => { await pacer.acquire(AbortSignal.timeout(3000)); times.push(Date.now()); }));
    assert.ok(times[1] - times[0] >= 30); assert.ok(times[2] - times[1] >= 30);
    await first.recordLimit({ status: 429, headers: { 'retry-after': '120' } });
    await assert.rejects(second.acquire(AbortSignal.timeout(1000)), e => e instanceof IndexingDeferred && e.retryAfterSeconds >= 119);
    const unrelated = new EmbeddingPacer(f.database, 0, 'different-model');
    await unrelated.acquire(AbortSignal.timeout(1000));
    await f.database.run("DELETE FROM settings WHERE key LIKE 'embedding-pacing:%'");
    await first.acquire(AbortSignal.timeout(1000));
  } finally { await f.close(); }
});

test('a shared cooldown makes zero provider requests and does not use an upload retry attempt', async () => {
  const f = await fixture();
  try {
    await f.enqueue();
    const pacer = new EmbeddingPacer(f.database, 0, f.store.embeddingConfig.model);
    await pacer.recordLimit({ status: 429 });
    await f.service.tick();
    const saved = (await f.service.list('a'))[0];
    assert.equal(saved.status, 'retry_wait'); assert.equal(saved.attempts, 0);
    assert.equal(f.requests.length, 0); assert.ok(saved.nextAt > Date.now() + 55000);
  } finally { await f.close(); }
});

test('repeated provider rate limits without progress exhaust a bounded budget even with short reset headers', async () => {
  const f = await fixture();
  try {
    const job = await f.enqueue(); let calls = 0;
    f.client(async () => { calls++; throw Object.assign(new Error('rate limit'), { status: 429, headers: { 'retry-after': '0' } }); });
    for (let attempt = 1; attempt <= 3; attempt++) {
      await f.database.run("DELETE FROM settings WHERE key LIKE 'embedding-pacing:%'");
      await f.database.run('UPDATE ingestion_jobs SET next_at=0 WHERE id=?', job.id);
      await f.service.tick();
      const saved = (await f.service.list('a'))[0];
      assert.equal(saved.attempts, attempt); assert.equal(saved.status, attempt === 3 ? 'failed' : 'retry_wait');
    }
    assert.equal(calls, 3);
  } finally { await f.close(); }
});

test('upload cancellation fences a late embedding response and prevents resurrection', async () => {
  const f = await fixture();
  try {
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    f.client(async body => { entered(); await gate; return f.success(body); });
    const job = await f.enqueue(); const running = f.service.tick();
    await started; await f.service.discard('a', job.id); release(); await running;
    assert.equal((await f.service.list('a')).length, 0);
    assert.equal((await f.store.getAllDocs('a')).length, 0);
    assert.equal(Number((await f.database.get('SELECT COUNT(*) AS n FROM ingestion_vectors'))!.n), 0);
  } finally { await f.close(); }
});

test('jobs enforce owner isolation, pending capacity and bounded retries', async () => {
  const f = await fixture();
  try {
    const job = await f.enqueue();
    assert.deepEqual(await f.service.list('b'), []);
    await assert.rejects(f.service.discard('b', job.id), /not found/);
    await assert.rejects(f.service.retry('b', job.id), /not found/);
    assert.equal((await f.enqueue()).id, job.id);
    await f.enqueue('a', 'second'); await f.enqueue('a', 'third');
    await assert.rejects(f.enqueue('a', 'fourth'), /queue is full/);
    f.client(async () => { throw Object.assign(new Error('credential secret'), { status: 401 }); });
    await f.service.tick();
    assert.equal((await f.service.list('a')).find(j => j.id === job.id)!.status, 'failed', 'Bad credentials do not trigger automatic retries');
    await f.service.retry('a', job.id);
    await f.database.run("UPDATE ingestion_jobs SET status='failed',attempts=6 WHERE id=?", job.id);
    await assert.rejects(f.service.retry('a', job.id), /retry budget/);
    await f.service.discard('a', job.id); await f.enqueue('a', 'fourth');
  } finally { await f.close(); }
});

test('expired workers are recovered and stale workers cannot publish another lease', async () => {
  const f = await fixture();
  try {
    const job = await f.enqueue();
    await f.database.run("UPDATE ingestion_jobs SET status='processing',lease_token='dead-worker',lease_until=0,attempts=1 WHERE id=?", job.id);
    await f.service.tick();
    assert.equal((await f.service.list('a'))[0].status, 'completed');
    assert.equal((await f.service.list('a'))[0].attempts, 1, 'Checkpoint progress clears the previous interrupted attempt');
    await f.enqueue('a', 'exhausted');
    await f.database.run("UPDATE ingestion_jobs SET status='processing',lease_until=0,attempts=6 WHERE document_id='exhausted'");
    await f.service.tick();
    assert.equal((await f.service.list('a')).find(j => j.documentId === 'exhausted')!.status, 'failed');
  } finally { await f.close(); }
});

test('changed embedding settings and malformed vectors cannot publish a partial or mixed index', async () => {
  const f = await fixture();
  try {
    const job = await f.enqueue();
    await f.database.run("UPDATE ingestion_jobs SET fingerprint='obsolete' WHERE id=?", job.id);
    await f.service.tick();
    assert.equal((await f.service.list('a'))[0].status, 'failed');
    assert.equal(f.requests.length, 0);
    await assert.rejects(f.service.retry('a', job.id), /settings changed/);
    await f.service.discard('a', job.id);
    for (const data of [undefined, [], [{ index: 0, embedding: [0, 0] }], [{ index: 0, embedding: [1, NaN] }], [{ index: 0, embedding: ['1', 0] }], [{ index: 1, embedding: [1, 0] }]]) {
      f.client(async () => ({ data }));
      await assert.rejects(f.store.getEmbeddings(['test']));
    }
    f.client(async body => ({ data: body.input.map((_: string, index: number) => ({ index, embedding: index ? [1,0,0] : [1,0] })) }));
    await assert.rejects(f.store.getEmbeddings(['one', 'two']));
    f.client(async () => ({ error: { code: 401 } }));
    await assert.rejects(f.store.getEmbeddings(['test']), /rejected the API key/);
    assert.equal((await f.store.getAllDocs('a')).length, 0);
  } finally { await f.close(); }
});

test('large text uploads use the queue and the isolated parser enforces the new upper bound', async () => {
  const f = await fixture();
  try {
    process.env.PARSER_ISOLATION = 'process';
    const text = 'A synthetic handbook passage. '.repeat(5000);
    const extracted = await extractDocument({ originalname: 'large.txt', buffer: Buffer.from(text), size: Buffer.byteLength(text) });
    assert.ok(extracted.length > 100000);
    const job = await f.enqueue('a', 'large', extracted);
    for (let turn = 0; turn < 20; turn++) {
      await f.service.tick();
      if ((await f.service.list('a'))[0].status === 'completed') break;
      await f.database.run('UPDATE ingestion_jobs SET next_at=0 WHERE id=?', job.id);
    }
    assert.equal((await f.service.list('a'))[0].status, 'completed');
    assert.equal((await f.store.getAllDocs('a'))[0].text, text.trim());
    await assert.rejects(extractDocument({ originalname: 'too-large.txt', buffer: Buffer.from('x'.repeat(500001)), size: 500001 }), /500,000/);
    const limit = await extractDocument({ originalname: 'limit.txt', buffer: Buffer.from('x'.repeat(500000)), size: 500000 });
    assert.equal(limit.length, 500000);
  } finally { await f.close(); }
});

test('input-mode configuration is paired and changes the embedding identity', async () => {
  const f = await fixture();
  try {
    process.env.EMBEDDING_QUERY_INPUT_TYPE = 'query';
    assert.throws(() => embeddingSettings(), /Configure both/);
    process.env.EMBEDDING_DOCUMENT_INPUT_TYPE = 'passage';
    const settings = embeddingSettings();
    assert.notEqual(settings.identity, settings.model);
    const store = new VectorStoreService(f.database), calls: string[] = [];
    (store as any).client = { embeddings: { create: async (body: any) => { calls.push(body.input_type); return { data: body.input.map((_: string, index: number) => ({ index, embedding: [1,0] })) }; } } };
    await store.addDocument('mode', 'Synthetic mode-specific passage.', {}, 'a');
    await store.queryEmbedding('Question?', 'a');
    assert.deepEqual(calls, ['passage', 'query']);
    assert.equal((await f.database.readDocuments('a'))[0].embeddingModel, settings.identity);
    await assert.rejects(f.store.search('Question?', 3, undefined, 'a'), /embedding model changed/);
  } finally { await f.close(); }
});

test('a replacement worker fences the original worker and publishes exactly once', async () => {
  const f = await fixture();
  let replacement: IngestionService | undefined;
  try {
    let release!: () => void, enter!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const entered = new Promise<void>(resolve => { enter = resolve; });
    f.client(async body => { enter(); await gate; return f.success(body); });
    const job = await f.enqueue(); const old = f.service.tick(); await entered;
    await f.database.run('UPDATE ingestion_jobs SET lease_until=0 WHERE id=?', job.id);
    replacement = new IngestionService(f.database, f.store); f.client(f.success);
    try { await replacement.tick(); } finally { release(); await old; }
    assert.equal((await f.service.list('a'))[0].status, 'completed');
    assert.equal(await f.database.revision('a'), 1, 'Only the new lease commits');
    assert.equal(Number((await f.database.get('SELECT COUNT(*) AS n FROM ingestion_vectors'))!.n), 0);
  } finally { await replacement?.onModuleDestroy(); await f.close(); }
});

test('multiple workers respect the global concurrency limit and isolate unfinished documents', async () => {
  const f = await fixture();
  const second = new IngestionService(f.database, f.store), third = new IngestionService(f.database, f.store);
  try {
    await f.enqueue('a', 'one'); await f.enqueue('b', 'two'); await f.enqueue('c', 'three');
    let release!: () => void, enter!: () => void, count = 0;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const entered = new Promise<void>(resolve => { enter = resolve; });
    f.client(async body => { if (++count === 2) enter(); await gate; return f.success(body); });
    const firstRun = f.service.tick(), secondRun = second.tick(); await entered;
    try {
      await third.tick(); assert.equal(count, 2, 'Third worker cannot call the provider while two leases are active');
      for (const owner of ['a', 'b', 'c']) assert.deepEqual(await f.store.getAllDocs(owner), []);
    } finally { release(); await Promise.all([firstRun, secondRun]); }
    await third.tick();
    for (const owner of ['a', 'b', 'c']) assert.equal((await f.store.getAllDocs(owner)).length, 1);
  } finally { await second.onModuleDestroy(); await third.onModuleDestroy(); await f.close(); }
});

test('reupload after a profile change replaces a stale receipt while retaining the published source until success', async () => {
  const f = await fixture();
  let updated: IngestionService | undefined;
  try {
    const original = await f.enqueue(); await f.service.tick();
    process.env.EMBEDDING_DOCUMENT_INPUT_TYPE = 'search_document'; process.env.EMBEDDING_QUERY_INPUT_TYPE = 'search_query';
    const store = new VectorStoreService(f.database);
    (store as any).client = { embeddings: { create: f.success } };
    updated = new IngestionService(f.database, store);
    const text = (await f.store.getAllDocs('a'))[0].text;
    const next = await updated.enqueue('a', 'document', text, { bytes: Buffer.from(text), name: 'document.txt', mime: 'text/plain' });
    assert.notEqual(next.id, original.id); assert.equal(next.status, 'queued');
    assert.equal((await f.store.getAllDocs('a')).length, 1, 'Previous index is retained during reindexing');
    await updated.tick();
    assert.equal((await updated.list('a'))[0].status, 'completed');
    assert.equal((await f.database.readDocuments('a'))[0].embeddingModel, store.embeddingConfig.identity);
    assert.equal(await f.database.revision('a'), 2);
    process.env.OPENROUTER_BASE_URL = 'https://different-provider.example.test/v1';
    assert.notEqual(embeddingSettings().identity, store.embeddingConfig.identity, 'Changing the gateway cannot silently mix embedding spaces');
  } finally { await updated?.onModuleDestroy(); await f.close(); }
});

test('PostgreSQL does not reclaim a lease while its publication transaction holds the job row', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const f = await fixture();
  const second = new IngestionService(f.database, f.store);
  let release!: () => void;
  try {
    let enter!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const entered = new Promise<void>(resolve => { enter = resolve; });
    const job = await f.enqueue();
    const original = f.store.addDocument.bind(f.store);
    f.store.addDocument = async (...args) => {
      const checkpoint = args[6]!;
      const commit = checkpoint.commit;
      checkpoint.commit = async publish => {
        // Shorten the lease before publication acquires its row lock. The provider
        // is done; deliberately hold the SQL transaction past that expiry.
        await f.database.run('UPDATE ingestion_jobs SET lease_until=? WHERE id=?', Date.now() + 1000, job.id);
        await commit(async () => { await publish(); enter(); await gate; });
      };
      return original(...args);
    };
    const first = f.service.tick();
    await entered; await delay(1100);
    try {
      const started = Date.now();
      await second.tick();
      assert.ok(Date.now() - started < 2000, 'A claiming worker skips a publishing row instead of waiting then reclaiming it');
    } finally { release(); await first; }
    const completed = (await f.service.list('a'))[0];
    assert.equal(completed.status, 'completed'); assert.equal(completed.attempts, 1);
    assert.equal(await f.database.revision('a'), 1);
  } finally { release?.(); await second.onModuleDestroy(); await f.close(); }
});

test('a chunk profile change rebuilds the actual index, then identical uploads reuse it', async () => {
  const f = await fixture();
  let updated: IngestionService | undefined;
  try {
    const text = 'A synthetic passage with distinct indexing boundaries. '.repeat(65);
    const first = await f.enqueue('a', 'profile', text); await f.service.tick();
    const originalCalls = f.requests.length;
    process.env.CHUNK_SIZE = '400'; process.env.CHUNK_OVERLAP = '40';
    const store = new VectorStoreService(f.database);
    (store as any).client = { embeddings: { create: f.success } };
    updated = new IngestionService(f.database, store);
    const file = { bytes: Buffer.from(text), name: 'profile.txt', mime: 'text/plain' };
    const job = await updated.enqueue('a', 'profile', text, file);
    assert.notEqual(job.id, first.id);
    await updated.tick();
    const document = (await f.database.readDocuments('a'))[0];
    assert.deepEqual(document.chunks.map(c => c.content), chunkText(text, 400, 40));
    assert.equal((await updated.list('a'))[0].completedChunks, document.chunks.length);
    assert.ok(f.requests.length > originalCalls, 'Changed chunk boundaries require new vectors');
    assert.equal(await f.database.revision('a'), 2);
    const calls = f.requests.length;
    await updated.enqueue('a', 'profile', text, file); await updated.tick();
    await store.addDocument('profile', text, { source: 'profile.txt' }, 'a', file);
    assert.equal(f.requests.length, calls, 'Unchanged profile still avoids duplicate provider work');
    assert.equal(await f.database.revision('a'), 2);
  } finally { await updated?.onModuleDestroy(); await f.close(); }
});

test('checkpoint progress resets the failure streak even when a worker yields normally', async () => {
  const f = await fixture();
  try {
    process.env.EMBEDDING_JOB_BATCHES_PER_TURN = '1';
    const job = await f.enqueue();
    await f.database.run('UPDATE ingestion_jobs SET attempts=2 WHERE id=?', job.id);
    await f.service.tick();
    const progress = (await f.service.list('a'))[0];
    assert.equal(progress.status, 'queued'); assert.equal(progress.completedChunks, 2);
    assert.equal(progress.attempts, 0, 'Successful work before a scheduling yield breaks the failure streak');
    await f.database.run('UPDATE ingestion_jobs SET next_at=0 WHERE id=?', job.id);
    f.client(async () => { throw Object.assign(new Error('limited'), { status: 429 }); });
    await f.service.tick();
    const limited = (await f.service.list('a'))[0];
    assert.equal(limited.status, 'retry_wait'); assert.equal(limited.attempts, 1);
    assert.equal(limited.completedChunks, 2);
  } finally { await f.close(); }
});

test('successful checkpoint progress also resets stale exponential backoff', async () => {
  const f = await fixture();
  try {
    const job = await f.enqueue();
    await f.database.run('UPDATE ingestion_jobs SET attempts=5 WHERE id=?', job.id);
    f.client(async body => {
      if (f.requests.length) throw Object.assign(new Error('limited'), { status: 429, headers: { 'retry-after': '0' } });
      return f.success(body);
    });
    await f.service.tick();
    const saved = (await f.service.list('a'))[0];
    assert.equal(saved.completedChunks, 2); assert.equal(saved.attempts, 0);
    assert.equal(saved.status, 'retry_wait');
    assert.ok(saved.nextAt <= Date.now() + 31000, 'Progress must not inherit the previous 16-minute retry delay');
    assert.ok(saved.nextAt >= Date.now() + 25000, 'Still applies the bounded base retry delay');
  } finally { await f.close(); }
});

test('graceful shutdown preserves checkpoints and does not consume the final upload attempt', async () => {
  const f = await fixture();
  let restarted: IngestionService | undefined;
  let release!: () => void;
  try {
    const job = await f.enqueue();
    await f.database.run('UPDATE ingestion_jobs SET attempts=5 WHERE id=?', job.id);
    let enter!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const entered = new Promise<void>(resolve => { enter = resolve; });
    f.client(async body => {
      if (f.requests.length) { enter(); await gate; }
      return f.success(body);
    });
    const running = f.service.tick(); await entered;
    const shutdown = f.service.onModuleDestroy(); release();
    await Promise.all([running, shutdown]);
    const paused = (await f.service.list('a'))[0];
    assert.equal(paused.status, 'queued'); assert.equal(paused.completedChunks, 2);
    assert.equal(paused.attempts, 0); assert.equal(paused.error, undefined);
    assert.equal((await f.store.getAllDocs('a')).length, 0);
    f.client(f.success); restarted = new IngestionService(f.database, f.store);
    await restarted.tick();
    const done = (await restarted.list('a'))[0];
    assert.equal(done.status, 'completed'); assert.equal(await f.database.revision('a'), 1);
    // The interrupted in-flight batch may be requested again; the committed first batch must not be.
    assert.equal(f.requests.slice(2).flat().length, done.totalChunks - 2);
  } finally { release?.(); await restarted?.onModuleDestroy(); await f.close(); }
});

test('provider outages retrieve bounded lexical windows without loading library vectors or other owners', async () => {
  const f = await fixture();
  try {
    const write = (owner: string, id: string, count: number, content: (index: number) => string) => f.database.writeDocument(owner, {
      id, text: 'Synthetic library document', chunks: Array.from({ length: count }, (_, index) => ({
        index, chunkId: `${id}#${index}`, content: content(index), embedding: [1, 0], source: `${id}.txt`, version: 'fixture-v1'
      }))
    });
    await write('a', 'long', 300, i => `Orchid policy passage ${i}: one remote day.`);
    await write('a', 'small', 3, i => i === 1 ? 'Orchid policy: three remote days.' : 'Additional policy context.');
    await write('b', 'long', 10, () => 'Orchid private other-account material.');
    f.store.getEmbedding = async () => { throw new HttpException('Provider unavailable', 503); };
    // An outage must not deserialize every vector and full source file in the library.
    f.database.readDocuments = async () => { throw new Error('Unbounded library load during provider outage'); };
    const candidates = await f.database.lexicalDocuments('a', 'Orchid', 2, ['long', 'small']);
    assert.ok(candidates.flatMap(d => d.chunks).length <= 100, 'At most twenty seed windows, each with up to five passages');
    assert.ok(candidates.every(d => d.text === '' && d.chunks.every(c => c.embedding.length === 0)), 'No full sources or vectors returned');
    const found = await f.store.search('Compare long.txt and small.txt orchid policy', 2, undefined, 'a', ['long', 'small']);
    assert.deepEqual(new Set(found.map(p => p.id)), new Set(['long', 'small']));
    assert.ok(found.every(p => p.retrievalMode === 'lexical_fallback' && p.score === 0 && p.version === 'fixture-v1'));
    assert.ok(found.every(p => !p.text.includes('private other-account')));
    assert.ok(found.find(p => p.id === 'small')!.text.includes('Additional policy context.'));
    await assert.rejects(f.store.search('nonexistentterm', 2, undefined, 'a'), /Provider unavailable/);
    assert.deepEqual(await f.store.search('Orchid', 2, undefined, 'a', ['unauthorized-id']), []);
  } finally { await f.close(); }
});

test('checkpoint progress survives a crash on the final retry and the stale worker cannot overwrite recovery', async () => {
  const f = await fixture();
  let replacement: IngestionService | undefined, release!: () => void;
  try {
    const job = await f.enqueue();
    await f.database.run('UPDATE ingestion_jobs SET attempts=5 WHERE id=?', job.id);
    let enter!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const entered = new Promise<void>(resolve => { enter = resolve; });
    f.client(async body => {
      if (f.requests.length) { enter(); await gate; }
      return f.success(body);
    });
    const old = f.service.tick(); await entered;
    try {
      const saved = (await f.service.list('a'))[0];
      assert.equal(saved.completedChunks, 2);
      await f.database.run('UPDATE ingestion_jobs SET lease_until=0 WHERE id=?', job.id);
      replacement = new IngestionService(f.database, f.store); f.client(f.success);
      await replacement.tick();
      assert.equal((await replacement.list('a'))[0].status, 'completed', 'Persisted progress must reset the exhausted failure streak before a crash');
    } finally { release(); await old; }
    assert.equal((await f.service.list('a'))[0].status, 'completed');
    assert.equal(await f.database.revision('a'), 1);
  } finally { release?.(); await replacement?.onModuleDestroy(); await f.close(); }
});

test('graceful shutdown without progress preserves the remaining manual retry budget', async () => {
  const f = await fixture();
  let release!: () => void;
  try {
    const job = await f.enqueue();
    await f.database.run('UPDATE ingestion_jobs SET attempts=5 WHERE id=?', job.id);
    let enter!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const entered = new Promise<void>(resolve => { enter = resolve; });
    f.client(async body => { enter(); await gate; return f.success(body); });
    const running = f.service.tick(); await entered;
    const shutdown = f.service.onModuleDestroy(); release(); await Promise.all([running, shutdown]);
    const paused = (await f.service.list('a'))[0];
    assert.equal(paused.status, 'queued'); assert.equal(paused.attempts, 5);
    assert.equal(paused.completedChunks, 0); assert.equal(paused.error, undefined);
  } finally { release?.(); await f.close(); }
});

test('application shutdown drains upload workers before closing the shared database', async () => {
  const f = await fixture();
  @Global()
  @Module({ providers: [{ provide: DatabaseService, useValue: f.database }], exports: [DatabaseService] })
  class TestDatabaseModule {}
  @Module({ imports: [TestDatabaseModule], providers: [{ provide: VectorStoreService, useValue: f.store }, IngestionService] })
  class TestJobsModule {}
  @Module({ imports: [TestDatabaseModule, TestJobsModule] })
  class TestAppModule {}
  const app = await NestFactory.createApplicationContext(TestAppModule, { logger: false });
  let reopened: DatabaseService | undefined, release!: () => void;
  try {
    const worker = app.get(IngestionService);
    const job = await f.enqueue();
    let enter!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const entered = new Promise<void>(resolve => { enter = resolve; });
    (f.store as any).client = { embeddings: { create: async (body: { input: string[] }, { signal }: { signal: AbortSignal }) => {
      if (f.requests.length) {
        enter();
        signal.addEventListener('abort', release, { once: true });
        await gate;
        signal.throwIfAborted();
      }
      return f.success(body);
    } } };
    const running = worker.tick(); await entered;
    await app.close(); await running;
    reopened = new DatabaseService(); await reopened.initialize();
    const saved = await reopened.get('SELECT status,completed_chunks,attempts,lease_token FROM ingestion_jobs WHERE id=?', job.id);
    assert.equal(saved!.status, 'queued'); assert.equal(Number(saved!.completed_chunks), 2);
    assert.equal(Number(saved!.attempts), 0); assert.equal(saved!.lease_token, null);
  } finally { release?.(); await app.close(); await reopened?.onModuleDestroy(); await f.close(); }
});
