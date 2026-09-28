// ESLint config for Next.js apps (web, admin).
import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import globals from 'globals';

import { baseConfig } from './base.mjs';

/**
 * @param {Parameters<typeof baseConfig>[0]} options
 * @returns {import('eslint').Linter.Config[]}
 */
export function nextConfig(options) {
  const [ignores, ...rest] = baseConfig(options);
  return [
    ignores,
    ...nextCoreWebVitals,
    ...rest,
    {
      languageOptions: {
        globals: { ...globals.browser, ...globals.node },
      },
      // Lets the Next plugin find the app when ESLint runs from the repo root (lint-staged).
      settings: { next: { rootDir: options.tsconfigRootDir } },
    },
  ];
}
