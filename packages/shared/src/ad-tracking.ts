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
 * Meta's `_fbp` and `_fbc` values: `fb.<subdomain index>.<creation time in ms>.<random or fbclid>`
 * (newer tags may append a short suffix). The browser drops anything else before sending it.
 */
export const META_CLICK_ID = /^fb\.\d\.\d{10,16}\.[A-Za-z0-9_.-]{1,500}$/;
/** TikTok's `_ttp` cookie and `ttclid` parameter: opaque URL-safe tokens. */
export const TIKTOK_CLICK_ID = /^[A-Za-z0-9_.-]{8,500}$/;

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

/**
 * What the website sends with a booking when its consent cookie allows marketing (ADR-079):
 * the consent record's id and the networks' click ids it has.
 */
export interface MarketingAttribution {
  consentId: string;
  fbp?: string;
  fbc?: string;
  ttp?: string;
  ttclid?: string;
}

/** Server-side sends per conversion before it is given up (ADR-079). */
export const AD_CONVERSION_MAX_ATTEMPTS = 3;
