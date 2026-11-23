import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RagService, completionText } from '../rag/rag.service';
import { VectorStoreService, namedDocumentIds } from '../vector-store/vector-store.service';
import { asksInventory, asksProvenance } from '../rag/query-context';
import { compatibleQuestionScope } from '../rag/answer-cache';
import { quantities, parseClaimVerification } from '../rag/verification';
import { resolveDocumentScope, inheritDocumentScope } from '../rag/document-scope';

const library = [{ id: 'resume', source: 'my_resume.pdf' }, { id: 'paper', source: 'Tkg_new.pdf' }];
const context = { turns: [{ question: 'What is the name in the resume?', answer: 'The name is Example Person.' }], citations: [{ documentId: 'resume', source: 'my_resume.pdf', version: 'v1' }] };
function fixture() {
  const searches: { query: string; scope?: string[] }[] = [];
  const store = { revision: async () => 1, inventory: async () => library,
    conversationContext: async (owner: string, conversation: string) => owner === 'alice' && conversation === 'alice-chat' ? context : undefined,
    search: async (query: string, _k: number, _signal: AbortSignal, _owner: string, scope?: string[]) => { searches.push({ query, scope }); return [{ id: 'resume', source: 'my_resume.pdf', version: 'v1', chunkIndex: 0, text: 'The person works as a researcher.' }]; } };
  const rag = new RagService(store as unknown as VectorStoreService);
  rag.generateAnswer = async () => 'The person works as a researcher.';
  rag.factCheck = async draft => parseClaimVerification(JSON.stringify({ sentences: [{ id: 1, kind: 'FACTUAL', claims: [{ text: draft, span: draft, verdict: 'SUPPORTED', supporting: [{ index: 1, quote: draft }], contradicting: [], missingInformation: [], temporalValidity: 'UNKNOWN', scope: { time: null, place: null } }] }] }), draft, [{ id: 'resume', chunkIndex: 0, text: draft }]);
  return { rag, searches };
}
test('workspace inventory answers count the entire authorized library without retrieval or LLM calls', async () => {
  const { rag, searches } = fixture(); rag.generateAnswer = async () => { throw Error('Must not invoke provider'); };
  const result = await rag.queryPipeline('how many document is given here ?? in my workspace?? if i want to extract any resume content then from where u would extract?', 'alice');
  assert.equal(result.answerOrigin, 'workspace_metadata'); assert.match(result.draft, /2 documents/);
  assert.match(result.draft, /my_resume.pdf/); assert.match(result.draft, /Tkg_new.pdf/);
  assert.equal(result.modelUsage.length, 0); assert.equal(searches.length, 0); assert.equal(result.claimsChecked, 0);
  assert.equal(asksInventory('How many documents were evaluated in the paper?'), false);
  assert.equal(asksInventory('What are the results in my uploaded documents?'), false);
});
test('source explanations use saved provenance and do not fabricate a reason or search a mentioned paper', async () => {
  const { rag, searches } = fixture();
  const q = 'for the previous answer, why did u extracted information from tkg source paper?';
  assert.equal(asksProvenance(q), true);
  const result = await rag.queryPipeline(q, 'alice', 'alice-chat');
  assert.equal(result.answerOrigin, 'saved_provenance'); assert.match(result.draft, /my_resume.pdf/);
  assert.doesNotMatch(result.draft, /Tkg_new.pdf/); assert.match(result.draft, /does not establish why/);
  assert.equal(searches.length, 0);
  const outsider = await rag.queryPipeline(q, 'bob', 'alice-chat');
  assert.doesNotMatch(outsider.draft, /my_resume.pdf/); assert.match(outsider.draft, /no successfully verified/);
});
test('follow-up retrieval retains authorized source context, permits explicit overrides and cannot reuse a context-free cache entry', async () => {
  const { rag, searches } = fixture();
  await rag.queryPipeline('what is the persons professions', 'alice');
  const result = await rag.queryPipeline('what is the persons professions', 'alice', 'alice-chat');
  assert.equal(result.contextUsed, true); assert.equal(result.cache.kind, 'miss'); assert.equal(searches.length, 2);
  assert.deepEqual(searches[1].scope, ['resume']); assert.match(searches[1].query, /name in the resume/);
  await rag.queryPipeline('How is this method built in Tkg_new.pdf?', 'alice', 'alice-chat');
  assert.deepEqual(searches[2].scope, ['paper']);
  await rag.queryPipeline('Compare it across all documents', 'alice', 'alice-chat');
  assert.equal(searches[3].scope, undefined);
});
test('common filename topic words do not silently restrict candidate retrieval', () => {
  const docs = [{ id: 'a', source: 'model_overview.pdf' }, { id: 'b', source: 'experiments.pdf' }];
  assert.equal(namedDocumentIds('What are the model results?', docs), undefined);
  assert.deepEqual(namedDocumentIds('Summarize model_overview.pdf', docs), ['a']);
  assert.deepEqual(namedDocumentIds('what tkg paper is about', library), ['paper']);
  assert.deepEqual(namedDocumentIds('Read data.pdf', [{ id: 'a', source: 'a.pdf' }, { id: 'data', source: 'data.pdf' }]), ['data']);
  assert.equal(namedDocumentIds('What are the risk factors?', [{ id: 'risk', source: 'risk.pdf' }, { id: 'study', source: 'study.pdf' }]), undefined);
});
test('numeric guards retain negative signs in evidence verification and semantic cache scope', () => {
  assert.deepEqual(quantities('The score is −5 and +2 [1].'), ['-5','2']);
  assert.equal(compatibleQuestionScope('What happens at -5 degrees?', 'What happens at 5 degrees?'), false);
  assert.equal(compatibleQuestionScope('What happens after 5e-3 seconds?', 'What happens after 8e-3 seconds?'), false);
  assert.equal(compatibleQuestionScope('What happens after .5 seconds?', 'What happens after 5 seconds?'), false);
  assert.equal(compatibleQuestionScope('What happens after 5e-3 seconds?', 'What happens after 0.005 seconds?'), true);
  const draft = 'The score was 5.';
  const result = parseClaimVerification(JSON.stringify({ sentences: [{ id: 1, kind: 'FACTUAL', claims: [{ text: draft, span: draft, verdict: 'SUPPORTED', supporting: [{ index: 1, quote: 'The score was -5.' }], contradicting: [], missingInformation: [], temporalValidity: 'UNKNOWN', scope: { time: null, place: null } }] }] }), draft, [{ id: 'paper', chunkIndex: 0, text: 'The score was -5.' }]);
  assert.equal(result.atomicClaims![0].verdict, 'INSUFFICIENT_EVIDENCE');
});

