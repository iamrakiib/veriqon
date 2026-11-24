import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { DatabaseService } from '../database/database.service';
import { VectorStoreService } from '../vector-store/vector-store.service';
import { temporalScope, validDate } from '../rag/temporal';
import { RagService } from '../rag/rag.service';
import { parseClaimVerification } from '../rag/verification';
import { extractDocumentInProcess } from '../rag/document-parser';

async function fixture() {
  const previous = { ...process.env }, schema = 'test_' + randomUUID().replace(/-/g, '');
  Object.assign(process.env, { NODE_ENV: 'test', DATABASE_PATH: ':memory:', EMBEDDING_MODEL: 'retrieval-fixture', RETRIEVAL_CANDIDATES: '30' });
  delete process.env.DATABASE_URL; delete process.env.REDIS_URL;
  const admin = process.env.TEST_DATABASE_URL ? new Pool({ connectionString: process.env.TEST_DATABASE_URL }) : undefined;
  if (admin) {
    await admin.query('CREATE EXTENSION IF NOT EXISTS vector'); await admin.query(`CREATE SCHEMA ${schema}`);
    const url = new URL(process.env.TEST_DATABASE_URL!); url.searchParams.set('options', `-c search_path=${schema},public`); process.env.DATABASE_URL = url.toString();
  }
  const db = new DatabaseService(); await db.initialize();
  for (const id of ['a', 'b']) await db.run('INSERT INTO users(id,email,name,password_hash,role,created_at) VALUES(?,?,?,?,?,?)', id, `${id}@example.test`, id, 'unused', 'member', Date.now());
  const store = new VectorStoreService(db); let embeddings = 0;
  store.getEmbedding = async () => { embeddings++; return [1, 0]; };
  async function doc(id: string, passages: string[], owner = 'a') {
    const text = passages.join('\n'), version = 'sha256:' + createHash('sha256').update(text).digest('hex');
    await db.writeDocument(owner, { id, text, embeddingModel: store.embeddingConfig.identity, chunks: passages.map((content, index) => ({ content, index, chunkId: `${id}#${index}`, source: `${id}.txt`, version, embedding: [1, 0] })) });
  }
  return { db, store, doc, embeddings: () => embeddings, close: async () => { await db.onModuleDestroy(); if (admin) { await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); } process.env = previous; } };
}

test('explicit period comparisons retain both periods instead of silently using today', () => {
  const scope = temporalScope('Compare remote days in 2024 and in 2026.');
  assert.equal(scope.from, '2024-01-01'); assert.equal(scope.to, '2027-01-01');
  assert.deepEqual(temporalScope('Compare remote days in 2024 and 2026.'), scope);
  assert.equal(temporalScope('What applied in 2024, compared with today?', undefined, new Date('2026-11-11T00:00:00Z')).from, '2024-01-01');
  assert.equal(temporalScope('Describe dataset 2024 and model 2026.').kind, 'current');
  assert.equal(temporalScope('Policy in 2024, specifically in 2024?').kind, 'year');
});

test('calendar bounds do not create malformed exclusive dates', () => {
  assert.equal(validDate('2024-02-29'), true); assert.equal(validDate('2025-02-29'), false);
  assert.equal(validDate('9999-12-31'), false);
  assert.throws(() => temporalScope('Policy?', '9999-12-31'), /date/i);
  assert.equal(temporalScope('Policy on 2024-02-29').to, '2024-03-01');
  assert.deepEqual(temporalScope('Compare on 2024-02-29 and on 2026-03-01'), { from: '2024-02-29', to: '2026-03-02', kind: 'range' });
});

