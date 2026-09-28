import { fileURLToPath } from 'node:url';

import tailwind from '@tailwindcss/postcss';
import postcss from 'postcss';
import { beforeAll, describe, expect, it } from 'vitest';

import { getTailwindThemeCss } from './tailwind-theme';
import { ALL_CANDIDATES, FORBIDDEN_CLASSES, TOKEN_CLASSES, definedClasses } from './test-utils';

// Resolve `@import "tailwindcss"` from this package's node_modules.
const from = fileURLToPath(new URL('./virtual.css', import.meta.url));

let css = '';
let classes = new Set<string>();

beforeAll(async () => {
  const input = [
    '@import "tailwindcss" source(none);',
    getTailwindThemeCss(),
    `@source inline("${ALL_CANDIDATES} duration-fast focus-ring ease-standard");`,
  ].join('\n');
  css = (await postcss([tailwind()]).process(input, { from })).css;
  classes = definedClasses(css);
});

describe('Tailwind v4 theme (web)', () => {
  it.each(TOKEN_CLASSES)('generates token utility %s', (className) => {
    expect(classes).toContain(className);
  });

  it.each(FORBIDDEN_CLASSES)('does not generate non-token utility %s', (className) => {
    expect(classes).not.toContain(className);
  });

  it('exposes motion, focus and easing utilities', () => {
    expect(classes).toContain('duration-fast');
    expect(classes).toContain('focus-ring');
    expect(classes).toContain('ease-standard');
  });

  it('emits theme values as CSS variables and honours reduced motion', () => {
    expect(css).toContain('--color-primary: #004BBE');
    expect(css).toContain('--text-body: 16px');
    expect(css).toMatch(/prefers-reduced-motion:\s*reduce/);
  });
});
