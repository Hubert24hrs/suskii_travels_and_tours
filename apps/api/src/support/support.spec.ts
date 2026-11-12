import type { AppConfig } from '../config/config';
import { DEFAULT_SUPPORT_SLA, parseEnv } from '../config/env.schema';
import { HmacService } from '../crypto/hmac.service';

import { SUPPORT_LINK_TTL_MS, SupportAccess } from './support-access';

const env = (extra: Record<string, string> = {}): AppConfig =>
  parseEnv({
    DATABASE_URL: 'postgresql://suskii:pw@localhost:5432/suskii',
    REDIS_URL: 'redis://localhost:6379',
    FIELD_ENCRYPTION_KEY: Buffer.alloc(32, 3).toString('base64'),
    ...extra,
  });

const NOW = Date.parse('2026-11-02T10:00:00Z');
const ID = '01923456-7890-7abc-8def-0123456789ab';
const OTHER = '01923456-7890-7abc-8def-0123456789ac';

describe('support access (ADR-083)', () => {
  const access = new SupportAccess(new HmacService({ HMAC_SECRET: 'x'.repeat(32) } as AppConfig));

  it("opens a guest's conversation with its access token, never with the stored digest", () => {
    const { token, hash } = access.issue();
    const conversation = { id: ID, accessTokenHash: hash };
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(access.opens(conversation, token, NOW)).toBe(true);
    expect(access.opens(conversation, hash, NOW)).toBe(false);
    expect(access.opens(conversation, access.issue().token, NOW)).toBe(false);
  });

  it('opens with an emailed link for that conversation until it expires', () => {
    const conversation = { id: ID, accessTokenHash: null };
    const link = access.link(ID, NOW);
    expect(access.opens(conversation, link, NOW + SUPPORT_LINK_TTL_MS - 1)).toBe(true);
    expect(access.opens(conversation, link, NOW + SUPPORT_LINK_TTL_MS)).toBe(false);
    expect(access.opens({ id: OTHER, accessTokenHash: null }, link, NOW)).toBe(false);
    // A later expiry with the old signature is refused.
    const [id, expires, signature] = link.split('.');
    expect(access.opens(conversation, `${id}.${Number(expires) + 1}.${signature}`, NOW)).toBe(
      false,
    );
  });
});

describe('SUPPORT_SLA', () => {
  it('defaults to minutes per priority and overrides only what is named', () => {
    expect(env().SUPPORT_SLA).toEqual(DEFAULT_SUPPORT_SLA);
    expect(env({ SUPPORT_SLA: 'urgent=10/120' }).SUPPORT_SLA).toEqual({
      ...DEFAULT_SUPPORT_SLA,
      urgent: { responseMinutes: 10, resolutionMinutes: 120 },
    });
  });

  it('refuses an unknown priority or a malformed rule', () => {
    expect(() => env({ SUPPORT_SLA: 'vip=10/120' })).toThrow();
    expect(() => env({ SUPPORT_SLA: 'urgent=10' })).toThrow();
  });
});
