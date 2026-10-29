import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFactPlan, matchesFactPlan, parseClaimEdits } from '../rag/atomic-facts';
import { parseClaimVerification, substantiveRepair } from '../rag/verification';
import { answerConflicts } from '../rag/conflicts';
import { RagService } from '../rag/rag.service';
import { VectorStoreService } from '../vector-store/vector-store.service';
import { answerSentences } from '../rag/verification';
const draft = 'The adapter used five datasets and four architectures.';
const docs = [{ id: 'paper', source: 'paper.docx', version: 'approved-v2', chunkIndex: 0, text: 'The adapter used two datasets and four architectures.' }];
const plan = { sentences: [{ id: 1, kind: 'FACTUAL', claims: [{ text: 'The adapter used five datasets.', span: 'The adapter used five datasets' }, { text: 'The adapter used four architectures.', span: 'four architectures' }] }] };
const assessment = (count: 'five' | 'two') => parseClaimVerification(JSON.stringify({ sentences: [{ id: 1, kind: 'FACTUAL', claims: plan.sentences[0].claims.map((c,i) => ({ text: c.text.replace('five',count), span: c.span.replace('five',count), verdict: i === 0 && count === 'five' ? 'CONTRADICTED' : 'SUPPORTED', supporting: i === 0 && count === 'five' ? [] : [{ index: 1, quote: docs[0].text }], contradicting: i === 0 && count === 'five' ? [{ index: 1, quote: docs[0].text }] : [], missingInformation: [], temporalValidity: 'UNKNOWN', scope: { time: null, place: null } })) }] }), draft.replace('five',count), docs);

test('separate decomposition preserves exact spans and rejects omitted propositions or injected judgments', () => {
  assert.deepEqual(parseFactPlan(JSON.stringify(plan), draft), plan);
  assert.equal(parseFactPlan(JSON.stringify({ sentences: [{ ...plan.sentences[0], claims: [plan.sentences[0].claims[1]] }] }), draft), null);
  assert.equal(parseFactPlan(JSON.stringify({ ...plan, verdict: 'SUPPORTED' }), draft), null);
  const check = assessment('five'); assert.equal(matchesFactPlan(plan as NonNullable<ReturnType<typeof parseFactPlan>>, check), true);
  check.atomicClaims![0].text = 'The adapter used two datasets.';
  assert.equal(matchesFactPlan(plan as NonNullable<ReturnType<typeof parseFactPlan>>, check), false);
});
test('RAC-inspired span correction changes the wrong fact and preserves a supported fact in the same sentence', () => {
  const before = assessment('five');
  const revision = parseClaimEdits(JSON.stringify({ corrections: [{ claimId: 's1c1', replacement: 'The adapter used two datasets', evidence: [{ index: 1, quote: docs[0].text }] }] }), draft, before, docs);
  assert.equal(revision?.text, 'The adapter used two datasets and four architectures. [1]');
  assert.equal(revision?.edits[0].original, 'The adapter used five datasets');
  const after = assessment('two'); assert.equal(after.passed, true); assert.equal(substantiveRepair(before, after), true);
});
test('repair contracts reject edits to supported claims, invented quotes, ungrounded values and duplicate edits', () => {
  const edit = { claimId: 's1c1', replacement: 'The adapter used two datasets', evidence: [{ index: 1, quote: docs[0].text }] };
  for (const corrections of [[{ ...edit, claimId: 's1c2' }], [{ ...edit, replacement: 'The adapter used 95 datasets' }], [{ ...edit, evidence: [{ index: 1, quote: 'This evidence was fabricated.' }] }], [edit,edit]]) {
    assert.equal(parseClaimEdits(JSON.stringify({ corrections }), draft, assessment('five'), docs), null);
  }
});
test('temporally invalid claims need exact contradictory source evidence', () => {
  const text = 'In 2024 the policy allowed one day per week.';
  const evidence = [{ ...docs[0], text: 'In 2024 the policy allowed three days per week. From 2025 the policy allows one day per week.' }];
  const raw = { sentences: [{ id: 1, kind: 'FACTUAL', claims: [{ text, span: text, verdict: 'TEMPORALLY_INVALID', supporting: [], contradicting: [{ index: 1, quote: 'In 2024 the policy allowed three days per week.' }], missingInformation: [], temporalValidity: 'NOT_APPLICABLE', scope: { time: '2024', place: null } }] }] };
  const check = parseClaimVerification(JSON.stringify(raw), text, evidence);
  assert.equal(check.schemaValid, true); assert.equal(check.passed, false);
  raw.sentences[0].claims[0].contradicting = [];
  assert.equal(parseClaimVerification(JSON.stringify(raw), text, evidence).schemaValid, false);
});
test('conflict records retain both exact passages, stable IDs, versions and affected answer references', () => {
  const check = assessment('five');
  check.atomicClaims![0].verdict = 'CONFLICTED';
  check.atomicClaims![0].supporting = [{ index: 2, quote: 'The adapter used five datasets.' }];
  const result = { factCheck: check, citations: [{ index: 1, documentId: 'paper', source: 'paper.docx', version: 'approved-v2', excerpt: docs[0].text, chunkIndex: 0 }, { index: 2, documentId: 'other', source: 'other.docx', version: 'approved-v1', excerpt: 'The adapter used five datasets.', chunkIndex: 1 }] };
  const message = { id: 'answer', conversationId: 'chat', question: 'Datasets?', createdAt: 1 };
  const [record] = answerConflicts(message, result);
  assert.equal(record.status, 'UNRESOLVED'); assert.equal(record.messageId, 'answer');
  assert.equal(record.supporting[0].version, 'approved-v1'); assert.equal(record.contradicting[0].version, 'approved-v2');
  assert.equal(answerConflicts(message, result)[0].id, record.id);
});

