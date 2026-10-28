import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => { await page.route('**/api/rag/conversations', route => route.fulfill({ json: [] })); });

const user = { id: 'fixture', name: 'Alex Morgan', email: 'alex@example.com', role: 'owner' };

test('sign-in errors, account identity and sign-out clear the private workspace', async ({ page }, info) => {
  let signedIn = false;
  await page.route('**/api/auth/status', route => route.fulfill({ json: { needsSetup: false, registrationEnabled: true } }));
  await page.route('**/api/auth/me', route => route.fulfill({ status: signedIn ? 200 : 401, json: signedIn ? { user } : { message: 'Sign in' } }));
  await page.route('**/api/auth/refresh', route => route.fulfill({ status: 401, json: { message: 'Session expired' } }));
  await page.route('**/api/auth/login', route => {
    expect(route.request().headers()['x-veriqon-request']).toBe('1');
    const valid = route.request().postDataJSON().password === 'a valid testing password';
    signedIn = valid;
    return route.fulfill({ status: valid ? 200 : 401, json: valid ? { user } : { message: 'Email or password is incorrect.' } });
  });
  await page.route('**/api/auth/logout', route => { signedIn = false; return route.fulfill({ json: { success: true } }); });
  await page.route('**/api/rag/health', route => route.fulfill({ json: { status: 'ok', providerConfigured: true, storage: 'sqlite' } }));
  await page.route('**/api/rag/docs', route => route.fulfill({ json: [] }));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Welcome back.' })).toBeVisible();
  await expect(page.locator('.auth-error[role=alert]')).toHaveCount(0);
  await page.getByLabel('Email address').fill(user.email);
  await page.getByLabel('Password', { exact: true }).fill('wrong');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.locator('.auth-error[role=alert]')).toHaveText('Email or password is incorrect.');
  await page.getByLabel('Password', { exact: true }).fill('a valid testing password');
  await page.getByRole('button', { name: 'Show password' }).click();
  await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute('type', 'text');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Add documents' })).toBeEnabled();
  if (info.project.name === 'mobile') await page.getByRole('button', { name: 'Open navigation' }).click();
  await expect(page.locator('.profile')).toContainText(user.name);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Welcome back.' })).toBeVisible();
  await expect(page.locator('.workspace-main')).toHaveCount(0);
});

test('owner setup is responsive in both themes and submits the setup code', async ({ page }, info) => {
  await page.route('**/api/auth/status', route => route.fulfill({ json: { needsSetup: true, registrationEnabled: true } }));
  await page.route('**/api/auth/me', route => route.fulfill({ status: 401, json: {} }));
  await page.route('**/api/auth/refresh', route => route.fulfill({ status: 401, json: {} }));
  await page.route('**/api/auth/register', route => {
    expect(route.request().postDataJSON()).toEqual({ name: user.name, email: user.email, password: 'a valid testing password', setupCode: 'fixture-setup' });
    return route.fulfill({ status: 403, json: { message: 'Enter the setup code from the server to create the owner account.' } });
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Make it yours.' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `test-results/auth-${info.project.name}-dark.png`, fullPage: true });
  await page.getByRole('button', { name: 'Switch to light mode' }).click();
  await page.screenshot({ path: `test-results/auth-${info.project.name}-light.png`, fullPage: true });
  await page.getByLabel('Full name').fill(user.name);
  await page.getByLabel('Email address').fill(user.email);
  await page.getByLabel('Password', { exact: true }).fill('a valid testing password');
  await page.getByLabel('One-time setup code').fill('fixture-setup');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.locator('.auth-error[role=alert]')).toContainText('Enter the setup code');
});

test('expired session clears the workspace; valid renewal retries the private request', async ({ page }) => {
  let renewed = false, expire = false;
  await page.route('**/api/auth/status', route => route.fulfill({ json: { needsSetup: false, registrationEnabled: true } }));
  await page.route('**/api/auth/me', route => route.fulfill({ json: { user } }));
  await page.route('**/api/auth/refresh', route => { renewed = !expire; return route.fulfill({ status: expire ? 401 : 200, json: expire ? {} : { user } }); });
  await page.route('**/api/rag/health', route => route.fulfill({ json: { status: 'ok', providerConfigured: true } }));
  await page.route('**/api/rag/docs', route => route.fulfill({ status: renewed && !expire ? 200 : 401, json: renewed && !expire ? [] : { message: 'Expired' } }));
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Add documents' })).toBeEnabled();
  expect(renewed).toBe(true);
  expire = true;
  await page.getByRole('button', { name: 'Refresh workspace' }).click();
  await expect(page.getByRole('heading', { name: 'Welcome back.' })).toBeVisible();
  await expect(page.locator('.auth-error[role=alert]')).toContainText('session has expired');
  await expect(page.locator('.workspace-main')).toHaveCount(0);
});


test('two tabs serialize session renewal instead of racing refresh tokens', async ({ context }) => {
  let renewed = false, active = 0, maximum = 0;
  await context.route('**/api/auth/status', route => route.fulfill({ json: { needsSetup: false, registrationEnabled: true } }));
  await context.route('**/api/auth/me', route => route.fulfill({ json: { user } }));
  await context.route('**/api/rag/health', route => route.fulfill({ json: { status: 'ok', providerConfigured: true } }));
  await context.route('**/api/rag/conversations', route => route.fulfill({ json: [] }));
  await context.route('**/api/rag/docs', route => route.fulfill({ status: renewed ? 200 : 401, json: renewed ? [] : { message: 'Expired' } }));
  await context.route('**/api/auth/refresh', async route => {
    active++; maximum = Math.max(maximum, active);
    await new Promise(resolve => setTimeout(resolve, 150));
    renewed = true;
    await route.fulfill({ json: { user } }); active--;
  });
  const first = await context.newPage(), second = await context.newPage();
  await Promise.all([first.goto('/'), second.goto('/')]);
  await expect(first.getByRole('button', { name: 'Add documents' })).toBeEnabled();
  await expect(second.getByRole('button', { name: 'Add documents' })).toBeEnabled();
  expect(maximum).toBe(1);
  await first.close(); await second.close();
});
