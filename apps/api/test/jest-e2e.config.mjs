/**
 * E2E tests: boot the real Nest application in-process against Postgres and Redis
 * (Testcontainers) and drive it over HTTP. Files share the containers and run serially; each file
 * resets the database and Redis first.
 */
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
};

export default config;
