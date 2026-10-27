import { ProblemDetailsException } from '../common/problem-details';
import type { AppConfig } from '../config/config';
import { parseEnv } from '../config/env.schema';
import { LocalKeyFieldEncryption } from '../crypto/field-encryption';

import { MockActivityPartner } from './activity-partner';
import { MockAffiliateLinker } from './affiliate-linker';
import { parsePostback } from './partner-conversions.service';
import { PartnerLinks } from './partner-links';
import { partnerOffersEnabled } from './partner-offers.service';
import {
  allowedDestination,
  countrySlug,
  PARTNER_PROGRAMS,
  partnerProgram,
  type PartnerProgram,
} from './partner-programs';
import {
  LINK_CALLS_PER_MINUTE,
  TravelpayoutsLinker,
  type LinkStore,
} from './travelpayouts/travelpayouts-linker';
import { ViatorActivityPartner } from './viator/viator-activity-partner';

const env = (extra: Record<string, string> = {}): AppConfig =>
  parseEnv({
    DATABASE_URL: 'postgresql://suskii:pw@localhost:5432/suskii',
    REDIS_URL: 'redis://localhost:6379',
    FIELD_ENCRYPTION_KEY: Buffer.alloc(32, 3).toString('base64'),
    ...extra,
  });

const program = (id: string): PartnerProgram => {
  const found = partnerProgram(id);
  if (!found) throw new Error(`no programme ${id}`);
  return found;
};

const CLICK = '0192d3a0-7c1e-7b2a-9f00-0000000000c1';
const LAGOS = {
  countryCode: 'NG',
  cityName: 'Lagos',
  startDate: '2026-12-01',
  endDate: '2026-12-05',
};

function memoryStore(): LinkStore & { values: Map<string, string>; counts: Map<string, number> } {
  const values = new Map<string, string>();
  const counts = new Map<string, number>();
  return {
    values,
    counts,
    get: (key) => Promise.resolve(values.get(key) ?? null),
    set: (key, value) => {
      values.set(key, value);
      return Promise.resolve();
    },
    take: (key, limit) => {
      const used = (counts.get(key) ?? 0) + 1;
      counts.set(key, used);
      return Promise.resolve(used <= limit);
    },
  };
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('partner programmes (ADR-069)', () => {
  it('has unique ids and https landing pages on their own hosts', () => {
    const ids = PARTNER_PROGRAMS.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const entry of PARTNER_PROGRAMS) {
      expect([entry.id, allowedDestination(entry, entry.landing(LAGOS))]).toEqual([entry.id, true]);
    }
  });

  it('builds country slugs for partner pages', () => {
    expect(countrySlug('NG')).toBe('nigeria');
    expect(countrySlug('AE')).toBe('united-arab-emirates');
    expect(countrySlug('CI')).toBe('cote-divoire');
    expect(countrySlug('ZZ')).toBeNull();
    expect(countrySlug('XX')).toBeNull();
    expect(program('airalo').landing(LAGOS)).toBe('https://www.airalo.com/nigeria-esim');
  });

  it('only allows https on the programme hosts, without credentials or ports', () => {
    const viator = program('viator');
    expect(allowedDestination(viator, 'https://www.viator.com/tours/Lagos/x/d1-1')).toBe(true);
    for (const url of [
      'http://www.viator.com/',
      'https://evil.example/https://www.viator.com',
      'https://www.viator.com.evil.example/',
      'https://user:pw@www.viator.com/',
      'https://www.viator.com:8443/',
      'javascript:alert(1)',
      'not a url',
    ]) {
      expect([url, allowedDestination(viator, url)]).toEqual([url, false]);
    }
  });

  it('is on outside production and off in production unless set', () => {
    expect(partnerOffersEnabled(env())).toBe(true);
    const production = { ...env(), NODE_ENV: 'production' } as AppConfig;
    expect(partnerOffersEnabled(production)).toBe(false);
    expect(partnerOffersEnabled({ ...production, PARTNER_OFFERS_ENABLED: true })).toBe(true);
  });
});

