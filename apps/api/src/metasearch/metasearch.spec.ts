import { money, type FlightSearchRequest } from '@suskii/shared';

import type { AppConfig } from '../config/config';
import { parseEnv } from '../config/env.schema';
import { LocalKeyFieldEncryption } from '../crypto/field-encryption';

import {
  isMetasearchKey,
  keyHint,
  MetasearchLinks,
  newMetasearchKey,
  type MetasearchLinkClaims,
} from './metasearch-links';

const env = (extra: Record<string, string> = {}): AppConfig =>
  parseEnv({
    DATABASE_URL: 'postgresql://suskii:pw@localhost:5432/suskii',
    REDIS_URL: 'redis://localhost:6379',
    FIELD_ENCRYPTION_KEY: Buffer.alloc(32, 3).toString('base64'),
    WEB_APP_URL: 'https://www.suskii.test',
    ...extra,
  });

const HOUR = 3_600_000;
const NOW = Date.parse('2026-10-28T09:00:00Z');

const request: FlightSearchRequest = {
  slices: [
    { origin: 'LOS', destination: 'LHR', departureDate: '2026-12-01' },
    { origin: 'LHR', destination: 'LOS', departureDate: '2026-12-15' },
  ],
  passengers: { adults: 2, children: 1, infants: 1 },
  cabinClass: 'economy',
  directOnly: false,
};

const claims: MetasearchLinkClaims = {
  partnerId: '01923456-7890-7abc-8def-0123456789ab',
  request,
  itinerary: 'economy::BA75@2026-12-01T22:00:00.000Z|BA74@2026-12-15T10:30:00.000Z',
  shown: money(1_234_567_00n, 'NGN'),
};

describe('metasearch keys', () => {
  it('are smk_ and 256 random bits, never the same twice', () => {
    const first = newMetasearchKey();
    const second = newMetasearchKey();
    expect(isMetasearchKey(first)).toBe(true);
    expect(first).toHaveLength(47);
    expect(first).not.toBe(second);
    expect(keyHint(first)).toBe(first.slice(0, 12));
  });

  it('refuses anything else before it reaches the database', () => {
    for (const value of ['', 'smk_short', `pk_${'a'.repeat(43)}`, `smk_${'a'.repeat(42)}!`]) {
      expect(isMetasearchKey(value)).toBe(false);
    }
  });
});

describe('MetasearchLinks', () => {
  const config = env({ METASEARCH_LINK_TTL_HOURS: '24' });
  const links = new MetasearchLinks(new LocalKeyFieldEncryption(config), config);

  it('round-trips the partner, search, itinerary and shown price on the website', () => {
    const href = links.href(claims, NOW);
    expect(href.startsWith('https://www.suskii.test/flights/go/')).toBe(true);
    const token = decodeURIComponent(href.split('/flights/go/')[1] ?? '');
    const opened = links.open(token, NOW + HOUR);
    expect(opened).toEqual({ ...claims, issuedAt: new Date(NOW), fresh: true });
    // Short enough for every browser and metasearch engine.
    expect(href.length).toBeLessThan(1500);
  });

  it('keeps the price promise only for METASEARCH_LINK_TTL_HOURS', () => {
    const token = links.seal(claims, NOW);
    expect(links.open(token, NOW + 23 * HOUR)?.fresh).toBe(true);
    expect(links.open(token, NOW + 24 * HOUR)?.fresh).toBe(false);
  });

  it('opens nothing altered, truncated, forged or sealed for another purpose', () => {
    const token = links.seal(claims, NOW);
    const flipped = `${token.slice(0, -2)}${token.endsWith('A') ? 'B' : 'A'}${token.slice(-1)}`;
    expect(links.open(flipped, NOW)).toBeNull();
    expect(links.open(token.slice(0, -4), NOW)).toBeNull();
    expect(links.open('not-a-token', NOW)).toBeNull();
    expect(links.open('x'.repeat(5000), NOW)).toBeNull();
    const encryption = new LocalKeyFieldEncryption(config);
    const otherPurpose = encryption.encrypt(
      JSON.stringify({ p: claims.partnerId }),
      'partner-link',
    );
    expect(links.open(otherPurpose, NOW)).toBeNull();
    const wrongShape = encryption.encrypt(JSON.stringify({ p: 'x' }), 'metasearch-link');
    expect(links.open(wrongShape, NOW)).toBeNull();
  });

  it('holds no personal data: only codes, dates, counts and the price', () => {
    const token = links.seal(claims, NOW);
    const plain = new LocalKeyFieldEncryption(config).decrypt(token, 'metasearch-link');
    expect(JSON.parse(plain)).toEqual({
      p: claims.partnerId,
      s: [
        ['LOS', 'LHR', '2026-12-01'],
        ['LHR', 'LOS', '2026-12-15'],
      ],
      a: [2, 1, 1],
      c: 'economy',
      d: false,
      k: claims.itinerary,
      t: '123456700',
      m: 'NGN',
      i: NOW,
    });
  });
});