test('textless PDF explicitly requires OCR instead of publishing empty evidence', async () => {
  const stream = '0 0 20 20 re f\n';
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << >> /Contents 4 0 R >>', `<< /Length ${stream.length} >>\nstream\n${stream}endstream`];
  let pdf = '%PDF-1.4\n'; const offsets = [0];
  objects.forEach((object, i) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${i + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 5\n0000000000 65535 f \n${offsets.slice(1).map(n => n.toString().padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const buffer = Buffer.from(pdf);
  await assert.rejects(extractDocumentInProcess({ buffer, size: buffer.length, originalname: 'textless.pdf' }), /No readable text.*OCR/);
});

test('unknown effective dates remain unknown; publication date is not used as effective time', async () => {
  const f = await fixture();
  try {
    await f.doc('unknown', ['Engineering permits two remote days.']);
    await f.db.updateMetadata('a', 'unknown', { publishedAt: '2030-01-01' }, 0, 'Publication only fixture');
    const sources = await f.store.search('Remote days in 2024?', 3, undefined, 'a');
    assert.equal(sources.length, 1); assert.equal(sources[0].metadata?.effectiveFrom, undefined);
    assert.equal(sources[0].metadata?.publishedAt, '2030-01-01');
  } finally { await f.close(); }
});

test('inherited file focus cannot bypass effective dates; explicit source inspection can', async () => {
  const f = await fixture();
  try {
    await f.doc('old', ['In 2024 Engineering allows three remote days.']);
    await f.db.updateMetadata('a', 'old', { effectiveFrom: '2024-01-01', effectiveTo: '2024-12-31', scope: 'Engineering' }, 0, 'Historical policy fixture');
    assert.deepEqual(await f.store.search('How many remote days?', 3, undefined, 'a', ['old']), []);
    assert.equal(f.embeddings(), 0, 'Inapplicable sources are excluded before any provider work');
    assert.equal((await f.store.search('According to old.txt, how many remote days?', 3, undefined, 'a'))[0]?.id, 'old');
    assert.deepEqual(await f.store.search('According to old.txt, how many remote days currently?', 3, undefined, 'a'), []);
  } finally { await f.close(); }
});

test('multi-period retrieval preserves competing versions and metadata stays owner-scoped', async () => {
  const f = await fixture();
  try {
    await f.doc('old', ['In 2024 Engineering allows three remote days.']); await f.doc('new', ['In 2026 Engineering allows one remote day.']);
    await f.doc('private', ['CONFIDENTIAL_B Engineering allows ninety remote days.'], 'b');
    await f.db.updateMetadata('a', 'old', { effectiveFrom: '2024-01-01', effectiveTo: '2025-12-31', scope: 'Engineering' }, 0, 'Historical policy fixture');
    await f.db.updateMetadata('a', 'new', { effectiveFrom: '2026-01-01', scope: 'Engineering', supersedes: 'old' }, 0, 'Current policy fixture');
    const sources = await f.store.search('Compare remote days in 2024 and in 2026.', 3, undefined, 'a');
    assert.deepEqual(new Set(sources.map(s => s.id)), new Set(['old', 'new']));
    assert.ok(!JSON.stringify(sources).includes('CONFIDENTIAL_B'));
    assert.deepEqual(await f.store.search('Remote days?', 3, undefined, 'a', ['private']), []);
  } finally { await f.close(); }
});

test('pipeline follow-up expansion cannot turn an inherited filename into explicit historical inspection', async () => {
  const f = await fixture();
  try {
    await f.doc('old', ['Engineering permits three remote days.']);
    await f.db.updateMetadata('a', 'old', { effectiveTo: '2024-12-31' }, 0, 'Expired source fixture');
    const rag = new RagService(f.store); let calls = 0;
    rag.generateAnswer = async () => { calls++; return 'Engineering permits three remote days.'; };
    const result = await rag.queryPipeline('How many remote days?', 'a', undefined, { snapshot: { focus: ['old'], retrievalQuery: 'According to old.txt, what is the policy? Follow-up question: How many remote days?' } });
    assert.equal(calls, 0); assert.equal(result.verificationStatus, 'INSUFFICIENT_EVIDENCE');
  } finally { await f.close(); }
});

test('cache cannot reuse an expired-source inspection for a policy question even if equivalence says yes', async () => {
  const f = await fixture();
  try {
    const text = 'Engineering permits three remote days.';
    await f.doc('old', [text]);
    await f.db.updateMetadata('a', 'old', { effectiveTo: '2024-12-31' }, 0, 'Expired source cache fixture');
    const rag = new RagService(f.store); let generations = 0;
    rag.generateAnswer = async () => { generations++; return text; };
    rag.equivalentQuestions = async () => true;
    rag.factCheck = async (draft, docs) => parseClaimVerification(JSON.stringify({ sentences: [{ id: 1, kind: 'FACTUAL', claims: [{ text: draft, span: draft, verdict: 'SUPPORTED', supporting: [{ index: 1, quote: text }], contradicting: [], missingInformation: [], temporalValidity: 'UNKNOWN', scope: { time: null, place: null } }] }] }), draft, docs);
    assert.equal((await rag.queryPipeline('According to old.txt, how many remote days?', 'a')).verificationStatus, 'VERIFIED_UNCHANGED');
    const result = await rag.queryPipeline('How many remote days does old.txt permit?', 'a');
    assert.equal(result.cache?.kind, 'miss'); assert.equal(result.verificationStatus, 'INSUFFICIENT_EVIDENCE');
    assert.equal(generations, 1, 'Excluded evidence cannot trigger a fresh generated answer either');
  } finally { await f.close(); }
});

test('bounded retrieval matrix reports annotated passage recall and request counts in a noisy library', async t => {
  const f = await fixture();
  try {
    await f.doc('paper', ['Objective: improve forecasting with an adapter.', 'Related work concerns forecasting.', 'Background describes model families.', 'Training uses frozen forecasting backbones.', 'Evaluation protocol uses a held-out test split.', 'Results table: Dataset | MAE (kWh)\nAlpha | 2.4\nBeta | 3.1', 'Evaluation uses two datasets and four forecasting architectures.']);
    await f.doc('policy-a', ['Engineering permits three remote days per week. Paid vacation is twenty days.']);
    await f.doc('policy-b', ['Engineering permits one remote day per week. Paid vacation is twenty days.']);
    for (let i = 0; i < 8; i++) await f.doc(`noise-${i}`, [`Unrelated biography and shopping notes number ${i}.`]);
    await f.doc('private', ['CONFIDENTIAL_B Results table: MAE 900 kWh.'], 'b');
    const cases = [
      { query: 'What is the adapter objective?', expected: [['paper', 0]] },
      { query: 'What does the adapter improve?', expected: [['paper', 0]] },
      { query: 'What MAE kWh values are in the results table?', expected: [['paper', 5]] },
      { query: 'According to paper.txt, describe the objective and evaluation datasets.', expected: [['paper', 0], ['paper', 6]] },
      { query: 'According to policy-a.txt, how many remote days?', expected: [['policy-a', 0]] },
      { query: 'Compare policy-a.txt and policy-b.txt remote days.', expected: [['policy-a', 0], ['policy-b', 0]] }
    ];
    const rows = [];
    for (const c of cases) {
      const before = f.embeddings(), passages = await f.store.search(c.query, 3, undefined, 'a');
      const found = c.expected.filter(([id, index]) => passages.some(p => p.id === id && p.chunkIndex <= Number(index) && p.chunkEndIndex >= Number(index))).length;
      rows.push({ query: c.query, expected: c.expected.length, found, embeddings: f.embeddings() - before, passages: passages.map(p => ({ id: p.id, from: p.chunkIndex, to: p.chunkEndIndex, mode: p.retrievalMode })) });
      assert.ok(!JSON.stringify(passages).includes('CONFIDENTIAL_B'));
      if (c.query.includes('MAE')) assert.ok(passages.some(p => p.text.includes('Alpha | 2.4') && p.text.includes('MAE (kWh)')));
    }
    t.diagnostic(JSON.stringify({ dialect: f.db.dialect, controlledEmbeddings: true, candidateBudget: 30, finalPassages: 3, rows }));
    assert.equal(rows.reduce((n, r) => n + r.found, 0), rows.reduce((n, r) => n + r.expected, 0));
  } finally { await f.close(); }
});

test('initial and targeted retrieval never supply another account evidence to the generator or verifier', async t => {
  const f = await fixture();
  try {
    await f.doc('public-paper', ['The paper describes a forecasting method but gives no accuracy results.']);
    await f.doc('private-paper', ['CONFIDENTIAL_B The accuracy result is 95 percent.'], 'b');
    await f.db.updateMetadata('b', 'private-paper', { authority: 'CONFIDENTIAL_B' }, 0, 'Private evidence fixture');
    const rag = new RagService(f.store), inputs: string[] = []; let generations = 0, checks = 0, searches = 0;
    const search = f.store.search.bind(f.store);
    f.store.search = async (...args) => { searches++; return search(...args); };
    rag.generateAnswer = async (_q, docs) => { generations++; inputs.push(JSON.stringify(docs)); return 'The accuracy is 95 percent.'; };
    rag.factCheck = async (draft, docs) => {
      checks++; inputs.push(JSON.stringify(docs));
      return parseClaimVerification(JSON.stringify({ sentences: [{ id: 1, kind: 'FACTUAL', claims: [{ text: draft, span: draft, verdict: 'INSUFFICIENT_EVIDENCE', supporting: [], contradicting: [], missingInformation: ['Accuracy result'], temporalValidity: 'UNKNOWN', scope: { time: null, place: null } }] }] }), draft, docs);
    };
    const result = await rag.queryPipeline('What accuracy does the forecasting method report?', 'a');
    assert.equal(searches, 2); assert.equal(generations, 1); assert.ok(checks >= 1);
    assert.ok(inputs.length >= 2); assert.ok(inputs.every(input => !input.includes('CONFIDENTIAL_B')));
    assert.equal(result.verificationStatus, 'INSUFFICIENT_EVIDENCE'); assert.ok(!result.draft.includes('95'));
    t.diagnostic(JSON.stringify({ searches, generations, checks, unauthorizedProviderInputs: 0 }));
  } finally { await f.close(); }
});
