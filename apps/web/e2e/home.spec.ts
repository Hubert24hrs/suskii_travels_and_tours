import { expect, t, test } from './fixtures';

test.describe('homepage', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('renders every section in the order of the spec', async ({ page }) => {
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const sections = await page
      .locator('main section[aria-labelledby]')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-labelledby')));
    expect(sections).toEqual([
      'hero-heading',
      'trust-heading',
      'deals-heading',
      'destinations-heading',
      'prime-heading',
      'flexible-payment-heading',
      'packages-tours-heading',
      'why-book-heading',
      'app-heading',
      'newsletter-heading',
      'faq-heading',
    ]);
    // The search card sits between the hero and the trust strip.
    const searchAfterHero = await page.evaluate(() => {
      const hero = document.querySelector('[aria-labelledby="hero-heading"]');
      const search = document.querySelector('form[aria-label]');
      const trust = document.querySelector('[aria-labelledby="trust-heading"]');
      if (!hero || !search || !trust) return false;
      return (
        Boolean(hero.compareDocumentPosition(search) & Node.DOCUMENT_POSITION_FOLLOWING) &&
        Boolean(search.compareDocumentPosition(trust) & Node.DOCUMENT_POSITION_FOLLOWING)
      );
    });
    expect(searchAfterHero).toBe(true);
  });

  test('shows fresh flight offers and hotel destinations with live prices', async ({ page }) => {
    const deals = page.locator('#deals article');
    await expect(deals.first()).toBeVisible();
    expect(await deals.count()).toBeGreaterThanOrEqual(3);
    await expect(deals.first()).toContainText('₦');

    const destinations = page.locator('#destinations li a');
    expect(await destinations.count()).toBeGreaterThanOrEqual(3);
    await expect(destinations.first()).toContainText('₦');
  });

  test('renders only verified trust signals', async ({ page }) => {
    const trust = page.locator('[aria-labelledby="trust-heading"]');
    for (const label of ['24/7 support', 'Flexible payment on every booking', 'Secure payments'])
      await expect(trust).toContainText(label);
    // Unverified in the seed: no accreditation or traveller-count claims anywhere on the page.
    const body = page.locator('body');
    await expect(body).not.toContainText('IATA');
    await expect(body).not.toContainText('Travellers served');
    await expect(body).not.toContainText('2M+');
    await expect(body).not.toContainText(/wakanow/i);
  });

  test('filters fresh flight offers by departure city', async ({ page }) => {
    const filter = page.getByRole('group', { name: t('sections.deals.filterLabel') });
    await filter.getByRole('button', { name: 'Abuja' }).click();
    await expect(filter.getByRole('button', { name: 'Abuja' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    const cards = page.locator('#deals article');
    await expect(cards.first()).toContainText('ABV');
    for (const card of await cards.all()) await expect(card).toContainText('ABV →');

    await filter.getByRole('button', { name: t('sections.deals.allOrigins') }).click();
    await expect(page.locator('#deals article', { hasText: 'LOS →' }).first()).toBeVisible();
  });

  test('opens a deal as a pre-filled flight search', async ({ page }) => {
    const link = page
      .locator('#deals article')
      .first()
      .getByRole('link', { name: t('sections.deals.cta') });
    const href = new URL((await link.getAttribute('href')) ?? '', 'http://localhost');
    const origin = href.searchParams.get('from') ?? '';
    const destination = href.searchParams.get('to') ?? '';
    await link.click();

    await expect(page).toHaveURL(/\/flights\/search\?trip=round_trip&from=[A-Z]{3}&to=[A-Z]{3}/);
    await expect(page.locator('#flight-origin-input')).toHaveValue(new RegExp(`\\(${origin}\\)`));
    await expect(page.locator('#flight-destination-input')).toHaveValue(
      new RegExp(`\\(${destination}\\)`),
    );
  });

  test('has search-engine metadata and structured data', async ({ page }) => {
    await expect(page).toHaveTitle(/Suskii Travels/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en-NG');
    await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /.{50,}/);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      'href',
      /^https?:\/\/[^/]+\/?$/,
    );
    await expect(page.locator('meta[property="og:image"]').first()).toHaveAttribute(
      'content',
      /opengraph-image/,
    );
    await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute(
      'content',
      'summary_large_image',
    );

    const blocks = await page
      .locator('script[type="application/ld+json"]')
      .evaluateAll((nodes) => nodes.map((node) => node.textContent ?? ''));
    const types = blocks
      .flatMap((text) => [JSON.parse(text) as unknown].flat())
      .map((item) => (item as { '@type'?: string })['@type']);
    expect(types).toEqual(expect.arrayContaining(['TravelAgency', 'WebSite', 'FAQPage']));
  });
});
