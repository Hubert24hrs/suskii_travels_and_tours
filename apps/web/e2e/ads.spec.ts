import type { BrowserContext, Page } from '@playwright/test';

import {
  AD_NETWORK_HOSTS,
  CONSENT_COOKIE_NAME,
  expect,
  expectNoAxeViolations,
  isoDaysFromToday,
  t,
  test,
} from './fixtures';
import { TEST_AD_TAGS } from './stack';

/**
 * ADR-079: the Meta and TikTok tags run only after the visitor allows marketing. A first visit
 * asks once, with equal choices; a refusal loads nothing; after Accept the tags report trip facts
 * only, and a booking carries the consent id and click ids for the server-side Purchase.
 * ADR-089: pages that start a payment never run them, so checkout and the booking page hold only
 * our own scripts (PCI DSS SAQ A).
 *
 * The networks are never contacted: their scripts are stubbed here. The stubs do nothing, so the
 * queues our loader sets up keep every call for the test to read.
 */

test.skip(Boolean(process.env.E2E_BASE_URL), 'needs the Playwright stack with test ad ids');
test.use({ startingConsent: null });

const FBP = 'fb.1.1714546784212.1116446470';
const TTCLID = 'E.C.P.test-click-0001';

async function stubNetworks(context: BrowserContext): Promise<string[]> {
  const hits: string[] = [];
  // Registered after the fixture's refusal, so this handler wins.
  await context.route(AD_NETWORK_HOSTS, (route) => {
    hits.push(route.request().url());
    return route.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
  });
  return hits;
}

type Call = unknown[];
const metaCalls = (page: Page): Promise<Call[]> =>
  page.evaluate(() => (window as { fbq?: { queue?: unknown[][] } }).fbq?.queue ?? []);
const tiktokCalls = (page: Page): Promise<Call[]> =>
  page.evaluate(() => [...((window as { ttq?: unknown[][] }).ttq ?? [])]);
const tracked = (calls: Call[], event: string): Call | undefined =>
  calls.find((call) => call[0] === 'track' && call[1] === event);

const consentValue = async (page: Page): Promise<string> =>
  (await page.context().cookies()).find((cookie) => cookie.name === CONSENT_COOKIE_NAME)?.value ??
  '';

