import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.PLAYWRIGHT_PORT || 3001);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('PLAYWRIGHT_PORT must be between 1024 and 65535');
const url = `http://127.0.0.1:${port}`;
const channel = process.env.PLAYWRIGHT_CHANNEL || undefined;

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: true,
  workers: 2,
  timeout: 60000,
  use: { baseURL: url, trace: 'retain-on-failure' },
  projects: [{ name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 }, channel } }, { name: 'mobile', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium', channel } }],
  webServer: { command: `npm exec --workspace @veriqon/web -- next dev --hostname 127.0.0.1 --port ${port}`, url, reuseExistingServer: !process.env.CI, timeout: 120000 }
});