describe('sealed partner links (ADR-070)', () => {
  const config = env({ PARTNER_LINK_TTL_HOURS: '24' });
  const links = new PartnerLinks(new LocalKeyFieldEncryption(config), config);
  const claims = {
    programId: 'discovercars',
    url: 'https://www.discovercars.com/',
    userId: '0192d3a0-7c1e-7b2a-9f00-0000000000a1',
    channel: 'mobile' as const,
    bookingId: null,
    campaign: null,
  };

  it('round-trips and hides the user id', () => {
    const now = Date.UTC(2026, 9, 27);
    const href = links.href(claims, now);
    expect(href).toMatch(/^\/v1\/go\/v2\./);
    expect(href).not.toContain(claims.userId);
    expect(href).not.toContain('discovercars');
    expect(links.open(href.slice('/v1/go/'.length), now + 1000)).toEqual({
      ...claims,
      fresh: true,
    });
  });

  it('marks links older than the lifetime as stale', () => {
    const now = Date.UTC(2026, 9, 27);
    const token = links.seal(claims, now);
    expect(links.open(token, now + 25 * 3_600_000)?.fresh).toBe(false);
  });

  it('refuses altered, foreign and oversized tokens', () => {
    const token = links.seal(claims);
    const parts = token.split('.');
    // Always a different first character (its six bits are all data, unlike the last one's).
    const sealed = parts[3] ?? '';
    const swapped = `${sealed.startsWith('A') ? 'B' : 'A'}${sealed.slice(1)}`;
    const tampered = [...parts.slice(0, 3), swapped, parts[4]].join('.');
    expect(links.open(tampered)).toBeNull();
    const other = new LocalKeyFieldEncryption(config);
    expect(links.open(other.encrypt(JSON.stringify({ p: 'x' }), 'partner-link'))).toBeNull();
    expect(links.open(other.encrypt('{}', 'booking:x:contact'))).toBeNull();
    expect(links.open('x'.repeat(3000))).toBeNull();
    expect(links.open('garbage')).toBeNull();
  });
});