test('explicit comparison filenames exclude other same-year sources and bare years are never acronyms', () => {
  const docs = [{ id: 'policy', source: 'aurora-2026-policy.txt' }, { id: 'memo', source: 'aurora-2026-memo.txt' }, { id: 'sales', source: 'aurora-sales.txt' }];
  assert.deepEqual(namedDocumentIds('Compare aurora-2026-policy.txt with aurora-sales.txt in 2026.', docs), ['policy', 'sales']);
  assert.equal(namedDocumentIds('What is the policy in 2026?', docs), undefined);
  assert.deepEqual(namedDocumentIds('Compare aurora-2026-policy.txt and aurora-2026-memo.txt.', docs), ['policy', 'memo']);
  assert.equal(namedDocumentIds('Compare aurora-2026-policy.txt with other sources.', docs), undefined);
});
test('provider error envelopes preserve safe rate-limit and billing classifications without raw metadata', () => {
  const envelope = (code: number) => ({ error: { code, message: 'secret provider details' } }) as unknown as Parameters<typeof completionText>[0];
  assert.throws(() => completionText(envelope(429), 'Generation'), /rate limit/);
  assert.throws(() => completionText(envelope(402), 'Generation'), /insufficient credits/);
  assert.throws(() => completionText(envelope(502), 'Generation'), e => e instanceof Error && !e.message.includes('secret'));
});

