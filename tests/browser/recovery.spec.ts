import { test, expect } from '@playwright/test';
const user = { id: 'fixture', name: 'Alex', email: 'alex@example.test', role: 'member' };
const codes = Array.from({ length: 8 }, (_, i) => `${i}0000000-00000000-00000000-00000000`);
test.beforeEach(async ({ page }) => {
  await page.route('**/api/auth/status', route => route.fulfill({ json: { needsSetup: false, registrationEnabled: true } }));
  await page.route('**/api/auth/me', route => route.fulfill({ status: 401, json: {} }));
  await page.route('**/api/auth/refresh', route => route.fulfill({ status: 401, json: {} }));
  await page.route('**/api/rag/conversations', route => route.fulfill({ json: [] }));
  await page.route('**/api/rag/docs', route => route.fulfill({ json: [] }));
  await page.route('**/api/rag/health', route => route.fulfill({ json: { status: 'ok', providerConfigured: true } }));
});
test('recover a password with a saved code, including mismatch and invalid-code feedback', async ({ page }) => {
  let valid = false, calls = 0;
  await page.route('**/api/auth/recover', route => {
    calls++; expect(route.request().postDataJSON()).toEqual({ email: user.email, code: codes[0], password: 'new password for tests' });
    return route.fulfill({ status: valid ? 200 : 401, json: valid ? { success: true } : { message: 'Email or recovery code is invalid, used, or replaced.' } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Forgot password?' }).click();
  await page.getByLabel('Recovery email').fill(user.email);
  await page.getByLabel('Recovery code', { exact: true }).fill(codes[0]);
  await page.getByLabel('New password', { exact: true }).fill('new password for tests');
  await page.getByLabel('Confirm new password').fill('mismatching password');
  await page.getByRole('button', { name: 'Reset password', exact: true }).click();
  await expect(page.locator('.auth-error[role=alert]')).toHaveText('The new passwords do not match.'); expect(calls).toBe(0);
  await page.getByLabel('Confirm new password').fill('new password for tests');
  await page.getByRole('button', { name: 'Reset password', exact: true }).click();
  await expect(page.locator('.auth-error[role=alert]')).toContainText('invalid, used, or replaced');
  valid = true;
  await page.getByRole('button', { name: 'Reset password', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Password changed.');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Back to sign in' }).click();
  await expect(page.getByLabel('Password', { exact: true })).toBeVisible();
});
test('registration shows one-time codes and requires acknowledgement before closing', async ({ page }) => {
  let registered = false;
  await page.route('**/api/auth/me', route => route.fulfill({ status: registered ? 200 : 401, json: registered ? { user } : {} }));
  await page.route('**/api/auth/register', route => { registered = true; return route.fulfill({ status: 201, json: { user, recoveryCodes: codes } }); });
  await page.goto('/');
  await page.getByRole('button', { name: 'Create an account', exact: true }).click();
  await page.getByLabel('Full name').fill(user.name);
  await page.getByLabel('Email address').fill(user.email);
  await page.getByLabel('Password', { exact: true }).fill('valid password for tests');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText(codes[0]);
  await expect(dialog.getByRole('button', { name: 'Done', exact: true })).toBeDisabled();
  const download = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Download recovery codes' }).click();
  expect((await download).suggestedFilename()).toBe('veriqon-recovery-codes.txt');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(dialog).toHaveCount(0);
});

test('an existing account can generate backup codes from settings after confirming its password', async ({ page }, info) => {
  await page.route('**/api/auth/me', route => route.fulfill({ json: { user } }));
  await page.route('**/api/auth/recovery-codes', route => {
    expect(route.request().postDataJSON()).toEqual({ password: 'current password for tests' });
    return route.fulfill({ json: { codes } });
  });
  await page.goto('/');
  if (info.project.name === 'mobile') await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('button', { name: 'Workspace settings', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Confirm current password').fill('current password for tests');
  await dialog.getByRole('button', { name: 'Generate recovery codes' }).click();
  await expect(dialog).toContainText(codes[7]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(dialog.getByLabel('Confirm current password')).toBeVisible();
});
