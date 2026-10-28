import { expect, expectNoAxeViolations, t, test } from './fixtures';

test.describe('crawling and sharing', () => {
  test('publishes a sitemap with the landing, route and city pages', async ({ request }) => {
    const response = await request.get('/sitemap.xml');
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('xml');
    const xml = await response.text();
    for (const path of [
      '/',
      '/flights',
      '/hotels',
      '/deals',
      '/flights/lagos-to-london',
      '/flights/from/lagos',
      '/flights/to/london',
      '/hotels/dubai',
    ])
      expect(xml).toMatch(new RegExp(`<loc>https?://[^<]+${path === '/' ? '/?' : path}</loc>`));
    expect(xml).not.toContain('/newsletter/');
  });

  test('robots.txt points to the sitemap and keeps private pages out', async ({ request }) => {
    const text = await (await request.get('/robots.txt')).text();
    expect(text).toMatch(/Sitemap: https?:\/\/[^\s]+\/sitemap\.xml/);
    for (const path of ['/newsletter/', '/checkout/', '/bookings/', '/mobile/', '/flights/go/']) {
      expect(text).toContain(`Disallow: ${path}`);
    }
  });

  test('serves 1200x630 social images and a manifest', async ({ request }) => {
    for (const path of ['/opengraph-image', '/twitter-image']) {
      const response = await request.get(path);
      expect(response.status()).toBe(200);
      expect(response.headers()['content-type']).toBe('image/png');
      const png = await response.body();
      expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1200, 630]);
    }
    const manifest = (await (await request.get('/manifest.webmanifest')).json()) as {
      name: string;
      icons: unknown[];
    };
    expect(manifest.name).toBe('Suskii Travels and Tour');
    expect(manifest.icons.length).toBeGreaterThan(0);
  });

  test('points the browser default /favicon.ico at the logo icon', async ({ request }) => {
    const favicon = await request.get('/favicon.ico', { maxRedirects: 0 });
    expect(favicon.status()).toBe(308);
    expect(favicon.headers().location).toBe('/icon.png');
    expect((await request.get('/icon.png')).headers()['content-type']).toContain('image/png');
    expect((await request.get('/apple-icon.png')).headers()['content-type']).toContain('image/png');
  });

  test('route pages carry their own metadata and breadcrumbs', async ({ page }) => {
    await page.goto('/flights/lagos-to-london');
    await expect(page).toHaveTitle(/Lagos to London/);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      'href',
      /\/flights\/lagos-to-london$/,
    );
    const types = await page
      .locator('script[type="application/ld+json"]')
      .evaluateAll((nodes) =>
        nodes.flatMap((node) => [JSON.parse(node.textContent ?? '') as unknown].flat()),
      );
    expect(types).toEqual(
      expect.arrayContaining([expect.objectContaining({ '@type': 'BreadcrumbList' })]),
    );
  });
});

test.describe('SEO pages from fare history (ADR-080)', () => {
  test('route pages say what the fare history shows and link to hubs and airlines', async ({
    page,
  }) => {
    await page.goto('/flights/lagos-to-london');
    const facts = page.getByTestId('route-facts');
    await expect(facts.getByRole('heading', { name: t('pages.route.factsHeading') })).toBeVisible();
    await expect(facts.getByTestId('fact-typical')).toContainText(t('pages.route.typical'));
    await expect(facts.getByTestId('fact-cheapest')).toContainText(t('pages.route.cheapest'));
    await expect(facts.getByTestId('fact-direct')).toBeVisible();
    await expect(facts.getByTestId('fact-fastest')).toBeVisible();
    // The stack runs the mock supplier: the facts are labelled as samples.
    await expect(facts).toContainText(t('pages.route.sampleFacts'));
    await expect(facts).toContainText(t('pages.route.factsNote'));

    // Each airline has its own page with the routes it was seen on.
    const airline = facts.getByRole('link').first();
    const airlineName = ((await airline.textContent()) ?? '').trim();
    await airline.click();
    await page.waitForURL(/\/airlines\/[a-z0-9]{2}$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(airlineName);
    await expect(
      page
        .getByTestId('airline-routes')
        .getByRole('link', { name: 'Flights from Lagos to London' }),
    ).toBeVisible();
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      'href',
      /\/airlines\/[a-z0-9]{2}$/,
    );

    // Hubs both ways, linked from the route page and to each other.
    await page.goto('/flights/lagos-to-london');
    await page
      .getByTestId('route-hub-links')
      .getByRole('link', { name: t('pages.route.fromCity', { city: 'Lagos' }) })
      .click();
    await page.waitForURL(/\/flights\/from\/lagos$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      t('pages.hub.fromTitle', { city: 'Lagos' }),
    );
    const london = page
      .getByTestId('hub-routes')
      .getByRole('link', { name: 'Flights from Lagos to London' });
    await expect(london).toBeVisible();
    await page.getByRole('link', { name: t('pages.route.toCity', { city: 'Lagos' }) }).click();
    await page.waitForURL(/\/flights\/to\/lagos$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      t('pages.hub.toTitle', { city: 'Lagos' }),
    );
    await expectNoAxeViolations(page);
  });
});

