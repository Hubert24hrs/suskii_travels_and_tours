import type { ScrapeVendor } from '@suskii/shared';

import type { AppConfig } from '../config/config';

import { priceSourceInputSchema, priceSourcePatchSchema } from './price-intel.schemas';
import { PriceSourcesService, type SourceWithPolicy } from './price-sources.service';
import type { ScrapeProviders } from './scrape-providers';

const site = (
  status: 'review' | 'approved' | 'blocked',
  vendors: ScrapeVendor[],
  active = true,
): SourceWithPolicy =>
  ({
    id: '0193a000-0000-7000-8000-000000000001',
    domain: 'hotels.example.com',
    active,
    policy: { status, vendors },
  }) as unknown as SourceWithPolicy;

const service = (enabled: ScrapeVendor[], config: Partial<AppConfig>): PriceSourcesService =>
  new PriceSourcesService(
    null as never,
    null as never,
    null as never,
    null as never,
    new Map(enabled.map((vendor) => [vendor, { name: vendor }])) as unknown as ScrapeProviders,
    { NODE_ENV: 'development', ALLOW_MOCK_PROVIDERS: false, ...config } as AppConfig,
  );

describe('who may read a site (ADR-102)', () => {
  it('reads a site in review with the mock only, whatever its chain names', () => {
    const local = service(['mock', 'firecrawl'], {});
    expect(local.readableVendors(site('review', ['firecrawl', 'oxylabs']))).toEqual(['mock']);
    expect(local.readableVendors(site('review', ['mock']))).toEqual(['mock']);
  });

  it('reads an approved site with the vendors of its chain that are enabled, in its order', () => {
    const local = service(['mock', 'firecrawl', 'bright_data'], {});
    expect(local.readableVendors(site('approved', ['bright_data', 'apify', 'firecrawl']))).toEqual([
      'bright_data',
      'firecrawl',
    ]);
  });

  it('reads nothing from a blocked or an inactive site', () => {
    const local = service(['mock', 'firecrawl'], {});
    expect(local.readableVendors(site('blocked', ['mock', 'firecrawl']))).toEqual([]);
    expect(local.readableVendors(site('approved', ['mock', 'firecrawl'], false))).toEqual([]);
  });

  it('reads nothing in production while a site is not approved', () => {
    // Production refuses the mock at start-up, so it is not among the enabled vendors there.
    const production = service(['firecrawl', 'oxylabs'], { NODE_ENV: 'production' });
    expect(production.readableVendors(site('review', ['firecrawl', 'oxylabs']))).toEqual([]);
    expect(production.readableVendors(site('blocked', ['firecrawl']))).toEqual([]);
    expect(production.readableVendors(site('approved', ['oxylabs', 'firecrawl']))).toEqual([
      'oxylabs',
      'firecrawl',
    ]);
  });

  it('leaves the mock out of an approved chain in production, unless mocks are allowed', () => {
    const chain = site('approved', ['mock', 'firecrawl']);
    expect(
      service(['mock', 'firecrawl'], { NODE_ENV: 'production' }).readableVendors(chain),
    ).toEqual(['firecrawl']);
    expect(
      service(['mock', 'firecrawl'], {
        NODE_ENV: 'production',
        ALLOW_MOCK_PROVIDERS: true,
      }).readableVendors(chain),
    ).toEqual(['mock', 'firecrawl']);
  });
});

describe('a change to a site', () => {
  const stated = {
    domain: 'hotels.example.com',
    name: 'Sample Hotels',
    products: ['hotel'],
    country: 'NG',
    currency: 'NGN',
    locale: 'en-NG',
    urlTemplates: { hotel: 'https://hotels.example.com/search?city={place}' },
    recipes: {
      hotel: { version: 'hotel-v1', methods: [{ method: 'structured_data', types: ['Hotel'] }] },
    },
    vendors: ['mock'],
    timeZone: 'Africa/Lagos',
  };

  it('starts a new site closed and slow when its creator says nothing else', () => {
    expect(priceSourceInputSchema.parse(stated)).toMatchObject({
      robots: 'unknown',
      terms: 'unknown',
      maxProxyClass: 'none',
      requestsPerMinute: 6,
      maxConcurrency: 1,
      nightStartHour: 1,
      nightEndHour: 5,
      active: true,
    });
  });

  it('carries only what was sent: no default may reset what an approver agreed to', () => {
    expect(priceSourcePatchSchema.parse({ name: 'Sample Hotels Ltd' })).toEqual({
      name: 'Sample Hotels Ltd',
    });
    expect(priceSourcePatchSchema.parse({ active: false })).toEqual({ active: false });
    expect(priceSourcePatchSchema.safeParse({}).success).toBe(false);
    // The domain is not part of a change: a site's rules never move to another site.
    expect(priceSourcePatchSchema.parse({ domain: 'other.example.com', name: 'Sample' })).toEqual({
      name: 'Sample',
    });
  });
});
