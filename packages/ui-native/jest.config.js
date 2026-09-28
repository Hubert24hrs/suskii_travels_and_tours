/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  testMatch: ['<rootDir>/src/**/*.test.{ts,tsx}'],
  setupFiles: ['<rootDir>/jest.setup.js'],
  // Worklets' resolver picks its JS implementation instead of the native module in tests.
  resolver: require.resolve('react-native-worklets/jest/resolver'),
  // Merged with jest-expo's transforms: some RN libraries (lucide) resolve to ESM `.mjs` builds.
  transform: { '^.+\\.mjs$': 'babel-jest' },
  // pnpm nests packages under node_modules/.pnpm/<name>@<version>/node_modules/<name>, so the
  // allow-list tolerates that prefix. Everything else in node_modules stays untransformed.
  transformIgnorePatterns: [
    'node_modules/(?!(?:\\.pnpm/[^/]+/node_modules/)?(?:(?:jest-)?react-native[^/]*|@react-native[^/]*|expo[^/]*|@expo[^/]*|nativewind|@gorhom|lucide-react-native)/)',
  ],
};
