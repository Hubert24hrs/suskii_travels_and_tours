import { expect, expectNoAxeViolations, t, test } from './fixtures';
import { TEST_APP } from './stack';

/** The web side of the mobile app (ADR-021): app-link association files and the payment return. */

const BOOKING_ID = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';

test.describe('mobile app links', () => {
  test('publishes Android and iOS association files for the app paths only', async ({
    request,
  }) => {
    const android = await request.get('/.well-known/assetlinks.json');
    expect(android.status()).toBe(200);
    expect(android.headers()['content-type']).toContain('application/json');
    expect(await android.json()).toEqual([
      {
        relation: ['delegate_permission/common.handle_all_urls'],
        target: {
          namespace: 'android_app',
          package_name: TEST_APP.androidPackage,
          sha256_cert_fingerprints: [TEST_APP.androidFingerprint],
        },
      },
    ]);

    const apple = await request.get('/.well-known/apple-app-site-association', {
      maxRedirects: 0,
    });
    expect(apple.status()).toBe(200);
    expect(apple.headers()['content-type']).toContain('application/json');
    expect(await apple.json()).toEqual({
      applinks: {
        details: [
          {
            appIDs: [TEST_APP.appleAppId],
            components: [
              { '/': '/bookings/*' },
              { '/': '/flights/search' },
              { '/': '/hotels/search' },
              { '/': '/deals' },
            ],
          },
        ],
      },
    });
  });
});

test.describe('mobile payment return', () => {
  // Without a recent tap Chrome refuses the automatic jump to the app; the button is the fallback.
  test.use({ allowedConsoleErrors: [/Not allowed to launch 'suskii:.*user gesture is required/] });

  test('hands the traveller back to the app without showing booking data', async ({ page }) => {
    await page.goto(`/mobile/payment-return?booking=${BOOKING_ID}`);
    await expect(page.getByRole('heading', { name: t('mobileReturn.heading') })).toBeVisible();
    await expect(page.getByTestId('open-app')).toHaveAttribute(
      'href',
      `suskii://trips/${BOOKING_ID}`,
    );
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
    await expectNoAxeViolations(page);

    // Anything that is not a booking id opens the Trips tab instead.
    await page.goto('/mobile/payment-return?booking=../../evil');
    await expect(page.getByTestId('open-app')).toHaveAttribute('href', 'suskii://trips');
  });
});
