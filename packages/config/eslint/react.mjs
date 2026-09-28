// ESLint config for React component libraries (ui-web, ui-native).
// Next.js and Expo apps get the equivalent rules from their framework configs.
import jsxA11y from 'eslint-plugin-jsx-a11y';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

import { baseConfig } from './base.mjs';

/**
 * @param {Parameters<typeof baseConfig>[0] & { a11y?: boolean }} options
 *   `a11y` enables jsx-a11y (DOM-only; off for React Native).
 * @returns {import('eslint').Linter.Config[]}
 */
export function reactLibraryConfig({ a11y = true, ...options }) {
  const [ignores, ...rest] = baseConfig(options);
  return [
    ignores,
    react.configs.flat.recommended,
    react.configs.flat['jsx-runtime'],
    reactHooks.configs.flat.recommended,
    ...(a11y ? [jsxA11y.flatConfigs.strict] : []),
    ...rest,
    {
      settings: { react: { version: 'detect' } },
      languageOptions: { globals: { ...globals.browser } },
      rules: {
        // Types replace prop-types.
        'react/prop-types': 'off',
      },
    },
  ];
}
