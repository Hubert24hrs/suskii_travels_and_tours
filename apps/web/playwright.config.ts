import { defineConfig, devices } from '@playwright/test';

/**
 * Web e2e tests (phase 4 acceptance): the global setup boots Postgres, Redis, the built API,
 * one worker refresh and the built web app, unless E2E_BASE_URL names a running stack.
 * Build first: `pnpm turbo run build --filter=@suskii/web --filter=@suskii/api --filter=@suskii/worker`.
 *
 * The Lighthouse project runs last, on its own, so parallel tests cannot skew the scores.
 */
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
const isCI = Boolean(process.env.CI);

export default defineConfig({
  testDir: './e2e',
  outputDir: './test-results/playwright',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: 0,
  workers: isCI ? 2 : undefined,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: isCI
    ? [['github'], ['html', { open: 'never', outputFolder: 'playwright-report' }]]
    : [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    locale: 'en-NG',
    timezoneId: 'Africa/Lagos',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
  },
  projects: [
    {
      name: 'chromium',
      testIgnore: /lighthouse\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'lighthouse',
      testMatch: /lighthouse\.spec\.ts/,
      dependencies: ['chromium'],
      fullyParallel: false,
    },
  ],
});
