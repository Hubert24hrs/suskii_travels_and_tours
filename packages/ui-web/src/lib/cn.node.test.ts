import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { motion, tailwindMergeTheme } from '@suskii/design-tokens';
import { extendTailwindMerge } from 'tailwind-merge';
import { describe, expect, it } from 'vitest';

import { cn, TOKEN_NAMES } from './cn';

/**
 * `cn` replaced tailwind-merge in the browser bundle (phase 11, ADR-013). tailwind-merge with the
 * design-system theme stays the reference here: every class used anywhere in the website, the
 * console and ui-web must merge exactly as it would.
 */
const reference = extendTailwindMerge<'focus-ring'>({
  override: {
    theme: {
      ...tailwindMergeTheme,
      // CSS colour keywords exist without a token; the old config missed them, so
      // `bg-primary bg-transparent` kept both classes.
      color: [...tailwindMergeTheme.color, 'inherit', 'current', 'transparent'],
      spacing: [...tailwindMergeTheme.spacing, 'px'],
    },
  },
  extend: {
    // Named motion tokens and the focus-ring utility, which the old config treated as unknown.
    classGroups: {
      duration: [{ duration: Object.keys(motion.duration) }],
      ease: [{ ease: Object.keys(motion.easing) }],
      'focus-ring': ['focus-ring'],
      'max-h': [{ 'max-h': ['menu'] }],
    },
  },
});

const ROOT = resolve(__dirname, '../../../..');
const SOURCES = [
  'packages/ui-web/src',
  'apps/web/app',
  'apps/web/components',
  'apps/admin/app',
  'apps/admin/components',
];

function files(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return name === '__screenshots__' ? [] : files(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

/** Every token inside a string literal that looks like a class (Tailwind scans the same way). */
function corpus(): string[] {
  const tokens = new Set<string>();
  for (const file of SOURCES.flatMap((source) => files(join(ROOT, source)))) {
    for (const match of readFileSync(file, 'utf8').matchAll(/(['"`])((?:\\.|(?!\1)[^\n])*)\1/g)) {
      for (const token of (match[2] ?? '').split(/\s+/)) {
        if (/^!?-?[a-z[][\w:[\]&>=.%/-]*[\w\]%]!?$/.test(token)) tokens.add(token);
      }
    }
  }
  return [...tokens];
}

describe('cn', () => {
  it('knows the design-system token names', () => {
    expect(TOKEN_NAMES.color).toEqual(tailwindMergeTheme.color);
    expect(TOKEN_NAMES.text).toEqual(tailwindMergeTheme.text);
    expect(TOKEN_NAMES.font).toEqual(tailwindMergeTheme.font);
    expect(TOKEN_NAMES['font-weight']).toEqual(tailwindMergeTheme['font-weight']);
  });

  it('merges every pair of classes in the source tree as tailwind-merge does', () => {
    // A class that neither side recognises (a duplicate is not merged) cannot conflict.
    const known = (token: string) =>
      reference(`${token} ${token}`) === token || cn(token, token) === token;
    const tokens = corpus().filter(known);
    expect(tokens.length).toBeGreaterThan(300);
    const differences: string[] = [];
    for (const first of tokens) {
      for (const second of tokens) {
        const input = `${first} ${second}`;
        const expected = reference(input);
        if (cn(input) !== expected)
          differences.push(`${input} → ${cn(input)} (expected ${expected})`);
      }
    }
    expect(differences.slice(0, 40)).toEqual([]);
  });

  it('keeps unknown classes and resolves variants separately', () => {
    expect(cn('p-2 hover:p-4', 'p-3', 'custom-class')).toBe('hover:p-4 p-3 custom-class');
    expect(cn('px-2 py-1', 'p-4')).toBe('p-4');
    expect(cn('p-4', 'px-2')).toBe('p-4 px-2');
    expect(cn('text-body text-muted', 'text-primary')).toBe('text-body text-primary');
    expect(cn('md:hover:bg-surface', 'hover:md:bg-primary')).toBe('hover:md:bg-primary');
  });
});
