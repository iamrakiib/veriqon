import 'reflect-metadata';
import { config } from 'dotenv';
import { mkdirSync, writeFileSync, readFileSync } from 'fs';
import { execFileSync } from 'child_process';
import { resolve } from 'path';
import { createHash } from 'crypto';
import { RagService } from '../src/rag/rag.service';
import { VectorStoreService } from '../src/vector-store/vector-store.service';
import type { Evidence } from '../src/rag/verification';

// Synthetic source-of-truth records generate both passages and labels before any model calls.
// This is a closed-domain correction benchmark, not an independent human-annotated dataset.
const truth = { datasets: 2, architectures: 4, historicalDays: 3, currentDays: 1 };
const passage: Evidence = { id: 'synthetic-manuscript', source: 'manuscript.docx', version: 'approved-v1', chunkIndex: 0, text: `The adapter used ${truth.datasets} datasets. The adapter used ${truth.architectures} architectures. Numerical accuracy was not reported.` };
const intro: Evidence = { ...passage, chunkIndex: 9, text: 'The manuscript describes a forecasting adapter. Experimental details are in a different section.' };
const historical: Evidence = { id: 'policy', source: 'policy-2024.docx', version: 'approved-2024', chunkIndex: 0, text: `From January 1 through December 31, 2024, remote work was permitted ${truth.historicalDays} days per week.` };
const current: Evidence = { id: 'policy-current', source: 'policy-2025.docx', version: 'approved-2025', chunkIndex: 0, text: `Beginning January 1, 2025, remote work is permitted ${truth.currentDays} day per week. This policy does not apply to 2024.` };
const cases = [
  { id: 'incorrect-number', question: 'How many datasets and architectures did the adapter use?', draft: 'The adapter used five datasets. The adapter used four architectures.', initial: [passage], extra: [passage], expected: { datasets: 2, architectures: 4 }, repairNeeded: true },
  { id: 'already-correct', question: 'How many datasets and architectures did the adapter use?', draft: 'The adapter used two datasets. The adapter used four architectures.', initial: [passage], extra: [passage], expected: { datasets: 2, architectures: 4 }, repairNeeded: false },
  { id: 'targeted-retrieval', question: 'How many datasets did the adapter use?', draft: 'The adapter used two datasets.', initial: [intro], extra: [passage], expected: { datasets: 2 }, repairNeeded: false },
  { id: 'missing-evidence', question: 'What accuracy did the adapter achieve?', draft: 'The adapter achieved 95% accuracy.', initial: [intro], extra: [intro], expected: {}, repairNeeded: false },
  { id: 'historical-policy', question: 'How many remote work days per week were permitted in 2024?', draft: 'In 2024, remote work was permitted one day per week.', initial: [historical, current], extra: [historical, current], expected: { days: 3 }, repairNeeded: true }
];
const words: Record<string, number> = { one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10 };
function facts(text: string): { key: string; value: number }[] {
  return [...text.matchAll(/\b(\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten)\s*(?:benchmark\s+|forecasting\s+)?(datasets?|architectures?|days?|%)/gi)].map(m => ({ key: m[2] === '%' ? 'accuracy' : m[2].toLowerCase().replace(/s?$/, 's'), value: words[m[1].toLowerCase()] ?? Number(m[1]) }));
}
const ratio = (a: number, b: number) => b ? a / b : null;
async function main() {
  if (!process.argv.includes('--live')) throw new Error('Use --live to explicitly run provider calls on synthetic fixtures.');
  config({ path: process.env.EVAL_ENV_FILE || '.env' });
  if (!process.env.OPENROUTER_API_KEY) throw new Error('Configure the existing provider key in a private env file.');
  const baselineRevision = execFileSync('git', ['-C','data/rac-baseline','rev-parse','HEAD'], { encoding: 'utf8' }).trim();
  if (!baselineRevision.startsWith('7b06e3e')) throw new Error('The evaluation baseline must be checkout 7b06e3e; see docs/rac-method.md.');
  const baselineModule = resolve('data/rac-baseline/dist/src/rag/rag.service.js');
  const baselineModuleHash = createHash('sha256').update(readFileSync(baselineModule)).digest('hex');
  const Baseline: typeof RagService = (await import(baselineModule) as { RagService: typeof RagService }).RagService;
  const constructors = [{ name: 'veriqon-7b06e3e', Service: Baseline }, { name: 'rac-inspired-v3', Service: RagService }];
  const observations: Record<string, unknown>[] = [];
  for (const fixture of cases) for (const variant of constructors) {
    let searches = 0;
    const store = { revision: async () => 1, search: async (_q: string, _k: number, _signal: AbortSignal, owner: string) => { if (owner !== 'synthetic-evaluation') throw new Error('Unexpected account'); return (++searches === 1 ? fixture.initial : fixture.extra).map(d => ({ ...d })); } } as unknown as VectorStoreService;
    const service = new variant.Service(store), generate = service.generateAnswer.bind(service);
    service.generateAnswer = async (question, docs, failed, signal, assessment) => failed ? generate(question, docs, failed, signal, assessment) : fixture.draft;
    const started = Date.now();
    try {
      const result = await service.queryPipeline(fixture.question, 'synthetic-evaluation');
      const expected = fixture.expected as Record<string, number>, output = facts(result.draft), original = facts(fixture.draft);
      const correct = output.filter(f => expected[f.key] === f.value).length;
      const supportedCitations = output.filter(f => expected[f.key] === f.value && result.factCheck.atomicClaims?.some(c => facts(c.text).some(x => x.key === f.key && x.value === f.value) && c.supporting.some(q => result.citations.some(d => d.index === q.index && d.excerpt.includes(q.quote)) && facts(q.quote).some(x => x.key === f.key && x.value === f.value)))).length;
      const complete = Object.entries(expected).every(([key,value]) => output.some(f => f.key === key && f.value === value));
      const initiallyCorrect = original.filter(f => expected[f.key] === f.value);
      observations.push({ variant: variant.name, case: fixture.id, status: result.verificationStatus, answer: result.draft, repairNeeded: fixture.repairNeeded, repairSucceeded: fixture.repairNeeded && complete && correct === output.length && result.status === 'repaired', unnecessaryRepair: !fixture.repairNeeded && result.status === 'repaired', originalPreserved: result.draft === fixture.draft, supportedFactsPreserved: initiallyCorrect.filter(f => output.some(o => o.key === f.key && o.value === f.value)).length, initiallyCorrectFacts: initiallyCorrect.length, claimsReturned: output.length, claimsCorrect: correct, claimsUnsupported: output.length - correct, citationsSupported: supportedCitations, expectedFacts: Object.keys(expected).length, expectedFactsReturned: Object.entries(expected).filter(([key,value]) => output.some(f => f.key === key && f.value === value)).length, latencyMs: Date.now() - started, searches, modelUsage: result.modelUsage, factCheck: result.factCheck, repairHistory: result.repairHistory });
      console.log(`${variant.name} ${fixture.id}: ${result.verificationStatus}`);
    } catch (error) {
      observations.push({ variant: variant.name, case: fixture.id, repairNeeded: fixture.repairNeeded, failure: true, latencyMs: Date.now() - started, error: error instanceof Error ? error.message : 'Provider failed' });
      console.log(`${variant.name} ${fixture.id}: execution failed`);
    }
    mkdirSync('data', { recursive: true }); writeFileSync('data/rac-comparison-observations.json', JSON.stringify(observations,null,2));
  }
  const summaries = constructors.map(({name}) => {
    const rows = observations.filter(r => r.variant === name);
    const sum = (key: string) => rows.reduce((n,r) => n + Number(r[key] || 0),0);
    const calls = rows.flatMap(r => (r.modelUsage || []) as { promptTokens: number | null; completionTokens: number | null }[]);
    return { variant: name, cases: rows.length, failures: rows.filter(r => r.failure).length, claimCorrectness: ratio(sum('claimsCorrect'),sum('claimsReturned')), repairSuccessRate: ratio(sum('repairSucceeded'),rows.filter(r => r.repairNeeded).length), unnecessaryRepairRate: ratio(sum('unnecessaryRepair'),rows.filter(r => !r.repairNeeded).length), unsupportedClaimRate: ratio(sum('claimsUnsupported'),sum('claimsReturned')), citationSupportAccuracy: ratio(sum('citationsSupported'),sum('claimsReturned')), expectedFactCoverage: ratio(sum('expectedFactsReturned'),cases.reduce((n,c) => n + Object.keys(c.expected).length,0)), supportedFactPreservation: ratio(sum('supportedFactsPreserved'),cases.reduce((n,c) => n + facts(c.draft).filter(f => (c.expected as Record<string,number>)[f.key] === f.value).length,0)), meanLatencyMs: sum('latencyMs')/rows.length, promptTokens: calls.reduce((n,c)=>n+(c.promptTokens||0),0), completionTokens: calls.reduce((n,c)=>n+(c.completionTokens||0),0), tokenUsageComplete: rows.every(r => !r.failure) && calls.every(c=>c.promptTokens!==null&&c.completionTokens!==null) };
  });
  writeFileSync('data/rac-comparison.json', JSON.stringify({ generatedAt: new Date().toISOString(), baseline: baselineRevision, baselineModuleHash, datasetHash: createHash('sha256').update(JSON.stringify(cases)).digest('hex'), groundTruth: 'Programmatic synthetic source records; independent of model outputs, not externally human annotated.', protocol: 'Same fixed drafts, passages, provider configuration and pipeline deadline. Sequential runs. Draft-generation and embedding latency excluded. Production orchestrators; controlled retrieval. Numeric facts only; no general semantic accuracy claim. Token totals include only reported successful calls; inspect completeness flag.', models: { generator: process.env.LLM_MODEL, verifier: process.env.VERIFIER_MODEL, decomposer: process.env.DECOMPOSER_MODEL || process.env.VERIFIER_MODEL || process.env.LLM_MODEL }, summaries, cases },null,2));
  console.log(JSON.stringify(summaries,null,2));
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Evaluation failed'); process.exitCode = 1; });