const policies = [{ id: 'one', source: 'note.txt' }, { id: 'three', source: 'note b.txt' }, ...library];
test('filename separators are aliases, exact spelling wins, and missing or ambiguous filenames never widen retrieval', () => {
  assert.deepEqual(resolveDocumentScope('According to note-b.txt, how many remote days?', policies).ids, ['three']);
  assert.deepEqual(resolveDocumentScope('Compare note.txt and note_b.txt.', policies).ids, ['one', 'three']);
  assert.ok(resolveDocumentScope('Compare note.txt and secret.pdf', policies).issue);
  const duplicates = [...policies, { id: 'duplicate', source: 'note-b.txt' }];
  assert.deepEqual(resolveDocumentScope('Read note-b.txt', duplicates).ids, ['duplicate']);
  assert.ok(resolveDocumentScope('Read note_b.txt', duplicates).issue);
  assert.ok(resolveDocumentScope('Read note.txt', [...policies, { id: 'duplicate', source: 'note.txt' }]).issue);
  assert.deepEqual(resolveDocumentScope('Compare the results within note.txt', policies).ids, ['one']);
});

test('two-file follow-ups use recent explicit filenames, including conflicted answers, and reject missing referents', () => {
  const questions = ['Explain Tkg_new.pdf', 'According to note.txt, remote days?', 'According to note-b.txt, remote days?'];
  assert.deepEqual(inheritDocumentScope('According to these two policy files, how many vacation days?', questions, policies).ids, ['three','one']);
  assert.deepEqual(inheritDocumentScope('Compare both files', ['Compare note.txt with note b.txt'], policies).ids, ['one','three']);
  assert.ok(inheritDocumentScope('Compare both files', ['Read note.txt'], policies).issue);
  assert.ok(inheritDocumentScope('Compare both files', questions, policies.filter(p => p.id !== 'three')).issue);
  assert.ok(inheritDocumentScope('What does this document say?', ['Compare note.txt with note b.txt'], policies).issue);
});

test('pipeline focuses initial and targeted retrieval, clarifies missing filenames without AI, and ignores unauthorized history', async () => {
  const calls: { question: string; scope?: string[] }[] = [];
  const store = { revision: async () => 1, inventory: async () => policies,
    conversationContext: async (owner: string) => owner === 'alice' ? { turns: [], citations: [], sourceQuestions: ['Read note.txt', 'Read note-b.txt'] } : undefined,
    search: async (question: string, _k: number, _s: AbortSignal, _owner: string, scope?: string[]) => { calls.push({ question, scope }); return (scope || ['one']).map(id => ({ id, source: policies.find(d => d.id === id)?.source, chunkIndex: 0, text: 'Remote work requires approval.' })); }
  } as unknown as VectorStoreService;
  const rag = new RagService(store);
  rag.generateAnswer = async () => 'Insufficient information.';
  await rag.queryPipeline('According to note-b.txt, remote days?', 'alice');
  assert.ok(calls.length >= 2); assert.ok(calls.every(c => JSON.stringify(c.scope) === '["three"]'));
  calls.length = 0;
  const pair = await rag.queryPipeline('According to these two policy files, vacation days?', 'alice', 'chat');
  assert.deepEqual('documentScope' in pair && pair.documentScope, ['three','one']);
  assert.ok(calls.every(c => JSON.stringify(c.scope) === '["three","one"]'));
  calls.length = 0;
  for (const [q, owner] of [['Read secret.pdf', 'alice'], ['Compare both files', 'bob']]) {
    const result = await rag.queryPipeline(q, owner, 'chat');
    assert.equal('reason' in result && result.reason, 'source_selection_required'); assert.equal(result.modelUsage.length, 0);
  }
  assert.equal(calls.length, 0);
  store.search = async () => [{ id: 'one', source: 'note.txt', chunkIndex: 0, chunkEndIndex: 0, text: 'One source only.', score: 1, retrievalMode: 'hybrid' }];
  rag.generateAnswer = async () => { throw Error('Must not compare an incomplete set of sources'); };
  const incomplete = await rag.queryPipeline('Compare note.txt and note-b.txt', 'alice');
  assert.match(incomplete.draft, /every selected file/); assert.equal(incomplete.attempts, 0);
});
