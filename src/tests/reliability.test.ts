import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseClaimVerification, parseMinimalRepair, substantiveRepair, answerSentences, type Evidence, type ClaimVerdict } from '../rag/verification';
import { RagService } from '../rag/rag.service';
import { VectorStoreService } from '../vector-store/vector-store.service';
import { docxText } from '../rag/document-parser';
import { withProviderRetry, providerClient, providerError } from '../common/provider';

const source: Evidence = { id: 'policy', source: 'policy.docx', chunkIndex: 0, text: 'Remote work is permitted one day per week. Manager approval is required.' };
function assessment(draft: string, verdict: ClaimVerdict, docs = [source], index = 1) {
  return parseClaimVerification(JSON.stringify({ sentences: answerSentences(draft).map(s => ({ id: s.id, kind: 'FACTUAL', claims: [{ text: s.text, span: s.text, verdict, supporting: verdict === 'SUPPORTED' || verdict === 'CONFLICTED' ? [{ index, quote: docs[index - 1].text }] : [], contradicting: verdict === 'CONTRADICTED' || verdict === 'CONFLICTED' ? [{ index, quote: docs[index - 1].text }] : [], missingInformation: verdict === 'INSUFFICIENT_EVIDENCE' ? ['Exact numerical value'] : [], temporalValidity: 'UNKNOWN', scope: { time: null, place: null } }] })) }), draft, docs);
}
function pipeline(initial = [source], additional = initial) {
  let searches = 0;
  const store = { revision: async () => 1, search: async (_query: string, _k: number, _signal: AbortSignal, owner: string) => { assert.equal(owner, 'account-a'); return ++searches === 1 ? [...initial] : [...additional]; } } as unknown as VectorStoreService;
  return { rag: new RagService(store), searches: () => searches };
}

test('invented numerical support is downgraded even when a model says SUPPORTED', () => {
  const result = assessment('Remote work is permitted three days per week.', 'SUPPORTED');
  assert.equal(result.schemaValid, true); assert.equal(result.passed, false);
  assert.equal(result.atomicClaims![0].verdict, 'INSUFFICIENT_EVIDENCE');
});

test('citation markers after punctuation stay attached to their original sentence', () => {
  assert.deepEqual(answerSentences('One day. [1] Approval is required. [2]').map(s => s.text), ['One day. [1]', 'Approval is required. [2]']);
});

test('a compound dataset and architecture count cannot masquerade as one atomic claim', () => {
  const text = 'The adapter used two datasets and four architectures.';
  assert.equal(assessment(text, 'SUPPORTED', [{ ...source, text }]).schemaValid, false);
});

test('a library revision during a query withholds the answer and prevents caching', async () => {
  let revision = 1;
  const rag = new RagService({ revision: async () => revision, search: async () => [source] } as unknown as VectorStoreService);
  rag.generateAnswer = async () => { revision++; return 'One day.'; };
  rag.factCheck = async draft => assessment(draft, 'SUPPORTED');
  const result = await rag.queryPipeline('Days?', 'account-a');
  assert.equal(result.verificationStatus, 'VERIFICATION_FAILED'); assert.equal(result.sourcesChanged, true);
  assert.equal(result.factCheck.passed, false); assert.equal(result.correction, null);
});

test('compound experimental claims retain separate source spans and independently checked quantities', () => {
  const draft = 'The method used three datasets and achieved 95% accuracy.';
  const docs = [{ ...source, text: 'The method used three datasets. Accuracy was not reported.' }];
  const base = { verdict: 'SUPPORTED', supporting: [{ index: 1, quote: docs[0].text }], contradicting: [], missingInformation: [], temporalValidity: 'UNKNOWN', scope: { time: null, place: null } };
  const parsed = parseClaimVerification(JSON.stringify({ sentences: [{ id: 1, kind: 'FACTUAL', claims: [
    { ...base, text: 'The method used three datasets.', span: 'The method used three datasets' },
    { ...base, text: 'The method achieved 95% accuracy.', span: 'achieved 95% accuracy' }
  ] }] }), draft, docs);
  assert.equal(parsed.atomicClaims!.length, 2); assert.equal(parsed.atomicClaims![0].verdict, 'SUPPORTED');
  assert.equal(parsed.atomicClaims![1].verdict, 'INSUFFICIENT_EVIDENCE');
  for (const claim of parsed.atomicClaims!) assert.equal(draft.slice(claim.span.start, claim.span.end), claim.span.text);
});

test('invented quotes, omitted sentences, extra schema fields and factual style bypasses fail closed', () => {
  for (const value of [
    { sentences: [] }, { sentences: [{ id: 1, kind: 'STYLE', claims: [] }] },
    { sentences: [{ id: 1, kind: 'UNCERTAINTY', claims: [] }] }, { sentences: [], passed: true }
  ]) assert.equal(parseClaimVerification(JSON.stringify(value), 'The result was 95%.', [source]).schemaValid, false);
  assert.equal(parseClaimVerification('not json', 'A fact.', [source]).passed, false);
  const raw = { sentences: [{ id: 1, kind: 'FACTUAL', claims: [{ text: 'Three days.', span: 'Three days.', verdict: 'SUPPORTED', supporting: [{ index: 1, quote: 'This text was invented by the verifier.' }], contradicting: [], missingInformation: [], temporalValidity: 'UNKNOWN', scope: { time: null, place: null } }] }] };
  assert.equal(parseClaimVerification(JSON.stringify(raw), 'Three days.', [source]).schemaValid, false);
});

