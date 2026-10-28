import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { DatabaseService } from '../database/database.service';
import { RedisService } from '../common/redis.service';
import { VectorStoreService } from '../vector-store/vector-store.service';
import { validateEnvironment } from '../common/config';
import { sqliteSnapshot } from '../database/sqlite-snapshot';
import { DatabaseSync } from 'node:sqlite';

test('PostgreSQL migrations, isolated transactions, pgvector ranking, ownership, and restart persistence', async () => {
  assert.ok(process.env.TEST_DATABASE_URL, 'Set an explicit isolated TEST_DATABASE_URL');
  const schema = 'test_' + randomUUID().replace(/-/g, '');
  const admin = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  const previous = process.env.DATABASE_URL;
  await admin.query('CREATE EXTENSION IF NOT EXISTS vector');
  await admin.query(`CREATE SCHEMA ${schema}`);
  const url = new URL(process.env.TEST_DATABASE_URL!); url.searchParams.set('options', `-c search_path=${schema},public`);
  process.env.DATABASE_URL = url.toString();
  const first = new DatabaseService(), second = new DatabaseService();
  try {
    await Promise.all([first.initialize(), second.initialize()]);
    for (const id of ['a','b']) await first.run('INSERT INTO users(id,email,name,password_hash,role,created_at) VALUES(?,?,?,?,?,?)', id, `${id}@example.test`, id, 'unused', 'member', Date.now());
    await assert.rejects(first.transaction(async () => {
      await first.run("INSERT INTO settings VALUES('rollback','no')");
      await second.run("INSERT INTO settings VALUES('committed','yes')");
      throw new Error('rollback fixture');
    }), /rollback fixture/);
    assert.equal(await second.get("SELECT value FROM settings WHERE key='rollback'"), undefined);
    assert.equal((await second.get("SELECT value FROM settings WHERE key='committed'"))!.value, 'yes');
    const store = new VectorStoreService(first);
    store.getEmbeddings = async texts => texts.map(() => [1,0]);
    store.getEmbedding = async () => [1,0];
    await store.addDocument('shared-id', 'Owner A source', { source: 'a.txt' }, 'a', { name: 'a.txt', mime: 'text/plain', bytes: Buffer.from('Owner A source') });
    await store.addDocument('shared-id', 'Owner B private text', { source: 'b.txt' }, 'b');
    const result = await store.search('source', 3, undefined, 'a');
    assert.equal(result.length, 1); assert.equal(result[0].text, 'Owner A source');
    const neighbors = ['Architecture description.', 'Most relevant passage.', 'Important continuation.'];
    await first.writeDocument('a', { id: 'paper', text: neighbors.join(' '), chunks: neighbors.map((content, index) => ({ content, index, chunkId: `paper#${index}`, embedding: index === 1 ? [1,0] : [0,1] })) });
    const candidates = await first.candidateDocuments('a', [1,0], 'unused', 1).catch(() => []);
    assert.equal(candidates.length, 0, 'Changed embedding model is rejected instead of mixing embeddings');
    const windows = await first.candidateDocuments('a', [1,0], process.env.EMBEDDING_MODEL || 'openai/text-embedding-3-small', 1);
    assert.equal(windows.find(doc => doc.id === 'paper')!.chunks.length, 3);
    await assert.rejects(first.candidateDocuments('a', [1,0,0], 'unused', 1), /embedding model changed/);
    await assert.rejects(second.deleteDocument('b', 'paper'), /not found/);
    await first.onModuleDestroy();
    const reopened = new VectorStoreService(second);
    assert.equal((await reopened.getOriginal('a', 'shared-id')).bytes.toString(), 'Owner A source');
    assert.equal((await reopened.getAllDocs('a')).length, 2);
    await second.deleteDocument('a', 'paper');
    assert.equal(Number((await second.get("SELECT COUNT(*) AS count FROM chunks WHERE document_id='paper'"))!.count), 0);
  } finally {
    await first.onModuleDestroy(); await second.onModuleDestroy();
    if (previous === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previous;
    await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end();
  }
});

test('two Redis clients share atomic rate limits and admission leases; failures release slots', async () => {
  assert.ok(process.env.TEST_REDIS_URL);
  process.env.REDIS_URL = process.env.TEST_REDIS_URL;
  process.env.REDIS_PREFIX = 'test_' + randomUUID();
  const first = new RedisService(), second = new RedisService();
  await Promise.all([first.onModuleInit(), second.onModuleInit()]);
  try {
    const limits = await Promise.allSettled(Array.from({ length: 12 }, (_, i) => (i % 2 ? first : second).limit('same-user', 10, 1000, 'rate exceeded')));
    assert.equal(limits.filter(result => result.status === 'fulfilled').length, 10);
    let release!: () => void;
    let entered!: () => void;
    const ready = new Promise<void>(resolve => { entered = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    const running = first.run('same-owner', async () => { entered(); await gate; });
    await ready;
    await assert.rejects(second.run('same-owner', async () => undefined), /Another operation/);
    const gates = ['b', 'c', 'd'].map(owner => second.run(owner, () => gate));
    // Wait until all three leases have actually been acquired before testing capacity.
    await new Promise(resolve => setTimeout(resolve, 100));
    await assert.rejects(first.run('e', async () => undefined), /server is busy/);
    release(); await Promise.all([running, ...gates]);
    await assert.rejects(first.run('same-owner', async () => { throw new Error('task failure'); }), /task failure/);
    assert.equal(await second.run('same-owner', async () => 'released'), 'released');
    await first.onModuleDestroy();
    await assert.rejects(first.run('offline', async () => 'must not run'), /unavailable/);
  } finally { await first.onModuleDestroy(); await second.onModuleDestroy(); delete process.env.REDIS_URL; delete process.env.REDIS_PREFIX; }
});

test('cloud settings reject ephemeral databases, weak secrets, and insecure public origins', () => {
  assert.throws(() => validateEnvironment({ NODE_ENV: 'production' }), /DATABASE_URL/);
  const env = { NODE_ENV: 'production', DATABASE_URL: 'postgresql://user:pass@db/db', REDIS_URL: 'rediss://cache:6379', JWT_SECRET: 'x'.repeat(48), SETUP_CODE: 'y'.repeat(48), APP_ORIGINS: 'https://app.example.com' };
  assert.doesNotThrow(() => validateEnvironment(env));
  assert.throws(() => validateEnvironment({ ...env, APP_ORIGINS: 'http://app.example.com' }), /HTTPS/);
  assert.throws(() => validateEnvironment({ ...env, APP_ORIGINS: 'https://app.example.com/path' }), /HTTPS/);
  assert.throws(() => validateEnvironment({ ...env, AUTH_COOKIE_SECURE: 'false' }), /Secure/);
  assert.throws(() => validateEnvironment({ ...env, SETUP_CODE: env.JWT_SECRET }), /different/);
});


test('SQLite cutover preserves file bytes and history, refuses nonempty targets, and leaves source unchanged', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'veriqon-import-'));
  const filename = join(directory, 'source.sqlite');
  const schema = 'test_' + randomUUID().replace(/-/g, '');
  const admin = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  const previous = { DATABASE_URL: process.env.DATABASE_URL, DATABASE_PATH: process.env.DATABASE_PATH };
  delete process.env.DATABASE_URL; process.env.DATABASE_PATH = filename;
  const source = new DatabaseService();
  try {
    await source.run("INSERT INTO users(id,email,name,password_hash,role,created_at) VALUES('fixture','fixture@example.test','Fixture','unused','owner',0)");
    await source.writeDocument('fixture', { id: 'file', text: 'Original', chunks: [{ index: 0, chunkId: 'file#0', content: 'Original', embedding: [1,0] }] }, { bytes: Buffer.from('Original'), name: 'original.txt', mime: 'text/plain' });
    const message = await source.beginMessage('fixture', 'conversation', 'Saved question');
    await source.finishMessage('fixture', message, { draft: 'Saved answer', citations: [{ excerpt: 'Original' }] });
    await source.onModuleDestroy();
    const before = readFileSync(filename);
    await admin.query('CREATE EXTENSION IF NOT EXISTS vector');
    await admin.query(`CREATE SCHEMA ${schema}`);
    const url = new URL(process.env.TEST_DATABASE_URL!); url.searchParams.set('options', `-c search_path=${schema},public`);
    const env = { ...process.env, DATABASE_URL: url.toString(), NODE_ENV: 'test' };
    const snapshotPath = join(directory, 'snapshot.sqlite');
    await sqliteSnapshot(filename, snapshotPath);
    await assert.rejects(sqliteSnapshot(filename, snapshotPath), /EEXIST/);
    const snapshot = new DatabaseSync(snapshotPath, { readOnly: true });
    try { assert.equal(snapshot.prepare('PRAGMA journal_mode').get()!.journal_mode, 'delete'); }
    finally { snapshot.close(); }
    const command = ['dist/scripts/import-sqlite.js', `--from=${snapshotPath}`];
    const imported = await promisify(execFile)(process.execPath, command, { env });
    assert.match(imported.stdout, /Import committed/);
    await assert.rejects(promisify(execFile)(process.execPath, command, { env }));
    assert.deepEqual(readFileSync(filename), before);
    process.env.DATABASE_URL = url.toString();
    const target = new DatabaseService();
    try {
      assert.equal((await new VectorStoreService(target).getOriginal('fixture', 'file')).bytes.toString(), 'Original');
      assert.equal((await target.conversations('fixture'))[0].messages[0].question, 'Saved question');
      assert.equal(Number((await target.get('SELECT COUNT(*) AS count FROM users'))!.count), 1);
      assert.equal(Number((await target.get('SELECT COUNT(*) AS count FROM sessions'))!.count), 0);
    } finally { await target.onModuleDestroy(); }
  } finally {
    await source.onModuleDestroy();
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await admin.end();
    rmSync(directory, { recursive: true, force: true });
  }
});
