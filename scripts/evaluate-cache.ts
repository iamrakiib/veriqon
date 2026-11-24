import 'reflect-metadata';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { writeFileSync } from 'node:fs';
import { config as loadEnvironment } from 'dotenv';
import { RagService } from '../src/rag/rag.service';
import { VectorStoreService } from '../src/vector-store/vector-store.service';
import { parseClaimVerification, type Evidence } from '../src/rag/verification';

// Authored synthetic equivalence groups, not user history or a model-graded dataset.
// Production cache orchestration runs unchanged; retrieval/generation/verification are
// controlled fixtures. --live enables real embedding/equivalence calls; never database writes.
const groups = [
  ['How many datasets were used?', 'What is the number of datasets used?', 'How many datasets did the experiment use?', 'The experiment used three datasets.'],
  ['How many backbones were evaluated?', 'What number of backbones was evaluated?', 'How many backbone models were tested?', 'Four backbones were evaluated.'],
  ['What accuracy did the model report?', 'What was the reported model accuracy?', 'What accuracy value was reported for the model?', 'The model reported 92% accuracy.'],
  ['How many epochs did training run?', 'What was the number of training epochs?', 'For how many epochs was the model trained?', 'Training ran for 20 epochs.'],
  ['What batch size was used?', 'What was the training batch size?', 'How large was each training batch?', 'The training batch size was 32.'],
  ['What learning rate was used?', 'Which learning rate was used for training?', 'What was the training learning rate?', 'The learning rate was 0.001.'],
  ['How many random seeds were used?', 'What was the count of random seeds?', 'How many seeds were used in the experiment?', 'Five random seeds were used.'],
  ['How long did training take?', 'What was the training duration?', 'How much time did training require?', 'Training took two hours.'],
  ['How many layers does the encoder have?', 'What is the number of encoder layers?', 'How many layers are in the encoder?', 'The encoder has six layers.'],
  ['What is the embedding dimension?', 'How many dimensions do the embeddings have?', 'What dimensionality do the embeddings use?', 'The embedding dimension is 128.'],
  ['How many remote days are allowed per week?', 'What is the weekly remote-work day allowance?', 'How many days a week may employees work remotely?', 'One remote day is allowed per week.'],
  ['How many annual leave days are provided?', 'What is the annual leave allowance in days?', 'How many days of annual leave are available?', 'The annual leave allowance is 20 days.'],
  ['How long is the probation period?', 'What is the duration of probation?', 'How many months does probation last?', 'The probation period is three months.'],
  ['What is the meal reimbursement limit?', 'What is the maximum meal reimbursement?', 'How much may be reimbursed for a meal?', 'The meal reimbursement limit is 25 dollars.'],
  ['How many vacation days may be carried over?', 'What is the vacation carryover allowance?', 'How many unused vacation days can carry over?', 'Five vacation days may be carried over.'],
  ['What is the upload size limit?', 'What is the maximum upload file size?', 'How large can an uploaded file be?', 'The upload size limit is 10 megabytes.'],
  ['How many files can be uploaded in a batch?', 'What is the batch upload file limit?', 'What is the maximum number of files per upload batch?', 'An upload batch can contain 10 files.'],
  ['How long are access tokens valid?', 'What is the access-token lifetime?', 'How much time passes before an access token expires?', 'Access tokens are valid for 15 minutes.'],
  ['How many recovery codes are generated?', 'What is the number of generated recovery codes?', 'How many backup recovery codes are issued?', 'Eight recovery codes are generated.'],
  ['How long are cached answers retained?', 'What is the answer-cache retention duration?', 'How much time can an answer remain cached?', 'Cached answers are retained for five minutes.'],
];
type Kind = 'first_question' | 'exact_repeat' | 'whitespace_repeat' | 'paraphrase_a' | 'paraphrase_b';

