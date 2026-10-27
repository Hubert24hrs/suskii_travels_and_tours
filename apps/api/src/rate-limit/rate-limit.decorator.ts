import { SetMetadata } from '@nestjs/common';

/** What a limit counts against. Body fields are HMAC'd before they reach Redis. */
export type RateLimitSubject = 'ip' | 'user' | { body: 'email' | 'phone' | 'reference' };

export interface RateLimitPolicy {
  /** Stable name; part of the Redis key and shared across routes that use the same policy. */
  name: string;
  limit: number;
  windowSeconds: number;
  by: RateLimitSubject;
}

export const RATE_LIMIT_POLICIES = 'suskii:rate-limit-policies';
export const SKIP_RATE_LIMIT = 'suskii:skip-rate-limit';

/** Infrastructure probes (load balancer health checks) are exempt. */
export const SkipRateLimit = (): MethodDecorator & ClassDecorator =>
  SetMetadata(SKIP_RATE_LIMIT, true);

/**
 * Adds stricter limits to a route, on top of the defaults (per route per caller, and a global
 * per-IP ceiling).
 */
export const RateLimit = (...policies: RateLimitPolicy[]): MethodDecorator & ClassDecorator =>
  SetMetadata(RATE_LIMIT_POLICIES, policies);

/** Shared policies for credential and OTP endpoints. */
export const AUTH_LIMITS = {
  login: { name: 'auth-login-ip', limit: 10, windowSeconds: 60, by: 'ip' },
  register: { name: 'auth-register-ip', limit: 10, windowSeconds: 3600, by: 'ip' },
  refresh: { name: 'auth-refresh-ip', limit: 60, windowSeconds: 60, by: 'ip' },
  mfa: { name: 'auth-mfa-ip', limit: 10, windowSeconds: 60, by: 'ip' },
  otpSendIp: { name: 'auth-otp-send-ip', limit: 10, windowSeconds: 3600, by: 'ip' },
  otpSendPhone: {
    name: 'auth-otp-send-phone',
    limit: 3,
    windowSeconds: 600,
    by: { body: 'phone' },
  },
  otpVerify: { name: 'auth-otp-verify-ip', limit: 10, windowSeconds: 60, by: 'ip' },
  social: { name: 'auth-social-ip', limit: 20, windowSeconds: 60, by: 'ip' },
  resetIp: { name: 'auth-reset-ip', limit: 5, windowSeconds: 3600, by: 'ip' },
  resetEmail: { name: 'auth-reset-email', limit: 3, windowSeconds: 3600, by: { body: 'email' } },
  verifyEmail: { name: 'auth-verify-email-ip', limit: 10, windowSeconds: 60, by: 'ip' },
  sensitive: { name: 'account-sensitive-user', limit: 10, windowSeconds: 600, by: 'user' },
} as const satisfies Record<string, RateLimitPolicy>;

/** Data export and account deletion (ADR-029): costly and sensitive, so few per user. */
export const PRIVACY_LIMITS = {
  exportUser: { name: 'data-export-user', limit: 5, windowSeconds: 86_400, by: 'user' },
  deleteUser: { name: 'account-delete-user', limit: 5, windowSeconds: 3600, by: 'user' },
  /** Cookie choices: a person changes them a few times at most. */
  cookieConsentIp: { name: 'cookie-consent-ip', limit: 20, windowSeconds: 600, by: 'ip' },
} as const satisfies Record<string, RateLimitPolicy>;

/** Field performance beacons: a page view sends one or two, so a generous per-IP ceiling. */
export const TELEMETRY_LIMITS = {
  webVitalsIp: { name: 'web-vitals-ip', limit: 120, windowSeconds: 600, by: 'ip' },
} as const satisfies Record<string, RateLimitPolicy>;

/** Search is expensive (supplier calls) and a scraping target: per-IP quotas plus cache-first. */
export const SEARCH_LIMITS = {
  searchIp: { name: 'search-ip', limit: 30, windowSeconds: 60, by: 'ip' },
  searchIpDaily: { name: 'search-ip-daily', limit: 1000, windowSeconds: 86_400, by: 'ip' },
  searchUser: { name: 'search-user', limit: 60, windowSeconds: 60, by: 'user' },
  quoteIp: { name: 'quote-ip', limit: 30, windowSeconds: 60, by: 'ip' },
  promoIp: { name: 'promo-ip', limit: 10, windowSeconds: 600, by: 'ip' },
  promoUser: { name: 'promo-user', limit: 10, windowSeconds: 600, by: 'user' },
} as const satisfies Record<string, RateLimitPolicy>;

/** Newsletter sign-up and email-link endpoints (ADR-012). */
/** AI trip search (ADR-061): the cost cap bounds spend; these bound bursts. */
export const AI_SEARCH_LIMITS = {
  ip: { name: 'ai-search-ip', limit: 10, windowSeconds: 60, by: 'ip' },
  ipDaily: { name: 'ai-search-ip-daily', limit: 200, windowSeconds: 86_400, by: 'ip' },
  user: { name: 'ai-search-user', limit: 20, windowSeconds: 60, by: 'user' },
} as const satisfies Record<string, RateLimitPolicy>;

