import 'reflect-metadata';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { RagService } from '../src/rag/rag.service';
import { VectorStoreService } from '../src/vector-store/vector-store.service';
import { Evidence, answerSentences } from '../src/rag/verification';

export type ResearchCase = { id: string; question: string; draft: string; initial: string[]; extra: string[];
  expectedFacts: Record<string, number>; repairNeeded: boolean; expect: string; replacement?: string };
type Dataset = { version: number; provenance: string; documents: { id: string; source: string; text: string }[];
  annotations: { claim: string; document: string; quote: string }[]; corrections: { original: string; replacement: string }[]; cases: ResearchCase[] };
export function loadResearchFixtures(path = 'research/fixtures.json') {
  const raw = readFileSync(path, 'utf8'), data = JSON.parse(raw) as Dataset;
  if (data.version !== 1 || !Array.isArray(data.cases) || !Array.isArray(data.documents) || !Array.isArray(data.annotations)) throw new Error('Invalid research fixture schema');
  const ids = new Set(data.documents.map(d => d.id));
  if (ids.size !== data.documents.length || new Set(data.cases.map(c => c.id)).size !== data.cases.length) throw new Error('Duplicate research IDs');
  for (const a of data.annotations) if (!data.documents.find(d => d.id === a.document)?.text.includes(a.quote)) throw new Error('An annotation lacks an exact source quote');
  for (const c of data.cases) if (![...c.initial, ...c.extra].every(id => ids.has(id)) || !c.question || !c.draft) throw new Error('Invalid case evidence references');
  return { data, hash: createHash('sha256').update(raw).digest('hex') };
}
const clean = (text: string) => text.replace(/\s*\[\d+\]/g, '').trim();

/** Only used by offline evaluation. No production service imports this fixture provider. */
function fixtureCompletion(body: { messages: { content: string }[] }, data: Dataset, fixture: ResearchCase) {
  const input = JSON.parse(body.messages[body.messages.length - 1].content);
  if (input.assessment) {
    return { corrections: input.assessment.filter((c: any) => ['CONTRADICTED', 'TEMPORALLY_INVALID'].includes(c.verdict)).map((c: any) => {
      const correction = data.corrections.find(item => item.original === clean(c.text));
      const annotation = data.annotations.find(a => a.claim === correction?.replacement);
      const source = input.evidence.find((d: any) => annotation && d.text.includes(annotation.quote));
      if (!source || !correction || !annotation) throw new Error('Missing controlled correction');
      return { claimId: c.id, replacement: fixture.replacement || correction.replacement, evidence: [{ index: source.index, quote: annotation.quote }] };
    }) };
  }
  if (input.facts) return { conflicts: [], claims: input.facts.map((fact: any) => {
    const annotation = data.annotations.find(a => a.claim === clean(fact.text));
    const correction = data.corrections.find(c => c.original === clean(fact.text));
    const opposing = data.annotations.find(a => a.claim === correction?.replacement);
    const support = input.evidence.find((d: any) => annotation && d.text.includes(annotation.quote));
    const contradiction = input.evidence.find((d: any) => opposing && d.text.includes(opposing.quote));
    return { id: fact.id, verdict: support ? 'SUPPORTED' : contradiction ? 'CONTRADICTED' : 'INSUFFICIENT_EVIDENCE',
      supporting: support ? [{ index: support.index, quote: annotation!.quote }] : [],
      contradicting: contradiction ? [{ index: contradiction.index, quote: opposing!.quote }] : [],
      missingInformation: support || contradiction ? [] : ['The exact proposition is not established by these sources.'],
      temporalValidity: 'UNKNOWN', scope: { time: null, place: null } };
  }) };
  if (input.sentences) return { sentences: input.sentences.map((s: any) => ({ id: s.id, kind: 'FACTUAL', claims: [{ text: clean(s.text), span: clean(s.text) }] })) };
  throw new Error('Unexpected provider stage in controlled demo');
}
export async function runResearchCase(data: Dataset, fixture: ResearchCase, live: boolean) {
  let searches = 0;
  const evidence = (ids: string[]): Evidence[] => ids.map(id => {
    const d = data.documents.find(d => d.id === id)!;
    return { ...d, chunkIndex: 0, version: 'sha256:' + createHash('sha256').update(d.text).digest('hex') };
  });
  const store = { revision: async () => 1, inventory: async () => data.documents.map(d => ({ id: d.id, source: d.source })),
    search: async (_q: string, _k: number, _signal: AbortSignal, owner: string) => {
      if (owner !== 'synthetic-research') throw new Error('Unexpected research owner');
      return evidence(++searches === 1 ? fixture.initial : fixture.extra);
    } } as unknown as VectorStoreService;
  const rag = new RagService(store), originalGenerate = rag.generateAnswer.bind(rag);
  rag.generateAnswer = async (...args) => args[2] ? originalGenerate(...args) : fixture.draft;
  if (!live) Object.defineProperty(rag, 'client', { value: { chat: { completions: { create: async (body: any) => ({
    model: 'controlled-fixture-not-a-model', choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(fixtureCompletion(body, data, fixture)) } }]
  }) } } } });
  const started = performance.now();
  const result = await rag.queryPipeline(fixture.question, 'synthetic-research');
  return { result, searches, latencyMs: Math.round(performance.now() - started) };
}
const words: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5 };
export function numericalFacts(text: string) {
  return [...text.matchAll(/\b(\d+(?:\.\d+)?|one|two|three|four|five)\s*(datasets?|architectures?|days?|%)/gi)]
    .map(m => ({ key: m[2] === '%' ? 'accuracy' : m[2].toLowerCase().replace(/s?$/, 's'), value: words[m[1].toLowerCase()] ?? Number(m[1]) }));
}
export function scoreNumericalFacts(text: string, fixture: ResearchCase) {
  const facts = numericalFacts(text), correct = facts.filter(f => fixture.expectedFacts[f.key] === f.value).length;
  return { returned: facts.length, correct, unsupported: facts.length - correct,
    expected: Object.keys(fixture.expectedFacts).length,
    covered: Object.entries(fixture.expectedFacts).filter(([key, value]) => facts.some(f => f.key === key && f.value === value)).length };
}
export function checkDemo(data: Dataset, fixture: ResearchCase, run: Awaited<ReturnType<typeof runResearchCase>>) {
  const { result } = run;
  const checks = [result.verificationStatus === fixture.expect,
    result.citations.every(c => data.documents.some(d => d.id === c.documentId && d.text.includes(c.excerpt))),
    result.status !== 'repaired' || Boolean(result.correction && result.factCheck.passed && result.repairHistory.some(h => h.accepted && h.after?.passed))];
  if (fixture.id === 'already-correct') checks.push(result.draft === fixture.draft && result.repairHistory.length === 0);
  if (fixture.id === 'targeted-retrieval') checks.push(run.searches === 2);
  if (fixture.id === 'new-error-in-repair') checks.push(result.repairHistory.some(h => h.after && !h.after.passed));
  // Every original, already supported sentence must survive the controlled correction.
  for (const sentence of answerSentences(fixture.draft)) if (data.annotations.some(a => a.claim === clean(sentence.text))) checks.push(clean(result.draft).includes(clean(sentence.text)));
  return checks.every(Boolean);
}
