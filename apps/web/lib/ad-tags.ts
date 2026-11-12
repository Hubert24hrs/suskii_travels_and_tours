/** Where checkout finds TikTok's click id, kept from the landing URL: the tag does not keep it. */
export const TIKTOK_CLICK_STORAGE_KEY = 'suskii:ttclid';

/**
 * The ad networks' browser tags (ADR-079). Their ids are read at request time (the server renders
 * every page), so one build serves every environment; unset means no tag, no prompt and no CSP
 * change. They must be the same ids the API sends server-side events for.
 */
export interface AdTagConfig {
  metaPixelId: string | null;
  tiktokPixelId: string | null;
}

const META_PIXEL = /^\d{6,20}$/;
const TIKTOK_PIXEL = /^[A-Z0-9]{8,32}$/;

/** Server only: the configured ids, ignoring malformed values. */
export function adTagConfig(env: Record<string, string | undefined> = process.env): AdTagConfig {
  const meta = env.META_PIXEL_ID?.trim() ?? '';
  const tiktok = env.TIKTOK_PIXEL_ID?.trim() ?? '';
  return {
    metaPixelId: META_PIXEL.test(meta) ? meta : null,
    tiktokPixelId: TIKTOK_PIXEL.test(tiktok) ? tiktok : null,
  };
}

export const adTagsOn = (config: AdTagConfig): boolean =>
  config.metaPixelId !== null || config.tiktokPixelId !== null;

/**
 * Where the tags send events and pixels, for the CSP. Scripts need no entry: our bundle inserts
 * them, and `strict-dynamic` trusts what a trusted script inserts (ADR-010).
 */
export function adTagOrigins(config: AdTagConfig): { connect: string[]; img: string[] } {
  const connect: string[] = [];
  const img: string[] = [];
  if (config.metaPixelId) {
    connect.push('https://connect.facebook.net', 'https://www.facebook.com');
    img.push('https://www.facebook.com');
  }
  if (config.tiktokPixelId) {
    connect.push('https://analytics.tiktok.com');
    img.push('https://analytics.tiktok.com');
  }
  return { connect, img };
}
