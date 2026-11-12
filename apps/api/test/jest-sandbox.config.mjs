/**
 * Sandbox journeys: the real Nest application against a provider's test mode (ADR-062). Never
 * part of `test:e2e` or CI (no test may call a real provider); only the manual duffel-sandbox
 * workflow runs them, with a test token. Same containers and seed as the e2e suite.
 */
import e2e from './jest-e2e.config.mjs';

/** @type {import('jest').Config} */
const config = {
  rootDir: e2e.rootDir,
  testEnvironment: e2e.testEnvironment,
  moduleFileExtensions: e2e.moduleFileExtensions,
  transform: e2e.transform,
  globalSetup: e2e.globalSetup,
  globalTeardown: e2e.globalTeardown,
  testRegex: String.raw`test/sandbox/.*\.sandbox-spec\.ts$`,
  maxWorkers: 1,
  // Test-mode searches and bookings are slower than our local stand-ins.
  testTimeout: 180_000,
};

export default config;
