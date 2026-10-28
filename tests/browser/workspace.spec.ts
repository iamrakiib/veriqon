import { test, expect, type Page } from '@playwright/test';

async function showAssistant(page: Page) {
  if ((page.viewportSize()?.width || 0) <= 640) await page.getByRole('button', { name: 'Show assistant' }).click();
}

const source = { id: 'policy', text: 'Employees may work remotely one day per week.', source: 'policy.md', chunkCount: 1, version: '1', hasOriginal: true };
const result = { draft: 'One day per week. [1]', status: 'repaired', factCheck: { verdict: 'All claims supported by model assessment', evidence: 'Supported: One day per week.', passed: true, claims: [] }, citations: [{ index: 1, documentId: 'policy', source: 'policy.md', chunkIndex: 0, excerpt: source.text }], attempts: 2, durationMs: 1200, correction: { original: 'Three days per week.', revised: 'One day per week. [1]', reason: 'Repaired using the retrieved policy.' } };

test.beforeEach(async ({ page }) => {
  await page.route('**/api/rag/conversations', route => route.fulfill({ json: [] }));
  await page.route('**/api/auth/status', route => route.fulfill({ json: { needsSetup: false, registrationEnabled: true } }));
  await page.route('**/api/auth/me', route => route.fulfill({ json: { user: { id: 'fixture', email: 'alex@example.com', name: 'Alex Morgan', role: 'owner' } } }));
  await page.route('**/api/rag/health', route => route.fulfill({ json: { status: 'ok', providerConfigured: true, storage: 'memory' } }));
});

