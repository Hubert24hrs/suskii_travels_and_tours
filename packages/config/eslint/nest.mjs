// ESLint config for the NestJS API.
import { nodeConfig } from './node.mjs';

/**
 * @param {Parameters<typeof nodeConfig>[0]} options
 * @returns {import('eslint').Linter.Config[]}
 */
export function nestConfig(options) {
  return [
    ...nodeConfig({
      ...options,
      // Nest resolves constructor-injected providers from emitted decorator metadata.
      // Telling the parser about it stops `consistent-type-imports` from rewriting
      // injected classes into type-only imports, which would break DI at runtime.
      parserOptions: {
        emitDecoratorMetadata: true,
        experimentalDecorators: true,
        ...options.parserOptions,
      },
    }),
    {
      files: ['**/*.spec.ts', '**/*.e2e-spec.ts', 'test/**/*.ts'],
      rules: {
        // Jest matchers and mocks reference methods unbound by design.
        '@typescript-eslint/unbound-method': 'off',
        // supertest types response bodies as `any`; assertions on them are the point of the test.
        '@typescript-eslint/no-unsafe-member-access': 'off',
        '@typescript-eslint/no-unsafe-assignment': 'off',
        '@typescript-eslint/no-unsafe-call': 'off',
        '@typescript-eslint/no-unsafe-argument': 'off',
      },
    },
  ];
}
