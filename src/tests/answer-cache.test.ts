import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AnswerCache, compatibleQuestionScope, parseCacheEquivalence } from '../rag/answer-cache';
import { RagService } from '../rag/rag.service';
import { VectorStoreService } from '../vector-store/vector-store.service';
import { parseClaimVerification } from '../rag/verification';

const passage = { id: 'policy', source: 'policy.txt', version: 'v1', chunkIndex: 0, text: 'The policy permits one remote day per week.' };
function fixture() {
  let revision = 1, generations = 0, gates = 0, embeddings = 0;
  const vectors = new Map<string, number[]>();
  const store = {
    revision: async () => revision,
    queryEmbedding: async (q: string) => { embeddings++; const v = [1, 0]; vectors.set(q.trim(), v); return v; },
    cachedQueryEmbedding: (q: string) => vectors.get(q.trim()),
    search: async (q: string) => { vectors.set(q.trim(), [1, 0]); return [passage]; },
  };
  const rag = new RagService(store as unknown as VectorStoreService);
  rag.generateAnswer = async () => { generations++; return passage.text; };
  rag.factCheck = async draft => parseClaimVerification(JSON.stringify({ sentences: [{ id: 1, kind: 'FACTUAL', claims: [{
    text: draft, span: draft, verdict: 'SUPPORTED', supporting: [{ index: 1, quote: passage.text }], contradicting: [], missingInformation: [], temporalValidity: 'UNKNOWN', scope: { time: null, place: null },
  }] }] }), draft, [passage]);
  rag.equivalentQuestions = async () => { gates++; return true; };
  return { rag, store, counts: () => ({ generations, gates, embeddings }), changeRevision: () => revision++, setEquivalence: (value: boolean) => { rag.equivalentQuestions = async () => { gates++; return value; }; } };
}

test('paraphrases reuse a verified answer, exact repeats skip both embedding and equivalence, and citations stay intact', async () => {
  const f = fixture();
  await f.rag.queryPipeline('How many remote days are allowed?', 'alice');
  const exact = await f.rag.queryPipeline(' How many remote days are allowed? ', 'alice');
  assert.equal(exact.cache?.kind, 'exact'); assert.equal(f.counts().embeddings, 0);
  const semantic = await f.rag.queryPipeline('What is the remote work day allowance?', 'alice');
  assert.equal(semantic.cache?.kind, 'semantic'); assert.equal(f.counts().generations, 1); assert.equal(f.counts().gates, 1);
  assert.equal(semantic.citations[0].version, 'v1'); assert.equal(semantic.modelUsage.length, 0);
  semantic.citations[0].excerpt = 'mutated by caller';
  const again = await f.rag.queryPipeline('How many remote days are allowed?', 'alice');
  assert.equal(again.citations[0].excerpt, passage.text);
});

test('high embedding similarity cannot bypass scope or model rejection', async () => {
  assert.equal(compatibleQuestionScope('What happens after 5 seconds?', 'What happens after 5 milliseconds?'), false);
  for (const [a, b] of [
    ['What policy applied in 2024?', 'What policy applied in 2025?'],
    ['Does the model use history?', 'Does the model not use history?'],
    ['What is the latest policy?', 'What was the policy?'],
    ['Explain the method.', 'Explain it.'],
  ]) assert.equal(compatibleQuestionScope(a, b), false);
  const f = fixture(); await f.rag.queryPipeline('What policy applied in 2024?', 'alice');
  const period = await f.rag.queryPipeline('What policy applied in 2025?', 'alice');
  assert.equal(period.cache?.kind, 'miss'); assert.equal(f.counts().gates, 0);
  f.rag.equivalentQuestions = async () => false;
  const otherEntity = await f.rag.queryPipeline('What policy applied to the sales department in 2024?', 'alice');
  assert.equal(otherEntity.cache?.kind, 'miss'); assert.equal(f.counts().generations, 3);
});

test('owner, document revision and model configuration changes cannot reuse old answers', async () => {
  const f = fixture(); await f.rag.queryPipeline('Remote days?', 'alice');
  assert.equal((await f.rag.queryPipeline('Remote days?', 'bob')).cache?.kind, 'miss');
  f.changeRevision(); assert.equal((await f.rag.queryPipeline('Remote days?', 'alice')).cache?.kind, 'miss');
  const old = process.env.LLM_MODEL;
  try { process.env.LLM_MODEL = 'different-test-model'; assert.equal((await f.rag.queryPipeline('Remote days?', 'alice')).cache?.kind, 'miss'); }
  finally { if (old === undefined) delete process.env.LLM_MODEL; else process.env.LLM_MODEL = old; }
});