test('uncertainty is preserved and supported clauses cannot be edited by a repair', () => {
  const original = 'Three days. Manager approval is required. Quantitative results are not reported.';
  const bad = assessment('Three days.', 'CONTRADICTED');
  const good = assessment('Manager approval is required.', 'SUPPORTED');
  good.atomicClaims![0].sentenceId = 2;
  const combined = { ...bad, atomicClaims: [...bad.atomicClaims!, ...good.atomicClaims!] };
  const revised = parseMinimalRepair(JSON.stringify({ edits: [{ sentenceId: 1, text: 'One day. [1]' }] }), original, combined);
  assert.equal(revised, 'One day. [1] Manager approval is required. Quantitative results are not reported.');
  assert.equal(parseMinimalRepair(JSON.stringify({ edits: [{ sentenceId: 2, text: 'No approval is required.' }] }), original, combined), null);
  assert.equal(parseMinimalRepair(JSON.stringify({ edits: [{ sentenceId: 3, text: 'Results were excellent.' }] }), original, combined), null);
});

test('a superficial rewrite cannot be accepted as a successful factual repair', () => {
  const before = assessment('Three days.', 'CONTRADICTED');
  const after = assessment('Three days per week.', 'SUPPORTED', [{ ...source, text: 'Remote work is permitted three days per week.' }]);
  assert.equal(after.passed, true); assert.equal(substantiveRepair(before, after), false);
  assert.equal(substantiveRepair(before, assessment('One day.', 'SUPPORTED')), true);
});

test('correct original answers do not invoke retrieval retries or repair', async () => {
  const { rag, searches } = pipeline(); let generations = 0;
  rag.generateAnswer = async () => { generations++; return 'One day.'; };
  rag.factCheck = async draft => assessment(draft, 'SUPPORTED');
  const result = await rag.queryPipeline('How many days?', 'account-a');
  assert.equal(result.verificationStatus, 'VERIFIED_UNCHANGED'); assert.equal(generations, 1); assert.equal(searches(), 1);
});

test('missing evidence triggers targeted retrieval; new support preserves the original answer', async () => {
  const initial = { ...source, text: 'The paper describes a research method.' };
  const extra = { ...source, id: 'experiments', text: 'The method was evaluated on three datasets.' };
  const { rag, searches } = pipeline([initial], [extra]); let checks = 0, generations = 0;
  rag.generateAnswer = async () => { generations++; return 'Three datasets.'; };
  rag.factCheck = async (draft, docs) => ++checks === 1 ? assessment(draft, 'INSUFFICIENT_EVIDENCE', docs) : assessment(draft, 'SUPPORTED', docs, 2);
  const result = await rag.queryPipeline('How many datasets?', 'account-a');
  assert.equal(result.verificationStatus, 'VERIFIED_UNCHANGED'); assert.equal(generations, 1); assert.equal(searches(), 2);
  assert.equal(result.correction, null); assert.equal(result.citations.length, 2);
});

test('no new evidence leads to uncertainty without an unnecessary repair call', async () => {
  const { rag, searches } = pipeline(); let calls = 0;
  rag.generateAnswer = async () => { calls++; return 'The method achieved 95% accuracy.'; };
  rag.factCheck = async draft => assessment(draft, 'INSUFFICIENT_EVIDENCE');
  const result = await rag.queryPipeline('What were the quantitative results?', 'account-a');
  assert.equal(calls, 1); assert.equal(searches(), 2); assert.equal(result.verificationStatus, 'INSUFFICIENT_EVIDENCE');
  assert.ok(!result.draft.includes('95%'));
});

test('new unsupported repair claims are withheld and attempted repairs remain auditable', async () => {
  const { rag } = pipeline();
  rag.generateAnswer = async (_q, _docs, old) => old ? 'One day and a 95% bonus.' : 'Three days.';
  rag.factCheck = async draft => assessment(draft, draft === 'Three days.' ? 'CONTRADICTED' : 'SUPPORTED');
  const result = await rag.queryPipeline('Remote policy?', 'account-a');
  assert.equal(result.status, 'abstained'); assert.equal(result.correction, null);
  assert.equal(result.repairHistory[0].accepted, false); assert.ok(!result.draft.includes('95%'));
});

test('source conflicts remain unresolved rather than choosing a preferred source', async () => {
  const { rag } = pipeline(); let generated = 0;
  rag.generateAnswer = async () => { generated++; return 'One day.'; };
  rag.factCheck = async draft => assessment(draft, 'CONFLICTED');
  const result = await rag.queryPipeline('Current policy?', 'account-a');
  assert.equal(result.verificationStatus, 'UNRESOLVED_CONFLICT'); assert.equal(generated, 1);
});

test('DOCX extraction retains table row values and units as plain text', () => {
  const text = docxText('<h1>Results</h1><table><tr><td>Dataset</td><td>Accuracy</td></tr><tr><td>Bench A</td><td>95%</td></tr></table><p>Not peer reviewed.</p>');
  assert.match(text, /Dataset \| Accuracy\nBench A \| 95%/); assert.match(text, /Not peer reviewed/); assert.ok(!text.includes('<td>'));
});

test('provider timeouts retry once, respect cancellation and retain a bounded request timeout', async () => {
  let attempts = 0;
  const result = await withProviderRetry(async () => { if (++attempts === 1) throw { name: 'APIConnectionTimeoutError' }; return 'recovered'; }, AbortSignal.timeout(3000));
  assert.equal(result, 'recovered'); assert.equal(attempts, 2);
  const controller = new AbortController(); controller.abort(); attempts = 0;
  await assert.rejects(withProviderRetry(async () => { attempts++; throw { name: 'APIConnectionTimeoutError' }; }, controller.signal));
  assert.equal(attempts, 1); assert.equal(providerClient().timeout, 45000);
  assert.equal(providerError({ name: 'APIConnectionTimeoutError' }, 'Answer generation').getStatus(), 504);
});