describe('affiliate linkers', () => {
  it('mock: the partner page with the click id', async () => {
    const linker = new MockAffiliateLinker();
    await expect(
      linker.link(program('kiwitaxi'), 'https://kiwitaxi.com/en', CLICK),
    ).resolves.toEqual({ url: `https://kiwitaxi.com/en?sub_id=${CLICK}`, tracked: true });
  });

  describe('Travelpayouts', () => {
    const tracked = (subId: string) =>
      `https://tp.media/r?marker=12345&trs=678&p=4108&u=https%3A%2F%2Fwww.discovercars.com%2F&sub_id=${subId}`;
    const linker = (fetchImpl: typeof fetch, store = memoryStore()) =>
      new TravelpayoutsLinker({
        baseUrl: 'https://api.travelpayouts.com',
        token: 'tp-token',
        marker: '12345',
        trs: '678',
        timeoutMs: 1000,
        store,
        fetch: fetchImpl,
      });

    it('asks for a full link with our click id, then reuses it with each new click id', async () => {
      const store = memoryStore();
      const calls: { url: string; init: RequestInit }[] = [];
      const fetchImpl = ((url: string, init: RequestInit) => {
        calls.push({ url, init });
        return Promise.resolve(
          json({
            code: 'success',
            result: { links: [{ code: 'success', partner_url: tracked(CLICK) }] },
          }),
        );
      }) as unknown as typeof fetch;
      const subject = linker(fetchImpl, store);
      const first = await subject.link(
        program('discovercars'),
        'https://www.discovercars.com/',
        CLICK,
      );
      expect(first).toEqual({ url: tracked(CLICK), tracked: true });
      expect(calls).toHaveLength(1);
      expect(calls[0]?.url).toBe('https://api.travelpayouts.com/links/v1/create');
      expect(calls[0]?.init.redirect).toBe('error');
      expect(calls[0]?.init.headers).toMatchObject({ 'X-Access-Token': 'tp-token' });
      expect(JSON.parse(calls[0]?.init.body as string)).toEqual({
        marker: 12345,
        trs: 678,
        shorten: false,
        links: [{ url: 'https://www.discovercars.com/', sub_id: CLICK }],
      });

      const second = await subject.link(
        program('discovercars'),
        'https://www.discovercars.com/',
        'click-2',
      );
      expect(second.url).toContain('sub_id=click-2');
      expect(second.url).not.toContain(CLICK);
      expect(calls).toHaveLength(1);
    });

    it('falls back to the partner page when the API fails, answers oddly or the budget is spent', async () => {
      const page = 'https://www.discovercars.com/';
      const failing = (() => Promise.reject(new Error('network'))) as unknown as typeof fetch;
      await expect(linker(failing).link(program('discovercars'), page, CLICK)).resolves.toEqual({
        url: page,
        tracked: false,
      });
      const refused = (() =>
        Promise.resolve(json({ error: 'nope' }, 401))) as unknown as typeof fetch;
      await expect(linker(refused).link(program('discovercars'), page, CLICK)).resolves.toEqual({
        url: page,
        tracked: false,
      });
      const elsewhere = (() =>
        Promise.resolve(
          json({ result: { links: [{ partner_url: 'https://evil.example/r?sub_id=1' }] } }),
        )) as unknown as typeof fetch;
      await expect(linker(elsewhere).link(program('discovercars'), page, CLICK)).resolves.toEqual({
        url: page,
        tracked: false,
      });

      const store = memoryStore();
      const minute = Math.floor(Date.now() / 60_000);
      store.counts.set(`partners:tp:budget:${minute}`, LINK_CALLS_PER_MINUTE);
      const unused = jest.fn() as unknown as typeof fetch;
      await expect(
        linker(unused, store).link(program('discovercars'), page, CLICK),
      ).resolves.toEqual({ url: page, tracked: false });
      expect(unused).not.toHaveBeenCalled();
    });

    it('does not cache a short link, which is made per click', async () => {
      const store = memoryStore();
      const short = (() =>
        Promise.resolve(
          json({ links: [{ partner_url: 'https://discovercars.tp.st/AbCd' }] }),
        )) as unknown as typeof fetch;
      const result = await linker(short, store).link(
        program('discovercars'),
        'https://www.discovercars.com/',
        CLICK,
      );
      expect(result).toEqual({ url: 'https://discovercars.tp.st/AbCd', tracked: true });
      expect(store.values.size).toBe(0);
    });
  });
});

