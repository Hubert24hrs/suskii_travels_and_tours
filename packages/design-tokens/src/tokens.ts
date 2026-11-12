/**
 * Suskii design tokens: the single source of truth for visual design.
 *
 * Values marked "spec" mirror PROJECT_SPEC.json#/design_system/tokens exactly (tokens.test.ts
 * asserts parity). Values marked "derived" exist so every pairing the UI uses meets WCAG 2.2 AA;
 * see docs/decisions/ADR-004-accessible-derived-colour-tokens.md.
 *
 * Names are kebab-case because they become CSS custom properties and Tailwind class names
 * (`bg-primary-hover`, `text-foreground`, `rounded-lg`).
 */

export const color = {
  // spec: the SUSKII T&T logo (ADR-068): its red for actions, its blue for headings, the cart
  // tile's orange for promotions.
  primary: '#D11F0E',
  'primary-hover': '#B01A0C',
  'primary-pressed': '#93160A',
  accent: '#F7A21B',
  'accent-hover': '#E68D0A',
  background: '#FFF8F6',
  surface: '#FFFFFF',
  heading: '#0B3FBF',
  foreground: '#0D1520',
  muted: '#5B6B7B',
  border: '#EAD9D4',
  success: '#12805C',
  warning: '#B25E00',
  danger: '#B3261E',
  'focus-ring': 'rgba(11, 63, 191, 0.45)',

  // derived (ADR-004, ADR-068)
  'on-primary': '#FFFFFF',
  'on-accent': '#0D1520',
  'on-status': '#FFFFFF',
  'border-strong': '#857773',
  focus: '#0B3FBF',
  'warning-text': '#A35600',
  'primary-subtle': '#FDEBE8',
  scrim: 'rgba(13, 21, 32, 0.72)',
  'on-scrim': '#FFFFFF',
  overlay: 'rgba(13, 21, 32, 0.5)',
  skeleton: '#F3E7E3',
} as const;

export type ColorToken = keyof typeof color;

/** Maps PROJECT_SPEC.json colour keys to token names (used by the parity test and docs). */
export const SPEC_COLOR_KEYS = {
  primary: 'primary',
  primary_hover: 'primary-hover',
  primary_pressed: 'primary-pressed',
  accent: 'accent',
  accent_hover: 'accent-hover',
  background: 'background',
  surface: 'surface',
  text_heading: 'heading',
  text_body: 'foreground',
  text_muted: 'muted',
  border: 'border',
  success: 'success',
  warning: 'warning',
  danger: 'danger',
  focus_ring: 'focus-ring',
} as const satisfies Record<string, ColorToken>;

const SANS_FALLBACK = ['ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'];

export const fontFamily = {
  /** Web: `--font-plus-jakarta-sans` / `--font-dm-sans` are set by next/font or @fontsource. */
  web: {
    heading: ['var(--font-plus-jakarta-sans, "Plus Jakarta Sans")', ...SANS_FALLBACK],
    body: ['var(--font-dm-sans, "DM Sans")', ...SANS_FALLBACK],
  },
  /**
   * React Native cannot synthesise weights for custom fonts, so each weight is its own family
   * (names match the @expo-google-fonts exports the app loads).
   */
  native: {
    heading: 'PlusJakartaSans_700Bold',
    'heading-extrabold': 'PlusJakartaSans_800ExtraBold',
    body: 'DMSans_400Regular',
    'body-medium': 'DMSans_500Medium',
    'body-bold': 'DMSans_700Bold',
  },
} as const;

export const fontWeight = {
  regular: 400,
  medium: 500,
  bold: 700,
  extrabold: 800,
} as const;

/**
 * Type scale in px (spec). Line heights are derived: tight for display sizes, 1.5 for body copy
 * (WCAG 1.4.12 friendly).
 */
export const fontSize = {
  hero: { size: 54, lineHeight: 1.1 },
  'hero-mobile': { size: 34, lineHeight: 1.15 },
  h2: { size: 28, lineHeight: 1.2 },
  h3: { size: 22, lineHeight: 1.25 },
  h4: { size: 18, lineHeight: 1.3 },
  body: { size: 16, lineHeight: 1.5 },
  'body-sm': { size: 14, lineHeight: 1.45 },
  caption: { size: 12, lineHeight: 1.35 },
} as const;

export type FontSizeToken = keyof typeof fontSize;

export const SPEC_FONT_SIZE_KEYS = {
  hero: 'hero',
  hero_mobile: 'hero-mobile',
  h2: 'h2',
  h3: 'h3',
  h4: 'h4',
  body: 'body',
  body_sm: 'body-sm',
  caption: 'caption',
} as const satisfies Record<string, FontSizeToken>;

/** 4px base unit (spec). Keys are multiples of the base unit, matching Tailwind's convention. */
export const spacingBaseUnit = 4;
export const spacing = {
  '0': 0,
  '1': 4,
  '2': 8,
  '3': 12,
  '4': 16,
  '5': 20,
  '6': 24,
  '8': 32,
  '10': 40,
  '12': 48,
  '16': 64,
  '20': 80,
} as const;
export type SpacingToken = keyof typeof spacing;
export const spacingScale: readonly number[] = Object.values(spacing);

export const radius = {
  sm: 8,
  md: 10,
  lg: 12,
  xl: 16,
  pill: 9999,
} as const;

export const shadow = {
  'primary-button': '0 4px 14px 0 rgba(209, 31, 14, 0.3)',
  'card-hover': '0 6px 20px 0 rgba(13, 21, 32, 0.08)',
  none: 'none',
} as const;

export const SPEC_SHADOW_KEYS = {
  primary_button: 'primary-button',
  card_hover: 'card-hover',
  none: 'none',
} as const satisfies Record<string, keyof typeof shadow>;

export const breakpoint = {
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
} as const;

/** Max content width in px (spec `container_max`). */
export const containerMax = 1200;

/**
 * Derived component dimensions in px. The spacing scale is reserved for spacing (spec), so larger
 * fixed sizes get names here instead of arbitrary values.
 */
export const size = {
  /** Max height of listbox menus (combobox results) before they scroll. */
  menu: 320,
  /** Width of popover panels (passenger picker). */
  popover: 360,
  /** Max width of centred modal dialogs. */
  dialog: 560,
} as const;

export const motion = {
  duration: { fast: 120, base: 200 },
  easing: { standard: 'cubic-bezier(0.2, 0, 0, 1)' },
  respectPrefersReducedMotion: true,
} as const;

export const tokens = {
  color,
  fontFamily,
  fontWeight,
  fontSize,
  spacing,
  radius,
  shadow,
  breakpoint,
  containerMax,
  size,
  motion,
} as const;
