import { test, expect } from '@playwright/test';

test('batch uploads distinguish active indexing from waiting files', async ({ page }) => {
  await page.route('**/api/auth/status', route => route.fulfill({ json: { needsSetup: false, registrationEnabled: true } }));
  await page.route('**/api/auth/me', route => route.fulfill({ json: { user: { id: 'fixture', name: 'Alex Morgan', email: 'alex@example.com', role: 'member' } } }));
  await page.route('**/api/rag/conversations', route => route.fulfill({ json: [] }));
  await page.route('**/api/rag/docs', route => route.fulfill({ json: [] }));
  await page.route('**/api/rag/health', route => route.fulfill({ json: { status: 'ok', providerConfigured: true } }));
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let calls = 0;
  await page.route('**/api/rag/upload', async route => {
    if (++calls === 1) await gate;
    await route.fulfill({ status: 201, json: { success: true } });
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Add documents' })).toBeEnabled();
  await page.getByLabel('Upload documents').setInputFiles(['first.txt', 'second.txt'].map(name => ({ name, mimeType: 'text/plain', buffer: Buffer.from('Synthetic source') })));
  await expect(page.locator('.upload-result.indexing')).toContainText('first.txt');
  await expect(page.locator('.upload-result.queued')).toContainText('Waiting in queue');
  expect(calls).toBe(1);
  await expect(page.getByRole('button', { name: 'Dismiss second.txt' })).toHaveCount(0);
  release();
  await expect(page.locator('.upload-result.indexed')).toHaveCount(2);
  expect(calls).toBe(2);
});
