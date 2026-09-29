import type { AppConfig } from '../config/config';

/** The booking page on the web app (guests add an access token, see booking-access-links.ts). */
export const bookingUrl = (config: AppConfig, bookingId: string): string =>
  `${config.WEB_APP_URL.replace(/\/$/, '')}/bookings/${bookingId}`;
