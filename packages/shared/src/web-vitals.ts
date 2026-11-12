/**
 * Field performance reporting from the website (ADR-044): the Core Web Vitals and two supporting
 * metrics, grouped by page template and device class. Nothing else about the visit is sent.
 */
export const WEB_VITAL_NAMES = ['LCP', 'INP', 'CLS', 'FCP', 'TTFB'] as const;
export type WebVitalName = (typeof WEB_VITAL_NAMES)[number];

export const WEB_VITALS_DEVICES = ['mobile', 'desktop'] as const;
export type WebVitalsDevice = (typeof WEB_VITALS_DEVICES)[number];

/**
 * The page templates metrics are grouped by. A fixed list keeps metric labels bounded, and ids,
 * slugs and query strings never leave the browser. Account pages count as one template.
 */
export const WEB_VITALS_PAGES = [
  '/',
  '/flights',
  '/flights/search',
  '/flights/[route]',
  '/hotels',
  '/hotels/search',
  '/hotels/[city]',
  '/hotels/stay/[hotelId]',
  '/packages',
  '/packages/[slug]',
  '/tours',
  '/tours/[slug]',
  '/visa',
  '/visa/[slug]',
  '/travel-add-ons',
  '/deals',
  '/prime',
  '/checkout/[quoteId]',
  '/bookings/[bookingId]',
  '/account',
  '/info/[slug]',
  'other',
] as const;
export type WebVitalsPage = (typeof WEB_VITALS_PAGES)[number];

/** Upper bounds the API accepts: anything larger is a broken measurement, not a slow page. */
export const WEB_VITAL_MAX: Record<WebVitalName, number> = {
  LCP: 120_000,
  INP: 60_000,
  CLS: 50,
  FCP: 120_000,
  TTFB: 120_000,
};

const segments = (path: string): string[] => path.split('/').filter(Boolean);

const TEMPLATES = WEB_VITALS_PAGES.filter((page) => page !== 'other').map((page) => ({
  page,
  parts: segments(page),
}));

/** The template a pathname belongs to; literal segments win over `[param]` ones. */
export function webVitalsPage(pathname: string): WebVitalsPage {
  const parts = segments(pathname.split(/[?#]/)[0] ?? '');
  if (parts[0] === 'account') return '/account';
  let best: { page: WebVitalsPage; literals: number } | null = null;
  for (const template of TEMPLATES) {
    if (template.parts.length !== parts.length) continue;
    let literals = 0;
    const matches = template.parts.every((part, index) => {
      if (part.startsWith('[')) return true;
      literals += 1;
      return part === parts[index];
    });
    if (matches && (!best || literals > best.literals)) best = { page: template.page, literals };
  }
  return best?.page ?? 'other';
}
