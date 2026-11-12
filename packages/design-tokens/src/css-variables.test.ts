import { describe, expect, it } from 'vitest';

import { getCssVariables } from './css-variables';
import { color, radius, spacing } from './tokens';

describe('getCssVariables', () => {
  const css = getCssVariables();

  it('declares one variable per colour, radius and spacing step', () => {
    for (const [name, value] of Object.entries(color)) {
      expect(css).toContain(`--suskii-color-${name}: ${value};`);
    }
    for (const name of Object.keys(radius)) {
      expect(css).toContain(`--suskii-radius-${name}:`);
    }
    for (const name of Object.keys(spacing)) {
      expect(css).toContain(`--suskii-space-${name}:`);
    }
  });

  it('quotes multi-word font families', () => {
    expect(css).toMatch(/--suskii-font-body: var\(--font-dm-sans, "DM Sans"\), .*"Segoe UI"/);
  });
});
