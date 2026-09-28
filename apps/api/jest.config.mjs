/** Unit tests: colocated `*.spec.ts` files under src/. */
/** @type {import('jest').Config} */
const config = {
  rootDir: '.',
  testEnvironment: 'node',
  moduleFileExtensions: ['ts', 'js', 'json'],
  testRegex: String.raw`src/.*\.spec\.ts$`,
  transform: {
    [String.raw`^.+\.ts$`]: ['ts-jest', { tsconfig: 'tsconfig.json' }],
  },
  collectCoverageFrom: ['src/**/*.ts', '!src/main.ts'],
  coverageDirectory: 'coverage',
};

export default config;
