import type { AppConfig } from '../config/config';

/**
 * Whether assisted quotes are offered (ADR-104): on when set; unset means on outside
 * production and off in production. Off stops what starts something new (a request, an offer,
 * a payment for an offer). It never stops staff from finishing what a traveller already paid
 * for.
 */
export const assistedQuotesEnabled = (config: AppConfig): boolean =>
  config.ASSISTED_QUOTES_ENABLED ?? config.NODE_ENV !== 'production';
