/**
 * E2E tests: boot the real Nest application in-process against Postgres and Redis
 * (Testcontainers) and drive it over HTTP. Files share the containers and run serially; each file
 * resets the database and Redis first.
 */
/** 80% of lines, statements and functions; branches at 65% (provider error paths vary). */
const CRITICAL = { lines: 80, statements: 80, functions: 80, branches: 65 };

/** @type {import('jest').Config} */
const config = {
  rootDir: '..',
  testEnvironment: 'node',
  moduleFileExtensions: ['ts', 'js', 'json'],
  testRegex: String.raw`test/.*\.e2e-spec\.ts$`,
  transform: {
    [String.raw`^.+\.ts$`]: ['ts-jest', { tsconfig: 'tsconfig.json' }],
  },
  globalSetup: '<rootDir>/test/global-setup.ts',
  globalTeardown: '<rootDir>/test/global-teardown.ts',
  maxWorkers: 1,
  // Container start-up and argon2 hashing are slow on shared CI runners.
  testTimeout: 60_000,
  // Phase 11 gate, applied when CI runs the suite with --coverage: the app runs in-process, so
  // this measures pricing, the booking lifecycle, installments, the ledger and auth as the real
  // HTTP flows exercise them.
  collectCoverageFrom: ['src/**/*.ts', '!src/main.ts', '!src/**/*.spec.ts', '!src/generated/**'],
  coverageDirectory: 'coverage-e2e',
  coverageReporters: ['text-summary', 'json-summary', 'lcov'],
  coverageThreshold: {
    './src/pricing/': CRITICAL,
    './src/auth/': CRITICAL,
    './src/ledger/': CRITICAL,
    './src/bookings/booking-transitions.ts': CRITICAL,
    './src/bookings/payment-plans.service.ts': CRITICAL,
    './src/bookings/payment-options.ts': CRITICAL,
    './src/bookings/booking-funds.service.ts': CRITICAL,
  },
};

export default config;
