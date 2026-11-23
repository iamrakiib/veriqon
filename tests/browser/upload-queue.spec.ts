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
  await page.goto('/', { waitUntil: 'domcontentloaded' });
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

test('durable upload progress survives reload, retries and completes before becoming ready', async ({ page }) => {
  await page.route('**/api/auth/status', r => r.fulfill({ json: { needsSetup: false, registrationEnabled: true } }));
  await page.route('**/api/auth/me', r => r.fulfill({ json: { user: { id: 'fixture', name: 'Alex Morgan', email: 'alex@example.com', role: 'member' } } }));
  await page.route('**/api/rag/conversations', r => r.fulfill({ json: [] }));
  await page.route('**/api/rag/health', r => r.fulfill({ json: { status: 'ok', providerConfigured: true, capabilities: { durableUploads: true } } }));
  const job = { id: 'job-1', documentId: 'doc-1', source: 'handbook.docx', status: 'queued', totalChunks: 120, completedChunks: 0, attempts: 0, nextAt: 0, error: '' };
  let present = false;
  await page.route('**/api/rag/docs', r => r.fulfill({ json: job.status === 'completed' ? [{ id: 'doc-1', source: job.source, text: 'Synthetic source', chunkCount: 120 }] : [] }));
  await page.route('**/api/rag/uploads', r => {
    if (r.request().method() === 'POST') { present = true; return r.fulfill({ status: 202, json: job }); }
    return r.fulfill({ json: present ? [job] : [] });
  });
  await page.route('**/api/rag/uploads/job-1/retry', r => {
    job.status = 'queued'; job.error = '';
    return r.fulfill({ json: job });
  });
  await page.route('**/api/rag/uploads/job-1', r => { present = false; return r.fulfill({ json: { success: true } }); });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('button', { name: 'Add documents' })).toBeEnabled();
  await expect(page.getByText(/500,000 extracted characters/)).toBeVisible();
  await page.getByLabel('Upload documents').setInputFiles({ name: job.source, mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: Buffer.from('Synthetic upload') });
  await expect(page.getByText('Saved — waiting to index')).toBeVisible();
  await expect(page.getByText('Ready for questions', { exact: true })).toHaveCount(0);
  job.status = 'retry_wait'; job.completedChunks = 24; job.attempts = 1; job.nextAt = Date.now() + 60000; job.error = 'The provider rate limit was reached.';
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByText(/Progress saved \(24\/120\). Retrying after/)).toBeVisible();
  job.status = 'failed'; job.attempts = 3;
  await expect(page.getByRole('button', { name: 'Retry handbook.docx' })).toBeVisible({ timeout: 10000 });
  await page.getByRole('button', { name: 'Retry handbook.docx' }).click();
  await expect(page.getByText('Saved — waiting to index')).toBeVisible();
  job.status = 'processing';
  await expect(page.getByText('Indexing 24 of 120 passages')).toBeVisible({ timeout: 10000 });
  job.status = 'completed'; job.completedChunks = 120;
  await expect(page.getByText('Ready for questions', { exact: true })).toBeVisible({ timeout: 10000 });
  await expect(page.locator('.document-table')).toContainText('handbook.docx');
  await page.getByRole('button', { name: 'Dismiss handbook.docx' }).click();
  await expect(page.getByLabel('Saved upload progress')).toHaveCount(0);
  await expect(page.locator('.document-table')).toContainText('handbook.docx');
});
