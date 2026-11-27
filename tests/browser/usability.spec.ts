import { test, expect, type Page } from '@playwright/test';

const answer = { draft: 'One day. [1]', status: 'supported', verificationStatus: 'VERIFIED_UNCHANGED', factCheck: { passed: true, claims: [], verdict: 'Supported', evidence: 'One day.' }, citations: [], attempts: 1, durationMs: 100 };
const chat = { id: 'chat-a', title: 'Engineering policy', messages: [{ id: 'm1', question: 'How many vacation days?', createdAt: '2026-11-20T10:00:00Z', result: answer }] };
async function nav(page: Page, title: string) {
  if (page.viewportSize()!.width <= 850) await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  await page.getByRole('button', { name: title, exact: true }).click();
}
test.beforeEach(async ({ page }) => {
  await page.route('**/api/auth/status', r => r.fulfill({ json: { needsSetup: false, registrationEnabled: true } }));
  await page.route('**/api/auth/me', r => r.fulfill({ json: { user: { id: 'qa', name: 'QA Tester', email: 'qa@example.test', role: 'member' } } }));
  await page.route('**/api/rag/health', r => r.fulfill({ json: { status: 'ok', providerConfigured: true } }));
  await page.route('**/api/rag/docs', r => r.fulfill({ json: [] }));
  await page.route('**/api/rag/conversations', r => r.fulfill({ json: [chat] }));
  await page.route('**/api/rag/corrections', r => r.fulfill({ json: { records: [], reviewedAnswers: 1, truncated: false } }));
  await page.route('**/api/rag/conflicts', r => r.fulfill({ json: { records: [], reviewedAnswers: 1, truncated: false } }));
});

test('theme switching preserves geometry across routes at phone, tablet and desktop widths', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'One context covers all viewport widths');
  for (const width of [360, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 844 }); await page.goto('/');
    await expect(page.getByRole('button', { name: 'Add documents', exact: true })).toBeEnabled();
    await page.evaluate(() => document.fonts.ready);
    for (const title of ['Knowledge base', 'Chat history', 'Chat workspace', 'Analytics', 'Corrections', 'Conflict center']) {
      await nav(page, title);
      const geometry = async () => page.locator('main').evaluate(el => [...el.querySelectorAll('.section-heading, .search-field, .metrics-grid, .assistant-heading, .composer-area')].map(e => { const r=e.getBoundingClientRect(); return { x:r.x, y:r.y, width:r.width, height:r.height }; }));
      const dark = page.getByRole('button', { name: 'Switch to dark mode', exact: true }); if (await dark.isVisible()) await dark.click();
      const before = await geometry();
      await page.getByRole('button', { name: 'Switch to light mode', exact: true }).click();
      expect(await geometry(), `${title} at ${width}px must retain layout`).toEqual(before);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
  }
});

test('sidebar search finds question text just like Chat history', async ({ page }) => {
  await page.goto('/'); await nav(page, 'Chat history');
  await page.getByRole('textbox', { name: 'Search conversations', exact: true }).fill('vacation');
  await expect(page.locator('.history-row')).toContainText(chat.title);
  if (page.viewportSize()!.width <= 850) await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  await page.getByRole('textbox', { name: 'Search chat history', exact: true }).fill('vacation');
  await expect(page.locator('.conversation-link')).toContainText(chat.title);
});

test('workspace pages support browser back, forward and reload without losing drafts', async ({ page }) => {
  await page.goto('/'); await nav(page, 'Chat workspace');
  await page.getByLabel('Ask your knowledge base').fill('Keep this draft while I check history');
  await nav(page, 'Chat history'); await nav(page, 'Analytics');
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Chat history', exact: true })).toBeVisible();
  await page.goBack();
  await expect(page.getByLabel('Ask your knowledge base')).toHaveValue('Keep this draft while I check history');
  await page.goForward();
  await expect(page.getByRole('heading', { name: 'Chat history', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Chat history', exact: true })).toBeVisible();
  // Re-selecting the current page must not add duplicate Back steps.
  await nav(page, 'Chat history'); await nav(page, 'Analytics'); await page.goBack();
  await expect(page.getByRole('heading', { name: 'Chat history', exact: true })).toBeVisible();
  await page.goBack();
  await expect(page.getByLabel('Ask your knowledge base')).toBeVisible();
  await page.goto('/#unknown');
  await expect(page.getByRole('button', { name: 'Add documents', exact: true })).toBeEnabled();
});

test('chat deletion is discoverable, confirmed, failure-safe and persistent', async ({ page }, info) => {
  let exists = true, fail = true, deletes = 0;
  await page.route('**/api/rag/conversations', r => r.fulfill({ json: exists ? [chat] : [] }));
  await page.route('**/api/rag/conversations/chat-a', r => {
    expect(r.request().method()).toBe('DELETE'); deletes++;
    if (fail) return r.fulfill({ status: 503, json: { message: 'Delete temporarily unavailable.' } });
    exists = false; return r.fulfill({ json: { success: true } });
  });
  await page.goto('/'); await nav(page, 'Chat history');
  await page.getByLabel(`Chat actions for ${chat.title}`, { exact: true }).click();
  await page.getByRole('button', { name: 'Delete chat', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete chat?' });
  await expect(dialog).toContainText(chat.title);
  await page.screenshot({ path: `data/qa-delete-${info.project.name}.png` });
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click(); expect(deletes).toBe(0);
  await page.locator('.history-row').click();
  await page.screenshot({ path: `data/qa-chat-${info.project.name}.png` });
  await page.getByLabel('Chat actions', { exact: true }).click();
  await page.getByRole('button', { name: 'Delete chat', exact: true }).click();
  await dialog.getByRole('button', { name: 'Delete chat', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Delete temporarily unavailable.');
  expect(exists).toBe(true);
  fail = false; await dialog.getByRole('button', { name: 'Delete chat', exact: true }).click();
  await expect(dialog).not.toBeVisible(); await expect(page.getByRole('heading', { name: 'Chat history', exact: true })).toBeVisible();
  await expect(page.locator('.history-row')).toHaveCount(0);
  await page.reload(); await nav(page, 'Chat history'); await expect(page.locator('.history-row')).toHaveCount(0);
  expect(deletes).toBe(2);
});
