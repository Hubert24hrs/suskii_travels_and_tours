import type { FullConfig } from '@playwright/test';

import { startStack } from './stack';

/**
 * Starts the platform unless E2E_BASE_URL points at one that is already running (a local dev
 * stack or a preview deployment). The returned function is Playwright's global teardown.
 */
export default async function globalSetup(_config: FullConfig): Promise<() => Promise<void>> {
  if (process.env.E2E_BASE_URL) return () => Promise.resolve();
  const stack = await startStack();
  return stack.stop;
}
