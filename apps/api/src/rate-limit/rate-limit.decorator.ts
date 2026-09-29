import { SetMetadata } from '@nestjs/common';

/** What a limit counts against. Body fields are HMAC'd before they reach Redis. */
export type RateLimitSubject = 'ip' | 'user' | { body: 'email' | 'phone' };

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
  travellersUser: { name: 'travellers-user', limit: 60, windowSeconds: 600, by: 'user' },
} as const satisfies Record<string, RateLimitPolicy>;