test.describe('ads with consent', () => {
  test('a first visit asks once with equal choices; nothing reaches a network before or after a refusal', async ({
    page,
  }) => {
    const hits = await stubNetworks(page.context());
    await page.goto('/');
    const prompt = page.getByTestId('consent-prompt');
    await expect(prompt).toBeVisible();
    await expect(prompt).toContainText(t('cookies.prompt.body'));
    const accept = prompt.getByTestId('consent-accept');
    const reject = prompt.getByTestId('consent-reject');
    // Neither choice is pushed: both buttons look the same.
    expect(await accept.getAttribute('class')).toBe(await reject.getAttribute('class'));
    await expectNoAxeViolations(page);
    expect(hits).toEqual([]);

    await reject.click();
    await expect(prompt).toBeHidden();
    expect(await consentValue(page)).toMatch(/\.00$/);

    // Asked once: the choice holds across pages, and nothing is loaded or queued.
    await page.goto(
      `/flights/search?trip=one_way&from=LOS&to=ABV&depart=${isoDaysFromToday(30)}&adults=1`,
    );
    await expect(page.getByTestId('flight-offer').first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('consent-prompt')).toBeHidden();
    expect(hits).toEqual([]);
    expect(await page.evaluate(() => 'fbq' in window || 'ttq' in window)).toBe(false);
  });

  test('after Accept the tags load and report trip facts; the booking carries the attribution', async ({
    page,
    baseURL,
  }) => {
    const context = page.context();
    const hits = await stubNetworks(context);
    await page.goto(`/?ttclid=${TTCLID}`);
    await page.getByTestId('consent-accept').click();
    await expect(page.getByTestId('consent-prompt')).toBeHidden();
    expect(await consentValue(page)).toMatch(/\.11$/);

    await expect
      .poll(() => hits)
      .toEqual(
        expect.arrayContaining([
          'https://connect.facebook.net/en_US/fbevents.js',
          `https://analytics.tiktok.com/i18n/pixel/events.js?sdkid=${TEST_AD_TAGS.TIKTOK_PIXEL_ID}&lib=ttq`,
        ]),
      );
    const started = await metaCalls(page);
    expect(started).toContainEqual(['init', TEST_AD_TAGS.META_PIXEL_ID]);
    expect(started).toContainEqual(['set', 'autoConfig', false, TEST_AD_TAGS.META_PIXEL_ID]);
    expect(tracked(started, 'PageView')).toBeTruthy();
    expect(await tiktokCalls(page)).toContainEqual(['page']);

    // What Meta's own script would have set; the tag stub sets nothing.
    await context.addCookies([{ name: '_fbp', value: FBP, url: baseURL ?? '' }]);

    // A search reports the route as airport codes.
    await page.goto(
      `/flights/search?trip=one_way&from=LOS&to=ABV&depart=${isoDaysFromToday(30)}&adults=1`,
    );
    const offers = page.getByTestId('flight-offer');
    await expect(offers.first()).toBeVisible({ timeout: 30_000 });
    await expect.poll(async () => tracked(await metaCalls(page), 'Search')).toBeTruthy();
    expect(tracked(await metaCalls(page), 'Search')?.[2]).toEqual({
      content_type: 'product',
      content_ids: ['flights'],
      search_string: 'LOS-ABV',
    });

    // Checkout starts a payment: the document reloads without the tags, under a policy that
    // refuses any script but ours (ADR-089). The booking still carries the attribution.
    await offers
      .first()
      .getByRole('button', { name: t('results.flights.details') })
      .click();
    await offers
      .first()
      .getByRole('button', { name: /^Select/ })
      .click();
    await page.waitForURL(/\/checkout\//);
    // The reload replaces the document under the check, which then just tries again.
    await expect
      .poll(() => page.evaluate(() => 'fbq' in window || 'ttq' in window).catch(() => true))
      .toBe(false);
    await expectOnlyOurScripts(page);
    const before = hits.length;
    await page.locator('#passenger-0-title').selectOption('ms');
    await page.locator('#passenger-0-gender').selectOption('f');
    await page.locator('#passenger-0-givenNames').fill('Chioma');
    await page.locator('#passenger-0-surname').fill('Okafor');
    await page.locator('#passenger-0-dateOfBirth').fill('1990-04-01');
    await page.locator('#passenger-0-nationality').selectOption('NG');
    await page.locator('#contact-email').fill('chioma.ads@example.com');
    await page.locator('#contact-phone').fill('+234 801 234 5678');
    await page.getByLabel(t('checkout.terms')).check();
    const [created] = await Promise.all([
      page.waitForRequest(
        (request) => request.method() === 'POST' && request.url().endsWith('/v1/bookings'),
      ),
      page.getByRole('button', { name: t('checkout.pay') }).click(),
    ]);
    const consentId = (await consentValue(page)).split('.')[1];
    expect((created.postDataJSON() as { marketing?: unknown }).marketing).toEqual({
      consentId,
      fbp: FBP,
      ttclid: TTCLID,
    });

    // Paid: the booking page takes balances too, so it runs no tags either; the Purchase goes
    // server-side with the attribution above (ADR-079).
    await page.waitForURL(/\/checkout\/mock-payment\//);
    await page.getByRole('button', { name: /^Pay / }).click();
    await page.waitForURL(/\/bookings\//);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    expect(await page.evaluate(() => 'fbq' in window || 'ttq' in window)).toBe(false);
    await expectOnlyOurScripts(page);
    expect(hits.slice(before)).toEqual([]);
  });

  test('pages that start a payment refuse every script but ours (PCI DSS SAQ A)', async ({
    page,
  }) => {
    const policy = async (path: string): Promise<string> =>
      (await page.request.get(path)).headers()['content-security-policy'] ?? '';
    const scripts = (csp: string): string =>
      csp.split(';').find((directive) => directive.trim().startsWith('script-src')) ?? '';

    // Elsewhere the tags' hosts are allowed and our scripts may load what they trust.
    const home = await policy('/');
    expect(scripts(home)).toContain("'strict-dynamic'");
    expect(home).toContain('https://connect.facebook.net');

    for (const path of ['/checkout/0190f6a2-0000-7000-8000-000000000001', '/bookings/unknown']) {
      const csp = await policy(path);
      expect(scripts(csp), path).not.toContain("'strict-dynamic'");
      expect(scripts(csp), path).toMatch(
        /script-src 'self' 'nonce-[^']+' https:\/\/challenges\.cloudflare\.com/,
      );
      for (const host of ['facebook', 'tiktok']) expect(csp, path).not.toContain(host);
    }
  });
});

/** Every script on the page comes from our origin or Turnstile (ADR-089's inventory). */
async function expectOnlyOurScripts(page: Page): Promise<void> {
  const foreign = await page.evaluate(() => {
    const allowed = new Set([location.origin, 'https://challenges.cloudflare.com']);
    const sources = [
      ...Array.from(document.scripts, (script) => script.src).filter(Boolean),
      ...performance
        .getEntriesByType('resource')
        .filter((entry) => entry.initiatorType === 'script')
        .map((entry) => entry.name),
    ];
    return sources.filter((source) => !allowed.has(new URL(source).origin));
  });
  expect(foreign).toEqual([]);
}
