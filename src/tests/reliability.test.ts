import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseClaimVerification, parseMinimalRepair, substantiveRepair, answerSentences, resolveEvidenceQuote, type Evidence, type ClaimVerdict } from '../rag/verification';
import { RagService } from '../rag/rag.service';
import { VectorStoreService } from '../vector-store/vector-store.service';
import { docxText } from '../rag/document-parser';
import { withProviderRetry, providerClient, providerError, providerRetryAfter } from '../common/provider';
import { parseFactPlan, parseClaimEdits } from '../rag/atomic-facts';

const source: Evidence = { id: 'policy', source: 'policy.docx', chunkIndex: 0, text: 'Remote work is permitted one day per week. Manager approval is required.' };

test('untrusted provider cooldown headers cannot crash sanitized error handling', () => {
  for (const raw of ['9'.repeat(100), '99999999999999999999', 'invalid-date']) {
    assert.equal(providerRetryAfter({ headers: { 'retry-after': raw } }), undefined);
    const failure = providerError({ status: 429, headers: { 'retry-after': raw } }, 'Generation');
    assert.equal(failure.getStatus(), 429); assert.match(failure.message, /No reset time was supplied/);
    assert.ok(!failure.message.includes(raw));
  }
});
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

test('scientific notation and leading decimals cannot hide changed numerical claims', () => {
  for (const [claim, evidence] of [
    ['Latency was 5e-3 seconds.', 'Latency was 8e-3 seconds.'],
    ['Latency was 5 seconds.', 'Latency was .5 seconds.'],
    ['Latency was 5e3 seconds.', 'Latency was 5e-3 seconds.'],
    ['The score was -0.5.', 'The score was 0.5.'],
    ['The count was 9007199254740993.', 'The count was 9007199254740992.'],
    ['Latency was 5e-3 seconds.', 'Latency was 5e-3 milliseconds.'],
  ]) {
    const check = assessment(claim, 'SUPPORTED', [{ ...source, text: evidence }]);
    assert.equal(check.schemaValid, true); assert.equal(check.passed, false, `${claim} against ${evidence}`);
  }
});

