import { ms, px } from './format';
import {
  breakpoint,
  color,
  containerMax,
  fontFamily,
  fontSize,
  fontWeight,
  motion,
  radius,
  shadow,
  size,
  spacing,
} from './tokens';

const mapValues = <T, R>(
  record: Readonly<Record<string, T>>,
  fn: (value: T) => R,
): Record<string, R> =>
  Object.fromEntries(Object.entries(record).map(([key, value]) => [key, fn(value)]));

/**
 * Tailwind CSS v3 preset for NativeWind (mobile). Uses `theme` (not `extend`) for every scale the
 * design system owns, so Tailwind's default palette and scales do not exist on mobile either.
 * Built from the same tokens as the web theme; a parity test checks both expose the same classes.
 */
export const nativewindPreset = {
  theme: {
    colors: { transparent: 'transparent', current: 'currentColor', ...color },
    fontFamily: mapValues(fontFamily.native, (family) => [family]),
    fontSize: mapValues(fontSize, ({ size, lineHeight }): [string, { lineHeight: string }] => [
      px(size),
      // React Native needs absolute line heights.
      { lineHeight: px(Math.round(size * lineHeight)) },
    ]),
    fontWeight: mapValues(fontWeight, String),
    spacing: mapValues(spacing, px),
    borderRadius: { none: '0px', ...mapValues(radius, px), full: '9999px' },
    boxShadow: { ...shadow },
    screens: mapValues(breakpoint, px),
    maxWidth: {
      none: 'none',
      full: '100%',
      page: px(containerMax),
      popover: px(size.popover),
      dialog: px(size.dialog),
    },
    maxHeight: { none: 'none', full: '100%', menu: px(size.menu) },
    transitionDuration: mapValues(motion.duration, ms),
    transitionTimingFunction: { ...motion.easing },
    // The spec's active-tab underline is 3px; Tailwind v3 has no `border-3` by default.
    extend: { borderWidth: { 3: '3px' } },
  },
};

export default nativewindPreset;
