import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  outputDir: '/tmp/509-yard-playwright-results',
  reporter: 'list',
  use: {
    baseURL: process.env.DOMINO_E2E_BASE_URL || 'http://127.0.0.1:5173',
    browserName: 'chromium',
    headless: true,
  },
  webServer: process.env.DOMINO_E2E_BASE_URL ? undefined : {
    command: 'PORT=5173 BASE_PATH=/ pnpm run dev',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