test('cache lookup errors fall back to fresh answers and document changes during lookup cannot serve stale answers', async () => {
  const f = fixture(); await f.rag.queryPipeline('Remote days?', 'alice');
  f.rag.equivalentQuestions = async () => { throw new Error('timeout'); };
  assert.equal((await f.rag.queryPipeline('How many remote days?', 'alice')).cache?.kind, 'miss');
  f.rag.equivalentQuestions = async () => { f.changeRevision(); return true; };
  const changed = await f.rag.queryPipeline('What is the remote day allowance?', 'alice');
  assert.equal('cached' in changed && changed.cached, false); assert.equal(changed.sourcesChanged, true);
  assert.equal(changed.factCheck.passed, false);
});

test('unverified and missing-version answers never become semantic candidates', async () => {
  const f = fixture(); const verify = f.rag.factCheck.bind(f.rag);
  f.rag.factCheck = async (...args) => ({ ...await verify(...args), passed: false, schemaValid: false });
  await f.rag.queryPipeline('Remote days?', 'alice'); await f.rag.queryPipeline('Remote days?', 'alice');
  assert.equal(f.counts().generations, 2);
  const missing = fixture(); missing.store.search = async (q: string) => { await missing.store.queryEmbedding(q); return [{ ...passage, version: undefined! }]; };
  await missing.rag.queryPipeline('Remote days?', 'alice');
  assert.equal((await missing.rag.queryPipeline('How many remote days?', 'alice')).cache?.kind, 'miss');
  assert.equal(missing.counts().gates, 0);
});

test('expiry, capacity, invalid vectors and authorization namespace are enforced by the cache', () => {
  let now = 0; const cache = new AnswerCache<{ answer: string }>(() => now);
  cache.put('a', 'alice', 'Remote days?', { answer: 'one' }, [1, 0], 1000, 2);
  assert.equal(cache.nearest('bob', 'Remote days?', [1, 0], 0.9), undefined);
  assert.equal(cache.nearest('alice', 'Remote days?', [NaN, 0], 0.9), undefined);
  assert.equal(cache.nearest('alice', 'Remote days?', [1, 0, 0], 0.9), undefined);
  cache.put('b', 'alice', 'Leave days?', { answer: 'two' }, [0, 1], 1000, 2);
  cache.put('c', 'alice', 'Batch size?', { answer: 'three' }, [1, 0], 1000, 2);
  assert.equal(cache.exact('a'), undefined);
  now = 1001; assert.equal(cache.exact('c'), undefined); assert.equal(cache.hasCandidates('alice', 'Batch size?'), false);
});

test('equivalence output is strict and fails closed on partial, malformed or extra claims', () => {
  assert.equal(parseCacheEquivalence('{"equivalent":true,"sameScope":true,"sameAnswerRequirements":true}'), true);
  for (const raw of ['yes', '{}', '{"equivalent":true}', '{"equivalent":true,"sameScope":false,"sameAnswerRequirements":true}', '{"equivalent":true,"sameScope":true,"sameAnswerRequirements":true,"confidence":1}']) assert.equal(parseCacheEquivalence(raw), false);
});

test('bounded cache matrix records positive reuse and negative temporal, entity, quantity and owner cases', async t => {
  const cases = [
    { name: 'exact', first: 'Remote days?', next: 'Remote days?', expected: 'exact' },
    { name: 'paraphrase', first: 'How many remote days?', next: 'What is the remote day allowance?', expected: 'semantic' },
    { name: 'date', first: 'Remote days in 2024?', next: 'Remote days in 2025?', expected: 'miss' },
    { name: 'quantity', first: 'Does five days apply?', next: 'Does three days apply?', expected: 'miss' },
    { name: 'entity', first: 'Engineering remote days?', next: 'Sales remote days?', expected: 'miss', equivalent: false },
    { name: 'scope', first: 'Remote days?', next: 'Remote days except contractors?', expected: 'miss' },
    { name: 'owner', first: 'Remote days?', next: 'Remote days?', expected: 'miss', owner: 'bob' },
    { name: 'revision', first: 'Remote days?', next: 'Remote days?', expected: 'miss', revision: true },
    { name: 'explicit-date', first: 'Remote days?', next: 'Remote days?', expected: 'miss', asOf: '2024-01-01' }
  ];
  const rows = [];
  for (const c of cases) {
    const f = fixture();
    await f.rag.queryPipeline(c.first, 'alice');
    if (c.revision) f.changeRevision();
    if (c.equivalent === false) f.setEquivalence(false);
    const result = await f.rag.queryPipeline(c.next, c.owner || 'alice', undefined, c.asOf ? { asOf: c.asOf } : undefined);
    rows.push({ name: c.name, actual: result.cache?.kind, expected: c.expected, ...f.counts() });
    assert.equal(result.cache?.kind, c.expected, c.name);
  }
  t.diagnostic(JSON.stringify({ controlledEquivalence: true, warmups: cases.length, probes: rows, hits: rows.filter(r => r.actual !== 'miss').length, misses: rows.filter(r => r.actual === 'miss').length }));
});