describe('activity partners', () => {
  it('mock: sample products on Viator hosts', async () => {
    const products = await new MockActivityPartner().search(LAGOS, 2);
    expect(products).toHaveLength(2);
    expect(products[0]?.url).toMatch(/^https:\/\/www\.viator\.com\/tours\/lagos\//);
    expect(products[0]?.fromPrice).toEqual({ minor: 2500n, currency: 'USD' });
  });

  it('Viator: searches the place and dates and maps products', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = ((url: URL, init: RequestInit) => {
      calls.push({ url: url.toString(), init });
      return Promise.resolve(
        json({
          products: {
            totalCount: 3,
            results: [
              {
                productCode: '12345P1',
                title: 'Lekki Conservation Centre tour',
                productUrl:
                  'https://www.viator.com/tours/Lagos/Lekki/d22213-12345P1?pid=P1&mcid=42383',
                images: [
                  {
                    variants: [
                      { url: 'https://media.example/720.jpg', width: 720 },
                      { url: 'https://media.example/480.jpg', width: 480 },
                    ],
                  },
                ],
                reviews: { totalReviews: 87, combinedAverageRating: 4.62 },
                duration: { fixedDurationInMinutes: 240 },
                pricing: { summary: { fromPrice: 45.5 }, currency: 'USD' },
              },
              { productCode: 'BAD', title: 'Elsewhere', productUrl: 'https://evil.example/x' },
              { title: 'No code' },
            ],
          },
        }),
      );
    }) as unknown as typeof fetch;
    const partner = new ViatorActivityPartner({
      baseUrl: 'https://api.sandbox.viator.com/partner',
      apiKey: 'viator-key',
      campaign: 'suskii-app',
      fetch: fetchImpl,
    });
    const products = await partner.search(LAGOS, 6, AbortSignal.timeout(1000));
    expect(calls[0]?.url).toBe(
      'https://api.sandbox.viator.com/partner/search/freetext?campaign-value=suskii-app',
    );
    expect(calls[0]?.init.headers).toMatchObject({
      'exp-api-key': 'viator-key',
      Accept: 'application/json;version=2.0',
    });
    expect(JSON.parse(calls[0]?.init.body as string)).toEqual({
      searchTerm: 'Lagos, Nigeria',
      searchTypes: [{ searchType: 'PRODUCTS', pagination: { start: 1, count: 6 } }],
      currency: 'USD',
      productFiltering: { dateRange: { from: '2026-12-01', to: '2026-12-05' } },
    });
    expect(products).toEqual([
      {
        code: '12345P1',
        title: 'Lekki Conservation Centre tour',
        url: 'https://www.viator.com/tours/Lagos/Lekki/d22213-12345P1?pid=P1&mcid=42383',
        imageUrl: 'https://media.example/480.jpg',
        rating: { average: 4.62, count: 87 },
        durationMinutes: 240,
        fromPrice: { minor: 4550n, currency: 'USD' },
      },
    ]);
    expect(partner.campaign).toBe('suskii-app');
  });

  it('Viator: throws on an error status without echoing the key', async () => {
    const fetchImpl = (() =>
      Promise.resolve(json({ message: 'bad key' }, 401))) as unknown as typeof fetch;
    const partner = new ViatorActivityPartner({
      baseUrl: 'https://api.viator.com/partner',
      apiKey: 'secret-key',
      campaign: 'suskii',
      fetch: fetchImpl,
    });
    await expect(partner.search(LAGOS, 6, AbortSignal.timeout(1000))).rejects.toThrow(/HTTP 401$/);
  });
});

describe('postbacks (ADR-070)', () => {
  it('maps network status words and parses amounts into minor units', () => {
    expect(
      parsePostback({
        id: 'b1',
        status: 'Paid',
        price: '120.50',
        commission: '7.23',
        currency: 'usd',
      }),
    ).toEqual({
      status: 'confirmed',
      priceMinor: 12050n,
      priceCurrency: 'USD',
      commissionMinor: 723n,
      commissionCurrency: 'USD',
    });
    expect(parsePostback({ id: 'b1', status: 'processing' }).status).toBe('pending');
    expect(parsePostback({ id: 'b1', status: 'canceled' }).status).toBe('cancelled');
    expect(
      parsePostback({
        id: 'b1',
        status: 'booked',
        price: '95000',
        currency: 'NGN',
        commission: '3.10',
        commission_currency: 'USD',
      }),
    ).toMatchObject({ priceMinor: 9_500_000n, commissionMinor: 310n, commissionCurrency: 'USD' });
    // More decimals than the currency has round half to even, never through floats.
    expect(
      parsePostback({ id: 'b1', status: 'paid', commission: '0.125', currency: 'USD' })
        .commissionMinor,
    ).toBe(12n);
  });

  it('refuses unknown statuses, malformed or negative amounts and missing currencies', () => {
    for (const input of [
      { id: 'b1', status: 'shipped' },
      { id: 'b1', status: 'paid', commission: '7.2.3', currency: 'USD' },
      { id: 'b1', status: 'paid', commission: '1e3', currency: 'USD' },
      { id: 'b1', status: 'paid', commission: '-1.00', currency: 'USD' },
      { id: 'b1', status: 'paid', commission: '1.00' },
      { id: 'b1', status: 'paid', commission: '1.00', currency: 'DOLLARS' },
    ]) {
      expect(() => parsePostback(input)).toThrow(ProblemDetailsException);
    }
  });
});
