import { expect, t, test } from './fixtures';

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
      '/hotels/dubai',
    ])
      expect(xml).toMatch(new RegExp(`<loc>https?://[^<]+${path === '/' ? '/?' : path}</loc>`));
    expect(xml).not.toContain('/newsletter/');
  });

  test('robots.txt points to the sitemap and keeps private pages out', async ({ request }) => {
    const text = await (await request.get('/robots.txt')).text();
    expect(text).toMatch(/Sitemap: https?:\/\/[^\s]+\/sitemap\.xml/);
    for (const path of ['/newsletter/', '/checkout/', '/bookings/', '/mobile/']) {
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
    expect(csp).not.toContain("'unsafe-eval'");
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['x-frame-options']).toBe('DENY');
    expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(headers['strict-transport-security']).toContain('max-age=');
    expect(headers['permissions-policy']).toBeTruthy();
    expect(headers['x-powered-by']).toBeUndefined();

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
