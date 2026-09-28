// Base ESLint flat config shared by every workspace.
// Type-aware rules are on: floating promises and misused promises are the
// class of bug that silently loses money in booking and payment code.
import js from '@eslint/js';
import eslintConfigPrettier from 'eslint-config-prettier/flat';
import tseslint from 'typescript-eslint';

export const GLOBAL_IGNORES = [
  '**/node_modules/**',
  '**/dist/**',
  '**/build/**',
  '**/coverage/**',
  '**/.turbo/**',
  '**/.next/**',
  '**/.expo/**',
  '**/next-env.d.ts',
  '**/expo-env.d.ts',
];

/**
 * @param {object} options
 * @param {string} options.tsconfigRootDir Directory of the workspace's tsconfig.json (pass `import.meta.dirname`).
 * @param {string[]} [options.ignores] Extra glob patterns to ignore.
 * @param {Record<string, unknown>} [options.parserOptions] Extra parser options (e.g. decorator metadata for Nest).
 * @returns {import('eslint').Linter.Config[]}
 */
export function baseConfig({ tsconfigRootDir, ignores = [], parserOptions = {} }) {
  return [
    { ignores: [...GLOBAL_IGNORES, ...ignores] },
    js.configs.recommended,
    ...tseslint.configs.recommendedTypeChecked,
    ...tseslint.configs.stylisticTypeChecked,
    {
      languageOptions: {
        parserOptions: {
          projectService: true,
          tsconfigRootDir,
          ...parserOptions,
        },
      },
      linterOptions: {
        reportUnusedDisableDirectives: 'error',
      },
      rules: {
        eqeqeq: ['error', 'always'],
        'no-console': 'error',
        '@typescript-eslint/consistent-type-imports': [
          'error',
          { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
        ],
        '@typescript-eslint/no-unused-vars': [
          'error',
          { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
        ],
        '@typescript-eslint/switch-exhaustiveness-check': 'error',
        '@typescript-eslint/no-floating-promises': 'error',
        '@typescript-eslint/no-misused-promises': 'error',
      },
    },
    {
      // Plain JS config files (eslint.config.mjs, prettier.config.mjs, ...) are not
      // part of any tsconfig, so type-aware rules are disabled for them.
      files: ['**/*.{js,mjs,cjs}'],
      ...tseslint.configs.disableTypeChecked,
    },
    // Must stay last: turns off stylistic rules that conflict with Prettier.
    eslintConfigPrettier,
  ];
}
