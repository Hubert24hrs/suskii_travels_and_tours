import { expoAppConfig } from '@suskii/config/eslint/expo';
import globals from 'globals';

export default [
  ...expoAppConfig({ tsconfigRootDir: import.meta.dirname }),
  {
    // Babel, Metro, Tailwind and Jest config files are CommonJS by design.
    files: ['*.js', 'src/test/*.js'],
    languageOptions: { globals: { ...globals.node, ...globals.jest } },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
];
