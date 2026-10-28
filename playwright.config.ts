import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: true,
  workers: 2,
  timeout: 60000,
  use: { baseURL: 'http://127.0.0.1:3001', trace: 'retain-on-failure' },
  projects: [{ name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 }, channel: process.env.CI ? undefined : 'msedge' } }, { name: 'mobile', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium', channel: process.env.CI ? undefined : 'msedge' } }],
  webServer: { command: 'npm run web:dev', url: 'http://127.0.0.1:3001', reuseExistingServer: !process.env.CI, timeout: 120000 }
});
