import { TIKTOK_CLICK_ID, TIKTOK_CLICK_PARAM } from '@suskii/shared/lite';

import { attachAdSink, type AdCall } from './ad-events';
import { TIKTOK_CLICK_STORAGE_KEY, type AdTagConfig } from './ad-tags';

type Queue = unknown[][];
type MetaPixel = ((...args: unknown[]) => void) & { queue?: Queue };
type TikTokPixel = Queue & {
  page?: (...args: unknown[]) => void;
  track?: (...args: unknown[]) => void;
  load?: (id: string) => void;
};

declare global {
  interface Window {
    fbq?: MetaPixel;
    ttq?: TikTokPixel;
  }
}

function insertScript(src: string): void {
  const script = document.createElement('script');
  script.async = true;
  script.src = src;
  document.head.append(script);
}

/** Meta's base code: a queue until fbevents.js loads and takes it over. */
function loadMeta(pixelId: string): MetaPixel {
  if (window.fbq) return window.fbq;
  const queue: Queue = [];
  const fbq: MetaPixel = Object.assign((...args: unknown[]) => void queue.push(args), { queue });
  Object.assign(fbq, { push: fbq, loaded: true, version: '2.0' });
  window.fbq = fbq;
  insertScript('https://connect.facebook.net/en_US/fbevents.js');
  // No automatic events or page metadata: only what the pages report.
  fbq('set', 'autoConfig', false, pixelId);
  fbq('init', pixelId);
  return fbq;
}

/** TikTok's base code: a queue of method calls until events.js loads and replays it. */
function loadTikTok(pixelId: string): TikTokPixel {
  if (window.ttq) return window.ttq;
  const ttq = [] as unknown as TikTokPixel;
  for (const method of ['page', 'track'] as const) {
    ttq[method] = (...args: unknown[]) => void ttq.push([method, ...args]);
  }
  Object.assign(window, { TiktokAnalyticsObject: 'ttq' });
  window.ttq = ttq;
  insertScript(
    `https://analytics.tiktok.com/i18n/pixel/events.js?sdkid=${encodeURIComponent(pixelId)}&lib=ttq`,
  );
  return ttq;
}

/** Keeps TikTok's click id from the landing URL for checkout, in this tab only. */
function keepTikTokClick(): void {
  const click = new URLSearchParams(location.search).get(TIKTOK_CLICK_PARAM);
  if (!click || !TIKTOK_CLICK_ID.test(click)) return;
  try {
    sessionStorage.setItem(TIKTOK_CLICK_STORAGE_KEY, click);
  } catch {
    // Storage may be unavailable (private mode); the click id is then simply not sent.
  }
}

const compact = (value: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));

/**
 * Starts the configured tags; called only after `marketing` consent (ADR-079). Events carry trip
 * facts only, and the networks' automatic matching stays off.
 */
export function startAdTags(config: AdTagConfig): void {
  const meta = config.metaPixelId ? loadMeta(config.metaPixelId) : null;
  const tiktok = config.tiktokPixelId ? loadTikTok(config.tiktokPixelId) : null;
  keepTikTokClick();
  const send = ({ event, params }: AdCall): void => {
    const value = params.value === undefined ? undefined : Number(params.value);
    if (meta) {
      if (event === 'PageView') meta('track', 'PageView');
      else
        meta(
          'track',
          event,
          compact({
            value,
            currency: params.currency,
            content_type: 'product',
            content_ids: params.contentIds,
            search_string: params.search,
          }),
          params.eventId ? { eventID: params.eventId } : undefined,
        );
    }
    if (tiktok) {
      if (event === 'PageView') tiktok.page?.();
      else
        tiktok.track?.(
          event,
          compact({
            value,
            currency: params.currency,
            content_type: 'product',
            contents: params.contentIds?.map((id) => ({ content_id: id })),
            query: params.search,
          }),
          params.eventId ? { event_id: params.eventId } : undefined,
        );
    }
  };
  // The page the visitor allowed marketing on counts first; later pages report their own.
  send({ event: 'PageView', params: {} });
  attachAdSink(send);
}
