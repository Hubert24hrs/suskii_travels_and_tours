import { describe, expect, it } from 'vitest';

import { contrastRatio } from './color';
import { CONTRAST_CONTRACT, WCAG_AA, resolveBackground } from './contrast-contract';
import { color } from './tokens';

describe('WCAG 2.2 AA contrast contract', () => {
  it.each(CONTRAST_CONTRACT.map((requirement) => [requirement.usage, requirement] as const))(
    '%s',
    (_usage, requirement) => {
      const ratio = contrastRatio(
        color[requirement.foreground],
        resolveBackground(requirement.background),
      );
      expect(ratio).toBeGreaterThanOrEqual(requirement.minimum);
    },
  );

  it('covers every text-on-fill token', () => {
    const foregrounds = new Set(CONTRAST_CONTRACT.map((requirement) => requirement.foreground));
    for (const token of [
      'on-primary',
      'on-accent',
      'on-status',
      'on-scrim',
      'border-strong',
      'focus',
      'warning-text',
    ] as const) {
      expect(foregrounds).toContain(token);
    }
  });

  it('documents why orange fills need dark text: white fails even the large-text minimum', () => {
    expect(contrastRatio('#FFFFFF', color.accent)).toBeLessThan(WCAG_AA.largeText);
    expect(contrastRatio('#FFFFFF', color['accent-hover'])).toBeLessThan(WCAG_AA.largeText);
  });

  it('documents why inputs use border-strong: the spec border is decorative only', () => {
    expect(contrastRatio(color.border, color.surface)).toBeLessThan(WCAG_AA.nonText);
  });
});
