import { describe, expect, it } from 'vitest';

import {
  COOKIE_POLICY_VERSION,
  formatCookieConsent,
  parseCookieConsent,
  type CookieConsent,
} from './cookie-consent';

const consent: CookieConsent = {
  version: COOKIE_POLICY_VERSION,
  consentId: '0192d3a0-7c1e-7b2a-9f00-1234567890ab',
  choices: { analytics: true, marketing: false },
};

describe('cookie consent cookie (ADR-042)', () => {
  it('round-trips a recorded choice', () => {
    const value = formatCookieConsent(consent);
    expect(value).toBe(`${COOKIE_POLICY_VERSION}.0192d3a0-7c1e-7b2a-9f00-1234567890ab.10`);
    expect(parseCookieConsent(value)).toEqual(consent);
  });

  it('treats anything else as no choice, so optional cookies stay off', () => {
    for (const value of [
      undefined,
      null,
      '',
      'yes',
      `0.${consent.consentId}.11`,
      `${COOKIE_POLICY_VERSION + 1}.${consent.consentId}.11`,
      `${COOKIE_POLICY_VERSION}.not-a-uuid.11`,
      `${COOKIE_POLICY_VERSION}.${consent.consentId}.1`,
      `${COOKIE_POLICY_VERSION}.${consent.consentId}.12`,
      `${COOKIE_POLICY_VERSION}.${consent.consentId}.11.extra`,
    ]) {
      expect(parseCookieConsent(value)).toBeNull();
    }
  });
});
