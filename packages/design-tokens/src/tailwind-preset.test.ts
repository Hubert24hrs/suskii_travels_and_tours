import postcss from 'postcss';
import tailwindV3 from 'tailwindcss-v3';
import { beforeAll, describe, expect, it } from 'vitest';

import { nativewindPreset } from './tailwind-preset';
import { ALL_CANDIDATES, FORBIDDEN_CLASSES, TOKEN_CLASSES, definedClasses } from './test-utils';
import { fontSize } from './tokens';

let css = '';
let classes = new Set<string>();

beforeAll(async () => {
  const plugin = tailwindV3({
    presets: [nativewindPreset],
    content: [{ raw: `${ALL_CANDIDATES} font-body-bold duration-fast`, extension: 'html' }],
    corePlugins: { preflight: false },
  });
  css = (await postcss([plugin]).process('@tailwind utilities;', { from: undefined })).css;
  classes = definedClasses(css);
});

describe('Tailwind v3 preset (NativeWind)', () => {
  it.each(TOKEN_CLASSES)('generates token utility %s (parity with web)', (className) => {
    expect(classes).toContain(className);
  });

  it.each(FORBIDDEN_CLASSES)('does not generate non-token utility %s', (className) => {
    expect(classes).not.toContain(className);
  });

  it('exposes per-weight native font families and motion tokens', () => {
    expect(classes).toContain('font-body-bold');
    expect(classes).toContain('duration-fast');
  });

  it('uses absolute line heights, which React Native requires', () => {
    const expected = Math.round(fontSize.body.size * fontSize.body.lineHeight);
    expect(css).toMatch(new RegExp(`\\.text-body\\s*\\{[^}]*line-height:\\s*${expected}px`));
  });
});
