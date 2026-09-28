// Shared Vitest defaults. Workspaces extend with `mergeConfig(baseVitestConfig, defineConfig({...}))`.
import { defineConfig } from 'vitest/config';

export const baseVitestConfig = defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/**/index.ts'],
    },
  },
});