test('production orchestration corrects a historical count, preserves the valid sentence and reverifies against the historical version', async () => {
  const original = 'In 2024, remote work was permitted one day per week. Manager approval was required.';
  const corrected = 'In 2024, remote work was permitted three days per week. [1] Manager approval was required.';
  const evidence = [{ id: 'historical', source: 'policy.docx', version: 'approved-2024', chunkIndex: 0, text: 'In 2024, remote work was permitted three days per week. Manager approval was required.' }, { id: 'current', source: 'policy.docx', version: 'approved-2025', chunkIndex: 0, text: 'In 2025, remote work is permitted one day per week.' }];
  const decomposition = (text: string) => ({ sentences: answerSentences(text).map(s => ({ id: s.id, kind: 'FACTUAL', claims: [{ text: s.text.replace(/\s*\[\d+\]/g, ''), span: s.text.replace(/\s*\[\d+\]/g, '') }] })) });
  const verification = (text: string, bad: boolean) => ({ sentences: decomposition(text).sentences.map(s => ({ ...s, claims: s.claims.map(c => ({ ...c, verdict: bad && s.id === 1 ? 'CONTRADICTED' : 'SUPPORTED', supporting: bad && s.id === 1 ? [] : [{ index: 1, quote: evidence[0].text }], contradicting: bad && s.id === 1 ? [{ index: 1, quote: evidence[0].text }] : [], missingInformation: [], temporalValidity: 'APPLICABLE', scope: { time: '2024', place: null } })) })) });
  const responses = [decomposition(original), verification(original,true), { corrections: [{ claimId: 's1c1', replacement: 'In 2024, remote work was permitted three days per week.', evidence: [{ index: 1, quote: evidence[0].text }] }] }, decomposition(corrected), verification(corrected,false)];
  const previous = process.env.OPENROUTER_API_KEY; process.env.OPENROUTER_API_KEY = 'synthetic-test-only';
  try {
    const rag = new RagService({ revision: async () => 1, search: async () => evidence } as unknown as VectorStoreService);
    Object.defineProperty(rag, 'client', { value: { chat: { completions: { create: async () => {
      assert.ok(responses.length, 'No redundant verification or correction calls');
      return { model: 'controlled-fixture', choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(responses.shift()) } }], usage: { prompt_tokens: 0, completion_tokens: 0 } };
    } } } } });
    const generate = rag.generateAnswer.bind(rag);
    rag.generateAnswer = async (q,d,failed,signal,assessment) => failed ? generate(q,d,failed,signal,assessment) : original;
    const result = await rag.queryPipeline('What policy applied in 2024?', 'test-owner');
    assert.equal(result.verificationStatus, 'REPAIRED_VERIFIED'); assert.equal(result.draft, corrected);
    assert.equal(result.citations[0].version, 'approved-2024'); assert.equal(result.repairHistory[0].edits?.length, 1);
    assert.equal(result.repairHistory[0].after?.passed, true); assert.equal(responses.length, 0);
  } finally { if (previous === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = previous; }
});
