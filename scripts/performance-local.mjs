/** Local storage/retrieval microbenchmark. No network, private data, or provider calls. */
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { cpus, totalmem } from 'node:os';
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { DatabaseService } = require('../dist/src/database/database.service.js');
const { VectorStoreService } = require('../dist/src/vector-store/vector-store.service.js');
const { chunkText } = require('../dist/src/common/utils.js');
Object.assign(process.env, { NODE_ENV: 'test', DATABASE_PATH: ':memory:', EMBEDDING_MODEL: 'benchmark', OPENROUTER_API_KEY: 'unused-offline' });
delete process.env.DATABASE_URL;
delete process.env.REDIS_URL;
const db = new DatabaseService();
const store = new VectorStoreService(db);
let embeddingCalls = 0;
store.getEmbedding = async () => { embeddingCalls++; return [1, 0]; };
const samples = 40;
const results = {};
async function measure(name, operation) {
  for (let i = 0; i < 5; i++) await operation();
  global.gc?.();
  const heapBefore = process.memoryUsage().heapUsed;
  const times = [];
  for (let i = 0; i < samples; i++) {
    const started = performance.now(); await operation(); times.push(performance.now() - started);
  }
  global.gc?.();
  const heapAfter = process.memoryUsage().heapUsed;
  times.sort((a, b) => a - b);
  let queries = 0, returnedBytes = 0;
  const all = db.all.bind(db);
  db.all = async (...args) => { const rows = await all(...args); queries++; returnedBytes += Buffer.byteLength(JSON.stringify(rows)); return rows; };
  try { await operation(); } finally { db.all = all; }
  results[name] = { samples, p50Ms: times[Math.ceil(samples * .5) - 1], p95Ms: times[Math.ceil(samples * .95) - 1], queriesPerOperation: queries,
    serializedSqlRowBytesPerOperation: returnedBytes, retainedHeapDeltaBytes: heapAfter - heapBefore };
}
try {
  await db.initialize();
  await db.run('INSERT INTO users(id,email,name,password_hash,role,created_at) VALUES(?,?,?,?,?,?)', 'bench', 'bench@example.test', 'Benchmark', 'unused', 'member', 1);
  const base = 'Engineering policy allows three remote days. '.repeat(1500).slice(0, 64000);
  await db.transaction(async () => {
    for (let i = 0; i < 80; i++) {
      const id = `doc-${i}`;
      await db.run('INSERT INTO documents(owner_id,id,text,source,version,embedding_model,created_at) VALUES(?,?,?,?,?,?,?)', 'bench', id, base, `${id}.txt`, `v-${i}`, store.embeddingConfig.identity, i);
      for (let c = 0; c < 20; c++) await db.run('INSERT INTO chunks VALUES(?,?,?,?,?,?,?,?)', 'bench', id, c, base.slice(c * 800, (c + 1) * 800), '[1,0]', `${id}.txt`, null, `v-${i}`);
    }
  });
  const sources = [0, 1].map(i => ({ documentId: `doc-${i}`, version: `v-${i}`, quote: 'Engineering policy allows three remote days.', index: i + 1, excerpt: base.slice(0, 800), chunkIndex: 0 }));
  await db.persistConflict('bench', { id: 'conflict', messageId: 'm', conversationId: 'c', question: 'Remote days?', detectedAt: new Date(0).toISOString(), claim: 'Remote days', status: 'UNRESOLVED', scope: { time: null, place: 'Engineering' }, temporalValidity: 'UNKNOWN', reason: 'Benchmark fixture', supporting: [sources[0]], contradicting: [sources[1]] });
  for (let i = 0; i < 12; i++) await db.updateMetadata('bench', 'doc-0', { effectiveFrom: '2024-01-01', scope: `Department ${i}` }, i, 'Benchmark explicit metadata revision');
  await measure('conflictReview', async () => { const r = await db.conflictRecords('bench'); assert.equal(r.records.length, 1); assert.equal(r.records[0].stale, true); });
  await measure('versionSummaryPage', async () => { const r = await db.documentVersionPage('bench', 'doc-0', 5); assert.equal(r.items.length, 5); assert.ok(r.nextCursor); });
  await measure('versionLegacyList', async () => { const r = await db.documentVersions('bench', 'doc-0'); assert.equal(r.length, 13); });
  await measure('lexicalRetrieval', async () => { const r = await db.lexicalDocuments('bench', 'Engineering remote days', 5); assert.ok(r.length); });
  await measure('sqliteDenseCandidates', async () => { const r = await db.candidateDocuments('bench', [1, 0], store.embeddingConfig.identity, 5, 'remote days', ['doc-0']); assert.equal(r.length, 1); assert.equal(r[0].chunks.length, 20); });
  await measure('hybridRetrieval', async () => { const r = await store.search('Engineering remote days', 5, undefined, 'bench'); assert.ok(r.length && r.length <= 5); });
  await measure('fourConcurrentConflictReads', async () => { const rs = await Promise.all(Array.from({ length: 4 }, () => db.conflictRecords('bench'))); assert.ok(rs.every(r => r.records.length === 1)); });
  await measure('chunking500k', async () => { assert.ok(chunkText(base.repeat(8).slice(0, 500000), 800, 120).length); });
  const report = { measuredAt: new Date().toISOString(), kind: 'offline SQLite storage/retrieval microbenchmark, not live RAG or backend/worker load', node: process.version,
    hardware: { platform: process.platform, cpu: cpus()[0]?.model, logicalCpus: cpus().length, memoryBytes: totalmem() },
    config: { documents: 80, charactersPerDocument: 64000, chunksPerDocument: 20, vectorDimensions: 2, snapshots: 13, samples, warmups: 5, inference: 'none; deterministic query vector', gcExposed: Boolean(global.gc) },
    results, peakProcessRssKiB: process.resourceUsage().maxRSS, finalMemoryBytes: process.memoryUsage(), embeddingFixtureCalls: embeddingCalls, llmCalls: 0, tokens: null };
  writeFileSync(process.argv[2] || 'data/performance-local.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally { await db.onModuleDestroy(); }