test.describe('errors', () => {
  test.use({ allowedConsoleErrors: [/404/] });

  test('unknown pages answer 404 with a helpful, unindexed page', async ({ page }) => {
    for (const path of [
      '/definitely-not-a-page',
      '/hotels/atlantis',
      '/flights/lagos-to-atlantis',
    ]) {
      const response = await page.goto(path);
      expect(response?.status(), path).toBe(404);
    }
    await expect(page.getByRole('heading', { name: t('pages.notFound.heading') })).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  });

  test('flight hubs and airline pages without routes answer 404', async ({ page }) => {
    for (const path of [
      '/flights/from/atlantis',
      '/flights/to/atlantis',
      '/airlines/zz',
      '/airlines/k',
    ]) {
      const response = await page.goto(path);
      expect(response?.status(), path).toBe(404);
    }
  });
});

test.describe('illustrations', () => {
  test('serve cacheable SVG art and reject unexpected input', async ({ request }) => {
    const art = await request.get('/art/routes/LOS-LHR.svg');
    expect(art.status()).toBe(200);
    expect(art.headers()['content-type']).toContain('image/svg+xml');
    expect(art.headers()['cache-control']).toContain('max-age=');
    expect(art.headers()['content-security-policy']).toContain("default-src 'none'");
    expect(await art.text()).toMatch(/^<svg [^>]*xmlns="http:\/\/www.w3.org\/2000\/svg"/);
    expect((await request.get('/art/cities/Cape%20Town.svg')).status()).toBe(200);
    for (const path of [
      '/art/routes/LOS-LH%3Cscript%3E.svg',
      '/art/routes/los-lhr.svg',
      '/art/cities/%3Csvg%20onload%3Dalert(1)%3E.svg',
    ])
      expect((await request.get(path)).status(), path).toBe(404);
  });
});

test.describe('security headers', () => {
  test('pages ship a nonce-based CSP and the hardening headers', async ({ page }) => {
    const response = await page.goto('/');
    const headers = response?.headers() ?? {};
    const csp = headers['content-security-policy'] ?? '';
    const nonce = /'nonce-([^']+)'/.exec(csp)?.[1];
    expect(nonce, 'CSP nonce').toBeTruthy();
    expect(csp).toContain("'strict-dynamic'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).not.toContain("'unsafe-eval'");
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['x-frame-options']).toBe('DENY');
    expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(headers['strict-transport-security']).toContain('max-age=');
    expect(headers['permissions-policy']).toBeTruthy();
    expect(headers['x-powered-by']).toBeUndefined();
    // A request id for each page; a well-formed upstream id is kept, anything else replaced.
    expect(headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    const kept = await page.request.get('/', { headers: { 'X-Request-Id': 'lb-trace-12345678' } });
    expect(kept.headers()['x-request-id']).toBe('lb-trace-12345678');
    const replaced = await page.request.get('/', { headers: { 'X-Request-Id': 'bad id <x>' } });
    expect(replaced.headers()['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);

    // Every inline and external script carries this response's nonce.
    const nonces = await page
      .locator('script:not([type="application/ld+json"])')
      .evaluateAll((nodes) => nodes.map((node) => (node as HTMLScriptElement).nonce));
    expect(nonces.length).toBeGreaterThan(0);
    expect(new Set(nonces)).toEqual(new Set([nonce]));

    // A fresh nonce per response.
    const again = (await page.request.get('/')).headers()['content-security-policy'] ?? '';
    expect(/'nonce-([^']+)'/.exec(again)?.[1]).not.toBe(nonce);
  });
});
