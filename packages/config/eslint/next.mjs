// ESLint config for Next.js apps (web, admin).
import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import globals from 'globals';

import { baseConfig } from './base.mjs';

/**
 * A left or right utility in a class string (`ml-2`, `md:pr-4`, `left-3`, `text-right`,
 * `rounded-l-none`, `border-l-4`), which would not mirror in a right-to-left page.
 */
const PHYSICAL_DIRECTION =
  '/(^|[\\s:])-?((m|p|scroll-m|scroll-p)[lr]|left|right)-|(^|[\\s:])text-(left|right)\\b|(^|[\\s:])(rounded-(l|r|tl|tr|bl|br)|border-[lr])\\b/';

/**
 * @param {Parameters<typeof baseConfig>[0] & { logicalDirection?: boolean }} options
 *   `logicalDirection`: refuse left and right utilities (pages that render right to left, ADR-076).
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
          // Pages that may render right to left (ADR-076) use logical direction utilities.
          ...(options.logicalDirection
            ? [
                `Literal[value=${PHYSICAL_DIRECTION}]`,
                `TemplateElement[value.raw=${PHYSICAL_DIRECTION}]`,
              ].map((selector) => ({
                selector,
                message:
                  'Use a logical direction utility (ms-, pe-, inset-s-, border-s-, rounded-e-, text-start) so the page mirrors in Arabic.',
              }))
            : []),
        ],
      },
    },
  ];
}
