// Checks real local UI/API records from evaluate-hard-queries.mjs; no provider mocks or model calls.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
const account = JSON.parse(fs.readFileSync('data/hard-query-account.json', 'utf8'));
assert.ok(account.email.startsWith('hard-query-'), 'Only the isolated evaluation account is allowed');
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const errors = [];
try {
  const login = await context.request.post('http://127.0.0.1:3000/auth/login', { headers: { 'X-Veriqon-Request': '1' }, data: { email: account.email, password: account.password } });
  assert.equal(login.status(), 200);
  const history = await context.request.get('http://127.0.0.1:3000/rag/conversations').then(r => r.json());
  const conflicts = await context.request.get('http://127.0.0.1:3000/rag/conflicts').then(r => r.json());
  const docs = await context.request.get('http://127.0.0.1:3000/rag/docs').then(r => r.json());
  const messages = history.flatMap(c => c.messages), results = messages.flatMap(m => m.result ? [m.result] : []);
  const verified = results.filter(r => !r.answerOrigin && r.factCheck.passed && r.status !== 'abstained' && ['VERIFIED_UNCHANGED','REPAIRED_VERIFIED'].includes(r.verificationStatus));
  const repairs = results.filter(r => !r.cached && (r.repairHistory?.length || r.correction));
  const tokens = results.flatMap(r => r.modelUsage || []).reduce((n,c) => n + (c.promptTokens || 0) + (c.completionTokens || 0), 0);
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:3001', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('button', { name: 'Add documents' })).toBeEnabled();
  const navigate = title => page.getByRole('button', { name: title, exact: true }).click();
  await navigate('Analytics');
  const metric = label => page.locator('.metric').filter({ hasText: label }).locator('strong');
  await expect(metric('Indexed documents')).toHaveText(String(docs.length));
  await expect(metric('Completed answers')).toHaveText(String(results.length));
  await expect(metric('Verified answers')).toHaveText(String(verified.length));
  await expect(metric('Verified repairs')).toHaveText(String(verified.filter(r => !r.cached && r.verificationStatus === 'REPAIRED_VERIFIED').length));
  await expect(metric('Reported tokens')).toHaveText(tokens.toLocaleString('en-US'));
  const outcome = label => page.getByText(label, { exact: true }).locator('..').locator('dd');
  await expect(outcome('Generation / verification failures')).toHaveText(String(results.filter(r => r.verificationStatus === 'VERIFICATION_FAILED').length));
  await expect(outcome('Answers with unresolved conflicts')).toHaveText(String(results.filter(r => r.verificationStatus === 'UNRESOLVED_CONFLICT').length));
  await expect(outcome('Abstained / partly verified')).toHaveText(String(results.filter(r => r.status === 'abstained' && !['VERIFICATION_FAILED','UNRESOLVED_CONFLICT'].includes(r.verificationStatus)).length));
  await page.screenshot({ path: 'data/hard-query-analytics.png' });
  await navigate('Corrections');
  await expect(page.locator('.correction-record')).toHaveCount(repairs.length);
  await navigate('Chat history'); await expect(page.locator('.history-row')).toHaveCount(history.filter(c => c.messages.length).length);
  await navigate('Conflict center'); await expect(page.locator('.conflict-row')).toHaveCount(conflicts.records.length);
  if (conflicts.records.length) {
    const record = conflicts.records[0], source = record.supporting[0];
    await page.locator('.conflict-row').first().click();
    await expect(page.locator('.conflict-detail')).toContainText(source.quote);
    await page.locator('.conflict-detail').getByRole('button', { name: `[${source.index}] ${source.source}`, exact: true }).click();
    await expect(page.getByRole('dialog')).toContainText(source.version);
    await page.getByRole('button', { name: 'Close dialog' }).click();
    await page.getByRole('button', { name: 'Open affected answer' }).click();
    await expect(page.locator(`#message-${record.messageId}`)).toBeVisible();
  }
  assert.deepEqual(errors, []);
  const result = { checkedAt: new Date().toISOString(), passed: true, documents: docs.length, completedAnswers: results.length, verifiedAnswers: verified.length, recordedRepairs: repairs.length, conflicts: conflicts.records.length, reportedTokens: tokens, runtimeErrors: errors };
  fs.writeFileSync('data/hard-query-ui-live.json', JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
} finally {
  await context.request.post('http://127.0.0.1:3000/auth/logout', { headers: { 'X-Veriqon-Request': '1' } }).catch(() => {});
  await browser.close();
}
