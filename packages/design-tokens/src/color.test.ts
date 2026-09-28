import { describe, expect, it } from 'vitest';

import { contrastRatio, flatten, parseColor } from './color';

describe('parseColor', () => {
  it('parses short hex, long hex, rgb and rgba', () => {
    expect(parseColor('#fff')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColor('#004BBE')).toEqual({ r: 0, g: 75, b: 190, a: 1 });
    expect(parseColor('rgb(1, 2, 3)')).toEqual({ r: 1, g: 2, b: 3, a: 1 });
    expect(parseColor('rgba(0, 75, 190, 0.45)')).toEqual({ r: 0, g: 75, b: 190, a: 0.45 });
  });

  it('rejects unsupported or out-of-range input', () => {
    expect(() => parseColor('blue')).toThrow('Unsupported');
    expect(() => parseColor('rgb(300, 0, 0)')).toThrow('out of range');
  });
});

describe('contrastRatio', () => {
  it('matches the WCAG reference points', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrastRatio('#FFFFFF', '#FFFFFF')).toBeCloseTo(1, 5);
    // #767676 is the canonical lightest grey that passes 4.5:1 on white.
    expect(contrastRatio('#767676', '#FFFFFF')).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio('#777777', '#FFFFFF')).toBeLessThan(4.5);
  });

  it('is symmetric', () => {
    expect(contrastRatio('#004BBE', '#F2F6F9')).toBeCloseTo(
      contrastRatio('#F2F6F9', '#004BBE'),
      10,
    );
  });

  it('composites translucent foregrounds over the background before measuring', () => {
    // The spec focus ring alone is too faint to be a focus indicator (ADR-004).
    expect(contrastRatio('rgba(0, 75, 190, 0.45)', '#FFFFFF')).toBeLessThan(3);
    expect(flatten('rgba(0, 0, 0, 0.5)', '#FFFFFF')).toBe('rgb(128, 128, 128)');
  });
});
