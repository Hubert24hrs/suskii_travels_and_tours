/** Unit tests: colocated `*.spec.ts` files under src/. */
/** 80% of lines, statements and functions; branches at 70% (error paths are e2e-tested). */
const CRITICAL = { lines: 80, statements: 80, functions: 80, branches: 70 };

/** @type {import('jest').Config} */
const config = {
  rootDir: '.',
  testEnvironment: 'node',
  moduleFileExtensions: ['ts', 'js', 'json'],
  testRegex: String.raw`src/.*\.spec\.ts$`,
  transform: {
    [String.raw`^.+\.ts$`]: ['ts-jest', { tsconfig: 'tsconfig.json' }],
  },
  collectCoverageFrom: ['src/**/*.ts', '!src/main.ts', '!src/**/*.spec.ts', '!src/generated/**'],
  coverageDirectory: 'coverage',
  // Phase 11 gate (`pnpm test:cov`, run in CI): the pure money and lifecycle rules are covered by
  // unit tests. Services that need Postgres are gated by the e2e run (test/jest-e2e.config.mjs).
  coverageThreshold: {
    './src/bookings/booking-state-machine.ts': CRITICAL,
    './src/pricing/pricing-engine.ts': CRITICAL,
    './src/auth/tokens/': CRITICAL,
  },
};

export default config;
