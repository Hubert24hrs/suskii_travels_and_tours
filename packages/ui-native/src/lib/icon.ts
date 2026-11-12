import { color, spacing } from '@suskii/design-tokens';

/** Icon sizes from the spacing scale (lucide icons take numeric sizes). */
export const iconSize = {
  sm: spacing['4'],
  md: spacing['5'],
  lg: spacing['6'],
} as const;

/** Icon colours from tokens (SVG icons cannot take NativeWind text colours). */
export const iconColor = color;
