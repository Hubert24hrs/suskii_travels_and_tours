import { describe, expect, it } from 'vitest';

import { AD_EVENTS, AD_NETWORKS } from './ad-tracking';
import { marketingAttributionSchema } from './ad-tracking-schemas';
import { COOKIE_POLICY_VERSION, parseCookieConsent } from './cookie-consent';

const CONSENT_ID = '0192d3a0-7c1e-7b2a-9f00-1234567890ab';

describe('marketing attribution (ADR-079)', () => {
  it('accepts the click ids the networks set', () => {
    const parsed = marketingAttributionSchema.parse({
      consentId: CONSENT_ID,
      fbp: 'fb.1.1714546784212.1116446470',
      fbc: 'fb.1.1714546784212.IwAR2F4-dbP0l7Mn1IawQQGCINEz7PYXQvwjNwB_qa2ofrHyiLjcbCRxTDMgk',
      ttp: '2Kx4mP9qLzQ0aBcDeFgHiJ',
      ttclid: 'E.C.P.CsoBhTkQ_test-click_id',
    });
    expect(parsed.consentId).toBe(CONSENT_ID);
  });

  it('needs only the consent id', () => {
    expect(marketingAttributionSchema.parse({ consentId: CONSENT_ID })).toEqual({
      consentId: CONSENT_ID,
    });
  });

  it.each([
    ['a consent id that is not a uuid', { consentId: 'not-a-uuid' }],
    ['a Meta id in another shape', { consentId: CONSENT_ID, fbp: 'abc.1.2.3' }],
    ['markup in a click id', { consentId: CONSENT_ID, ttclid: '<script>alert(1)</script>' }],
    ['an over-long click id', { consentId: CONSENT_ID, ttp: 'a'.repeat(501) }],
    ['an unknown field', { consentId: CONSENT_ID, email: 'ada@example.com' }],
  ])('refuses %s', (_name, value) => {
    expect(marketingAttributionSchema.safeParse(value).success).toBe(false);
  });

  it('lists both networks and Purchase among the standard events', () => {
    expect(AD_NETWORKS).toEqual(['meta', 'tiktok']);
    expect(AD_EVENTS).toContain('Purchase');
  });

  it('asks again after the tags were added: a version 1 choice is no choice', () => {
    expect(COOKIE_POLICY_VERSION).toBe(2);
    expect(parseCookieConsent(`1.${CONSENT_ID}.11`)).toBeNull();
  });
});
