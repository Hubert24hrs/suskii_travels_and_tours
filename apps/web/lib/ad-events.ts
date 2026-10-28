import type { AdEvent } from '@suskii/shared/lite';

import { hasCookieConsent } from './consent-cookie';

/** Trip facts only: never a name, email, phone or booking reference (ADR-079). */
export interface AdEventParams {
  /** Decimal amount in `currency` (from an API Money value). */
  value?: string;
  currency?: string;
  /** Booking verticals (`flights`, `hotels`, `packages`...), as the server's Purchase sends them. */
  contentIds?: string[];
  /** A search as IATA codes or a city, e.g. `LOS-LHR`. */
  search?: string;
  /** Lets the network keep one of the browser and server copies (the booking id). */
  eventId?: string;
}

export interface AdCall {
  event: AdEvent;
  params: AdEventParams;
}

/** Calls made before the tags finish loading; only while marketing is allowed. */
const MAX_QUEUED = 20;
const queue: AdCall[] = [];
let sink: ((call: AdCall) => void) | null = null;

/**
 * Pages report what happens; nothing leaves the browser unless the visitor allowed marketing and
 * the tags loaded. Cheap to call from any page: it never loads the tags itself.
 */
export function trackAd(event: AdEvent, params: AdEventParams = {}): void {
  if (sink) {
    sink({ event, params });
    return;
  }
  if (queue.length < MAX_QUEUED && hasCookieConsent('marketing')) queue.push({ event, params });
}

/** The loader hands over its sender once the tags are in place, and gets what waited. */
export function attachAdSink(next: (call: AdCall) => void): void {
  sink = next;
  for (const call of queue.splice(0)) next(call);
}
