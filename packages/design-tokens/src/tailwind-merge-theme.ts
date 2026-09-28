import { color, fontFamily, fontSize, fontWeight, radius, shadow, spacing } from './tokens';

/**
 * Token names per tailwind-merge theme group. Without this, `cn('text-h2', 'text-primary')`
 * would treat the font size `text-h2` as a colour and drop it. Used by ui-web and ui-native as
 * `extendTailwindMerge({ override: { theme: tailwindMergeTheme } })`.
 */
export const tailwindMergeTheme = {
  color: Object.keys(color),
  text: Object.keys(fontSize),
  radius: Object.keys(radius),
  shadow: Object.keys(shadow),
  spacing: Object.keys(spacing),
  font: [...new Set([...Object.keys(fontFamily.web), ...Object.keys(fontFamily.native)])],
  'font-weight': Object.keys(fontWeight),
};
