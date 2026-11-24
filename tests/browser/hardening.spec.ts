import { test, expect } from '@playwright/test';

const user = { id: 'account-a', name: 'Account A', email: 'a@example.test', role: 'owner' };
test.beforeEach(async ({ page }) => {
  await page.route('**/api/auth/status', r => r.fulfill({ json: { needsSetup: false, registrationEnabled: true } }));
  await page.route('**/api/auth/me', r => r.fulfill({ json: { user } }));
  await page.route('**/api/rag/health', r => r.fulfill({ json: { status: 'ok', providerConfigured: true } }));
  await page.route('**/api/rag/docs', r => r.fulfill({ json: [] }));
  await page.route('**/api/rag/conversations', r => r.fulfill({ json: [] }));
});

test('generation failure keeps source passages accessible without a verified badge and can be retried', async ({ page }) => {
  await page.route('**/api/rag/docs', r => r.fulfill({ json: [{ id: 'policy', source: 'policy.md', text: 'One day per week.', chunkCount: 1 }] }));
  await page.route('**/api/rag/query', r => r.fulfill({ json: {
    draft: 'The AI provider is unavailable. Review the retrieved passages; no answer was verified.', status: 'abstained', verificationStatus: 'VERIFICATION_FAILED', reason: 'generation_failed',
    factCheck: { passed: false, verdict: 'Generation unavailable; source passages only', evidence: 'No generated answer was verified.', claims: [] },
    citations: [{ index: 1, documentId: 'policy', source: 'policy.md', version: 'v2', chunkIndex: 0, excerpt: 'One day per week.' }], attempts: 1, durationMs: 1000, correction: null,
  } }));
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('button', { name: 'Add documents' })).toBeEnabled();
  await page.getByRole('button', { name: 'Show assistant' }).click();
  await page.getByLabel('Ask your knowledge base').fill('How many remote days?');
  await page.getByRole('button', { name: 'Send question' }).click();
  await expect(page.getByText('Source passages only', { exact: true })).toBeVisible();
  await expect(page.getByText('Verified', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '[1] policy.md', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('One day per week.');
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('button', { name: 'Retry this question' }).click();
  await expect(page.getByLabel('Ask your knowledge base')).toHaveValue('How many remote days?');
});

test('an old tab cannot silently replay private requests as a newly signed-in account', async ({ page }) => {
  let switched = false, reloadedAsB = false;
  await page.route('**/api/auth/me', r => r.fulfill({ json: { user: switched ? { ...user, id: 'account-b', name: 'Account B' } : user } }));
  await page.route('**/api/rag/docs', r => {
    const expected = r.request().headers()['x-veriqon-account'];
    if (!switched) expect(expected).toBe('account-a');
    if (switched && expected === 'account-a') return r.fulfill({ status: 409, json: { code: 'ACCOUNT_CHANGED', message: 'The signed-in account changed.' } });
    if (switched) { expect(expected).toBe('account-b'); reloadedAsB = true; }
    return r.fulfill({ json: [] });
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('button', { name: 'Add documents' })).toBeEnabled();
  await page.getByRole('button', { name: 'Show assistant' }).click();
  await page.getByLabel('Ask your knowledge base').fill('Private account A draft');
  switched = true;
  await page.getByRole('button', { name: 'Refresh workspace' }).click();
  await expect.poll(() => reloadedAsB).toBe(true);
  await expect(page.getByRole('button', { name: 'Add documents' })).toBeEnabled();
  await page.getByRole('button', { name: 'Show assistant' }).click();
  await expect(page.getByLabel('Ask your knowledge base')).toHaveValue('');
});

test('older conversations and messages can be loaded, retried and read without losing a draft', async ({ page }, info) => {
  const message = (id: string, question: string) => ({ id, question, error: 'Saved provider failure', createdAt: '2026-01-01T00:00:00Z' });
  const recent = { id: 'conversation-a', title: 'Recent research', cursor: 'next-conversations', hasMoreConversations: true, olderMessagesCursor: 'next-messages', messages: [message('recent', 'Latest saved question')] };
  await page.route('**/api/rag/conversations', r => r.fulfill({ json: [recent] }));
  await page.route('**/api/rag/conversations?before=next-conversations', r => r.fulfill({ json: [{ id: 'older-chat', title: 'Older research', hasMoreConversations: false, messages: [message('old-chat-message', 'An older topic')] }] }));
  let fail = true;
  await page.route('**/api/rag/conversations/conversation-a/messages?before=next-messages', r => r.fulfill(fail ? { status: 503, json: { message: 'Temporarily unavailable' } } : { json: { messages: [message('old-1', 'Earliest saved question'), message('old-2', 'Second saved question')], olderMessagesCursor: null } }));
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('button', { name: 'Add documents' })).toBeEnabled();
  await page.getByRole('button', { name: 'Show assistant' }).click();
  await page.getByLabel('Ask your knowledge base').fill('Keep this unfinished question');
  await page.getByRole('button', { name: 'Load older messages' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Older messages could not be loaded' })).toBeVisible();
  fail = false;
  await page.getByRole('button', { name: 'Load older messages' }).click();
  await expect(page.getByText('Earliest saved question', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Load older messages' })).toHaveCount(0);
  await expect(page.getByLabel('Ask your knowledge base')).toHaveValue('Keep this unfinished question');
  if (info.project.name === 'mobile') await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('button', { name: 'Chat history', exact: true }).click();
  await page.getByRole('button', { name: 'Load older conversations' }).click();
  await expect(page.getByRole('main').getByRole('button', { name: /Older research/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Load older conversations' })).toHaveCount(0);
  await page.getByRole('main').getByRole('button', { name: /Older research/ }).click();
  await expect(page.getByText('An older topic', { exact: true })).toBeVisible();
});

test('chat header returns to filtered history, preserves drafts and gives the conversation more height at its original width', async ({ page }, info) => {
  const answer = { draft: 'Engineering employees receive twenty paid vacation days. Manager approval is required for remote work. [1]', status: 'supported', verificationStatus: 'VERIFIED_UNCHANGED', factCheck: { passed: true, verdict: 'Supported', evidence: 'Exact policy passage', claims: [] }, citations: [], attempts: 1, durationMs: 500, correction: null };
  await page.route('**/api/rag/conversations', r => r.fulfill({ json: [
    { id: 'engineering', title: 'Engineering policy review', messages: [{ id: 'm1', question: 'According to these two policy files, how many paid vacation days does Engineering receive, and what approval is needed for remote work?', result: answer, createdAt: '2026-01-01T00:00:00Z' }] },
    { id: 'other', title: 'Another topic', messages: [{ id: 'm2', question: 'Unrelated saved question', error: 'Saved error', createdAt: '2026-01-01T00:00:00Z' }] }
  ] }));
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('button', { name: 'Add documents' })).toBeEnabled();
  await page.getByRole('button', { name: 'Show assistant' }).click();
  await page.getByRole('button', { name: 'Back to chat history' }).click();
  await page.getByRole('textbox', { name: 'Search conversations', exact: true }).fill('Engineering');
  await page.getByRole('main').getByRole('button', { name: /Engineering policy review/ }).click();
  await page.getByLabel('Ask your knowledge base').fill('Keep this draft when returning to history');
  await page.getByRole('button', { name: 'Back to chat history' }).click();
  await expect(page.getByRole('heading', { name: 'Chat history', exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Search conversations', exact: true })).toHaveValue('Engineering');
  await expect(page.getByRole('main').getByRole('button', { name: /Another topic/ })).toHaveCount(0);
  await page.getByRole('main').getByRole('button', { name: /Engineering policy review/ }).click();
  await expect(page.getByLabel('Ask your knowledge base')).toHaveValue('Keep this draft when returning to history');
  await expect(page.getByRole('button', { name: 'Back to chat history' })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  const bounds = await page.locator('.answer-text').boundingBox();
  if (info.project.name === 'desktop') { expect(bounds!.width).toBeGreaterThan(740); expect(bounds!.width).toBeLessThanOrEqual(800); }
  else expect(bounds!.width).toBeGreaterThan(320);
  const conversation = await page.locator('.chat-scroll').boundingBox();
  expect(conversation!.height).toBeGreaterThan(info.project.name === 'desktop' ? 720 : page.viewportSize()!.height * 0.55);
  const composer = await page.getByLabel('Ask your knowledge base').boundingBox();
  expect(composer!.y + composer!.height).toBeLessThan(page.viewportSize()!.height);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: `test-results/chat-room-${info.project.name}-dark.png`, fullPage: true });
  await page.getByRole('button', { name: 'Switch to light mode' }).click();
  await page.screenshot({ path: `test-results/chat-room-${info.project.name}-light.png`, fullPage: true });
});

test('ambiguous filename requests ask for sources without claiming a model verification', async ({ page }) => {
  await page.route('**/api/rag/query', r => r.fulfill({ json: {
    draft: 'Which two files should I compare? Include both filenames.', status: 'abstained', verificationStatus: 'INSUFFICIENT_EVIDENCE', reason: 'source_selection_required',
    factCheck: { passed: false, verdict: 'Source selection required', evidence: 'No retrieval or model call was made.', claims: [] }, citations: [], attempts: 0, durationMs: 1, correction: null
  } }));
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('button', { name: 'Add documents' })).toBeEnabled();
  await page.getByRole('button', { name: 'Show assistant' }).click();
  await page.getByLabel('Ask your knowledge base').fill('Compare both files');
  await page.getByRole('button', { name: 'Send question' }).click();
  await expect(page.getByText('Choose sources', { exact: true })).toBeVisible();
  await page.locator('.verification-detail summary').click();
  await expect(page.getByText('Source names were checked against your accessible library. No AI answer was generated.')).toBeVisible();
});
