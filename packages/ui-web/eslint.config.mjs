import { join } from 'node:path';

import { reactLibraryConfig } from '@suskii/config/eslint/react';
import storybook from 'eslint-plugin-storybook';

export default [
  ...reactLibraryConfig({ tsconfigRootDir: import.meta.dirname, ignores: ['storybook-static/**'] }),
  ...storybook.configs['flat/recommended'],
  {
    // Resolve addons against this package, even when ESLint runs from the repo root (lint-staged).
    files: ['.storybook/main.ts'],
    rules: {
      'storybook/no-uninstalled-addons': [
        'error',
        { packageJsonLocation: join(import.meta.dirname, 'package.json') },
      ],
    },
  },
];
