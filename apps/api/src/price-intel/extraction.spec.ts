import { money } from '@suskii/shared';

import { extract, looksPersonal, publicItem } from './extraction';
import { mockPage } from './providers/mock-scrape-provider';
import { PUBLIC_ITEM_FIELDS, recipeSchema, urlTemplatesSchema, type Recipe } from './recipes';
import { pageProblem, ScrapeError, type ScrapePage } from './scrape-provider';

const context = { domain: 'hotels.example.com', currency: 'NGN', vendor: 'mock' } as const;
const page = (over: Partial<ScrapePage> = {}): ScrapePage => ({
  html: null,
  items: null,
  httpStatus: 200,
  rendered: false,
  costMicroUsd: null,
  ...over,
});
const recipe = (methods: unknown[], taxesIncluded: boolean | null = null): Recipe =>
  recipeSchema.parse({ version: 'hotel-v1', methods, taxesIncluded });

const STRUCTURED = { method: 'structured_data', types: ['Hotel'] };
const SELECTORS = {
  method: 'selectors',
  item: 'article.result',
  fields: { title: '.name', price: '.price', stars: '.stars', availability: '.stock' },
};

describe('price extraction (ADR-102)', () => {
  const html = mockPage('https://hotels.example.com/search?city=lagos');

  it('reads prices from structured data as exact money, with public facts only', () => {
    const result = extract(page({ html }), recipe([STRUCTURED]), context);
    expect(result).toMatchObject({ method: 'structured_data', parserVersion: 'hotel-v1' });
    expect(result.items).toHaveLength(3);
    for (const item of result.items) {
      expect(item.price.currency).toBe('NGN');
      expect(item.price.minor % 100n).toBe(0n);
      expect(item.availability).toBe('available');
      expect(Object.keys(item.item).every((key) => PUBLIC_ITEM_FIELDS.includes(key as never))).toBe(
        true,
      );
      expect(item.item.link).toMatch(/^https:\/\/hotels\.example\.com\/hotels\//);
    }
    // The page has a reviewer's name, a phone number and an email address: none is kept.
    const stored = JSON.stringify(result, (_key, value: unknown) =>
      typeof value === 'bigint' ? value.toString() : value,
    );
    expect(html).toContain('Adaeze Okafor');
    expect(html).toContain('bookings@example.com');
    for (const personal of ['Adaeze', 'Okafor', '555', 'bookings@', 'review']) {
      expect(stored).not.toContain(personal);
    }
  });

  it('reads the same prices with selectors, and agrees with the structured data', () => {
    const structured = extract(page({ html }), recipe([STRUCTURED]), context);
    const selected = extract(page({ html }), recipe([SELECTORS]), context);
    expect(selected.method).toBe('selectors');
    expect(selected.items.map((item) => [item.item.title, item.price])).toEqual(
      structured.items.map((item) => [item.item.title, item.price]),
    );
    expect(selected.items[0]?.item.stars).toEqual(expect.any(Number));
  });

  it('tries the methods in order and starts later when told to (parser drift)', () => {
    const both = recipe([STRUCTURED, SELECTORS]);
    expect(extract(page({ html }), both, context).method).toBe('structured_data');
    expect(extract(page({ html }), both, { ...context, fromMethod: 1 }).method).toBe('selectors');
    // Structured data gone from the page: the selectors still read it.
    const stripped = html.replace(/<script[\s\S]*?<\/script>/, '');
    expect(extract(page({ html: stripped }), both, context).method).toBe('selectors');
  });

  it('reads fields a vendor extracted, by path, keeping numbers exact', () => {
    const items = [
      {
        hotel: { name: 'Harbour View Hotel' },
        rate: { amount: '125000.50', cur: 'NGN' },
        extra: 1,
      },
      { hotel: { name: 'Marina Court Suites' }, rate: { amount: '₦98,000', cur: null } },
      { hotel: { name: 'No Price Inn' }, rate: {} },
    ];
    const result = extract(
      page({ items }),
      recipe([
        {
          method: 'vendor_fields',
          fields: { title: 'hotel.name', price: 'rate.amount', currency: 'rate.cur' },
        },
      ]),
      context,
    );
    expect(result.items.map((item) => [item.item.title, item.price])).toEqual([
      ['Harbour View Hotel', money(12_500_050n, 'NGN')],
      ['Marina Court Suites', money(9_800_000n, 'NGN')],
    ]);
  });

  it('says parse_failed when no method finds a price', () => {
    const attempt = () =>
      extract(
        page({ html: '<html><body><p>Nothing here</p></body></html>' }),
        recipe([STRUCTURED, SELECTORS]),
        context,
      );
    expect(attempt).toThrow(ScrapeError);
    try {
      attempt();
    } catch (error) {
      expect((error as ScrapeError).failure).toBe('parse_failed');
    }
    // A broken selector is a recipe fault, not a crash.
    expect(() =>
      extract(page({ html }), recipe([{ ...SELECTORS, item: 'article[[' }]), context),
    ).toThrow(/parse_failed/);
  });

  it('skips an item without a clear price and never joins two numbers', () => {
    const odd =
      '<article class="result"><h2 class="name">Range Hotel</h2><span class="price">NGN 40,000 - 60,000</span></article>' +
      '<article class="result"><h2 class="name">Clear Hotel</h2><span class="price">NGN 52,500</span></article>' +
      '<article class="result"><h2 class="name">Free Hotel</h2><span class="price">NGN 0</span></article>';
    const result = extract(page({ html: `<main>${odd}</main>` }), recipe([SELECTORS]), context);
    expect(result.items.map((item) => item.item.title)).toEqual(['Clear Hotel']);
    expect(result.items[0]?.price).toEqual(money(5_250_000n, 'NGN'));
  });

  it('keeps no fact that holds a contact detail, and no link off the site', () => {
    expect(looksPersonal('Call +234 803 555 0142')).toBe(true);
    expect(looksPersonal('ada@example.com')).toBe(true);
    expect(looksPersonal('Deluxe King Room, 32 sqm')).toBe(false);
    expect(looksPersonal('Lagos to London, 6h 45m')).toBe(false);
    expect(publicItem({ title: 'Ask for Ada: ada@example.com' }, 'example.com')).toBeNull();
    expect(
      publicItem(
        {
          title: 'Garden Inn',
          brand: 'Reservations 0803 555 0142',
          roomType: 'Deluxe King',
          link: 'https://evil.example.net/x',
          // Not a public item field: cannot be stored whatever a page returns.
          reviewer: 'Adaeze Okafor',
          email: 'guest@example.com',
        } as never,
        'example.com',
      ),
    ).toEqual({ title: 'Garden Inn', roomType: 'Deluxe King' });
    expect(publicItem({ title: 'Garden Inn', link: '/rooms/1#reviews' }, 'example.com')).toEqual({
      title: 'Garden Inn',
      link: 'https://example.com/rooms/1',
    });
    expect(
      publicItem({ title: 'X', link: 'https://user:pw@example.com/a' }, 'example.com'),
    ).toBeNull();
  });

  it('accepts only known placeholders and https addresses in a page template', () => {
    expect(
      urlTemplatesSchema.safeParse({
        hotel: 'https://hotels.example.com/search?city={place}&in={from}&out={to}&adults={adults}',
      }).success,
    ).toBe(true);
    for (const bad of [
      'http://hotels.example.com/search?city={place}',
      'https://{place}.example.com/',
      'https://hotels.example.com/search?u={userId}',
      'ftp://hotels.example.com/',
    ]) {
      expect([bad, urlTemplatesSchema.safeParse({ hotel: bad }).success]).toEqual([bad, false]);
    }
  });
});

describe('page checks before parsing (ADR-102)', () => {
  it('tells a refusal and an empty shell from content', () => {
    expect(pageProblem(page({ html: mockPage('https://x.example.com/') }))).toBeNull();
    expect(pageProblem(page({ httpStatus: 403, html: '<html>Forbidden</html>' }))).toBe('blocked');
    expect(pageProblem(page({ httpStatus: 429, html: '' }))).toBe('blocked');
    expect(
      pageProblem(page({ html: '<html><body>Please verify you are a human</body></html>' })),
    ).toBe('blocked');
    expect(pageProblem(page({ html: '<html><body><div id="root"></div></body></html>' }))).toBe(
      'empty_or_unrendered',
    );
    expect(pageProblem(page({ html: null, items: [] }))).toBe('empty_or_unrendered');
    expect(pageProblem(page({ html: null, items: [{ a: 1 }] }))).toBeNull();
    // A long results page that mentions a captcha in passing is still content.
    const long = `<html><body>${'<p>Room with a view and a garden.</p>'.repeat(900)}<p>captcha</p></body></html>`;
    expect(pageProblem(page({ html: long }))).toBeNull();
  });
});
