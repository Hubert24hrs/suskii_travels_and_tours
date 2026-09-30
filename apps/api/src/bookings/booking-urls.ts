import type { AppConfig } from '../config/config';
import type { SalesChannel } from '../generated/prisma/client';

const webBase = (config: AppConfig): string => config.WEB_APP_URL.replace(/\/$/, '');

/** The booking page on the web app (guests add an access token, see booking-access-links.ts). */
export const bookingUrl = (config: AppConfig, bookingId: string): string =>
  `${webBase(config)}/bookings/${bookingId}`;

/**
 * Where a hosted checkout sends the traveller back. The app gets a small web page that opens the
 * app (providers only accept https return URLs, ADR-021); everyone else gets the booking page.
 */
export const paymentReturnUrl = (
  config: AppConfig,
  bookingId: string,
  channel: SalesChannel | null,
): string =>
  channel === 'mobile'
    ? `${webBase(config)}/mobile/payment-return?booking=${bookingId}`
    : bookingUrl(config, bookingId);
