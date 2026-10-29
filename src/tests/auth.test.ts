import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomBytes, randomUUID } from 'crypto';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Pool } from 'pg';
import { AppModule } from '../app.module';
import { DatabaseService } from '../database/database.service';
import { VectorStoreService } from '../vector-store/vector-store.service';
import { RagService } from '../rag/rag.service';
import { AuthService } from '../auth/auth.service';

test('real HTTP authentication, migration, private uploads, refresh, revocation and persistence', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'veriqon-auth-'));
  const variables = ['DATABASE_URL', 'REDIS_URL', 'REDIS_PREFIX', 'SETUP_CODE', 'DATABASE_PATH', 'DOCUMENT_STORE_PATH', 'SETUP_CODE_PATH', 'JWT_SECRET', 'ALLOW_REGISTRATION', 'NODE_ENV', 'APP_ORIGINS', 'AUTH_COOKIE_SECURE'] as const;
  const previous = Object.fromEntries(variables.map(key => [key, process.env[key]]));
  Object.assign(process.env, { DATABASE_PATH: join(directory, 'test.sqlite'), DOCUMENT_STORE_PATH: join(directory, 'legacy.json'), SETUP_CODE_PATH: join(directory, 'setup.txt'), JWT_SECRET: randomBytes(48).toString('hex'), ALLOW_REGISTRATION: 'true', NODE_ENV: 'test', APP_ORIGINS: 'http://localhost:3001', AUTH_COOKIE_SECURE: 'false' });
  const schema = 'test_' + randomUUID().replace(/-/g, '');
  const admin = process.env.TEST_DATABASE_URL ? new Pool({ connectionString: process.env.TEST_DATABASE_URL }) : undefined;
  if (admin) {
    await admin.query('CREATE EXTENSION IF NOT EXISTS vector');
    await admin.query(`CREATE SCHEMA ${schema}`);
    const url = new URL(process.env.TEST_DATABASE_URL!); url.searchParams.set('options', `-c search_path=${schema},public`);
    process.env.DATABASE_URL = url.toString();
    process.env.SETUP_CODE = randomBytes(32).toString('hex');
    if (process.env.TEST_REDIS_URL) { process.env.REDIS_URL = process.env.TEST_REDIS_URL; process.env.REDIS_PREFIX = schema; }
  } else { delete process.env.DATABASE_URL; delete process.env.REDIS_URL; delete process.env.SETUP_CODE; }
  const legacy = JSON.stringify([{ id: 'legacy', text: 'Historical paper.', chunks: [{ chunkId: 'legacy#0', index: 0, content: 'Historical paper.', source: 'old.pdf', embedding: [1, 0] }] }]);
  writeFileSync(process.env.DOCUMENT_STORE_PATH!, legacy);
  const app = await NestFactory.create(AppModule, { logger: false });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  const store = app.get(VectorStoreService);
  store.getEmbeddings = async texts => texts.map(() => [1, 0]);
  store.getEmbedding = async () => [1, 0];
  const rag = app.get(RagService);
  let generations = 0;
  rag.generateAnswer = async () => { generations++; return 'Historical paper.'; };
  rag.factCheck = async () => ({ passed: true, verdict: 'Supported', evidence: 'Fixture evidence', claims: [{ sentence: 'Historical paper.', supported: true, evidenceIndexes: [1] }] });
  const database = app.get(DatabaseService);
  const password = 'a long testing password 123';
  await app.listen(0, '127.0.0.1');
  const origin = await app.getUrl();
  const cookies = (response: Response) => response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  const request = (path: string, body?: unknown, cookie = '', extras: Record<string, string> = {}) => fetch(origin + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'X-Veriqon-Request': '1', Cookie: cookie, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...extras }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  let ownerId = '';
  try {
    assert.equal((await request('/rag/health')).status, 200);
    assert.equal((await request('/rag/docs')).status, 401);
    assert.equal((await request('/rag/query', { query: 'Hello' })).status, 401);
    assert.equal((await request('/auth/status')).status, 200);
    const owner = { email: 'OWNER@example.com', name: 'Owner', password };
    assert.equal((await request('/auth/register', owner)).status, 403, 'First owner needs the local setup code');
    const setupCode = process.env.SETUP_CODE || readFileSync(database.setupFile, 'utf8');
    assert.equal((await request('/auth/register', { ...owner, setupCode, password: 'short' })).status, 400);
    assert.equal((await request('/auth/register', { ...owner, setupCode, role: 'owner' })).status, 400);
    const registration = await request('/auth/register', { ...owner, setupCode });
    assert.equal(registration.status, 201, await registration.clone().text());
    let ownerCookie = cookies(registration);
    const ownerBody = await registration.json() as { user: { id: string; role: string; email: string }; access?: string };
    ownerId = ownerBody.user.id;
    assert.equal(ownerBody.user.role, 'owner'); assert.equal(ownerBody.user.email, 'owner@example.com'); assert.equal(ownerBody.access, undefined);
    for (const header of registration.headers.getSetCookie()) { assert.match(header, /HttpOnly/); assert.match(header, /SameSite=Lax/i); }
    assert.equal((await request('/auth/status').then(r => r.json()) as { needsSetup: boolean }).needsSetup, false);
    assert.match(String((await database.get('SELECT password_hash FROM users WHERE id=?', ownerId))?.password_hash), /^scrypt\$/);
    assert.ok(!String((await database.get('SELECT password_hash FROM users WHERE id=?', ownerId))?.password_hash).includes(password));
    assert.equal(readFileSync(database.legacyFile, 'utf8'), legacy, 'Legacy snapshot is preserved');
    assert.equal((await store.getAllDocs(ownerId)).length, 1);
    assert.equal((await store.getAllDocs(ownerId))[0].hasOriginal, false);
    assert.equal((await request('/auth/register', { ...owner, setupCode })).status, 409);
    const member = await request('/auth/register', { name: 'Member', email: 'member@example.com', password });
    assert.equal(member.status, 201);
    const memberCookie = cookies(member);
    const memberId = (await member.json() as { user: { id: string } }).user.id;
    assert.equal((await request('/rag/conflicts')).status, 401);
    const conflictMessage = randomUUID();
    await database.beginMessage(ownerId, randomUUID(), 'Conflicting experimental counts?', conflictMessage);
    await database.finishMessage(ownerId, conflictMessage, {
      citations: [{ index: 1, documentId: 'a', source: 'a.docx', version: '1', chunkIndex: 0, excerpt: 'The adapter used two datasets.' }, { index: 2, documentId: 'b', source: 'b.docx', version: '2', chunkIndex: 0, excerpt: 'The adapter used three datasets.' }],
      factCheck: { atomicClaims: [{ id: 's1c1', text: 'The adapter used two datasets.', verdict: 'CONFLICTED', scope: { time: null, place: null }, temporalValidity: 'UNKNOWN', supporting: [{ index: 1, quote: 'The adapter used two datasets.' }], contradicting: [{ index: 2, quote: 'The adapter used three datasets.' }] }] }
    });
    const conflicts = await request('/rag/conflicts', undefined, ownerCookie).then(r => r.json()) as { records: { messageId: string; status: string }[] };
    assert.equal(conflicts.records.length, 1); assert.equal(conflicts.records[0].messageId, conflictMessage); assert.equal(conflicts.records[0].status, 'UNRESOLVED');
    assert.equal((await request('/rag/conflicts', undefined, memberCookie).then(r => r.json()) as { records: unknown[] }).records.length, 0, 'Conflict evidence is account-scoped');
    assert.deepEqual(await request('/rag/docs', undefined, memberCookie).then(r => r.json()), []);
    const noDocs = await request('/rag/query', { query: 'Hello' }, memberCookie).then(r => r.json()) as { reason: string };
    assert.equal(noDocs.reason, 'no_documents'); assert.equal(generations, 0);
    assert.equal((await request('/rag/query', { query: 'Hello' }, ownerCookie, { Origin: 'https://evil.example' })).status, 403);
    assert.equal((await request('/rag/query', { query: 'Hello' }, ownerCookie, { 'X-Veriqon-Request': '' })).status, 403);
    assert.equal((await request('/rag/query', { query: 'Hello', ownerId }, memberCookie)).status, 400);
    const bytes = readFileSync(join('tests', 'fixtures', 'policy.pdf'));
    const upload = new FormData(); upload.append('file', new Blob([bytes]), 'policy.pdf');
    const uploaded = await fetch(origin + '/rag/upload', { method: 'POST', body: upload, headers: { Cookie: ownerCookie, 'X-Veriqon-Request': '1' } });
    assert.equal(uploaded.status, 201, await uploaded.clone().text());
    const documentId = (await uploaded.json() as { id: string }).id;
    const download = await request(`/rag/docs/${documentId}/file`, undefined, ownerCookie);
    assert.equal(download.status, 200); assert.match(download.headers.get('content-disposition')!, /^attachment;/);
    assert.deepEqual(Buffer.from(await download.arrayBuffer()), bytes);
    assert.equal((await request(`/rag/docs/${documentId}/file`, undefined, memberCookie)).status, 404);
    assert.equal((await request(`/rag/docs/${documentId}/file`)).status, 401);
    assert.equal((await request('/rag/save', {}, ownerCookie)).status, 404);
    assert.equal((await request('/rag/load', {}, ownerCookie)).status, 404);
    for (let i = 0; i < 2; i++) assert.equal((await request('/rag/query', { query: 'Explain the paper' }, ownerCookie)).status, 200);
    assert.equal(generations, 1, 'Repeated supported answer uses the owner-specific cache');
    await store.addDocument('new', 'Additional source', undefined, ownerId);
    await request('/rag/query', { query: 'Explain the paper' }, ownerCookie);
    assert.equal(generations, 2, 'A document change invalidates the answer cache');
    await store.addDocument('member-doc', 'Member only', undefined, memberId);
    await request('/rag/query', { query: 'Explain the paper' }, memberCookie);
    assert.equal(generations, 3, 'Another account never receives the owner cached answer');
    assert.deepEqual((await store.getAllDocs(memberId)).map(d => d.id), ['member-doc']);
    const conversationId = randomUUID();
    assert.equal((await request('/rag/conversations')).status, 401);
    assert.equal((await request('/rag/query', { query: 'Hello', conversationId: 'invalid' }, ownerCookie)).status, 400);
    for (const query of ['Saved question one', 'Saved question two']) {
      assert.equal((await request('/rag/query', { query, conversationId }, ownerCookie)).status, 200);
    }
    const history = await request('/rag/conversations', undefined, ownerCookie).then(r => r.json()) as Awaited<ReturnType<DatabaseService['conversations']>>;
    const saved = history.find(c => c.id === conversationId)!;
    assert.equal(saved.messages.length, 2); assert.equal(saved.title, 'Saved question one');
    assert.equal(saved.messages[1].question, 'Saved question two');
    assert.ok('result' in saved.messages[0] && saved.messages[0].result.citations.length > 0);
    assert.equal((await request('/rag/conversations', undefined, memberCookie).then(r => r.json()) as typeof history).some(c => c.id === conversationId), false);
    // Even a guessed conversation ID cannot append to another account's history.
    await request('/rag/query', { query: 'Member private question', conversationId }, memberCookie);
    assert.equal((await database.conversations(ownerId)).find(c => c.id === conversationId)!.messages.length, 2);
    assert.equal((await database.conversations(memberId)).find(c => c.id === conversationId)!.messages.length, 1);
    const originalGenerate = rag.generateAnswer;
    rag.generateAnswer = async () => { throw new Error('private-provider-token'); };
    assert.equal((await request('/rag/query', { query: 'Fail this request', conversationId }, ownerCookie)).status, 502);
    rag.generateAnswer = originalGenerate;
    const failure = (await database.conversations(ownerId)).find(c => c.id === conversationId)!.messages[2];
    assert.ok('error' in failure && failure.error); assert.ok(!failure.error.includes('private-provider-token'));
    const idempotentId = randomUUID(), idempotentConversation = randomUUID();
    const payloadOnce = { query: 'Idempotent question', conversationId: idempotentConversation, messageId: idempotentId };
    const callsBefore = generations;
    const firstResponse = await request('/rag/query', payloadOnce, ownerCookie);
    assert.equal(firstResponse.status, 200);
    assert.deepEqual(await request('/rag/query', payloadOnce, ownerCookie).then(r => r.json()), await firstResponse.json());
    assert.equal(generations, callsBefore + 1);
    assert.equal((await database.conversations(ownerId)).find(c => c.id === idempotentConversation)!.messages.length, 1);
    assert.equal((await request('/rag/query', { ...payloadOnce, query: 'Different question' }, ownerCookie)).status, 409);
    const deleteFile = (cookie: string) => fetch(origin + `/rag/docs/${documentId}`, { method: 'DELETE', headers: { Cookie: cookie, 'X-Veriqon-Request': '1' } });
    assert.equal((await deleteFile(memberCookie)).status, 404);
    assert.equal((await deleteFile(ownerCookie)).status, 200);
    assert.equal((await request(`/rag/docs/${documentId}/file`, undefined, ownerCookie)).status, 404);
    const oldAnswer = (await database.conversations(ownerId)).find(c => c.id === idempotentConversation)!.messages[0];
    assert.ok('result' in oldAnswer && oldAnswer.result.sourcesChanged);
    for (let i = 0; i < 20; i++) await database.limitWork('rate-fixture-owner');
    await assert.rejects(() => database.limitWork('rate-fixture-owner'), /20 operations/);
    const renewed = await request('/auth/refresh', {}, ownerCookie);
    assert.equal(renewed.status, 200);
    assert.equal((await request('/auth/refresh', {}, ownerCookie)).status, 401, 'Rotated refresh tokens cannot be replayed');
    ownerCookie = cookies(renewed);
    assert.equal((await request('/auth/me', undefined, ownerCookie)).status, 200);
    const validToken = decodeURIComponent(ownerCookie.match(/vq_access=([^;]+)/)![1]);
    const jwt = new JwtService();
    const payload = jwt.decode<{ sub: string; sid: string }>(validToken);
    const expired = jwt.sign({ sub: payload.sub, sid: payload.sid }, { secret: process.env.JWT_SECRET, expiresIn: -1, issuer: 'veriqon', audience: 'veriqon-web' });
    assert.equal((await request('/auth/me', undefined, '', { Authorization: `Bearer ${expired}` })).status, 401);
    assert.equal((await request('/auth/me', undefined, '', { Authorization: 'Bearer tampered' })).status, 401);
    assert.equal((await request('/auth/logout', {}, ownerCookie)).status, 200);
    assert.equal((await request('/auth/me', undefined, ownerCookie)).status, 401, 'Logout revokes even unexpired JWTs');
    assert.equal((await request('/auth/login', { email: owner.email, password: 'wrong' })).status, 401);
    const loggedIn = await request('/auth/login', { email: owner.email, password });
    assert.equal(loggedIn.status, 200);
    assert.equal((await request('/rag/docs', undefined, cookies(loggedIn))).status, 200);
    assert.equal((await request('/rag/conversations', undefined, cookies(loggedIn)).then(r => r.json()) as typeof history).find(c => c.id === conversationId)!.messages.length, 3);
    const busyLogins = await Promise.all(Array.from({ length: 3 }, () => request('/auth/login', { email: 'busy@example.test', password: 'wrong password' })));
    assert.ok(busyLogins.some(response => response.status === 429), 'Memory-hard password work is bounded');
    assert.ok(busyLogins.every(response => [401, 429].includes(response.status)));
    process.env.ALLOW_REGISTRATION = 'false';
    assert.equal((await request('/auth/register', { email: 'third@example.com', name: 'Third', password })).status, 403);
    const auth = app.get(AuthService);
    for (let i = 0; i < 10; i++) await auth.limit('isolated-test-address', 'limit@example.com');
    await assert.rejects(() => auth.limit('isolated-test-address', 'limit@example.com'), /Too many/);
  } finally {
    await app.close();
    try {
      const reopened = new DatabaseService();
      try { assert.equal((await reopened.hasUsers()), true); assert.ok((await reopened.readDocuments(ownerId)).length >= 2); assert.ok((await reopened.conversations(ownerId)).some(c => c.messages.some(m => m.question === 'Saved question two' && 'result' in m && m.result))); } finally { await reopened.onModuleDestroy(); }
    } finally {
      for (const key of variables) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; }
      rmSync(directory, { recursive: true, force: true });
      if (admin) { await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); }
    }
  }
});
