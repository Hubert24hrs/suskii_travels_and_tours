import { defineConfig } from 'vitest/config';

/** Node-only tests (they read the source tree): the browser config runs the component tests. */
export default defineConfig({
  test: { include: ['src/**/*.node.test.ts'], environment: 'node', testTimeout: 60_000 },
});
