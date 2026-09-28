/** E2E tests: boot the real Nest application in-process and drive it over HTTP. */
/** @type {import('jest').Config} */
const config = {
  rootDir: '..',
  testEnvironment: 'node',
  moduleFileExtensions: ['ts', 'js', 'json'],
  testRegex: String.raw`test/.*\.e2e-spec\.ts$`,
  transform: {
    [String.raw`^.+\.ts$`]: ['ts-jest', { tsconfig: 'tsconfig.json' }],
  },
};

export default config;
