import { flatten } from './color';
import { color, type ColorToken } from './tokens';

/** WCAG 2.2 AA minimums. */
export const WCAG_AA = {
  /** 1.4.3 body text. */
  text: 4.5,
  /** 1.4.3 large text (>= 24px, or >= 18.66px bold). */
  largeText: 3,
  /** 1.4.11 UI component boundaries, focus indicators and meaningful graphics. */
  nonText: 3,
} as const;

export interface ContrastRequirement {
  foreground: ColorToken;
  /** A token, or an opaque colour the background is composited onto first (for scrims). */
  background: ColorToken | { token: ColorToken; over: string };
  minimum: number;
  usage: string;
}

/** A pure white photo is the worst case for white text on the destination-card scrim. */
const WORST_CASE_IMAGE = '#FFFFFF';

/**
 * Every foreground/background pairing the component libraries render. Adding a component that
 * uses a new pairing means adding it here; the contrast test enforces the minimum.
 */
export const CONTRAST_CONTRACT: readonly ContrastRequirement[] = [
  // Body copy and headings on page and card surfaces
  ...(
    ['foreground', 'muted', 'heading', 'primary', 'danger', 'success', 'warning-text'] as const
  ).flatMap((fg) =>
    (['surface', 'background'] as const).map((bg) => ({
      foreground: fg,
      background: bg,
      minimum: WCAG_AA.text,
      usage: `${fg} text on ${bg}`,
    })),
  ),
  // Filled buttons and badges
  ...(['primary', 'primary-hover', 'primary-pressed'] as const).map((bg) => ({
    foreground: 'on-primary' as const,
    background: bg,
    minimum: WCAG_AA.text,
    usage: `primary button label (${bg})`,
  })),
  ...(['accent', 'accent-hover'] as const).map((bg) => ({
    foreground: 'on-accent' as const,
    background: bg,
    minimum: WCAG_AA.text,
    usage: `secondary (orange) button and promo badge label (${bg})`,
  })),
  ...(['success', 'warning', 'danger'] as const).map((bg) => ({
    foreground: 'on-status' as const,
    background: bg,
    minimum: WCAG_AA.text,
    usage: `status badge label (${bg})`,
  })),
  {
    foreground: 'primary',
    background: 'primary-subtle',
    minimum: WCAG_AA.text,
    usage: 'info badge label and selected option text',
  },
  {
    foreground: 'foreground',
    background: 'primary-subtle',
    minimum: WCAG_AA.text,
    usage: 'text inside a highlighted (selected or in-range) row or day',
  },
  {
    foreground: 'on-scrim',
    background: { token: 'scrim', over: WORST_CASE_IMAGE },
    minimum: WCAG_AA.text,
    usage: 'destination card text over the image scrim (worst case: white photo)',
  },
  // Non-text: control boundaries and focus indicators
  ...(['surface', 'background'] as const).flatMap((bg) => [
    {
      foreground: 'border-strong' as const,
      background: bg,
      minimum: WCAG_AA.nonText,
      usage: `input and control boundary on ${bg}`,
    },
    {
      foreground: 'focus' as const,
      background: bg,
      minimum: WCAG_AA.nonText,
      usage: `focus outline on ${bg}`,
    },
  ]),
  {
    foreground: 'focus',
    background: 'primary-subtle',
    minimum: WCAG_AA.nonText,
    usage: 'focus outline on a highlighted row or day',
  },
];

/** Resolves a requirement's background to an opaque colour string. */
export function resolveBackground(background: ContrastRequirement['background']): string {
  return typeof background === 'string'
    ? color[background]
    : flatten(color[background.token], background.over);
}
