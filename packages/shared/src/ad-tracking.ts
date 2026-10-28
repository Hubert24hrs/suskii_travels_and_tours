/**
 * Ads with consent (ADR-079). The website loads a network's tag only after `marketing` consent;
 * the API sends server-side Purchase events only for bookings whose recorded consent allows it.
 * Zod-free, so the web's lite entry can use the names.
 */

export const AD_NETWORKS = ['meta', 'tiktok'] as const;
export type AdNetwork = (typeof AD_NETWORKS)[number];

/** First-party cookies the networks' tags set, which identify the browser to the network. */
export const AD_CLICK_COOKIES = {
  /** Meta: browser id. */
  fbp: '_fbp',
  /** Meta: the last ad click (`fbclid`), set by the tag. */
  fbc: '_fbc',
  /** TikTok: browser id. */
  ttp: '_ttp',
} as const;

/** Query parameter TikTok adds to ad clicks; the tag does not keep it, so checkout reads it. */
export const TIKTOK_CLICK_PARAM = 'ttclid';

/**
 * Standard event names, one list for both networks' tags and the server. Purchase is the only one
 * the server sends; its event id is the booking id, so each network keeps one of the two copies.
 */
export const AD_EVENTS = [
  'PageView',
  'Search',
  'ViewContent',
  'InitiateCheckout',
  'Purchase',
  'CompleteRegistration',
] as const;
export type AdEvent = (typeof AD_EVENTS)[number];

/** Server-side sends per conversion before it is given up (ADR-079). */
export const AD_CONVERSION_MAX_ATTEMPTS = 3;
