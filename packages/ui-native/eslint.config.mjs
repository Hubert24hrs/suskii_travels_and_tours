import { reactLibraryConfig } from '@suskii/config/eslint/react';
import globals from 'globals';

export default [
  // jsx-a11y rules target the DOM; native accessibility is covered by props and tests.
  ...reactLibraryConfig({ tsconfigRootDir: import.meta.dirname, a11y: false }),
  {
    files: ['*.js'],
    languageOptions: { sourceType: 'commonjs', globals: { ...globals.node, ...globals.jest } },
    // Jest and Babel config files are CommonJS by design.
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
];
