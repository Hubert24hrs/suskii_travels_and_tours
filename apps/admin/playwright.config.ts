import { defineConfig, devices } from '@playwright/test';

/**
 * Admin console e2e tests (phase 10): the global setup boots Postgres, Redis, the built API and
 * the built console, and provisions staff accounts and paid bookings (e2e/stack.ts).
 * Build first: `pnpm turbo run build --filter=@suskii/admin --filter=@suskii/api`.
 *
 * The audit project runs after the journeys and checks that each of their changes is logged.
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
    baseURL: 'http://localhost:3001',
    locale: 'en-NG',
    timezoneId: 'Africa/Lagos',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
  },
  projects: [
    {
      name: 'console',
      testIgnore: /audit\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } },
    },
    {
      name: 'audit',
      testMatch: /audit\.spec\.ts/,
      dependencies: ['console'],
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } },
    },
  ],
});
