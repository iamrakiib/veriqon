// Documentation only: current UI with synthetic, non-private browser fixtures.
// Start the frontend on localhost, then: node scripts/capture-screenshots.mjs URL
import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
const origin = process.argv[2] || 'http://127.0.0.1:3018';
if (!['localhost', '127.0.0.1'].includes(new URL(origin).hostname)) throw new Error('Use a local frontend only.');
const source = { id: 'policy', source: 'engineering-policy.md', version: 'approved-2026', chunkCount: 2, hasOriginal: true,
  text: 'Engineering permits one remote-work day per week. Manager approval is required. The policy takes effect on 1 January 2026.' };
const citation = { index: 1, documentId: source.id, source: source.source, version: source.version, chunkIndex: 0, excerpt: source.text };
const answer = 'Engineering permits one remote-work day per week. Manager approval is required. [1]';
const result = { draft: answer, status: 'supported', verificationStatus: 'VERIFIED_UNCHANGED', attempts: 1, durationMs: 2400, correction: null,
  citations: [citation], factCheck: { passed: true, schemaValid: true, verdict: 'Claims supported by quoted evidence and model assessment',
    evidence: source.text, claims: [{ sentence: answer, supported: true, evidenceIndexes: [1] }],
    atomicClaims: [
      { id: 's1c1', text: 'Engineering permits one remote-work day per week.', verdict: 'SUPPORTED', supporting: [{ index: 1, quote: 'Engineering permits one remote-work day per week.' }], contradicting: [] },
      { id: 's2c1', text: 'Manager approval is required.', verdict: 'SUPPORTED', supporting: [{ index: 1, quote: 'Manager approval is required.' }], contradicting: [] },
    ] }, repairHistory: [], modelUsage: [] };
const question = 'What is the remote-work policy for Engineering, and is approval required?';
const date = '2026-11-23T09:30:00Z';
const conversation = { id: 'policy-review', title: 'Engineering policy review', messages: [{ id: 'policy-answer', question, createdAt: date, result }] };
const opposing = { ...citation, index: 2, documentId: 'memo', source: 'team-memo.md', version: 'memo-2026', excerpt: 'Engineering permits three remote-work days per week.', quote: 'Engineering permits three remote-work days per week.' };
const conflicts = { coverage: 'saved_answer_assessments', reviewedAnswers: 1, truncated: false, records: [{
  id: 'policy-disagreement', question, claim: 'Engineering remote-work allowance', detectedAt: date, status: 'UNRESOLVED',
  scope: { time: 'Effective from January 2026', place: 'Engineering' },
  reason: 'The policy and team memo specify different allowances for the same team. No source precedence has been established.',
  supporting: [{ ...citation, quote: 'Engineering permits one remote-work day per week.' }], contradicting: [opposing],
}] };
const browser = await chromium.launch();
await mkdir('docs/screenshots', { recursive: true });
try {
  for (const mobile of [false, true]) {
    const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 }, deviceScaleFactor: 1, colorScheme: 'dark' });
    const page = await context.newPage();
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.route('**/api/**', async route => {
      const path = new URL(route.request().url()).pathname.replace('/api/', '');
      const fixtures = {
        'auth/status': { needsSetup: false, registrationEnabled: true },
        'auth/me': { user: { id: 'screenshot-fixture', name: 'Alex Morgan', email: 'alex@example.test', role: 'owner' } },
        'rag/health': { status: 'ok', providerConfigured: true, storage: 'postgresql' },
        'rag/docs': [source, { ...source, id: 'memo', source: opposing.source, text: opposing.excerpt, version: opposing.version, chunkCount: 1 }],
        'rag/conversations': [conversation], 'rag/conflicts': conflicts, 'rag/query': result,
      };
      if (!(path in fixtures)) { errors.push(`Unmocked screenshot route: ${path}`); await route.fulfill({ status: 404, json: {} }); return; }
      await route.fulfill({ json: fixtures[path] });
    });
    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('button', { name: 'Add documents' })).toBeEnabled();
    const navigate = async name => {
      if (mobile) await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
      await page.getByRole('button', { name, exact: true }).click();
    };
    await navigate('Chat history');
    await page.getByRole('main').getByRole('button', { name: /Engineering policy review/ }).click();
    await expect(page.getByText(answer)).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    const capture = async name => {
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `docs/screenshots/${name}.png`, animations: 'disabled' });
    };
    await capture(mobile ? 'chat-mobile' : 'chat-dark');
    if (!mobile) {
      await page.getByRole('button', { name: 'Switch to light mode' }).click();
      await capture('chat-light');
      await page.getByRole('button', { name: 'Switch to dark mode' }).click();
      await navigate('Conflict center');
      await page.getByRole('button', { name: /Engineering remote-work allowance/ }).click();
      await expect(page.getByText('Unresolved · human review needed')).toBeVisible();
      await capture('conflict-review');
    }
    expect(errors).toEqual([]);
    await context.close();
  }
  console.log('Captured four current UI screenshots using synthetic fixtures.');
} finally { await browser.close(); }
