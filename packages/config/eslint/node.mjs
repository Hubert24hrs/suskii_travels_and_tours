// ESLint config for Node.js services and libraries (worker, shared packages).
import globals from 'globals';

import { baseConfig } from './base.mjs';

/**
 * @param {Parameters<typeof baseConfig>[0]} options
 * @returns {import('eslint').Linter.Config[]}
 */
export function nodeConfig(options) {
  return [
    ...baseConfig(options),
    {
      languageOptions: {
        globals: { ...globals.node },
      },
    },
  ];
}