async function main() {
  const live = process.argv.includes('--live');
  if (live) loadEnvironment({ quiet: true });
  const lookup = new Map<string, { group: number; answer: string; evidence: Evidence }>();
  groups.forEach(([original, a, b, answer], i) => {
    const fixture = { group: i, answer, evidence: { id: `fixture-${i + 1}`, text: answer, source: 'synthetic-cache-fixture.txt', version: 'fixture-v1', chunkIndex: i } };
    for (const question of [original, a, b]) lookup.set(question, fixture);
  });
  const questions = [...lookup.keys()];
  const vectors = live
    ? await new VectorStoreService({} as never).getEmbeddings(questions)
    : questions.map(q => groups.map((_g, i) => lookup.get(q)!.group === i ? 1 : 0));
  const vectorByQuestion = new Map(questions.map((q, i) => [q, vectors[i]]));
  const previousEnabled = process.env.SEMANTIC_CACHE_ENABLED;
  const runs = [];
  try {
    for (const enabled of [false, true]) {
      process.env.SEMANTIC_CACHE_ENABLED = String(enabled);
      let revision = 1, searches = 0, generations = 0, verifications = 0, gates = 0;
      const rag = new RagService({
        revision: async () => revision,
        queryEmbedding: async (q: string) => vectorByQuestion.get(q.trim())!,
        cachedQueryEmbedding: (q: string) => vectorByQuestion.get(q.trim()),
        search: async (q: string) => { searches++; return [lookup.get(q.trim())!.evidence]; },
      } as unknown as VectorStoreService);
      rag.generateAnswer = async q => { generations++; return lookup.get(q.trim())!.answer; };
      rag.factCheck = async (draft, docs) => {
        verifications++;
        return parseClaimVerification(JSON.stringify({ sentences: [{ id: 1, kind: 'FACTUAL', claims: [{
          text: draft, span: draft, verdict: 'SUPPORTED', supporting: [{ index: 1, quote: docs[0].text }], contradicting: [], missingInformation: [], temporalValidity: 'UNKNOWN', scope: { time: null, place: null },
        }] }] }), draft, docs);
      };
      const gate = rag.equivalentQuestions.bind(rag);
      rag.equivalentQuestions = async (a, b, signal) => { gates++; return live ? gate(a, b, signal) : lookup.get(a.trim())!.group === lookup.get(b.trim())!.group; };
      const rows: { group: number; kind: Kind; question: string; cacheHit: boolean; answerMatchesGroundTruth: boolean; cache: Awaited<ReturnType<RagService['queryPipeline']>>['cache']; modelUsage: Awaited<ReturnType<RagService['queryPipeline']>>['modelUsage']; durationMs: number }[] = [];
      const kinds: Kind[] = ['first_question', 'exact_repeat', 'whitespace_repeat', 'paraphrase_a', 'paraphrase_b'];
      for (const kind of kinds) for (const [i, group] of groups.entries()) {
        const question = kind === 'whitespace_repeat' ? `  ${group[0]}  ` : group[kind === 'paraphrase_a' ? 1 : kind === 'paraphrase_b' ? 2 : 0];
        const start = performance.now();
        const result = await rag.queryPipeline(question, 'cache-benchmark-owner');
        rows.push({ group: i + 1, kind, question, cacheHit: Boolean('cached' in result && result.cached), answerMatchesGroundTruth: result.draft === group[3], cache: result.cache, modelUsage: result.modelUsage, durationMs: performance.now() - start });
      }
      const callsFor100 = { searches, generations, verifications, equivalenceChecks: gates };
      const otherOwner = await rag.queryPipeline(groups[0][0], 'another-benchmark-owner');
      revision++;
      const newVersion = await rag.queryPipeline(groups[0][0], 'cache-benchmark-owner');
      assert.ok(!('cached' in otherOwner)); assert.ok(!('cached' in newVersion));
      const breakdown = kinds.map(kind => { const selected = rows.filter(r => r.kind === kind); return { kind, requests: selected.length, hits: selected.filter(r => r.cacheHit).length }; });
      const hits = rows.filter(r => r.cacheHit).length;
      runs.push({ mode: enabled ? 'semantic' : 'exact-only', requests: rows.length, hits, misses: rows.length - hits, breakdown, callsFor100,
        incorrectReuses: rows.filter(r => r.cacheHit && !r.answerMatchesGroundTruth).length,
        isolationChecks: { differentOwnerMiss: true, changedSourceRevisionMiss: true }, rows });
      console.log(JSON.stringify({ mode: enabled ? 'semantic' : 'exact-only', hits, requests: rows.length, breakdown, callsFor100 }));
    }
  } finally { if (previousEnabled === undefined) delete process.env.SEMANTIC_CACHE_ENABLED; else process.env.SEMANTIC_CACHE_ENABLED = previousEnabled; }
  const calls = runs.flatMap(r => r.rows.flatMap(row => row.modelUsage));
  const report = { generatedAt: new Date().toISOString(), liveEmbeddingsAndGate: live, semanticIntents: groups.length,
    protocol: 'Same 100 requests per mode: 20 original questions, 20 exact repeats, 20 whitespace-only repeats, 40 authored paraphrases. Real production cache orchestration with a fresh instance per mode. Retrieval, answer generation and evidence verification use fixed synthetic ground truth. No user data or database writes.',
    similarityAndGate: live ? 'Real configured provider embeddings (precomputed in batches) and real production equivalence LLM calls.' : 'Ideal one-hot vectors and an annotated equivalence gate are fixtures. This run measures wiring and policy, NOT semantic model accuracy.',
    limits: 'Equivalence labels are authored, not independently reviewed. Positive paraphrases only in the 100-request set; adversarial scope and isolation checks are separate unit tests. No live answer generation, independently measured factual accuracy, provider cost estimate, or production hit rate. Reported request duration excludes batched embedding preprocessing and actual answer-generation latency.',
    configuration: { threshold: Number(process.env.SEMANTIC_CACHE_THRESHOLD || 0.92), timeoutMs: Number(process.env.SEMANTIC_CACHE_TIMEOUT_MS || 8000), ttlMs: Number(process.env.ANSWER_CACHE_TTL_MS || 300000), embeddingModel: live ? process.env.EMBEDDING_MODEL : 'fixture', gateModel: live ? process.env.SEMANTIC_CACHE_MODEL || process.env.VERIFIER_MODEL || process.env.LLM_MODEL : 'fixture' },
    reportedGateTokens: calls.reduce((n,c) => n + (c.promptTokens || 0) + (c.completionTokens || 0), 0), usageComplete: calls.every(c => c.promptTokens !== null && c.completionTokens !== null), runs };
  const file = live ? 'docs/semantic-cache-live' : 'docs/semantic-cache-comparison';
  writeFileSync(file + '.json', JSON.stringify(report, null, 2) + '\n');
  writeFileSync(file + '.md', `# Semantic cache comparison\n\n${report.protocol}\n\n${report.similarityAndGate}\n\n| Mode | Requests | Hits | Incorrect reuses |\n| --- | ---: | ---: | ---: |\n${runs.map(r => `| ${r.mode} | ${r.requests} | ${r.hits} | ${r.incorrectReuses} |`).join('\n')}\n\n${report.limits}\n\nRun: \`npm run evaluate:cache${live ? ' -- --live' : ''}\`. See JSON for each request, model usage and actual cache decisions.\n`);
  if (runs.some(r => r.incorrectReuses)) process.exitCode = 1;
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Cache evaluation failed'); process.exitCode = 1; });
