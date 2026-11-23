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
  let closed = false;
  try {
    const healthResponse = await request('/rag/health');
    assert.equal(healthResponse.status, 200);
    const health = await healthResponse.json() as { capabilities: Record<string, boolean>; implementation: Record<string, any> };
    for (const partial of ['temporal', 'conflictDecisions', 'answerVersions', 'revalidation']) {
      assert.equal(health.capabilities[partial], true, `${partial} has an integrated local workflow`);
      assert.equal(health.implementation[partial].status, 'implemented');
    }
    assert.equal(health.implementation.temporal.archivedVersionRetrieval, true);
    assert.equal(health.implementation.conflictDecisions.uiIntegrated, true);
    assert.equal(health.implementation.answerVersions.uiIntegrated, true);
    assert.equal(health.implementation.revalidation.liveProviderVerified, false);
    assert.equal(health.implementation.revalidation.schedulerEnabled, false, 'Test processes do not start automatic revalidation');
    assert.equal((await request('/rag/docs')).status, 401);
    assert.equal((await request('/rag/query', { query: 'Hello' })).status, 401);
    assert.equal((await request('/auth/status')).status, 200);
    const owner = { email: 'OWNER@example.com', name: 'Owner', password };
    assert.equal((await request('/auth/register', owner)).status, 403, 'First owner needs the local setup code');
    const setupCode = process.env.SETUP_CODE || readFileSync(database.setupFile, 'utf8');
    // A transient storage failure must roll back owner setup, recovery codes and
    // account creation together, allowing an ordinary retry without lost codes.
    const originalRun = database.run.bind(database);
    database.run = async (sql, ...args) => {
      if (sql.startsWith('INSERT INTO sessions')) throw new Error('Injected session storage failure');
      return originalRun(sql, ...args);
    };
    try {
      await assert.rejects(app.get(AuthService).register(owner.email, owner.name, password, setupCode), /Injected session storage failure/);
      assert.equal(await database.hasUsers(), false);
      assert.equal(Number((await database.get('SELECT COUNT(*) AS count FROM recovery_codes'))!.count), 0);
      assert.equal(await database.get("SELECT value FROM settings WHERE key='legacy_imported'"), undefined);
    } finally { database.run = originalRun; }
    assert.equal((await request('/auth/register', { ...owner, setupCode, password: 'short' })).status, 400);
    assert.equal((await request('/auth/register', { ...owner, setupCode, role: 'owner' })).status, 400);
    assert.equal((await request('/auth/register', { ...owner, setupCode, name: 'Invalid\0name' })).status, 400);
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
    // Source comparisons remain visible even when no individual answer claim is CONFLICTED.
    // Use a distinct saved answer: completed assessments now retain audit records.
    const comparisonMessage = randomUUID();
    await database.beginMessage(ownerId, randomUUID(), 'Compare the experimental sources', comparisonMessage);
    await database.finishMessage(ownerId, comparisonMessage, {
      citations: [{ index: 1, documentId: 'a', source: 'a.docx', version: '1', chunkIndex: 0, excerpt: 'The adapter used two datasets.' }, { index: 2, documentId: 'b', source: 'b.docx', version: '2', chunkIndex: 0, excerpt: 'The adapter used three datasets.' }],
      factCheck: { atomicClaims: [], sourceConflicts: [{ id: 'evidence-1', claim: 'Experimental dataset count', scope: { time: 'same experiment', place: null }, reason: 'Competing results without established precedence.', supporting: [{ index: 1, quote: 'The adapter used two datasets.' }], contradicting: [{ index: 2, quote: 'The adapter used three datasets.' }] }] }
    });
    const sourceConflicts = await request('/rag/conflicts', undefined, ownerCookie).then(r => r.json()) as { records: { messageId: string; reason: string }[] };
    assert.equal(sourceConflicts.records.length, 2, 'Both saved assessments remain visible');
    assert.ok(sourceConflicts.records.some(record => record.messageId === conflictMessage));
    assert.equal(sourceConflicts.records.find(record => record.messageId === comparisonMessage)?.reason, 'Competing results without established precedence.');
    assert.equal((await database.answerVersions(ownerId, conflictMessage)).length, 1, 'Reading conflicts never rewrites the original answer');
    const linkedAnswer = await request(`/rag/messages/${conflictMessage}`, undefined, ownerCookie);
    assert.equal(linkedAnswer.status, 200); assert.match(linkedAnswer.headers.get('cache-control') || '', /no-store/);
    assert.equal((await linkedAnswer.json() as { message: { id: string } }).message.id, conflictMessage);
    assert.equal((await request(`/rag/messages/${conflictMessage}`, undefined, memberCookie)).status, 404);
    assert.equal((await request(`/rag/messages/${conflictMessage}`)).status, 401);
    assert.equal((await request('/rag/conflicts', undefined, memberCookie).then(r => r.json()) as { records: unknown[] }).records.length, 0, 'Conflict evidence is account-scoped');
    const contextConversation = randomUUID(), contextMessage = randomUUID();
    await database.beginMessage(ownerId, contextConversation, 'What is in my resume?', contextMessage);
    await database.finishMessage(ownerId, contextMessage, { verificationStatus: 'VERIFIED_UNCHANGED', factCheck: { passed: true }, draft: 'A researcher.', citations: [{ documentId: 'resume', source: 'resume.pdf', version: 'v1' }] });
    assert.equal((await database.conversationContext(ownerId, contextConversation))?.turns[0].answer, 'A researcher.');
    assert.equal(await database.conversationContext(memberId, contextConversation), undefined, 'Conversation context is account-scoped');
    const failedContextMessage = randomUUID();
    await database.beginMessage(ownerId, contextConversation, 'Failed follow-up', failedContextMessage);
    await database.finishMessage(ownerId, failedContextMessage, { verificationStatus: 'VERIFICATION_FAILED', factCheck: { passed: false }, draft: 'Unverified claim.' });
    assert.equal((await database.conversationContext(ownerId, contextConversation))?.turns.length, 1, 'Failed answers are never injected as conversation context');
    const conflictReference = randomUUID();
    await database.beginMessage(ownerId, contextConversation, 'According to note-b.txt, remote days?', conflictReference);
    await database.finishMessage(ownerId, conflictReference, { verificationStatus: 'UNRESOLVED_CONFLICT', factCheck: { passed: false }, draft: 'Unresolved claim that must not become evidence.' });
    const references = await database.conversationContext(ownerId, contextConversation);
    assert.ok(references?.sourceQuestions?.includes('According to note-b.txt, remote days?'));
    assert.equal(references?.turns.length, 1);
    assert.ok(!JSON.stringify(references?.turns).includes('Unresolved claim'));
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
    const versionPage = await request(`/rag/docs/${documentId}/version-history?limit=1`, undefined, ownerCookie);
    assert.equal(versionPage.status, 200);
    const versionSummary = await versionPage.json() as { items: { versionId: string; text?: string; chunks?: unknown[] }[] };
    assert.equal(versionSummary.items.length, 1);
    assert.equal(versionSummary.items[0].text, undefined); assert.equal(versionSummary.items[0].chunks, undefined);
    const versionPath = `/rag/docs/${documentId}/versions/${versionSummary.items[0].versionId}`;
    assert.equal((await request(versionPath, undefined, ownerCookie)).status, 200);
    assert.equal((await request(versionPath, undefined, memberCookie)).status, 404);
    assert.equal((await request(`/rag/docs/${documentId}/version-history`, undefined, memberCookie)).status, 404);
    assert.equal((await request(`/rag/docs/${documentId}/version-history?limit=999`, undefined, ownerCookie)).status, 400);
    assert.equal((await request(`/rag/docs/${documentId}/version-history?cursor=invalid`, undefined, ownerCookie)).status, 400);
    const savedConflict = (await database.conflicts(ownerId)).records[0];
    assert.equal((await request(`/rag/conflicts/${savedConflict.id}/decision-history`, undefined, ownerCookie)).status, 200);
    assert.equal((await request(`/rag/conflicts/${savedConflict.id}/decision-history`, undefined, memberCookie)).status, 404);
    assert.equal((await request(versionPath)).status, 401);
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
    const assessmentId = saved.messages[0].id;
    await database.auditKnowledge(ownerId, assessmentId, 'ANSWER_REVALIDATED_UNCHANGED', 'Controlled history fixture', { targetRevision: 1 });
    await database.auditKnowledge(ownerId, assessmentId, 'REVALIDATION_RETRY', 'Controlled retry fixture', { targetRevision: 2 });
    const answerVersionPath = `/rag/messages/${assessmentId}/version-history`;
    const originalVersion = (await database.answerVersions(ownerId, assessmentId))[0];
    for (const sequence of [1, 2]) await database.run('INSERT INTO answer_versions VALUES(?,?,?,?,?,?,?)', ownerId, assessmentId, sequence, JSON.stringify(originalVersion.result), 0, 'Pagination fixture', originalVersion.createdAt);
    const versionPageResponse = await request(answerVersionPath + '?limit=1', undefined, ownerCookie);
    assert.equal(versionPageResponse.status, 200, 'Bounded answer history must be reachable');
    const answerPage = await versionPageResponse.json() as { items: {sequence:number}[]; nextCursor: string };
    assert.equal(answerPage.items[0].sequence, 2); assert.ok(answerPage.nextCursor);
    const answerNext = await request(answerVersionPath + '?limit=1&cursor=' + encodeURIComponent(answerPage.nextCursor), undefined, ownerCookie).then(r=>r.json()) as typeof answerPage;
    assert.equal(answerNext.items[0].sequence, 1);
    const answerLast = await request(answerVersionPath + '?limit=1&cursor=' + encodeURIComponent(answerNext.nextCursor), undefined, ownerCookie).then(r=>r.json()) as typeof answerPage;
    assert.equal(answerLast.items[0].sequence, 0); assert.equal(answerLast.nextCursor, null);
    assert.equal((await request(answerVersionPath, undefined, memberCookie)).status, 404);
    assert.equal((await request(answerVersionPath)).status, 401);
    assert.equal((await request(answerVersionPath + '?limit=51', undefined, ownerCookie)).status, 400);
    assert.equal((await request(answerVersionPath + '?cursor=invalid', undefined, ownerCookie)).status, 400);
    const assessmentPath = `/rag/messages/${assessmentId}/revalidation-history`;
    const assessmentPage = await request(assessmentPath + '?limit=1', undefined, ownerCookie);
    assert.equal(assessmentPage.status, 200);
    const assessmentHistory = await assessmentPage.json() as { items: { id: string }[]; nextCursor: string };
    assert.equal(assessmentHistory.items.length, 1); assert.ok(assessmentHistory.nextCursor);
    const assessmentNext = await request(assessmentPath + '?limit=1&cursor=' + encodeURIComponent(assessmentHistory.nextCursor), undefined, ownerCookie).then(r => r.json()) as typeof assessmentHistory;
    assert.equal(assessmentNext.items.length, 1); assert.notEqual(assessmentNext.items[0].id, assessmentHistory.items[0].id);
    assert.equal((await request(assessmentPath, undefined, memberCookie)).status, 404);
    assert.equal((await request(assessmentPath)).status, 401);
    assert.equal((await request(assessmentPath + '?limit=999', undefined, ownerCookie)).status, 400);
    assert.equal((await request(assessmentPath + '?cursor=invalid', undefined, ownerCookie)).status, 400);
    assert.equal((await request('/rag/conversations', undefined, memberCookie).then(r => r.json()) as typeof history).some(c => c.id === conversationId), false);
    // Even a guessed conversation ID cannot append to another account's history.
    await request('/rag/query', { query: 'Member private question', conversationId }, memberCookie);
    assert.equal((await database.conversations(ownerId)).find(c => c.id === conversationId)!.messages.length, 2);
    assert.equal((await database.conversations(memberId)).find(c => c.id === conversationId)!.messages.length, 1);
    const originalGenerate = rag.generateAnswer;
    rag.generateAnswer = async () => { throw new Error('private-provider-token'); };
    const unavailable = await request('/rag/query', { query: 'Fail this request', conversationId }, ownerCookie);
    assert.equal(unavailable.status, 200);
    const unavailableResult = await unavailable.json() as { reason: string; factCheck: { passed: boolean }; citations: unknown[] };
    assert.equal(unavailableResult.reason, 'generation_failed'); assert.equal(unavailableResult.factCheck.passed, false);
    assert.ok(unavailableResult.citations.length > 0);
    rag.generateAnswer = originalGenerate;
    const failure = (await database.conversations(ownerId)).find(c => c.id === conversationId)!.messages[2];
    assert.ok('result' in failure && failure.result.reason === 'generation_failed');
    assert.deepEqual(failure.result.citations, unavailableResult.citations);
    assert.ok(!JSON.stringify(failure).includes('private-provider-token'));
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
    const replayAfterDelete = await request('/rag/query', payloadOnce, ownerCookie).then(r => r.json()) as { sourcesChanged: boolean };
    assert.equal(replayAfterDelete.sourcesChanged, true, 'Idempotent replay must mark changed sources like saved history does');
    assert.equal(generations, callsBefore + 1, 'A replay never performs new provider work');
    for (let i = 0; i < 20; i++) await database.limitWork('rate-fixture-owner');
    await assert.rejects(() => database.limitWork('rate-fixture-owner'), /20 operations/);
    // Failed lifecycle writes count too, and all three routes share the existing work quota.
    const limited = await request('/auth/register', {email:'lifecycle-limit@example.test',name:'Limit fixture',password});
    assert.equal(limited.status,201);
    const limitedCookie=cookies(limited);
    const lifecycleWrite = (i:number) => i%3===0
      ? fetch(origin+'/rag/docs/missing/metadata',{method:'PUT',headers:{Cookie:limitedCookie,'X-Veriqon-Request':'1','Content-Type':'application/json'},body:JSON.stringify({metadata:{},expectedRevision:0,reason:'Testing bounded lifecycle writes'})})
      : request(i%3===1?'/rag/messages/missing/revalidate':'/rag/conflicts/missing/decision',i%3===1?{}:{action:'KEEP_UNRESOLVED',expectedRevision:0,explanation:'Testing bounded lifecycle writes'},limitedCookie);
    for(let i=0;i<20;i++) assert.equal((await lifecycleWrite(i)).status,404);
    for(let i=20;i<23;i++) assert.equal((await lifecycleWrite(i)).status,429,'All lifecycle mutations must respect the shared budget');
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
    for (let i = 0; i < 120; i++) await auth.limitRefresh('isolated-refresh-address');
    await assert.rejects(auth.limitRefresh('isolated-refresh-address'), /Too many session/);
    const previousGet = database.get.bind(database);
    database.get = async () => { throw new Error('Malformed refresh must not query sessions'); };
    try { await assert.rejects(auth.refresh('malformed'), /session has expired/); }
    finally { database.get = previousGet; }
    await app.close();
    closed = true;
    // These are test assertions, not cleanup: do not mask an earlier failure
    // by checking records that the interrupted test never got to create.
    const reopened = new DatabaseService();
    try { assert.equal((await reopened.hasUsers()), true); assert.ok((await reopened.readDocuments(ownerId)).length >= 2); assert.ok((await reopened.conversations(ownerId)).some(c => c.messages.some(m => m.question === 'Saved question two' && 'result' in m && m.result))); } finally { await reopened.onModuleDestroy(); }
  } finally {
    try { if (!closed) await app.close(); } finally {
      for (const key of variables) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; }
      rmSync(directory, { recursive: true, force: true });
      if (admin) { await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); }
    }
  }
});
