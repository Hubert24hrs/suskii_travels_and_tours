import type { FullConfig } from '@playwright/test';

import { startStack } from './stack';

/** Starts the platform and provisions the e2e accounts; the returned function is the teardown. */
export default async function globalSetup(_config: FullConfig): Promise<() => Promise<void>> {
  const stack = await startStack();
  return stack.stop;
}
