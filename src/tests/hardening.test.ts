import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes, randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { Pool } from 'pg';
import { AppModule } from '../app.module';
import { DatabaseService } from '../database/database.service';
import { VectorStoreService } from '../vector-store/vector-store.service';
import { MAX_FILE_BYTES } from '../rag/document-parser';
import { RagService } from '../rag/rag.service';
import { answerSentences } from '../rag/verification';
import { historyCursor, readHistoryCursor } from '../database/history-cursor';
import { IngestionService } from '../rag/ingestion.service';

test('history cursors reject malformed input and preserve timestamp ties', () => {
  assert.deepEqual(readHistoryCursor(historyCursor(123, 'message-1')), [123, 'message-1']);
  for (const cursor of ['', '!', 'a'.repeat(301), historyCursor(-1, 'x'), historyCursor(1, 'x\' OR 1=1'), Buffer.from('[1,{}]').toString('base64url')]) {
    assert.throws(() => readHistoryCursor(cursor), /Invalid history cursor/);
  }
});

test('HTTP hardening: account switching, bounded complete history, upload admission, abort recovery and grounded repair', async () => {
  const previous = { ...process.env }, directory = mkdtempSync(join(tmpdir(), 'veriqon-hardening-'));
  Object.assign(process.env, { NODE_ENV: 'test', DATABASE_PATH: join(directory, 'app.sqlite'), DOCUMENT_STORE_PATH: join(directory, 'absent.json'), SETUP_CODE_PATH: join(directory, 'setup.txt'),
    SETUP_CODE: randomBytes(32).toString('hex'), JWT_SECRET: randomBytes(48).toString('hex'), OPENROUTER_API_KEY: 'synthetic-test-only', ALLOW_REGISTRATION: 'true', APP_ORIGINS: 'http://localhost:3001' });
  delete process.env.DATABASE_URL; delete process.env.REDIS_URL;
  const admin = process.env.TEST_DATABASE_URL ? new Pool({ connectionString: process.env.TEST_DATABASE_URL }) : undefined;
  const schema = 'test_' + randomUUID().replace(/-/g, '');
  if (admin) {
    await admin.query('CREATE EXTENSION IF NOT EXISTS vector'); await admin.query(`CREATE SCHEMA ${schema}`);
    const url = new URL(process.env.TEST_DATABASE_URL!); url.searchParams.set('options', `-c search_path=${schema},public`); process.env.DATABASE_URL = url.toString();
  }
  const app = await NestFactory.create(AppModule, { logger: false });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  const store = app.get(VectorStoreService), database = app.get(DatabaseService);
  const ingestion = app.get(IngestionService);
  ingestion.onApplicationBootstrap = () => {}; // Drive the real worker explicitly in this fixture.
  store.getEmbeddings = async texts => texts.map(() => [1, 0]);
  await app.listen(0, '127.0.0.1');
  const origin = await app.getUrl();
  const register = async (email: string) => {
    const response = await fetch(origin + '/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Veriqon-Request': '1' }, body: JSON.stringify({ email, name: 'Fixture', password: 'synthetic testing password', setupCode: process.env.SETUP_CODE }) });
    assert.equal(response.status, 201);
    return { id: (await response.json() as { user: { id: string } }).user.id, cookie: response.headers.getSetCookie().map(c => c.split(';')[0]).join('; ') };
  };
  try {
    const a = await register('a@example.test'), b = await register('b@example.test');
    const headers = { Cookie: a.cookie, 'X-Veriqon-Request': '1', 'X-Veriqon-Account': a.id };
    const get = (path: string, cookie = a.cookie) => fetch(origin + path, { headers: { Cookie: cookie } });
    // Simulate an old tab using account A's view after the shared browser cookie became B's.
    for (const path of ['/rag/docs', '/auth/recovery-codes']) {
      const response = await fetch(origin + path, { headers: { ...headers, Cookie: b.cookie } });
      assert.equal(response.status, 409); assert.equal((await response.json() as { code: string }).code, 'ACCOUNT_CHANGED');
    }
    const switchedWrite = await fetch(origin + '/rag/add', { method: 'POST', headers: { ...headers, Cookie: b.cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'should-not-exist', text: 'An old tab draft' }) });
    assert.equal(switchedWrite.status, 409);
    assert.equal(Number((await database.get('SELECT COUNT(*) AS count FROM documents'))!.count), 0);

    const archive = (body: unknown, customHeaders: Record<string,string> = headers) => fetch(origin + '/rag/conflicts/archive', {method:'POST',headers:{...customHeaders,'Content-Type':'application/json'},body:JSON.stringify(body)});
    assert.equal((await archive({records:[{id:'missing',expectedRevision:0}]},{})).status,403,'Writes without the request header are rejected before authentication');
    assert.equal((await archive({records:[{id:'missing',expectedRevision:0}]},{'X-Veriqon-Request':'1'})).status,401);
    for (const body of [{},{records:[]},{records:[null]},{records:[{id:'x',expectedRevision:-1}]},{records:[{id:'x',expectedRevision:0,ownerId:b.id}]}]) {
      assert.equal((await archive(body)).status,400,'Archive requests require validated, bounded, owner-independent record references');
    }
    const archiveFixture = {id:'archive-fixture',messageId:'none',conversationId:'none',question:'Days?',claim:'Days differ',detectedAt:new Date().toISOString(),status:'UNRESOLVED' as const,scope:{time:null,place:null},temporalValidity:'UNKNOWN' as const,reason:'Fixture',supporting:[],contradicting:[]};
    await database.persistConflict(a.id,archiveFixture);
    assert.equal((await archive({records:[{id:archiveFixture.id,expectedRevision:1}]},{Cookie:b.cookie,'X-Veriqon-Request':'1','X-Veriqon-Account':b.id})).status,404);
    assert.equal((await archive({records:[{id:archiveFixture.id,expectedRevision:0}]})).status,409);
    assert.equal((await archive({records:[{id:archiveFixture.id,expectedRevision:1}]})).status,200);
    assert.equal((await archive({records:[{id:archiveFixture.id,expectedRevision:1}]})).status,200);
    assert.equal((await get('/rag/conflicts').then(r=>r.json()) as {records:unknown[]}).records.length,0);
    assert.equal((await database.knowledgeEvents(a.id,archiveFixture.id)).length,1);

    const ids = Array.from({ length: 25 }, () => randomUUID());
    for (const id of ids) await database.beginMessage(a.id, id, 'Stored question', randomUUID());
    // Tied times exercise the stable cursor ordering, independently of wall-clock speed.
    await database.run('UPDATE conversations SET updated_at=? WHERE owner_id=?', 1000, a.id);
    const longId = ids[0];
    await database.run('DELETE FROM messages WHERE owner_id=? AND conversation_id=?', a.id, longId);
    for (let i = 0; i < 47; i++) {
      const messageId = `message-${String(i).padStart(3, '0')}`;
      await database.beginMessage(a.id, longId, `Question ${i}`, messageId);
      await database.finishMessage(a.id, messageId, { draft: `Answer ${i}`, sourceRevision: 0 });
    }
    await database.run('UPDATE messages SET created_at=? WHERE owner_id=? AND conversation_id=?', 2000, a.id, longId);
    const first = await get('/rag/conversations').then(r => r.json()) as Awaited<ReturnType<DatabaseService['conversations']>>;
    assert.equal(first.length, 20); assert.equal(first[0].hasMoreConversations, true);
    const second = await get('/rag/conversations?before=' + first.at(-1)!.cursor).then(r => r.json()) as typeof first;
    assert.equal(second.length, 5); assert.equal(second[0].hasMoreConversations, false);
    assert.equal(new Set([...first, ...second].map(c => c.id)).size, 25);
    const long = first.find(c => c.id === longId)!;
    assert.equal(long.messages.length, 10);
    const middleResponse = await get(`/rag/conversations/${longId}/messages?before=${long.olderMessagesCursor}`);
    const middle = await middleResponse.json() as Awaited<ReturnType<DatabaseService['conversationMessages']>>;
    assert.equal(middle.messages.length, 30);
    const oldest = await get(`/rag/conversations/${longId}/messages?before=${middle.olderMessagesCursor}`).then(r => r.json()) as typeof middle;
    assert.equal(oldest.messages.length, 7); assert.equal(oldest.olderMessagesCursor, null);
    const all = [...oldest.messages, ...middle.messages, ...long.messages];
    assert.equal(new Set(all.map(m => m.id)).size, 47); assert.equal(all[0].question, 'Question 0'); assert.equal(all.at(-1)!.question, 'Question 46');
    assert.equal((await get(`/rag/conversations/${longId}/messages`, b.cookie)).status, 404);
    assert.equal((await get('/rag/conversations?before=invalid!')).status, 400);
    assert.equal((await get('/rag/conversations?before[]=invalid')).status, 400);
    assert.equal(Number((await database.get('SELECT COUNT(*) AS count FROM messages WHERE owner_id=? AND conversation_id=?', a.id, longId))!.count), 47, 'Pagination never deletes old messages');

    // Headers alone must be sufficient to reject an oversized upload: do not read its body.
    const rejected = await new Promise<number>((resolve, reject) => {
      const req = httpRequest(origin + '/rag/upload', { method: 'POST', headers: { ...headers, 'Content-Type': 'multipart/form-data; boundary=test', 'Content-Length': String(MAX_FILE_BYTES + 100000) } }, response => { response.resume(); resolve(response.statusCode!); req.destroy(); });
      req.on('error', reject); req.flushHeaders();
    });
    assert.equal(rejected, 413);
    const held = httpRequest(origin + '/rag/upload', { method: 'POST', headers: { ...headers, 'Content-Type': 'multipart/form-data; boundary=test' } });
    held.on('error', () => undefined);
    held.write('--test\r\nContent-Disposition: form-data; name="file"; filename="held.txt"\r\nContent-Type: text/plain\r\n\r\n');
    try {
      await delay(100);
      const blocked = await fetch(origin + '/rag/upload', { method: 'POST', headers });
      assert.equal(blocked.status, 429, 'A second upload is rejected before the first body finishes');
    } finally { held.destroy(); }
    await delay(100);
    const upload = new FormData(); upload.append('file', new Blob(['A bounded upload.']), 'small.txt');
    const uploaded = await fetch(origin + '/rag/upload', { method: 'POST', headers, body: upload });
    assert.equal(uploaded.status, 201);
    await database.deleteDocument(a.id, (await uploaded.json() as { id: string }).id);

    const queuedFile = new FormData(); queuedFile.append('file', new Blob(['A large handbook. '.repeat(7000)]), 'handbook.txt');
    const accepted = await fetch(origin + '/rag/uploads', { method: 'POST', headers, body: queuedFile });
    assert.equal(accepted.status, 202);
    const job = await accepted.json() as { id: string; status: string; documentId: string };
    assert.equal(job.status, 'queued');
    assert.equal((await get('/rag/docs').then(r => r.json()) as unknown[]).length, 0, 'Queued sources are not searchable');
    assert.deepEqual(await get('/rag/uploads', b.cookie).then(r => r.json()), []);
    assert.equal((await fetch(origin + `/rag/uploads/${job.id}`, { method: 'DELETE', headers: { Cookie: b.cookie, 'X-Veriqon-Request': '1' } })).status, 404);
    assert.equal((await fetch(origin + `/rag/uploads/${job.id}/retry`, { method: 'POST', headers: { Cookie: b.cookie, 'X-Veriqon-Request': '1' } })).status, 404);
    assert.equal((await fetch(origin + '/rag/uploads')).status, 401);
    await ingestion.tick();
    assert.equal((await get('/rag/uploads').then(r => r.json()) as { status: string }[])[0].status, 'completed');
    assert.equal((await get('/rag/docs').then(r => r.json()) as unknown[]).length, 1);
    await database.deleteDocument(a.id, job.documentId);
    assert.deepEqual(await ingestion.list(a.id), [], 'Deleting the source also removes its queue receipt');

    // Real HTTP/auth/ingestion/retrieval/persistence and production orchestration; only LLM transport
    // is deterministic. This demonstrates wiring and correction policy, NOT real-model accuracy.
    const source = 'The adapter was evaluated on three datasets. Training used frozen backbone weights.';
    const initial = 'The adapter was evaluated on five datasets. Training used frozen backbone weights.';
    const corrected = 'The adapter was evaluated on three datasets. [1] Training used frozen backbone weights.';
    const plan = (text: string) => ({ sentences: answerSentences(text).map(s => ({ id: s.id, kind: 'FACTUAL', claims: [{ text: s.text.replace(/\s*\[\d+\]/g, ''), span: s.text.replace(/\s*\[\d+\]/g, '') }] })) });
    const assessment = (text: string, bad: boolean) => ({ conflicts: [], claims: plan(text).sentences.map(s => ({ id: `s${s.id}c1`, verdict: bad && s.id === 1 ? 'CONTRADICTED' : 'SUPPORTED', supporting: bad && s.id === 1 ? [] : [{ index: 1, quote: source }], contradicting: bad && s.id === 1 ? [{ index: 1, quote: source }] : [], missingInformation: [], temporalValidity: 'UNKNOWN', scope: { time: null, place: null } })) });
    const completions: unknown[] = [initial, plan(initial), assessment(initial, true), { corrections: [{ claimId: 's1c1', replacement: 'The adapter was evaluated on three datasets.', evidence: [{ index: 1, quote: source }] }] }, plan(corrected), assessment(corrected, false)];
    const rag = app.get(RagService);
    Object.defineProperty(rag, 'client', { value: { chat: { completions: { create: async () => {
      assert.ok(completions.length, 'Unexpected extra model work');
      const response = completions.shift();
      return { model: 'controlled-fixture', choices: [{ finish_reason: 'stop', message: { content: typeof response === 'string' ? response : JSON.stringify(response) } }] };
    } } } } });
    const add = await fetch(origin + '/rag/add', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'annotated-paper', source: 'fixture-paper.txt', text: source }) });
    assert.equal(add.status, 201);
    const conversationId = randomUUID();
    const response = await fetch(origin + '/rag/query', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: 'How many datasets were evaluated?', conversationId }) });
    assert.equal(response.status, 200, await response.clone().text());
    const answer = await response.json() as { draft: string; verificationStatus: string; repairHistory: { accepted: boolean }[]; citations: { version: string }[] };
    assert.equal(answer.verificationStatus, 'REPAIRED_VERIFIED'); assert.equal(answer.draft, corrected);
    assert.equal(answer.repairHistory[0].accepted, true); assert.match(answer.citations[0].version, /^sha256:/);
    assert.equal(completions.length, 0, 'Correction includes decomposition and final verification');
    const persisted = await get(`/rag/conversations/${conversationId}/messages`).then(r => r.json()) as Awaited<ReturnType<DatabaseService['conversationMessages']>>;
    assert.ok('result' in persisted.messages[0]);
    assert.equal(persisted.messages[0].result.draft, corrected);

    // In-flight retries must not spend provider work twice or overwrite a saved message.
    // A different simultaneous query is rejected by admission control and can retry later.
    rag.equivalentQuestions = async () => false;
    let release!: () => void, started!: () => void, generations = 0;
    const hold = new Promise<void>(resolve => { release = resolve; });
    const entered = new Promise<void>(resolve => { started = resolve; });
    rag.generateAnswer = async () => { generations++; started(); await hold; return source; };
    completions.push(plan(source), assessment(source, false));
    const pending = { query: 'Concurrent audit of dataset count and training?', conversationId: randomUUID(), messageId: randomUUID() };
    const post = (body: unknown) => fetch(origin + '/rag/query', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const firstRequest = post(pending);
    try {
      await Promise.race([entered, delay(5000).then(() => { throw new Error('Controlled generation did not start'); })]);
      assert.equal((await post(pending)).status, 409, 'The same in-flight message is not processed twice');
      assert.equal((await post({ query: 'Another simultaneous question' })).status, 429);
      assert.equal(Number((await database.get('SELECT COUNT(*) AS count FROM messages WHERE owner_id=? AND id=?', a.id, pending.messageId))!.count), 1);
    } finally { release(); }
    const completed = await firstRequest;
    assert.equal(completed.status, 200);
    const completedBody = await completed.json() as { verificationStatus: string; draft: string; sourcesChanged?: boolean };
    assert.equal(completedBody.verificationStatus, 'VERIFIED_UNCHANGED');
    assert.equal(generations, 1);
    assert.deepEqual(await post(pending).then(r => r.json()), completedBody, 'Completed retries return the persisted result');
    assert.equal((await post({ ...pending, query: 'Reused ID with changed question' })).status, 409);
    await database.deleteDocument(a.id, 'annotated-paper');
    const replayAfterDeletion = await post(pending).then(r => r.json()) as typeof completedBody;
    assert.equal(replayAfterDeletion.sourcesChanged, true);
    assert.equal(replayAfterDeletion.draft, completedBody.draft, 'Historical content is preserved with an explicit stale-source flag');
    assert.equal(generations, 1, 'Replay does not regenerate from a deleted source');
    assert.equal((await post({ query: '   ' })).status, 400);
    assert.equal((await post({ query: ['Not a string'] })).status, 400);
    assert.equal((await post({ query: 'Invalid\0question' })).status, 400);
    for (const invalid of [{ page: 2147483648 }, { id: 'bad\0id' }, { text: 'bad\0text' }, { source: 'bad\0source' }, { version: 'bad\0version' }]) {
      const response = await fetch(origin + '/rag/add', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'invalid-input', text: 'Valid test content.', ...invalid }) });
      assert.equal(response.status, 400, JSON.stringify(invalid));
    }
    assert.equal(await database.get('SELECT id FROM documents WHERE owner_id=? AND id=?', a.id, 'invalid-input'), undefined);
  } finally {
    await app.close();
    if (admin) { await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); }
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous); rmSync(directory, { recursive: true, force: true });
  }
});
