import 'reflect-metadata';
import { test, after } from 'node:test';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { providerError, withProviderRetry } from '../common/provider';
import { extractDocument, MAX_FILE_BYTES } from '../rag/document-parser';
import assert from 'node:assert/strict';
import { Module, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { RagService, parseVerification, Verification, completionText } from '../rag/rag.service';
import { RagController } from '../rag/rag.controller';
import { VectorStoreService, joinPassages } from '../vector-store/vector-store.service';
import { DatabaseService, OriginalFile } from '../database/database.service';
import { WorkLimiter } from '../common/work-limiter';
import { chunkText } from '../common/utils';

// Unit fixtures must never inherit a caller's deployed database or Redis connection.
delete process.env.DATABASE_URL;
delete process.env.REDIS_URL;
process.env.NODE_ENV = 'test';

const passage = { id: 'policy', text: 'Remote work is permitted one day a week.', source: 'policy.md', score: 1, chunkIndex: 0 };
const pass: Verification = { verdict: 'Supported', evidence: 'One day.', claims: [{ sentence: 'One day.', supported: true, evidenceIndexes: [1] }], passed: true };
const fail: Verification = { verdict: 'Not supported', evidence: 'Missing evidence.', claims: [], passed: false };

function pipeline(docs = [passage]) {
  const store = { search: async () => docs, revision: () => 0 } as unknown as VectorStoreService;
  return new RagService(store);
}

test('verification fails closed for malformed, omitted and invented evidence', () => {
  const sentence = 'One day.';
  for (const raw of ['not json', '{}', '{"claims":[]}', JSON.stringify({ claims: [{ sentence, supported: true, evidenceIndexes: [] }] }), JSON.stringify({ claims: [{ sentence, supported: true, evidenceIndexes: [2] }] }), JSON.stringify({ claims: [{ sentence: 'Changed sentence.', supported: true, evidenceIndexes: [1] }] })]) {
    assert.equal(parseVerification(raw, [sentence], 1).passed, false);
  }
  assert.equal(parseVerification(JSON.stringify({ claims: pass.claims }), ['One day.'], 1).passed, true);
});

test('unsupported claim in an otherwise supported answer prevents passing', () => {
  assert.equal(parseVerification(JSON.stringify({ claims: [...pass.claims, { sentence: 'Three days.', supported: false, evidenceIndexes: [] }] }), ['One day.', 'Three days.'], 1).passed, false);
});

test('empty retrieval abstains without invoking the model', async () => {
  const rag = pipeline([]);
  rag.generateAnswer = async () => { throw new Error('Must not call generation'); };
  const result = await rag.queryPipeline('What is the policy?');
  assert.equal(result.status, 'abstained');
  assert.equal(result.citations.length, 0);
});

test('supported answer includes exact source passage and stable document reference', async () => {
  const rag = pipeline(); rag.generateAnswer = async () => 'One day.'; rag.factCheck = async () => pass;
  const result = await rag.queryPipeline('How many days?');
  assert.equal(result.status, 'supported');
  assert.equal(result.citations[0].documentId, 'policy');
  assert.equal(result.citations[0].excerpt, passage.text);
  assert.equal(result.correction, null);
});

test('repair uses failed draft, rechecks, and preserves the original in the response', async () => {
  const rag = pipeline(); let checks = 0;
  rag.generateAnswer = async (_query, _docs, failedDraft) => failedDraft ? 'One day.' : 'Three days.';
  rag.factCheck = async () => ++checks === 1 ? fail : pass;
  const result = await rag.queryPipeline('How many days?');
  assert.equal(result.status, 'repaired'); assert.equal(checks, 2);
  assert.equal(result.correction?.original, 'Three days.'); assert.equal(result.draft, 'One day.');
});

test('second failed assessment abstains instead of returning unsupported text', async () => {
  const rag = pipeline(); let attempts = 0;
  rag.generateAnswer = async () => { attempts++; return 'Three days.'; };
  rag.factCheck = async () => fail;
  const result = await rag.queryPipeline('How many days?');
  assert.equal(attempts, 2); assert.equal(result.status, 'abstained');
  assert.ok(!result.draft.includes('Three days')); assert.equal(result.correction, null);
});

test('provider failures are returned without secret or document detail', async () => {
  const rag = pipeline(); rag.generateAnswer = async () => { throw new Error('secret-provider-token'); };
  await assert.rejects(rag.queryPipeline('Question'), error => error instanceof Error && !error.message.includes('secret-provider-token'));
});

test('failed replacement leaves the original document searchable', async () => {
  const store = testStore(); store.getEmbedding = async () => [1, 0]; store.getEmbeddings = async texts => texts.map(() => [1, 0]);
  await store.addDocument('a', 'Original source');
  store.getEmbeddings = async () => { throw new Error('Provider unavailable'); };
  await assert.rejects(store.addDocument('a', 'Replacement source'));
  assert.equal((await store.getAllDocs())[0].text, 'Original source');
});

test('bulk ingestion reports actual successes and failures', async () => {
  const store = testStore(); store.getEmbeddings = async texts => texts.map(text => { if (text === 'bad') throw new Error('Failure'); return [1, 0]; });
  const result = await store.bulkAdd([{ id: 'a', text: 'good' }, { id: 'b', text: 'bad' }]);
  assert.equal(result.success, false); assert.equal(result.count, 1); assert.equal(result.errors[0].id, 'b');
});

test('invalid chunk configuration cannot create an infinite loop', () => {
  for (const args of [[0, 0], [10, 10], [10, 11], [NaN, 0]]) assert.throws(() => chunkText('content', args[0], args[1]));
  assert.deepEqual(chunkText('abcdefgh', 4, 1), ['abcd', 'defg', 'gh']);
});

test('HTTP routes enforce input validation and preserve the legacy API contract', async () => {
  const store = testStore(); store.getEmbedding = async () => [1, 0]; store.getEmbeddings = async texts => texts.map(() => [1, 0]);
  @Module({ controllers: [RagController], providers: [{ provide: DatabaseService, useValue: store.testDatabase }, { provide: VectorStoreService, useValue: store }, { provide: RagService, useValue: pipeline([]) }] })
  class TestModule {}
  const app = await NestFactory.create(TestModule, { logger: false });
  app.use((request: { user?: unknown }, _response: unknown, next: () => void) => { request.user = { id: 'test-user' }; next(); });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.listen(0, '127.0.0.1');
  const origin = await app.getUrl();
  const post = (path: string, body: unknown) => fetch(`${origin}/rag/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    assert.equal((await post('query', { query: 123 })).status, 400);
    assert.equal((await post('query', { query: 'valid', workspaceId: 'other-tenant' })).status, 400);
    assert.equal((await post('query', { query: 'x'.repeat(4001) })).status, 400);
    assert.equal((await post('add', { id: 'a', text: 'source', page: -1 })).status, 400);
    assert.equal((await post('bulk-add', { documents: [] })).status, 400);
    assert.equal((await post('add', { id: 'a', text: 'source', source: 'sample.md' })).status, 201);
    const docs = await (await fetch(`${origin}/rag/docs`)).json() as { source: string }[]; assert.equal(docs[0].source, 'sample.md');
    const query = await (await post('query', { query: 'question' })).json() as { status: string }; assert.equal(query.status, 'abstained');
    assert.equal((await fetch(`${origin}/rag/health`)).status, 200);
    for (const filename of ['policy.pdf', 'policy.docx']) {
      const body = new FormData(); body.append('file', new Blob([readFileSync(join('tests', 'fixtures', filename))]), filename);
      const response = await fetch(`${origin}/rag/upload`, { method: 'POST', body });
      assert.equal(response.status, 201, await response.text());
      const retry = new FormData(); retry.append('file', new Blob([readFileSync(join('tests', 'fixtures', filename))]), filename);
      assert.equal((await fetch(`${origin}/rag/upload`, { method: 'POST', body: retry })).status, 201);
    }
    assert.equal((await store.getAllDocs()).length, 3, 'retrying the same upload must not duplicate documents');
    const invalid = new FormData(); invalid.append('file', new Blob(['invalid']), 'bad.pdf');
    assert.equal((await fetch(`${origin}/rag/upload`, { method: 'POST', body: invalid })).status, 400);
  } finally { await app.close(); }
});

const testDirectory = mkdtempSync(join(tmpdir(), 'veriqon-tests-'));
const databases: DatabaseService[] = [];
after(async () => { for (const database of databases) await database.onModuleDestroy(); rmSync(testDirectory, { recursive: true, force: true }); });
let storeNumber = 0;
class TestStore extends VectorStoreService {
  constructor(readonly testDatabase: DatabaseService) { super(testDatabase); }
  override addDocument(id: string, text: string, meta?: { source?: string; page?: number; version?: string }, owner = 'test-user', file?: OriginalFile) { return super.addDocument(id, text, meta, owner, file); }
  override search(query: string, topK = 5, signal?: AbortSignal, owner = 'test-user') { return super.search(query, topK, signal, owner); }
  override getAllDocs(owner = 'test-user') { return super.getAllDocs(owner); }
  override bulkAdd(docs: Parameters<VectorStoreService['bulkAdd']>[0], owner = 'test-user') { return super.bulkAdd(docs, owner); }
}
function testStore(file = join(testDirectory, `store-${++storeNumber}.sqlite`)) {
  const previous = process.env.DATABASE_PATH;
  process.env.DATABASE_PATH = file;
  const database = new DatabaseService(); databases.push(database);
  if (previous === undefined) delete process.env.DATABASE_PATH; else process.env.DATABASE_PATH = previous;
  database.db.prepare("INSERT OR IGNORE INTO users(id,email,name,password_hash,role,created_at) VALUES('test-user','test@example.com','Test','unused','owner',0)").run();
  return new TestStore(database);
}

test('full libraries reject new documents before spending embedding quota and allow replacements', async () => {
  const store = testStore(); let embeddings = 0;
  store.getEmbeddings = async texts => { embeddings++; return texts.map(() => [1, 0]); };
  for (let i = 0; i < 100; i++) await store.testDatabase.writeDocument('test-user', { id: `doc-${i}`, text: 'Original', chunks: [] });
  await assert.rejects(store.addDocument('over-limit', 'New text'), /library limit/);
  assert.equal(embeddings, 0);
  await store.addDocument('doc-0', 'Replacement text');
  assert.equal(embeddings, 1);
  assert.equal((await store.getAllDocs()).length, 100);
  // The final write must enforce the limit even if concurrent work fills the library after preflight.
  await assert.rejects(store.testDatabase.writeDocument('test-user', { id: 'race', text: 'New', chunks: [] }), /library limit/);
});

test('library byte quotas count UTF-8 text bytes consistently in SQLite', async () => {
  const store = testStore();
  // Existing source bytes leave two bytes free; a three-byte character must exceed the cap.
  await store.testDatabase.run('INSERT INTO documents(owner_id,id,text,original_file,created_at) VALUES(?,?,?,?,?)', 'test-user', 'large', '€', Buffer.alloc(100 * 1024 * 1024 - 5), 0);
  await assert.rejects(store.testDatabase.preflightDocument('test-user', 'new', '€'), /library limit/);
});

test('PDF and DOCX parsers extract text; invalid and oversized files fail clearly', async () => {
  for (const originalname of ['policy.pdf', 'policy.docx']) {
    const buffer = readFileSync(join('tests', 'fixtures', originalname));
    assert.match(await extractDocument({ originalname, buffer, size: buffer.length }), /one day per week/);
  }
  for (const originalname of ['invalid.pdf', 'invalid.docx', 'unsupported.exe']) {
    await assert.rejects(extractDocument({ originalname, buffer: Buffer.from('invalid'), size: 7 }));
  }
  await assert.rejects(extractDocument({ originalname: 'big.txt', buffer: Buffer.from('x'), size: MAX_FILE_BYTES + 1 }), /10 MB/);
  await assert.rejects(extractDocument({ originalname: 'blank.txt', buffer: Buffer.from(' '), size: 1 }), /No readable text/);
  await assert.rejects(extractDocument({ originalname: 'long.txt', buffer: Buffer.from('x'.repeat(100001)), size: 100001 }), /100,000/);
});

test('concurrent indexing persists all documents and reload restores the library', async () => {
  const file = join(testDirectory, 'concurrent.sqlite');
  const store = testStore(file); store.getEmbeddings = async texts => texts.map(() => [1, 0]);
  await Promise.all([store.addDocument('a', 'First'), store.addDocument('b', 'Second')]);
  const restored = testStore(file);
  assert.equal((await restored.getAllDocs()).length, 2);
  assert.equal((await restored.testDatabase.readDocuments('test-user')).length, 2);
});

test('provider errors explain authentication, billing, models, and rate limits without leaking details', () => {
  for (const [status, pattern] of [[401, /API key/], [402, /credits/], [404, /configured model/], [429, /rate limit/]] as const) {
    const error = providerError({ status, message: 'secret-token' }, 'Answer failed');
    assert.match(error.message, pattern); assert.ok(!error.message.includes('secret-token'));
  }
});

test('embedding model changes cannot silently search incompatible stored vectors', async () => {
  const store = testStore(); store.getEmbeddings = async texts => texts.map(() => [1, 0]);
  await store.addDocument('a', 'One day per week.');
  store.getEmbedding = async () => [1, 0, 0];
  await assert.rejects(store.search('How many days?'), /embedding model changed/);
});

test('transient provider limits retry once; long cooldowns and auth failures fail immediately', async () => {
  let attempts = 0;
  const value = await withProviderRetry(async () => {
    if (++attempts === 1) throw { status: 429, headers: { 'retry-after': '0' } };
    return 'recovered';
  }, AbortSignal.timeout(5000));
  assert.equal(value, 'recovered'); assert.equal(attempts, 2);
  for (const failure of [{ status: 401 }, { status: 429, headers: { 'retry-after': '60' } }]) {
    let calls = 0;
    await assert.rejects(withProviderRetry(async () => { calls++; throw failure; }, AbortSignal.timeout(5000)));
    assert.equal(calls, 1);
  }
});

test('embedding batches are reordered by provider index and malformed vectors are rejected', async () => {
  const previousKey = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = 'test-key';
  const store = testStore(); let calls = 0;
  Object.defineProperty(store, 'client', { value: { embeddings: { create: async ({ input }: { input: string[] }) => {
    calls++;
    return { data: input.map((_, index) => ({ index, embedding: [index + 1, 0] })).reverse() };
  } } } });
  try {
    const result = await store.getEmbeddings(Array.from({ length: 33 }, () => 'source'));
    assert.equal(calls, 2); assert.equal(result.length, 33); assert.deepEqual(result[0], [1, 0]);
    Object.defineProperty(store, 'client', { value: { embeddings: { create: async () => ({ data: [{ index: 0, embedding: [NaN] }] }) } } });
    await assert.rejects(store.getEmbeddings(['source']), /embedding failed/);
  } finally {
    if (previousKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = previousKey;
  }
});

test('abstention distinguishes absent documents, insufficient context and failed verification', async () => {
  const empty = await pipeline([]).queryPipeline('Explain the architecture');
  assert.equal('reason' in empty && empty.reason, 'no_documents');
  const missing = pipeline(); missing.generateAnswer = async () => 'Insufficient information.';
  const result = await missing.queryPipeline('Explain the architecture');
  assert.equal('reason' in result && result.reason, 'insufficient_context');
  assert.equal(result.attempts, 1); assert.ok(!result.factCheck.evidence.includes('Upload'));
  const rejected = pipeline(); rejected.generateAnswer = async () => 'Unsupported claim.'; rejected.factCheck = async () => fail;
  const unverified = await rejected.queryPipeline('Explain the architecture');
  assert.equal('reason' in unverified && unverified.reason, 'verification_failed');
});

test('empty and token-limited completions are provider errors, not claims of missing evidence', () => {
  for (const [content, finish_reason] of [['', 'stop'], ['Partial answer', 'length']]) {
    const response = { choices: [{ message: { content }, finish_reason }] } as Parameters<typeof completionText>[0];
    assert.throws(() => completionText(response, 'Answer generation'), /empty response|cut off/);
  }
});

test('retrieval includes adjacent explanation, removes overlaps, and separates source documents', async () => {
  const store = testStore(); store.getEmbedding = async () => [1, 0];
  const shared = 'The adapter uses historical features.';
  const chunks = [
    { content: 'Architecture. ' + shared, embedding: [0, 1] },
    { content: shared + ' It predicts a residual.', embedding: [1, 0] },
    { content: 'The backbone remains frozen.', embedding: [0, 1] }
  ].map((chunk, index) => ({ ...chunk, index, chunkId: `paper#${index}`, source: 'paper.pdf' }));
  const records = [
    { id: 'paper', text: 'paper', chunks },
    { id: 'other', text: 'other', chunks: [{ content: 'Unrelated document.', embedding: [0, 1], index: 0, chunkId: 'other#0', source: 'other.pdf' }] }
  ];
  for (const record of records) await store.testDatabase.writeDocument('test-user', record);
  const result = await store.search('How is the adapter built?', 1);
  assert.equal(result.length, 1); assert.equal(result[0].chunkIndex, 0); assert.equal(result[0].chunkEndIndex, 2);
  assert.match(result[0].text, /backbone remains frozen/); assert.match(result[0].text, /Architecture/);
  assert.equal(result[0].text.split(shared).length - 1, 1); assert.ok(!result[0].text.includes('Unrelated'));
  assert.equal(joinPassages(['abc overlap', 'overlap def']), 'abc overlap def');
});

test('compact verification IDs map to original claims and still reject missing, duplicate or invented IDs', () => {
  const claim = { id: 1, supported: true, evidenceIndexes: [1] };
  assert.deepEqual(parseVerification(JSON.stringify({ claims: [claim] }), ['Original sentence.'], 1).claims[0], { sentence: 'Original sentence.', supported: true, evidenceIndexes: [1] });
  for (const claims of [[{ ...claim, id: 2 }], [{ ...claim, evidenceIndexes: [] }], [claim, claim]]) {
    assert.equal(parseVerification(JSON.stringify({ claims }), ['First.', 'Second.'].slice(0, claims.length), 1).passed, false);
  }
});


test('invalid inline references cannot pass even when the verifier approves the draft', async () => {
  const rag = pipeline(); let count = 0;
  rag.generateAnswer = async () => { count++; return 'One day. [99]'; };
  rag.factCheck = async () => pass;
  assert.equal((await rag.queryPipeline('How many days?')).status, 'abstained');
  assert.equal(count, 2);
  const assessment = parseVerification(JSON.stringify({ claims: [{ id: 1, supported: true, evidenceIndexes: [1] }] }), ['One day [2].'], 2);
  assert.equal(assessment.passed, false);
});

test('content-filtered and unfinished completions are explicit failures', () => {
  for (const finish_reason of ['content_filter', 'tool_calls', null]) {
    const response = { choices: [{ message: { content: 'Partial draft' }, finish_reason }] } as Parameters<typeof completionText>[0];
    assert.throws(() => completionText(response, 'Generation'), /did not finish normally/);
  }
});

test('identical document retries reuse embeddings and can attach an original to a legacy text record', async () => {
  const store = testStore(); let calls = 0;
  store.getEmbeddings = async texts => { calls++; return texts.map(() => [1, 0]); };
  await store.addDocument('stable', 'Known source', { source: 'source.txt' });
  const revision = (await store.revision('test-user'));
  await store.addDocument('stable', 'Known source', { source: 'source.txt' }, 'test-user', { name: 'source.txt', bytes: Buffer.from('Known source'), mime: 'text/plain' });
  assert.equal(calls, 1); assert.equal((await store.revision('test-user')), revision);
  assert.equal((await store.getOriginal('test-user', 'stable')).bytes.toString(), 'Known source');
  await store.addDocument('stable', 'Changed source', { source: 'source.txt' });
  assert.equal(calls, 2); assert.ok((await store.revision('test-user')) > revision);
});

test('all-zero provider embeddings are rejected before indexing', async () => {
  const old = process.env.OPENROUTER_API_KEY; process.env.OPENROUTER_API_KEY = 'test-only';
  const store = testStore();
  Object.defineProperty(store, 'client', { value: { embeddings: { create: async () => ({ data: [{ index: 0, embedding: [0, 0] }] }) } } });
  try { await assert.rejects(store.addDocument('zero', 'Text'), /embedding failed/); assert.equal((await store.getAllDocs()).length, 0); }
  finally { if (old === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = old; }
});

test('work admission limits concurrent users and always releases failed work', async () => {
  const limiter = new WorkLimiter();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const running = ['a','b','c','d'].map(owner => limiter.run(owner, () => gate));
  await assert.rejects(limiter.run('a', async () => undefined), /Another operation/);
  await assert.rejects(limiter.run('e', async () => undefined), /server is busy/);
  release(); await Promise.all(running);
  await assert.rejects(limiter.run('a', async () => { throw new Error('Failure'); }), /Failure/);
  assert.equal(await limiter.run('a', async () => 'released'), 'released');
});

test('a document change during generation flags the snapshot and prevents stale caching', async () => {
  let revision = 1;
  const store = { revision: () => revision, search: async () => [passage] } as unknown as VectorStoreService;
  const rag = new RagService(store); let calls = 0;
  rag.generateAnswer = async () => { calls++; revision++; return 'One day.'; }; rag.factCheck = async () => pass;
  const first = await rag.queryPipeline('Question', 'owner');
  assert.equal(first.sourcesChanged, true); assert.equal(first.sourceRevision, 1);
  await rag.queryPipeline('Question', 'owner'); assert.equal(calls, 2);
});


test('isolated production parser handles PDF/DOCX and recovers after an invalid file', async () => {
  const previous = process.env.PARSER_ISOLATION;
  process.env.PARSER_ISOLATION = 'process';
  try {
    for (const originalname of ['policy.pdf', 'policy.docx']) {
      const buffer = readFileSync(join('tests', 'fixtures', originalname));
      assert.match(await extractDocument({ originalname, buffer, size: buffer.length }), /one day per week/);
    }
    await assert.rejects(extractDocument({ originalname: 'invalid.pdf', buffer: Buffer.from('bad'), size: 3 }), /could not be read/);
    assert.equal(await extractDocument({ originalname: 'good.txt', buffer: Buffer.from('Recovered'), size: 9 }), 'Recovered');
  } finally { if (previous === undefined) delete process.env.PARSER_ISOLATION; else process.env.PARSER_ISOLATION = previous; }
});