test('upload, search, preview, chat, citations and repair history', async ({ page }, testInfo) => {
  let uploaded = false;
  await page.route('**/api/rag/docs', route => route.fulfill({ json: uploaded ? [source] : [] }));
  await page.route('**/api/rag/upload', async route => { expect(route.request().headers()['content-type']).toContain('multipart/form-data; boundary='); expect(route.request().postData()).toContain(source.text); uploaded = true; await route.fulfill({ json: { success: true }, status: 201 }); });
  await page.route('**/api/rag/query', async route => { expect(route.request().postDataJSON().query).toBe('How many days?'); await route.fulfill({ json: result }); });
  await page.route('**/api/rag/docs/policy/file', route => route.fulfill({ body: source.text, contentType: 'text/plain' }));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Make room for what you know' })).toBeVisible();
  await page.getByLabel('Upload documents').setInputFiles({ name: 'policy.md', mimeType: 'text/markdown', buffer: Buffer.from(source.text) });
  await expect(page.getByRole('button', { name: /policy.md.*Version 1/ })).toBeVisible();
  await page.getByRole('button', { name: /policy.md.*Version 1/ }).click();
  await expect(page.getByRole('dialog')).toContainText(source.text);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download original' }).click();
  expect((await download).suggestedFilename()).toBe('policy.md');
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByLabel('Search documents').fill('not-present');
  await expect(page.getByRole('heading', { name: 'No matching documents' })).toBeVisible();
  await page.getByRole('button', { name: 'Clear search' }).click();
  await showAssistant(page);
  await page.getByLabel('Ask your knowledge base').fill('How many days?');
  await page.getByRole('button', { name: 'Send question' }).click();
  await expect(page.getByText('Repaired & model checked')).toBeVisible();
  await page.getByRole('button', { name: '[1] policy.md' }).click();
  await expect(page.getByRole('dialog')).toContainText(source.text);
  await page.getByRole('button', { name: 'Close dialog' }).click();
  if (testInfo.project.name === 'mobile') await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('button', { name: /Answer repairs/ }).click();
  await expect(page.getByRole('main').getByText('Three days per week.', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('unsupported files and API failures are visible without fake success', async ({ page }) => {
  await page.route('**/api/rag/docs', route => route.fulfill({ json: [] }));
  await page.route('**/api/rag/query', route => route.fulfill({ status: 500, json: { message: 'Provider unavailable. Try again.' } }));
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Add documents' })).toBeEnabled();
  await page.getByLabel('Upload documents').setInputFiles({ name: 'policy.exe', mimeType: 'application/octet-stream', buffer: Buffer.from('not a supported text file') });
  await expect(page.getByText('Supported formats: PDF, DOCX, TXT and Markdown. Convert legacy .doc files to .docx.')).toBeVisible();
  await showAssistant(page);
  await page.getByLabel('Ask your knowledge base').fill('A question');
  await page.getByRole('button', { name: 'Send question' }).click();
  await expect(page.getByText('Provider unavailable. Try again.')).toBeVisible();
  await page.getByRole('button', { name: 'Edit and retry' }).click();
  await expect(page.getByLabel('Ask your knowledge base')).toHaveValue('A question');
});

test('offline state offers recovery and disables uploads', async ({ page }) => {
  await page.route('**/api/rag/docs', route => route.fulfill({ status: 503, json: { message: 'API is offline' } }));
  await page.goto('/');
  await expect(page.getByRole('alert').filter({ hasText: 'API is offline' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add documents' })).toBeDisabled();
  await page.route('**/api/rag/docs', route => route.fulfill({ json: [] }));
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Add documents' })).toBeEnabled();
});

test('reference layout renders without browser errors or horizontal overflow', async ({ page }, testInfo) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/rag/docs', route => route.fulfill({ json: [source] }));
  await page.goto('/');
  await expect(page.getByRole('button', { name: /policy.md.*Version 1/ })).toBeVisible();
  await expect(page).toHaveTitle('Veriqon | Knowledge workspace');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.screenshot({ path: `test-results/workspace-${testInfo.project.name}-dark.png`, fullPage: true });
  await page.getByRole('button', { name: 'Switch to light mode' }).click();
  await expect(page.locator('.dropzone')).toHaveCSS('background-color', 'rgb(250, 250, 250)');
  await page.screenshot({ path: `test-results/workspace-${testInfo.project.name}-light.png`, fullPage: true });
  if (testInfo.project.name === 'mobile') {
    await showAssistant(page);
    await page.screenshot({ path: 'test-results/assistant-mobile-light.png', fullPage: true });
    await page.getByRole('button', { name: 'Switch to dark mode' }).click();
    await expect(page.locator('.chat-panel')).toHaveCSS('background-color', 'rgb(17, 17, 17)');
    await page.screenshot({ path: 'test-results/assistant-mobile-dark.png', fullPage: true });
  }
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('theme persists across reload and system mode follows the device preference', async ({ page }, testInfo) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && /hydration|did not match/i.test(message.text())) errors.push(message.text()); });
  await page.route('**/api/rag/docs', route => route.fulfill({ json: [] }));
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  // The reference's black appearance is the initial default, even on a light OS.
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: 'Switch to light mode' }).click();
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(237, 237, 237)');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('button', { name: 'Switch to dark mode' }).click();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  if (testInfo.project.name === 'mobile') await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('button', { name: 'Workspace settings', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCSS('background-color', 'rgb(12, 12, 12)');
  await page.getByRole('radio', { name: 'System' }).check();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.getByRole('dialog')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('radio', { name: 'System' })).toBeChecked();
  expect(errors).toEqual([]);
});

test('theme controls still work when browser storage is blocked', async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => { throw new DOMException('Blocked', 'SecurityError'); };
    Storage.prototype.setItem = () => { throw new DOMException('Blocked', 'SecurityError'); };
  });
  await page.route('**/api/rag/docs', route => route.fulfill({ json: [] }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Switch to light mode' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('button', { name: 'Switch to dark mode' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('chat composer stays inside the viewport while long panels scroll independently', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Exercises desktop and mobile dimensions in a single browser.');
  const documents = Array.from({ length: 40 }, (_, i) => ({ ...source, id: `policy-${i}`, source: `policy-${String(i + 1).padStart(2, '0')}.md` }));
  await page.route('**/api/rag/docs', route => route.fulfill({ json: documents }));
  await page.route('**/api/rag/query', route => route.fulfill({ json: { ...result, draft: Array(50).fill('This long test answer must scroll inside the conversation panel.').join('\n\n') } }));
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Add documents' })).toBeEnabled();
  await page.getByLabel('Ask your knowledge base').fill('Show a long answer');
  await page.getByRole('button', { name: 'Send question' }).click();
  await expect(page.getByText('Repaired & model checked')).toBeVisible();
  for (const size of [{ width: 1920, height: 1080 }, { width: 1366, height: 768 }, { width: 1280, height: 720 }, { width: 1024, height: 600 }, { width: 800, height: 600 }, { width: 390, height: 844 }, { width: 390, height: 480 }]) {
    await page.setViewportSize(size);
    await showAssistant(page);
    for (const selector of ['.composer-area', '.send-button']) {
      const box = await page.locator(selector).boundingBox();
      expect(box, `${selector} visible at ${size.width}×${size.height}`).not.toBeNull();
      expect(box!.y).toBeGreaterThanOrEqual(0);
      expect(box!.y + box!.height).toBeLessThanOrEqual(size.height + 1);
    }
    expect(await page.evaluate(() => ({ height: document.documentElement.scrollHeight, width: document.documentElement.scrollWidth, scrollY: window.scrollY }))).toEqual({ height: size.height, width: size.width, scrollY: 0 });
    expect(await page.locator('.chat-scroll').evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
    if (size.width > 640) expect(await page.locator('main').evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
  }
  // Returning to the library keeps its documents and the conversation intact.
  await page.getByRole('button', { name: 'Show workspace' }).click();
  await expect(page.getByRole('button', { name: /policy-01.md.*Version 1/ })).toBeVisible();
  await showAssistant(page);
  await expect(page.getByText('Repaired & model checked')).toBeVisible();
});


test('saved chat history reopens after reload with answers, citations and repairs', async ({ page }, info) => {
  const saved: { id: string; title: string; messages: unknown[] }[] = [];
  await page.route('**/api/rag/docs', route => route.fulfill({ json: [source] }));
  await page.route('**/api/rag/conversations', route => route.fulfill({ json: saved }));
  await page.route('**/api/rag/query', route => {
    const body = route.request().postDataJSON();
    expect(body.conversationId).toMatch(/^[0-9a-f-]{36}$/);
    saved.push({ id: body.conversationId, title: body.query, messages: [{ id: 'saved-message', question: body.query, createdAt: new Date().toISOString(), result }] });
    return route.fulfill({ json: result });
  });
  await page.goto('/');
  await showAssistant(page);
  await expect(page.getByRole('button', { name: 'New conversation', exact: true }).first()).toBeEnabled();
  await page.getByLabel('Ask your knowledge base').fill('Remember this research question');
  await page.getByRole('button', { name: 'Send question' }).click();
  await expect(page.getByText('Repaired & model checked')).toBeVisible();
  await page.reload();
  await showAssistant(page);
  await expect(page.locator('.user-message')).toHaveText('Remember this research question');
  await expect(page.getByText('Repaired & model checked')).toBeVisible();
  await expect(page.getByRole('button', { name: '[1] policy.md' })).toBeVisible();
  if (info.project.name === 'mobile') await page.getByRole('button', { name: 'Open navigation' }).click();
  await expect(page.getByText('CHAT HISTORY', { exact: true })).toBeVisible();
  await page.locator('.conversation-link', { hasText: 'Remember this research question' }).click();
  await expect(page.locator('.user-message')).toHaveText('Remember this research question');
  if (info.project.name === 'mobile') await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('button', { name: /Answer repairs/ }).click();
  await expect(page.getByRole('main').getByText('Three days per week.', { exact: true })).toBeVisible();
});

test('history failure is explicit and can be retried', async ({ page }, info) => {
  await page.route('**/api/rag/docs', route => route.fulfill({ json: [] }));
  await page.route('**/api/rag/conversations', route => route.fulfill({ status: 503, json: { message: 'Unavailable' } }));
  await page.goto('/');
  if (info.project.name === 'mobile') await page.getByRole('button', { name: 'Open navigation' }).click();
  await expect(page.getByText('Chat history could not be loaded. Retry to reopen your conversations.')).toBeVisible();
  await page.route('**/api/rag/conversations', route => route.fulfill({ json: [] }));
  await page.getByRole('button', { name: 'Retry chat history' }).click();
  await expect(page.getByText('Your saved conversations')).toBeVisible();
});


test('source changes, history search, keyboard tabs and confirmed document removal', async ({ page }, info) => {
  let removed = false;
  const saved = [{ id: 'saved', title: 'Remote work policy', messages: [{ id: 'message', question: 'How many days?', createdAt: new Date().toISOString(), result: { ...result, sourcesChanged: true } }] }];
  await page.route('**/api/rag/conversations', route => route.fulfill({ json: saved }));
  await page.route('**/api/rag/docs', route => route.fulfill({ json: removed ? [] : [source] }));
  await page.route('**/api/rag/docs/policy', route => { expect(route.request().method()).toBe('DELETE'); expect(route.request().headers()['x-veriqon-request']).toBe('1'); removed = true; return route.fulfill({ json: { success: true } }); });
  await page.goto('/');
  await expect(page.getByRole('button', { name: /policy.md.*Version 1/ })).toBeVisible();
  if (info.project.name === 'mobile') await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByLabel('Search chat history').fill('unmatched');
  await expect(page.getByText('No matching recent conversations.')).toBeVisible();
  await page.getByRole('button', { name: 'Clear chat search' }).click();
  await expect(page.locator('.conversation-link', { hasText: 'Remote work policy' })).toBeVisible();
  if (info.project.name === 'mobile') await page.getByRole('button', { name: 'Close navigation' }).click();
  await showAssistant(page);
  await expect(page.getByText('Your library changed since this answer was generated.', { exact: false })).toBeVisible();
  await page.getByRole('tab', { name: 'Conversation' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: /Evidence/ })).toBeFocused();
  await expect(page.getByRole('tab', { name: /Evidence/ })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Home');
  await expect(page.getByRole('button', { name: 'Copy answer' })).toBeVisible();
  if (info.project.name === 'mobile') await page.getByRole('button', { name: 'Show workspace' }).click();
  await page.getByRole('button', { name: /policy.md.*Version 1/ }).click();
  await page.getByRole('button', { name: 'Delete document', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Saved answers keep their cited passages');
  await page.getByRole('button', { name: 'Keep document' }).click();
  expect(removed).toBe(false);
  await page.getByRole('button', { name: 'Delete document', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm delete', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Make room for what you know' })).toBeVisible();
  expect(removed).toBe(true);
});


test('withheld repair attempts are visible without publishing unsupported drafts', async ({ page }, info) => {
  await page.route('**/api/rag/docs', route => route.fulfill({ json: [] }));
  await page.route('**/api/rag/conversations', route => route.fulfill({ json: [{ id: 'failed-repair', title: 'A disputed claim', messages: [{ id: 'failed-message', question: 'A disputed claim', createdAt: new Date().toISOString(), result: { ...result, status: 'abstained', correction: null, attempts: 2, reason: 'verification_failed', draft: 'The answer could not be verified.', factCheck: { ...result.factCheck, passed: false, evidence: 'The source does not support this claim.' } } }] }] }));
  await page.goto('/');
  if (info.project.name === 'mobile') await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('button', { name: /Answer repairs/ }).click();
  await expect(page.getByText('Repair withheld')).toBeVisible();
  await page.getByText('Why verification failed').click();
  await expect(page.getByRole('main').getByText('The source does not support this claim.')).toBeVisible();
  await expect(page.getByRole('main').getByText('Three days per week.', { exact: true })).toHaveCount(0);
});
