import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  SPEC_COLOR_KEYS,
  SPEC_FONT_SIZE_KEYS,
  SPEC_SHADOW_KEYS,
  breakpoint,
  color,
  containerMax,
  fontSize,
  motion,
  radius,
  shadow,
  spacing,
  spacingBaseUnit,
  spacingScale,
} from './tokens';

interface SpecTokens {
  color: Record<string, string>;
  typography: { scale_px: Record<string, number> };
  spacing: { base_unit_px: number; scale: number[] };
  radius_px: Record<string, number>;
  shadow: Record<string, string>;
  breakpoints_px: Record<string, number>;
  motion: {
    duration_ms: Record<string, number>;
    easing: string;
    respect_prefers_reduced_motion: boolean;
  };
}

const spec = (
  JSON.parse(readFileSync(new URL('../../../PROJECT_SPEC.json', import.meta.url), 'utf8')) as {
    design_system: { tokens: SpecTokens };
  }
).design_system.tokens;

const normalise = (value: string): string => value.replace(/\s+/g, '').toLowerCase();

describe('design tokens match PROJECT_SPEC.json exactly', () => {
  it('maps every spec colour to an identical token value', () => {
    const specColors = Object.entries(spec.color).filter(([key]) => key !== 'notes');
    expect(Object.keys(SPEC_COLOR_KEYS).sort()).toEqual(specColors.map(([key]) => key).sort());
    for (const [specKey, value] of specColors) {
      const token = SPEC_COLOR_KEYS[specKey as keyof typeof SPEC_COLOR_KEYS];
      expect(normalise(color[token]), specKey).toBe(normalise(value));
    }
  });

  it('matches the type scale', () => {
    expect(Object.keys(SPEC_FONT_SIZE_KEYS).sort()).toEqual(
      Object.keys(spec.typography.scale_px).sort(),
    );
    for (const [specKey, size] of Object.entries(spec.typography.scale_px)) {
      const token = SPEC_FONT_SIZE_KEYS[specKey as keyof typeof SPEC_FONT_SIZE_KEYS];
      expect(fontSize[token].size, specKey).toBe(size);
    }
  });

  it('matches the spacing scale and base unit', () => {
    expect(spacingBaseUnit).toBe(spec.spacing.base_unit_px);
    expect([...spacingScale]).toEqual(spec.spacing.scale);
    for (const [key, px] of Object.entries(spacing)) {
      expect(Number(key) * spacingBaseUnit).toBe(px);
    }
  });

  it('matches radii, shadows, breakpoints and container width', () => {
    expect(radius).toEqual(spec.radius_px);
    for (const [specKey, value] of Object.entries(spec.shadow)) {
      expect(shadow[SPEC_SHADOW_KEYS[specKey as keyof typeof SPEC_SHADOW_KEYS]]).toBe(value);
    }
    const { container_max: specContainer, ...specBreakpoints } = spec.breakpoints_px;
    expect(breakpoint).toEqual(specBreakpoints);
    expect(containerMax).toBe(specContainer);
  });

  it('matches motion', () => {
    expect(motion.duration).toEqual(spec.motion.duration_ms);
    expect(motion.easing.standard).toBe(spec.motion.easing);
    expect(motion.respectPrefersReducedMotion).toBe(spec.motion.respect_prefers_reduced_motion);
  });
});