export const NEWSLETTER_LIMITS = {
  subscribeIp: { name: 'newsletter-ip', limit: 5, windowSeconds: 600, by: 'ip' },
  subscribeEmail: {
    name: 'newsletter-email',
    limit: 3,
    windowSeconds: 3600,
    by: { body: 'email' },
  },
  tokenIp: { name: 'newsletter-token-ip', limit: 20, windowSeconds: 600, by: 'ip' },
} as const satisfies Record<string, RateLimitPolicy>;

/** Checkout: booking creation and payment starts call suppliers and hold inventory. */
export const BOOKING_LIMITS = {
  createIp: { name: 'booking-create-ip', limit: 20, windowSeconds: 600, by: 'ip' },
  createUser: { name: 'booking-create-user', limit: 20, windowSeconds: 600, by: 'user' },
  paymentIp: { name: 'booking-payment-ip', limit: 30, windowSeconds: 600, by: 'ip' },
  mockPaymentIp: { name: 'mock-payment-ip', limit: 30, windowSeconds: 600, by: 'ip' },
  /** Holds tie up airline inventory: a tighter budget against seat spinning (ADR-018). */
  holdIp: { name: 'booking-hold-ip', limit: 6, windowSeconds: 3600, by: 'ip' },
  /** Each flight cancellation quote opens a pending cancellation with the airline (ADR-064). */
  cancellationQuoteIp: {
    name: 'flight-cancellation-quote-ip',
    limit: 10,
    windowSeconds: 600,
    by: 'ip',
  },
  travellersUser: { name: 'travellers-user', limit: 60, windowSeconds: 600, by: 'user' },
  /** "Manage booking" emails a link: few per address, fewer per booking (no email bombing). */
  linkIp: { name: 'booking-link-ip', limit: 10, windowSeconds: 600, by: 'ip' },
  linkReference: {
    name: 'booking-link-reference',
    limit: 3,
    windowSeconds: 3600,
    by: { body: 'reference' },
  },
} as const satisfies Record<string, RateLimitPolicy>;

/** Mobile devices: push token registration and attestation challenges (ADR-022, ADR-023). */
export const DEVICE_LIMITS = {
  pushTokenIp: { name: 'push-token-ip', limit: 30, windowSeconds: 600, by: 'ip' },
  challengeIp: { name: 'attestation-challenge-ip', limit: 60, windowSeconds: 600, by: 'ip' },
} as const satisfies Record<string, RateLimitPolicy>;

/** In-house catalog, add-on links and visa documents (ADR-025 to ADR-027). */
export const INHOUSE_LIMITS = {
  catalogIp: { name: 'inhouse-catalog-ip', limit: 120, windowSeconds: 60, by: 'ip' },
  /** Reference and surname lookups: tight, like other booking lookups (ADR-027). */
  addonLinkIp: { name: 'addon-link-ip', limit: 10, windowSeconds: 600, by: 'ip' },
  visaUploadIp: { name: 'visa-upload-ip', limit: 60, windowSeconds: 3600, by: 'ip' },
  visaLinkIp: { name: 'visa-link-ip', limit: 120, windowSeconds: 600, by: 'ip' },
  voucherRedeemUser: { name: 'voucher-redeem-user', limit: 120, windowSeconds: 600, by: 'user' },
} as const satisfies Record<string, RateLimitPolicy>;

/** Cars (ADR-050): holds and quotes are scraping and hoarding targets; safety routes never starve. */
export const CARS_LIMITS = {
  catalogIp: { name: 'cars-catalog-ip', limit: 60, windowSeconds: 60, by: 'ip' },
  holdIp: { name: 'bus-hold-ip', limit: 20, windowSeconds: 600, by: 'ip' },
  holdUser: { name: 'bus-hold-user', limit: 20, windowSeconds: 600, by: 'user' },
  scanUser: { name: 'ticket-scan-user', limit: 240, windowSeconds: 60, by: 'user' },
  rideQuoteIp: { name: 'ride-quote-ip', limit: 30, windowSeconds: 60, by: 'ip' },
  rideQuoteUser: { name: 'ride-quote-user', limit: 30, windowSeconds: 60, by: 'user' },
  /** One position every five seconds, with slack for retries. */
  locationUser: { name: 'driver-location-user', limit: 20, windowSeconds: 60, by: 'user' },
  driverActionUser: { name: 'driver-action-user', limit: 60, windowSeconds: 60, by: 'user' },
  rideActionUser: { name: 'ride-action-user', limit: 60, windowSeconds: 60, by: 'user' },
  /** SOS is never limited below one a minute (ADR-050). */
  sosUser: { name: 'ride-sos-user', limit: 5, windowSeconds: 60, by: 'user' },
  shareIp: { name: 'ride-share-ip', limit: 120, windowSeconds: 60, by: 'ip' },
  uploadUser: { name: 'driver-upload-user', limit: 20, windowSeconds: 3600, by: 'user' },
  applyUser: { name: 'driver-apply-user', limit: 5, windowSeconds: 3600, by: 'user' },
  /** Departure plans route through the maps provider: a few a minute is plenty. */
  planIp: { name: 'trip-plan-ip', limit: 30, windowSeconds: 60, by: 'ip' },
} as const satisfies Record<string, RateLimitPolicy>;