test('equivalent decimal notation retains exact precision without arbitrary unit conversion', () => {
  for (const [claim, evidence] of [
    ['Latency was 5e-3 seconds.', 'Latency was 0.005 seconds.'],
    ['Latency was .50 seconds.', 'Latency was 0.5 seconds.'],
    ['Latency was 5.00 seconds.', 'Latency was 5 seconds.'],
    ['Latency was +5E+3 seconds.', 'Latency was 5,000 seconds.'],
    ['The count was 9007199254740993.0.', 'The count was 9007199254740993.'],
  ]) assert.equal(assessment(claim, 'SUPPORTED', [{ ...source, text: evidence }]).passed, true, claim);
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

test('exact count denials and cited filename labels do not require invented numerical evidence', () => {
  const doc = { ...source, source: 'policy-2026.txt', text: 'The adapter used three datasets. The limit is one day per week.' };
  assert.equal(assessment('The adapter used three datasets, not five.', 'SUPPORTED', [doc]).passed, true);
  assert.equal(assessment('The adapter used three datasets, not three.', 'SUPPORTED', [doc]).passed, false);
  assert.equal(assessment('The adapter used three datasets, not five.', 'SUPPORTED', [{ ...doc, text: 'The adapter used at least three datasets.' }]).passed, false);
  assert.equal(assessment('The adapter used three datasets, not five.', 'SUPPORTED', [{ ...doc, text: 'The adapter used two datasets.' }]).passed, false);
  assert.equal(assessment('The adapter used three datasets and five architectures.', 'SUPPORTED', [doc]).passed, false);
  assert.equal(assessment('The policy-2026.txt document states the limit is one day per week.', 'SUPPORTED', [doc]).passed, true);
  assert.equal(assessment('In 2026, the limit is one day per week.', 'SUPPORTED', [doc]).passed, false, 'A filename date cannot establish an effective date');
  assert.equal(assessment('The other-2026.txt document states the limit is one day per week.', 'SUPPORTED', [doc]).passed, false);
});

test('LIVE-002: exact millisecond/second exclusions preserve polarity without approving equivalent or ungrounded values', () => {
  const doc = { ...source, text: 'The sampling interval is five milliseconds.' };
  assert.equal(assessment('The sampling interval is five milliseconds, not five seconds.', 'SUPPORTED', [doc]).passed, true);
  for (const text of [
    'The sampling interval is five milliseconds, not 0.005 seconds.',
    'The sampling interval is five milliseconds, not five milliseconds.',
    'The sampling interval is five seconds, not five milliseconds.',
    'The sampling interval is five milliseconds, not five metres.',
  ]) assert.equal(assessment(text, 'SUPPORTED', [doc]).passed, false, text);
  assert.equal(assessment('The sampling interval is five milliseconds, not five seconds.', 'SUPPORTED', [{ ...doc, text: 'The sampling interval is at least five milliseconds.' }]).passed, false);
  const precise = { ...doc, text: 'The sampling interval is 0.000000000000000001 milliseconds.' };
  assert.equal(assessment('The sampling interval is 0.000000000000000001 milliseconds, not 0.000000000000000000001 seconds.', 'SUPPORTED', [precise]).passed, false, 'Equivalent small values must not be rounded into distinct quantities');
});

test('PDF line-wrap hyphenation and typography resolve to exact source offsets without fuzzy factual matching', () => {
  const sourceText = 'Experi-\nments used five backbones. No benefit was established. The score was -5.';
  assert.equal(resolveEvidenceQuote(sourceText, 'Experiments used five backbones.'), 'Experi-\nments used five backbones.');
  assert.equal(resolveEvidenceQuote(sourceText, 'experiments  used five backbones.'), 'Experi-\nments used five backbones.');
  assert.equal(resolveEvidenceQuote(sourceText, 'Experiments used six backbones.'), null);
  assert.equal(resolveEvidenceQuote('Experiments did not improve accuracy.', 'Experiments did improve accuracy.'), null);
  assert.equal(resolveEvidenceQuote(sourceText, 'The score was 5.'), null);
  assert.equal(resolveEvidenceQuote('candidate\u2011level histories', 'candidate-level histories'), 'candidate\u2011level histories');
  const checked = assessment('Experiments used five backbones.', 'SUPPORTED', [{ ...source, text: sourceText }]);
  assert.equal(checked.passed, true);
  const draft = 'Experiments used five backbones.';
  const raw = { sentences: [{ id: 1, kind: 'FACTUAL', claims: [{ text: draft, span: draft, verdict: 'SUPPORTED', supporting: [{ index: 1, quote: draft }], contradicting: [], missingInformation: [], temporalValidity: 'UNKNOWN', scope: { time: null, place: null } }] }] };
  const result = parseClaimVerification(JSON.stringify(raw), draft, [{ ...source, text: sourceText }]);
  assert.equal(result.passed, true); assert.equal(result.atomicClaims![0].supporting[0].quote, 'Experi-\nments used five backbones.');
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
  assert.equal(attempts, 0); assert.equal(providerClient().timeout, 45000);
  assert.equal(providerError({ name: 'APIConnectionTimeoutError' }, 'Answer generation').getStatus(), 504);
});

test('quantity-unit pairs reject swapped counts, percentage mismatches and unsupported unit conversions', () => {
  for (const [claim, evidence] of [
    ['The distance was 5 km.', 'The distance was 5 metres.'],
    ['The dose was 5 mg.', 'The dose was 5 g.'],
    ['The score was 95%.', 'The score was 95 points.'],
    ['The experiment used five datasets.', 'Three datasets and five architectures were tested.'],
  ]) {
    const check = assessment(claim, 'SUPPORTED', [{ ...source, text: evidence }]);
    assert.equal(check.schemaValid, true); assert.equal(check.passed, false, claim);
  }
  assert.equal(assessment('The distance was 5 km.', 'SUPPORTED', [{ ...source, text: 'The distance was 5 kilometres.' }]).passed, true);
  assert.equal(assessment('Accuracy reached 95%.', 'SUPPORTED', [{ ...source, text: 'Accuracy reached 95 percent.' }]).passed, true);
});

test('decomposition cannot silently drop a negation or substitute a quantity unit', () => {
  for (const [original, altered] of [
    ['Remote work is not permitted.', 'Remote work is permitted.'],
    ['The distance is 5 km.', 'The distance is 5 m.'],
  ]) {
    const plan = (text: string) => JSON.stringify({ sentences: [{ id: 1, kind: 'FACTUAL', claims: [{ text, span: original }] }] });
    assert.equal(parseFactPlan(plan(altered), original), null);
    assert.ok(parseFactPlan(plan(original), original));
  }
});

test('grounded entity and unit corrections are substantive only with validated edits and final support', () => {
  for (const [original, corrected] of [
    ['The model uses TensorFlow.', 'The model uses PyTorch.'],
    ['The distance is 5 km.', 'The distance is 5 m.'],
  ]) {
    const evidence = [{ ...source, text: corrected }];
    const before = assessment(original, 'CONTRADICTED', evidence);
    const revision = parseClaimEdits(JSON.stringify({ corrections: [{ claimId: 's1c1', replacement: corrected, evidence: [{ index: 1, quote: corrected }] }] }), original, before, evidence)!;
    assert.ok(revision);
    const after = assessment(revision.text, 'SUPPORTED', evidence);
    assert.equal(after.passed, true);
    assert.equal(substantiveRepair(before, after, revision.edits), true);
    assert.equal(substantiveRepair(before, { ...after, passed: false }, revision.edits), false);
    assert.equal(parseClaimEdits(JSON.stringify({ corrections: [{ claimId: 's1c1', replacement: 'The distance is 5 kg.', evidence: [{ index: 1, quote: corrected }] }] }), original, before, evidence), null);
  }
  const original = 'The model uses TensorFlow.';
  const before = assessment(original, 'CONTRADICTED', [{ ...source, text: 'The model uses PyTorch.' }]);
  const paraphrase = 'TensorFlow is used by the model.';
  const after = assessment(paraphrase, 'SUPPORTED', [{ ...source, text: paraphrase }]);
  assert.equal(substantiveRepair(before, after, [{ claimId: 's1c1', original, replacement: paraphrase, evidence: [{ index: 1, quote: paraphrase }] }]), false);
});

test('provider failure retains exact authorized passages, is never cached and permits a fresh retry', async () => {
  const { rag } = pipeline([{ ...source, version: 'approved-v2' }]);
  let generations = 0;
  rag.generateAnswer = async () => { if (++generations <= 2) throw { status: 429, message: 'secret-token' }; return 'One day.'; };
  rag.factCheck = async draft => assessment(draft, 'SUPPORTED');
  for (let i = 0; i < 2; i++) {
    const result = await rag.queryPipeline('Remote work days?', 'account-a');
    assert.equal('reason' in result && result.reason, 'generation_failed'); assert.equal(result.status, 'abstained');
    assert.equal(result.factCheck.passed, false); assert.equal(result.claimsChecked, 0);
    assert.equal(result.citations[0].excerpt, source.text); assert.equal(result.citations[0].version, 'approved-v2');
    assert.equal(result.attempts, 1); assert.equal(result.correction, null); assert.equal(result.cache.kind, 'miss');
    assert.ok(!JSON.stringify(result).includes('secret-token'));
  }
  assert.equal((await rag.queryPipeline('Remote work days?', 'account-a')).verificationStatus, 'VERIFIED_UNCHANGED');
  assert.equal(generations, 3);
});

test('empty retrieval in a populated library does not falsely tell the user to upload documents', async () => {
  const rag = new RagService({ revision: async () => 1, search: async () => [], inventory: async () => [{ id: 'present' }] } as unknown as VectorStoreService);
  const result = await rag.queryPipeline('Missing detail?', 'account-a');
  assert.equal('reason' in result && result.reason, 'insufficient_context'); assert.ok(!result.draft.includes('No documents'));
});

test('an established contradiction avoids another retrieval; technical repair failure remains distinguishable from missing evidence', async () => {
  const { rag, searches } = pipeline();
  rag.generateAnswer = async (_q, _d, original) => { if (original) throw { name: 'APIConnectionTimeoutError' }; return 'Three days.'; };
  rag.factCheck = async draft => assessment(draft, 'CONTRADICTED');
  const result = await rag.queryPipeline('Days?', 'account-a');
  assert.equal(searches(), 1); assert.equal('reason' in result && result.reason, 'verification_failed');
  assert.equal(result.verificationStatus, 'VERIFICATION_FAILED'); assert.equal(result.repairHistory[0].accepted, false);
});

test('provider cooldowns accept HTTP dates and Headers, report supplied resets and never wait through long limits', async () => {
  const now = Date.parse('2026-11-02T00:00:00Z');
  assert.equal(providerRetryAfter({ headers: new Headers({ 'Retry-After': '12' }) }, now), 12);
  assert.equal(providerRetryAfter({ headers: { 'Retry-After': 'Mon, 02 Nov 2026 00:00:30 GMT' } }, now), 30);
  assert.equal(providerRetryAfter({ headers: { 'retry-after': 'invalid' } }, now), undefined);
  assert.equal(providerRetryAfter({ headers: { 'X-RateLimit-Reset': String(now + 86400000) } }, now), 86400);
  assert.equal(providerRetryAfter({ headers: { 'X-RateLimit-Reset': '60' } }, now), undefined);
  const daily = { status: 429, headers: new Headers({ 'X-RateLimit-Reset': String(Date.now() + 86400000) }) };
  let dailyAttempts = 0;
  await assert.rejects(withProviderRetry(async () => { dailyAttempts++; throw daily; }, AbortSignal.timeout(5000)));
  assert.equal(dailyAttempts, 1); assert.match(providerError(daily, 'Generation').message, /reset at .* UTC/);
  const failure = { status: 429, headers: { 'retry-after': '60' } }; let attempts = 0;
  await assert.rejects(withProviderRetry(async () => { attempts++; throw failure; }, AbortSignal.timeout(5000)));
  assert.equal(attempts, 1); assert.match(providerError(failure, 'Generation').message, /Retry in 60 seconds/);
});
