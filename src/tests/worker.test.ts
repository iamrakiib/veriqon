import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IngestionService } from '../rag/ingestion.service';
import { RevalidationService } from '../rag/revalidation.service';
import { backgroundConfig } from '../common/background-config';
import { queueConnection, JobQueueService } from '../rag/job-queue.service';
import { DatabaseService } from '../database/database.service';
import { VectorStoreService } from '../vector-store/vector-store.service';
import { RagService } from '../rag/rag.service';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, cpSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { Queue } from 'bullmq';
import { createServer as tcpServer, connect, type Socket } from 'node:net';
import { HttpException } from '@nestjs/common';
import { WorkerHeartbeat, workerHealthy } from '../common/worker-heartbeat';

test('worker health rejects absent, stale, malformed and dead-process heartbeats', () => {
  const directory = mkdtempSync(join(tmpdir(), 'veriqon-heartbeat-'));
  const path = join(directory, 'heartbeat.json'), heartbeat = new WorkerHeartbeat(path);
  try {
    assert.equal(workerHealthy(path), false);
    heartbeat.record(); assert.equal(workerHealthy(path), true);
    assert.equal(workerHealthy(path, Date.now() + 61000), false);
    writeFileSync(path, JSON.stringify({ pid: process.pid, checkedAt: Date.now() + 60000 }));
    assert.equal(workerHealthy(path), false);
    writeFileSync(path, JSON.stringify({ pid: 2147483647, checkedAt: Date.now() }));
    assert.equal(workerHealthy(path), false);
    writeFileSync(path, '{'); assert.equal(workerHealthy(path), false);
    heartbeat.record(); heartbeat.clear(); assert.equal(workerHealthy(path), false);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('worker heartbeat advances only after successful reconciliation and clears on shutdown', async () => {
  const previous = { ...process.env }, directory = mkdtempSync(join(tmpdir(), 'veriqon-heartbeat-'));
  const path = join(directory, 'heartbeat.json');
  Object.assign(process.env, { VERIQON_PROCESS_ROLE: 'worker', JOB_QUEUE_MODE: 'bullmq', DATABASE_URL: 'postgresql://localhost/test', QUEUE_REDIS_URL: 'redis://localhost', WORKER_HEARTBEAT_PATH: path, REVALIDATION_ENABLED: 'true' });
  let fail = true;
  const service = new JobQueueService({ registerShutdown() {} } as any, { async onModuleDestroy() {} } as any,
    { async planChanges() { if (fail) throw new Error('Database unavailable'); }, async onModuleDestroy() {} } as any);
  try {
    await assert.rejects(service.reconcile()); assert.equal(workerHealthy(path), false);
    fail = false; await service.reconcile(); assert.equal(workerHealthy(path), true);
    await service.onModuleDestroy(); assert.equal(workerHealthy(path), false);
    await service.reconcile(); assert.equal(workerHealthy(path), false);
  } finally { await service.onModuleDestroy(); process.env = previous; rmSync(directory, { recursive: true, force: true }); }
});

async function until(check: () => Promise<boolean>, label: string, timeout = 30000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await check()) return; await delay(100); }
  throw new Error(`Timed out: ${label}`);
}

test('background configuration rejects ambiguous schedulers and keeps producer retries bounded', () => {
  assert.equal(backgroundConfig({}).role, 'integrated');
  for (const env of [{ VERIQON_PROCESS_ROLE: 'api' }, { JOB_QUEUE_MODE: 'bullmq' }, { VERIQON_PROCESS_ROLE: 'other' },
    { VERIQON_PROCESS_ROLE: 'worker', JOB_QUEUE_MODE: 'bullmq' }, { QUEUE_PREFIX: 'invalid:prefix' }]) {
    assert.throws(() => backgroundConfig(env));
  }
  assert.equal(backgroundConfig({ VERIQON_PROCESS_ROLE: 'worker', JOB_QUEUE_MODE: 'bullmq', DATABASE_URL: 'postgresql://localhost/test', QUEUE_REDIS_URL: 'redis://localhost' }).role, 'worker');
  const producer = queueConnection('rediss://default:p%40ss@localhost:6380/2', false);
  assert.equal(producer.password, 'p@ss'); assert.equal(producer.db, 2); assert.deepEqual(producer.tls, {});
  assert.equal(producer.maxRetriesPerRequest, 1); assert.equal(producer.enableOfflineQueue, false);
  assert.equal(producer.commandTimeout, 5000);
  assert.equal(queueConnection('redis://localhost', true).maxRetriesPerRequest, null);
  assert.throws(() => queueConnection('https://localhost', true));
});

/** Real SQL/Redis and processors; only external model responses are controlled. */
async function queueFixture() {
  const previous = { ...process.env }, directory = mkdtempSync(join(tmpdir(), 'veriqon-worker-'));
  const schema = 'worker_' + randomUUID().replace(/-/g, ''), prefix = 'test-' + randomUUID();
  const admin = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  await admin.query('CREATE EXTENSION IF NOT EXISTS vector'); await admin.query(`CREATE SCHEMA ${schema}`);
  const url = new URL(process.env.TEST_DATABASE_URL!); url.searchParams.set('options', `-c search_path=${schema},public`);
  Object.assign(process.env, { NODE_ENV: 'test', DATABASE_URL: url.toString(), VERIQON_PROCESS_ROLE: 'worker', JOB_QUEUE_MODE: 'bullmq',
    QUEUE_REDIS_URL: process.env.TEST_REDIS_URL!, QUEUE_PREFIX: prefix, OPENROUTER_API_KEY: 'synthetic-only',
    EMBEDDING_MODEL: 'fixture-embedding', LLM_MODEL: 'fixture-chat', REVALIDATION_PER_HOUR: '100', EMBEDDING_BATCH_SIZE: '2',
    EMBEDDING_MIN_INTERVAL_MS: '0', CHUNK_SIZE: '800', CHUNK_OVERLAP: '120', REVALIDATION_ENABLED: 'true' });
  delete process.env.REDIS_URL;
  const db = new DatabaseService(); await db.initialize();
  for (const id of ['a','b']) await db.run('INSERT INTO users(id,email,name,password_hash,role,created_at) VALUES(?,?,?,?,?,?)', id, `${id}@example.test`, id, 'unused', 'member', Date.now());
  const store = new VectorStoreService(db);
  store.getEmbeddings = async texts => texts.map(() => [1,0]); store.getEmbedding = async () => [1,0];
  const ingestion = new IngestionService(db, store), rag = new RagService(store), revalidation = new RevalidationService(db, rag);
  const adapter = new JobQueueService(db, ingestion, revalidation);
  const queues = ['ingestion', 'revalidation'].map(kind => new Queue(kind, { prefix, connection: queueConnection(process.env.TEST_REDIS_URL!, false) }));
  const enqueue = (id = 'document', owner = 'a', text = 'The method preserves backbone scores.') => ingestion.enqueue(owner, id, text, { name: id + '.txt', mime: 'text/plain', bytes: Buffer.from(text) });
  return { db, store, rag, ingestion, revalidation, adapter, queues, enqueue, directory, prefix, close: async () => {
    await adapter.onModuleDestroy(); await db.onModuleDestroy();
    for (const queue of queues) { await queue.obliterate({ force: true }); await queue.close(); }
    await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end();
    rmSync(directory, { recursive: true, force: true }); process.env = previous;
  } };
}

const integration = Boolean(process.env.TEST_DATABASE_URL && process.env.TEST_REDIS_URL);
test('SQL reconciliation recovers missing deliveries and duplicates never republish indexes', { skip: !integration, timeout: 60000 }, async () => {
  const f = await queueFixture();
  try {
    const job = await f.enqueue();
    assert.equal((await f.ingestion.list('a'))[0].status, 'queued');
    // No producer call follows the SQL commit. Starting the independent dispatcher recovers it.
    await f.adapter.onApplicationBootstrap();
    await until(async () => (await f.ingestion.list('a'))[0].status === 'completed', 'index publication');
    const revision = await f.db.revision('a');
    await until(async () => !(await f.queues[0].getJob(`sql-${job.id}`)), 'acknowledgement');
    await f.queues[0].add('ingestion', { id: job.id }, { jobId: `sql-${job.id}`, removeOnComplete: true });
    await until(async () => !(await f.queues[0].getJob(`sql-${job.id}`)), 'duplicate acknowledgement');
    assert.equal(await f.db.revision('a'), revision);
    assert.equal((await f.db.readDocuments('a')).length, 1);
    assert.deepEqual(await f.ingestion.list('b'), []);
    await assert.rejects(f.ingestion.retry('b', job.id));
    assert.equal(Number((await f.db.get('SELECT COUNT(*) AS n FROM ingestion_vectors'))!.n), 0);
    const events = await (await f.queues[0].getBackend().client).runCommand('xlen', [`${f.prefix}:ingestion:events`]);
    assert.ok(events > 0, 'Real Lua/Streams/blocking queue execution, not just PING');
  } finally { await f.close(); }
});

test('provider cooldown and hourly budget do not cause redispatch storms', { skip: !integration, timeout: 45000 }, async () => {
  const f = await queueFixture();
  try {
    let calls = 0;
    f.store.getEmbeddings = async () => { calls++; throw Object.assign(new HttpException('Fixture quota exhausted', 429), { retryAfterSeconds: 120, retryable: true }); };
    await f.enqueue(); await f.adapter.onApplicationBootstrap();
    await until(async () => (await f.ingestion.list('a'))[0].status === 'retry_wait', 'saved provider cooldown');
    assert.ok((await f.ingestion.list('a'))[0].nextAt >= Date.now() + 110000);
    for (let i = 0; i < 3; i++) await f.adapter.reconcile();
    await delay(200); assert.equal(calls, 1);
    const message = await f.db.beginMessage('b', 'chat', 'A completed answer?');
    await f.db.finishMessage('b', message, { draft: 'Original answer.', factCheck: { passed: true }, citations: [] });
    await f.revalidation.request('b', message);
    const reset = Date.now() + 3600000;
    await f.db.run('INSERT INTO auth_limits VALUES(?,?,?)', 'revalidation:hourly', 100, reset);
    await f.adapter.reconcile();
    await until(async () => (await f.revalidation.list('b')).jobs[0].nextAt === reset, 'budget deferral');
    assert.equal((await f.revalidation.list('b')).jobs[0].attempts, 0);
    assert.equal((await f.db.answerVersions('b', message)).length, 1);
  } finally { await f.close(); }
});

test('Redis disconnect preserves accepted SQL work and reconnect resumes delivery', { skip: !integration, timeout: 60000 }, async () => {
  const f = await queueFixture(), sockets = new Set<Socket>();
  const upstream = new URL(process.env.TEST_REDIS_URL!);
  assert.equal(upstream.protocol, 'redis:', 'This local fault-injection proxy uses the isolated plaintext test Redis');
  const proxy = tcpServer(socket => {
    const target = connect({ host: upstream.hostname, port: Number(upstream.port || 6379) });
    for (const stream of [socket, target]) { sockets.add(stream); stream.on('error', () => {}); stream.on('close', () => sockets.delete(stream)); }
    socket.pipe(target); target.pipe(socket);
    socket.on('close', () => target.destroy()); target.on('close', () => socket.destroy());
  });
  const listen = (port: number) => new Promise<void>(done => proxy.listen(port, '127.0.0.1', done));
  await listen(0); const port = (proxy.address() as { port: number }).port;
  process.env.QUEUE_REDIS_URL = `redis://127.0.0.1:${port}`;
  try {
    await f.adapter.onApplicationBootstrap();
    const closed = new Promise<void>(done => proxy.close(() => done()));
    for (const socket of sockets) socket.destroy(); await closed;
    await delay(150);
    await f.enqueue();
    await assert.rejects(f.adapter.reconcile());
    assert.equal((await f.ingestion.list('a'))[0].status, 'queued');
    await listen(port);
    await until(async () => (await f.ingestion.list('a'))[0].status === 'completed', 'Redis reconnect recovery', 35000);
    assert.equal((await f.db.readDocuments('a')).length, 1);
    const closedAgain = new Promise<void>(done => proxy.close(() => done()));
    for (const socket of sockets) socket.destroy(); await closedAgain;
    const stopping = Date.now(); await f.adapter.onModuleDestroy();
    assert.ok(Date.now() - stopping < 10000, 'Unavailable Redis must not prevent bounded worker shutdown');
  } finally {
    await f.close();
    for (const socket of sockets) socket.destroy();
    if (proxy.listening) await new Promise<void>(done => proxy.close(() => done()));
  }
});

test('persistent Redis restart retains queued IDs and resumes processing', { skip: !integration || !process.env.TEST_REDIS_CONTAINER, timeout: 60000 }, async () => {
  assert.equal(process.env.TEST_REDIS_CONTAINER, 'veriqon-m3b-redis', 'Restart only the explicitly owned disposable container');
  assert.equal(new URL(process.env.TEST_REDIS_URL!).hostname, '127.0.0.1');
  assert.equal(new URL(process.env.TEST_REDIS_URL!).port, '56379');
  const f = await queueFixture();
  try {
    await f.adapter.onApplicationBootstrap(); await f.queues[0].pause();
    const job = await f.enqueue(); await f.adapter.reconcile();
    assert.deepEqual((await f.queues[0].getJob(`sql-${job.id}`))!.data, { id: job.id });
    const restarted = spawnSync('docker', ['restart', 'veriqon-m3b-redis'], { timeout: 20000, windowsHide: true, encoding: 'utf8' });
    assert.equal(restarted.status, 0, 'Disposable Redis restart must succeed');
    await until(async () => { try { return Boolean(await f.queues[0].getJob(`sql-${job.id}`)); } catch { return false; } }, 'persisted queue reconnect');
    await f.queues[0].resume();
    await until(async () => (await f.ingestion.list('a'))[0].status === 'completed', 'index after Redis restart');
    assert.equal((await f.db.readDocuments('a')).length, 1);
  } finally { await f.close(); }
});

test('standalone workers recover checkpoint and post-commit crashes without duplicate publication', { skip: !integration, timeout: 360000 }, async () => {
  const f = await queueFixture(); const children: ChildProcess[] = [];
  let output = '', embeddings = 0, modelCalls = 0, pauseEmbeddings = true, dimensions = 2;
  const successfulInputs: string[] = [];
  const source = 'The method preserves backbone scores.';
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString());
    response.setHeader('content-type', 'application/json');
    if (request.url?.endsWith('/embeddings')) {
      const input = Array.isArray(body.input) ? body.input : [body.input];
      if (pauseEmbeddings && embeddings >= 2) return; // crash while the next batch is in flight
      embeddings += input.length; successfulInputs.push(...input);
      response.end(JSON.stringify({ data: input.map((_: unknown, index: number) => ({ index, embedding: [1,...Array(dimensions - 1).fill(0)] })) })); return;
    }
    modelCalls++;
    const prompt = body.messages[0].content as string;
    let content: string;
    if (prompt.startsWith('Decompose')) {
      const input = JSON.parse(body.messages.at(-1).content);
      content = JSON.stringify({ sentences: input.sentences.map((s: any) => ({ id: s.id, kind: 'FACTUAL', claims: [{ text: source, span: source }] })) });
    } else if (prompt.startsWith('Assess each')) {
      const input = JSON.parse(body.messages.at(-1).content);
      content = JSON.stringify({ conflicts: [], claims: input.facts.map((fact: any) => ({ id: fact.id, verdict: 'SUPPORTED',
        supporting: [{ index: input.evidence[0].index, quote: source }], contradicting: [], missingInformation: [], temporalValidity: 'UNKNOWN', scope: { time: null, place: null } })) });
    } else { content = source + ' [1]'; }
    response.end(JSON.stringify({ model: 'fixture-chat', choices: [{ finish_reason: 'stop', message: { content } }], usage: { prompt_tokens: 10, completion_tokens: 10 } }));
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const address = server.address() as { port: number };
  try {
    // Match the embedding identity to the isolated provider URL before staging data.
    process.env.OPENROUTER_BASE_URL = `http://127.0.0.1:${address.port}/v1`;
    const store = new VectorStoreService(f.db), ingestion = new IngestionService(f.db, store);
    const text = Array.from({ length: 100 }, (_, i) => source + ` Section ${i}.`).join('\n');
    const job = await ingestion.enqueue('a', 'paper', text, { name: 'paper.txt', mime: 'text/plain', bytes: Buffer.from(text) });
    cpSync(resolve('migrations'), join(f.directory, 'migrations'), { recursive: true });
    const childEnv = { ...process.env, JWT_SECRET: 'local-fixture-secret-'.repeat(3), SETUP_CODE: 'local-fixture-setup-'.repeat(3),
      SETUP_CODE_PATH: join(f.directory, 'setup.txt'), DOCUMENT_STORE_PATH: join(f.directory, 'absent.json'),
      DB_MIGRATE_ON_START: 'false', REDIS_URL: '', APP_ORIGINS: 'http://localhost:3001' };
    // Test-only preloader creates an actual crash window after SQL commit/before BullMQ acknowledgement.
    const preloader = join(f.directory, 'after-commit.cjs');
    writeFileSync(preloader, `require(${JSON.stringify(require.resolve('reflect-metadata'))});
const {RevalidationService}=require(${JSON.stringify(resolve('dist/src/rag/revalidation.service.js'))});
const original=RevalidationService.prototype.processJob;
RevalidationService.prototype.processJob=async function(id){await original.call(this,id);console.log('fixture_after_commit');await new Promise(()=>{});};`);
    const start = (preload?: string) => {
      const child = spawn(process.execPath, [...(preload ? ['--require', preload] : []), resolve('dist/src/worker.js')], { cwd: f.directory, env: childEnv, stdio: ['ignore','pipe','pipe'] });
      children.push(child); child.on('exit',(code,signal)=>{output+=JSON.stringify({childExit:code,signal});}); child.stdout!.on('data', b => { output = (output + String(b)).slice(-16000); }); child.stderr!.on('data', b => { output = (output + String(b)).slice(-16000); }); return child;
    };
    const stop = async () => {
      for (const child of children) if (child.exitCode === null && child.signalCode === null) {
        const exited = new Promise<void>(done => child.once('exit', () => done())); child.kill('SIGKILL'); await exited;
      }
    };
    start(); start(); // competing processes share SQL leases and global queue concurrency
    await until(async () => (await ingestion.list('a'))[0].completedChunks === 2, 'checkpoint before crash', 45000);
    const checkpoint = [...successfulInputs];
    await stop(); pauseEmbeddings = false;
    // Advance lease expiry in this isolated fixture instead of waiting four minutes.
    await f.db.run('UPDATE ingestion_jobs SET lease_until=0 WHERE id=?', job.id);
    await (await f.queues[0].getBackend().client).del(`${f.prefix}:ingestion:sql-${job.id}:lock`);
    const recoveryStarted = Date.now();
    start(preloader);
    await until(async () => (await ingestion.list('a'))[0].status === 'completed', 'checkpoint recovery', 120000);
    const checkpointRecoveryMs = Date.now() - recoveryStarted;
    assert.equal(embeddings, job.totalChunks, 'Saved embedding batches must not be repeated after restart');
    for (const input of checkpoint) assert.equal(successfulInputs.filter(value => value === input).length, 1);
    const message = await f.db.beginMessage('a', 'chat', 'What does the method preserve?');
    const original = { draft: source + ' [1]', status: 'supported', verificationStatus: 'VERIFIED_UNCHANGED',
      factCheck: { passed: true, claims: [] }, citations: [], sourceRevision: await f.db.revision('a'), repairHistory: [], modelUsage: [] };
    await f.db.finishMessage('a', message, original);
    await f.revalidation.request('a', message);
    await until(async () => (await f.revalidation.list('a')).jobs.some(j => j.messageId === message && j.status === 'completed'), 'standalone revalidation', 45000);
    const versions = await f.db.answerVersions('a', message);
    assert.equal(versions.length, 2); assert.ok(modelCalls >= 2);
    const saved = await f.db.get('SELECT result FROM answer_versions WHERE owner_id=? AND message_id=? AND sequence=1', 'a', message);
    const result = JSON.parse(String(saved!.result));
    assert.equal(result.verificationStatus, 'VERIFIED_UNCHANGED'); assert.equal(result.factCheck.passed, true);
    await assert.rejects(f.db.answerVersions('b', message), /not found/i);
    await until(async () => output.includes('fixture_after_commit'), 'post-commit crash window');
    const revalidationJob = (await f.revalidation.list('a')).jobs.find(j => j.messageId === message)!;
    assert.equal(await (await f.queues[1].getJob(`sql-${revalidationJob.id}`))!.getState(), 'active');
    await stop();
    await (await f.queues[1].getBackend().client).del(`${f.prefix}:revalidation:sql-${revalidationJob.id}:lock`);
    const callsBeforeReplay = modelCalls, replayStarted = Date.now();
    start();
    await until(async () => !(await f.queues[1].getJob(`sql-${revalidationJob.id}`)), 'post-commit delivery replay', 120000);
    assert.equal((await f.db.answerVersions('a', message)).length, 2);
    assert.equal(modelCalls, callsBeforeReplay, 'Replaying a committed job must not call the model again');
    assert.equal((await ingestion.list('a'))[0].id, job.id);
    assert.ok(!output.includes('Server listening'), 'Worker must not open an HTTP listener');
    console.log(JSON.stringify({ concurrentWorkers: 2, childProcesses: children.length, embeddings, modelCalls, answerVersions: versions.length, realPipeline: true, simulatedLeaseExpiry: true, checkpointRecoveryMs, postCommitRecoveryMs: Date.now() - replayStarted }));
    await stop();
    dimensions = 1536;
    process.env.EMBEDDING_BATCH_SIZE = '32'; process.env.EMBEDDING_JOB_BATCHES_PER_TURN = '1000';
    Object.assign(childEnv, { EMBEDDING_BATCH_SIZE: '32', EMBEDDING_JOB_BATCHES_PER_TURN: '1000' });
    const maximumText = (source + '\n').repeat(14000).slice(0, 500000);
    const maxStore = new VectorStoreService(f.db), maxIngestion = new IngestionService(f.db, maxStore);
    const maximum = await maxIngestion.enqueue('b', 'maximum', maximumText, { name: 'maximum.txt', mime: 'text/plain', bytes: Buffer.from(maximumText) });
    const memoryPreloader = join(f.directory, 'measure-worker.cjs');
    writeFileSync(memoryPreloader, `require(${JSON.stringify(require.resolve('reflect-metadata'))});
const {IngestionService}=require(${JSON.stringify(resolve('dist/src/rag/ingestion.service.js'))});
const original=IngestionService.prototype.processJob;
IngestionService.prototype.processJob=async function(id){await original.call(this,id);console.log('fixture_memory='+JSON.stringify({maxRssKiB:process.resourceUsage().maxRSS,heapUsed:process.memoryUsage().heapUsed}));};`);
    const maximumStarted = Date.now(); start(memoryPreloader);
    await until(async () => (await maxIngestion.list('b'))[0].status === 'completed' && output.includes('fixture_memory='), 'maximum supported input', 90000);
    const memory = JSON.parse(output.match(/fixture_memory=(\{[^\n]+\})/)![1]);
    assert.ok(memory.maxRssKiB < 512 * 1024, 'Maximum-input fixture must stay within its declared 512 MiB worker budget');
    assert.equal((await f.db.readDocuments('b'))[0].chunks.length, maximum.totalChunks);
    console.log(JSON.stringify({ maximumInput: maximumText.length, chunks: maximum.totalChunks, dimensions, workerPeakRssKiB: memory.maxRssKiB,
      workerHeapUsed: memory.heapUsed, elapsedMs: Date.now() - maximumStarted, queuedPayloadBytes: Buffer.byteLength(JSON.stringify({ id: maximum.id })) }));
  } catch (error) { console.error(output); console.error(JSON.stringify({ sql: await f.ingestion.list('a'), queue: await f.queues[0].getJobCounts(), jobs: (await f.queues[0].getJobs(['active','wait','failed'])).map(j => ({id:j.id,failedReason:j.failedReason,attemptsMade:j.attemptsMade})) })); throw error; }
  finally {
    for (const child of children) if (child.exitCode === null && child.signalCode === null) { const exited = new Promise<void>(done => child.once('exit', () => done())); child.kill('SIGKILL'); await exited; }
    server.closeAllConnections(); await new Promise<void>(done => server.close(() => done()));
    await f.close();
  }
});

test('API role never starts either background SQL consumer', async () => {
  const previous = { ...process.env };
  Object.assign(process.env, { NODE_ENV: 'development', VERIQON_PROCESS_ROLE: 'api', JOB_QUEUE_MODE: 'bullmq' });
  const db = { registerShutdown() {} } as any;
  const ingestion = new IngestionService(db, {} as any);
  const revalidation = new RevalidationService(db, {} as any);
  try {
    ingestion.onApplicationBootstrap(); revalidation.onApplicationBootstrap();
    assert.equal((ingestion as any).timer, undefined);
    assert.equal((revalidation as any).timer, undefined);
  } finally {
    await ingestion.onModuleDestroy(); await revalidation.onModuleDestroy(); process.env = previous;
  }
});
