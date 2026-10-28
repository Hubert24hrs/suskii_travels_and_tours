import { createHash } from 'node:crypto';

import type { AdNetwork, MarketingAttribution } from '@suskii/shared';

/** The networks' click ids a booking may carry (ADR-079). */
export type ClickIds = Omit<MarketingAttribution, 'consentId'>;

/**
 * One server-side Purchase. Personal values arrive already hashed (SHA-256 of the normalised
 * value, as both networks require); nothing readable leaves the API.
 */
export interface PurchaseEvent {
  /** The booking id: the browser tag sends the same, so each network keeps one copy. */
  eventId: string;
  eventTime: Date;
  /** Decimal amount in `currency`, from the booking's total in minor units. */
  value: string;
  currency: string;
  /** The booking page without any token, for the network's source URL. */
  sourceUrl: string;
  /** Product kinds in the booking (flight, hotel, tour, ...). */
  contentIds: string[];
  hashedEmail: string | null;
  hashedPhone: string | null;
  clickIds: ClickIds;
}

/** A network's server-side events API. Adapters keep vendor payloads to themselves. */
export abstract class AdConversionsProvider {
  abstract readonly network: AdNetwork | 'mock';
  abstract sendPurchase(event: PurchaseEvent, signal: AbortSignal): Promise<void>;
}

/** Records events in memory: tests and local runs (production refuses it, ADR-079). */
export class MockAdConversions extends AdConversionsProvider {
  readonly network = 'mock' as const;
  readonly sent: PurchaseEvent[] = [];
  /** Failures to simulate before the next sends succeed (tests). */
  failNext = 0;

  sendPurchase(event: PurchaseEvent): Promise<void> {
    if (this.failNext > 0) {
      this.failNext -= 1;
      return Promise.reject(new Error('mock ad network unavailable'));
    }
    this.sent.push(event);
    return Promise.resolve();
  }
}

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

/** Trimmed and lower-cased, then SHA-256 (both networks' rule for email). */
export function hashEmail(email: string): string | null {
  const normalised = email.trim().toLowerCase();
  return normalised.includes('@') ? sha256(normalised) : null;
}

/** Digits only, with the country code and no `+` or leading zeros, then SHA-256. */
export function hashPhone(phone: string): string | null {
  const digits = phone.replace(/\D/g, '').replace(/^0+/, '');
  return digits.length >= 7 ? sha256(digits) : null;
}
