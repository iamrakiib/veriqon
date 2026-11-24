import { config } from 'dotenv';
import { mkdirSync, writeFileSync } from 'node:fs';
import { loadResearchFixtures, runResearchCase, checkDemo, scoreNumericalFacts } from './research-core';

async function main() {
  const live = process.argv.includes('--live');
  if (live) {
    config({ path: process.env.EVAL_ENV_FILE || '.env' });
    if (!process.env.OPENROUTER_API_KEY || !process.env.LLM_MODEL) throw new Error('Live evaluation requires your configured key and explicit LLM_MODEL.');
  } else {
    // Offline means no credentials, network model calls, database or user documents.
    Object.assign(process.env, { OPENROUTER_API_KEY: 'synthetic-test-only', OPENROUTER_BASE_URL: 'http://127.0.0.1:9',
      LLM_MODEL: 'controlled-fixture', VERIFIER_MODEL: 'controlled-fixture', DECOMPOSER_MODEL: 'controlled-fixture', MAX_REPAIR_ATTEMPTS: '1', SEMANTIC_CACHE_ENABLED: 'false' });
  }
  const { data, hash } = loadResearchFixtures();
  const selected = process.argv.find(arg => arg.startsWith('--case='))?.slice(7);
  const cases = data.cases.filter(c => !selected || c.id === selected);
  if (!cases.length) throw new Error('Unknown research case');
  const rows: any[] = [];
  for (const fixture of cases) {
    rows.push({ variant: 'uncorrected-fixed-draft', case: fixture.id, answer: fixture.draft, numerical: scoreNumericalFacts(fixture.draft, fixture),
      latencyMs: null, tokens: null, note: 'Fixed input, not a timed generation baseline.' });
    try {
      const run = await runResearchCase(data, fixture, live), { result } = run;
      const protocolPassed = live ? null : checkDemo(data, fixture, run);
      const numerical = scoreNumericalFacts(result.draft, fixture);
      rows.push({ variant: 'rac-inspired', case: fixture.id, protocolPassed, numerical, ...run,
        repairNeeded: fixture.repairNeeded, repairSucceeded: fixture.repairNeeded && result.status === 'repaired' && numerical.unsupported === 0 && numerical.covered === numerical.expected,
        unnecessaryRepair: !fixture.repairNeeded && result.status === 'repaired',
        providerFailure: 'reason' in result && (result.reason === 'generation_failed' || result.reason === 'verification_failed'),
        tokenUsageComplete: live && result.modelUsage.length > 0 && result.modelUsage.every(c => c.promptTokens !== null && c.completionTokens !== null),
        reportedTokens: live ? result.modelUsage.reduce((sum, c) => sum + (c.promptTokens || 0) + (c.completionTokens || 0), 0) : null });
      console.log(`${fixture.id}: ${result.verificationStatus}${live ? '' : protocolPassed ? ' (protocol passed)' : ' (PROTOCOL FAILED)'}`);
    } catch {
      rows.push({ variant: 'rac-inspired', case: fixture.id, executionFailure: true });
      console.log(`${fixture.id}: execution failed; see provider configuration and quota`);
    }
  }
  const corrected = rows.filter(r => r.variant === 'rac-inspired');
  const ratio = (a: number, b: number) => b ? a / b : null;
  const summaries = ['uncorrected-fixed-draft', 'rac-inspired'].map(variant => {
    const selectedRows = rows.filter(r => r.variant === variant), total = (key: string) => selectedRows.reduce((sum, r) => sum + Number(r.numerical?.[key] || 0), 0);
    return { variant, cases: selectedRows.length, executionFailures: selectedRows.filter(r => r.executionFailure).length,
      numericFactCorrectness: ratio(total('correct'), total('returned')), numericUnsupportedRate: ratio(total('unsupported'), total('returned')),
      expectedNumericCoverage: ratio(total('covered'), cases.reduce((sum, c) => sum + Object.keys(c.expectedFacts).length, 0)),
      repairSuccessRate: variant === 'rac-inspired' ? ratio(selectedRows.filter(r => r.repairSucceeded).length, cases.filter(c => c.repairNeeded).length) : null,
      unnecessaryRepairRate: variant === 'rac-inspired' ? ratio(selectedRows.filter(r => r.unnecessaryRepair).length, cases.filter(c => !c.repairNeeded).length) : null };
  });
  const report = { generatedAt: new Date().toISOString(), mode: live ? 'live-provider-controlled-retrieval' : 'offline-scripted-provider-protocol-test',
    datasetHash: hash, groundTruth: data.provenance,
    protocol: 'Same fixed drafts and evidence for both variants. Initial generation and embedding are excluded. No LLM grades the answers. Offline outcomes test orchestration only; live numeric grading is vocabulary-limited and cannot grade arbitrary semantic claims.',
    independentlyHumanReviewed: false, generalClaimCorrectness: null, citationEntailmentAccuracy: null, apiCost: null,
    cases: cases.map(c => c.id), summaries, rows };
  mkdirSync('data', { recursive: true });
  const output = `data/research-${live ? 'live' : 'demo'}-${Date.now()}.json`;
  writeFileSync(output, JSON.stringify(report, null, 2));
  console.log(`Report: ${output}`);
  if (corrected.some(r => r.executionFailure || r.protocolPassed === false || r.providerFailure)) process.exitCode = 1;
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Research evaluation failed'); process.exitCode = 1; });
