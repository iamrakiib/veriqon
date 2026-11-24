/** Bounded local PostgreSQL retrieval soak. No provider calls or application database. */
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { cpus } from 'node:os';
const require = createRequire(import.meta.url);
const { Pool } = require('pg');
const { DatabaseService } = require('../dist/src/database/database.service.js');
const { VectorStoreService } = require('../dist/src/vector-store/vector-store.service.js');
const url = new URL(process.env.TEST_DATABASE_URL || 'http://invalid');
assert.equal(url.hostname, '127.0.0.1', 'Use the disposable compose.test.yaml database');
assert.equal(url.port, '55432');
assert.equal(url.pathname, '/veriqon_test');
const schema = 'load_' + randomUUID().replaceAll('-', '');
const admin = new Pool({ connectionString: url.toString(), max: 1 });
const workload = { owners: 4, documentsPerOwner: 20, chunksPerDocument: 16, dimensions: 1536,
  concurrency: 4, durationMs: 60000, pausePerClientMs: 100 };
// Declared before execution; a small local release check, not a public capacity promise.
const gates = { minOperations: 200, p95Ms: 2000, errors: 0, retainedHeapGrowthBytes: 64 * 1024 * 1024 };
const report = { kind: 'local PostgreSQL retrieval short soak; no inference, API or queue throughput',
  startedAt: new Date().toISOString(), node: process.version, cpu: cpus()[0]?.model, workload, gates,
  inferenceCalls: 0, tokens: null, apiCost: null, passed: false };
let db, store, created = false;
try {
  await admin.query('CREATE EXTENSION IF NOT EXISTS vector');
  await admin.query(`CREATE SCHEMA ${schema}`); created = true;
  url.searchParams.set('options', `-c search_path=${schema},public`);
  Object.assign(process.env, { NODE_ENV: 'test', DATABASE_URL: url.toString(), DB_MIGRATE_ON_START: 'true',
    VERIQON_PROCESS_ROLE: 'integrated', JOB_QUEUE_MODE: 'sql', EMBEDDING_MODEL: 'load-fixture',
    OPENROUTER_API_KEY: 'synthetic-unused', OPENROUTER_BASE_URL: 'http://127.0.0.1:9' });
  delete process.env.REDIS_URL;
  db = new DatabaseService(); await db.initialize(); store = new VectorStoreService(db);
  const vector = Array.from({ length: workload.dimensions }, (_, i) => i === 0 ? 1 : 0);
  store.getEmbedding = async () => vector;
  for (let owner = 0; owner < workload.owners; owner++) {
    const id = `owner-${owner}`;
    await db.run('INSERT INTO users(id,email,name,password_hash,role,created_at) VALUES(?,?,?,?,?,?)', id, `${id}@example.test`, id, 'unused', 'member', Date.now());
    for (let document = 0; document < workload.documentsPerOwner; document++) {
      const documentId = `${id}-doc-${document}`;
      const chunks = Array.from({ length: workload.chunksPerDocument }, (_, index) => ({ index,
        chunkId: `${documentId}#${index}`, content: `Owner ${owner} document ${document} passage ${index}. Engineering permits three remote days.`,
        embedding: vector, version: `fixture-${owner}-${document}`, source: `${documentId}.txt` }));
      await db.writeDocument(id, { id: documentId, text: chunks.map(c => c.content).join('\n'),
        embeddingModel: store.embeddingConfig.identity, chunks });
    }
  }
  const operation = async owner => {
    const hits = await store.search('Engineering remote days', 3, undefined, `owner-${owner}`);
    assert.ok(hits.length > 0 && hits.length <= 3);
    for (const hit of hits) assert.ok(hit.id.startsWith(`owner-${owner}-doc-`), 'Cross-owner retrieval');
  };
  for (let i = 0; i < 8; i++) await operation(i % workload.owners);
  global.gc?.();
  const heapBefore = process.memoryUsage().heapUsed, started = performance.now(), times = [];
  let errors = 0;
  await Promise.all(Array.from({ length: workload.concurrency }, async (_, owner) => {
    while (performance.now() - started < workload.durationMs) {
      const begin = performance.now();
      try { await operation(owner); } catch { errors++; }
      times.push(performance.now() - begin);
      await delay(workload.pausePerClientMs);
    }
  }));
  global.gc?.(); times.sort((a,b) => a-b);
  report.results = { operations: times.length, errors, elapsedMs: performance.now()-started,
    p50Ms: times[Math.ceil(times.length*.5)-1], p95Ms: times[Math.ceil(times.length*.95)-1],
    retainedHeapGrowthBytes: process.memoryUsage().heapUsed-heapBefore, peakNodeRssKiB: process.resourceUsage().maxRSS,
    gcExposed: Boolean(global.gc), databaseBytes: Number((await admin.query('SELECT pg_database_size(current_database()) AS bytes')).rows[0].bytes) };
  assert.ok(global.gc, 'Run with --expose-gc for a comparable retained-heap check');
  assert.ok(times.length >= gates.minOperations, 'Too few operations');
  assert.equal(errors, gates.errors, 'Retrieval or isolation failure');
  assert.ok(report.results.p95Ms < gates.p95Ms, 'Retrieval p95 exceeded the predefined local gate');
  assert.ok(report.results.retainedHeapGrowthBytes < gates.retainedHeapGrowthBytes, 'Retained heap exceeded the predefined local gate');
  report.passed = true;
} catch (error) {
  report.error = error instanceof assert.AssertionError ? error.message : 'Storage load setup/execution failed; inspect disposable database connectivity.';
  process.exitCode = 1;
} finally {
  await db?.onModuleDestroy();
  if (created) await admin.query(`DROP SCHEMA ${schema} CASCADE`);
  await admin.end();
  mkdirSync('data', { recursive: true });
  writeFileSync('data/storage-load.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
}
