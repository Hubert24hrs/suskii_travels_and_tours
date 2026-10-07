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
    {
      files: ['**/*.tsx'],
      rules: {
        // A form without a method is sent with GET if someone submits it before the page has
        // hydrated, which puts passwords or passport numbers in the URL, history and server logs
        // (phase 11, ZAP finding). Say method="post", or method="get" for searches.
        'no-restricted-syntax': [
          'error',
          {
            selector:
              'JSXOpeningElement[name.name="form"]:not(:has(JSXAttribute[name.name="method"]))',
            message:
              'Give every <form> a method: "post" for anything personal, "get" only for searches.',
          },
        ],
      },
    },
  ];
}
