import { baseVitestConfig } from '@suskii/config/vitest';
import { defineConfig, mergeConfig } from 'vitest/config';

/** Phase 11 gate (`pnpm test:cov`, run in CI): money and payment-plan arithmetic. */
const CRITICAL = { lines: 80, statements: 80, functions: 80, branches: 80 };

export default mergeConfig(
  baseVitestConfig,
  defineConfig({
    test: {
      coverage: {
        thresholds: { 'src/money.ts': CRITICAL, 'src/payment-plans.ts': CRITICAL },
      },
    },
  }),
);
