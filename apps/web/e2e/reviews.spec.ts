import { BOOKING_TERMS_VERSION } from '@suskii/shared';

import { expect, expectNoAxeViolations, t, test } from './fixtures';

const API = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000';
const TOUR = 'sample-dubai-desert-evening';

/**
 * Verified reviews on the website (ADR-077). Who may review what, moderation and the published
 * score are covered against the API (`apps/api/test/reviews.e2e-spec.ts`); here the pages are
 * checked: the review section on a product page and the form on a finished trip's booking page.
 */
test.describe('verified reviews', () => {
  test('a product page says how reviews are checked, before any exist', async ({ page }) => {
    await page.goto(`/tours/${TOUR}`);
    const section = page.getByTestId('reviews');
    await expect(section.getByRole('heading', { name: t('reviews.heading') })).toBeVisible();
    await expect(section).toContainText(t('reviews.none'));
    await expect(section).toContainText(t('reviews.verifiedNote'));
    // No rating markup without published reviews.
    const ratings = await page
      .locator('script[type="application/ld+json"]')
      .evaluateAll((nodes) =>
        nodes.filter((node) => node.textContent?.includes('aggregateRating')),
      );
    expect(ratings).toHaveLength(0);
  });

  test('a finished trip asks for a review and sends what the traveller wrote', async ({
    page,
    request,
  }) => {
    // A paid, confirmed tour booking made through the API, opened as the guest would from email.
    const tour = (await (await request.get(`${API}/v1/tours/${TOUR}?adults=1`)).json()) as {
      title: string;
      departures: { id: string; bookable: boolean }[];
    };
    const departure = tour.departures.find((candidate) => candidate.bookable);
    expect(departure, 'a bookable sample departure').toBeDefined();
    const quote = (await (
      await request.post(`${API}/v1/inhouse-quotes`, {
        data: {
          kind: 'tour',
          departureId: departure?.id,
          travellers: { adults: 1, children: 0, infants: 0 },
        },
      })
    ).json()) as { quoteId: string };
    const created = await request.post(`${API}/v1/bookings`, {
      headers: { 'Idempotency-Key': `web-e2e-review-${Date.now()}` },
      data: {
        quoteId: quote.quoteId,
        contact: { email: 'review.guest@example.com', phone: '+2348012345678' },
        passengers: [
          {
            type: 'adult',
            title: 'ms',
            gender: 'f',
            givenNames: 'Ada',
            surname: 'Obi',
            dateOfBirth: '1990-04-01',
            nationality: 'NG',
          },
        ],
        termsVersion: BOOKING_TERMS_VERSION,
        acceptTerms: true,
        turnstileToken: 'e2e-turnstile',
      },
    });
    expect(created.status()).toBe(201);
    const { booking, accessToken } = (await created.json()) as {
      booking: { id: string };
      accessToken: string;
    };
    const guest = { 'X-Booking-Token': accessToken };
    const payment = (await (
      await request.post(`${API}/v1/bookings/${booking.id}/payments`, {
        headers: { ...guest, 'Idempotency-Key': `web-e2e-review-pay-${Date.now()}` },
        data: {},
      })
    ).json()) as { checkoutUrl: string };
    const reference = payment.checkoutUrl.split('/').pop() ?? '';
    await request.post(`${API}/v1/payments/mock/${reference}/complete`, {
      data: { outcome: 'succeeded' },
    });

    // The API lists the tour, not open yet: the trip has not happened.
    const listed = (await (
      await request.get(`${API}/v1/bookings/${booking.id}/reviews`, { headers: guest })
    ).json()) as { items: { itemId: string; kind: string; canReview: boolean }[] };
    expect(listed.items).toEqual([expect.objectContaining({ kind: 'tour', canReview: false })]);
    const itemId = listed.items[0]?.itemId ?? '';

    // Answer as the API does once the trip has ended, and capture what the form sends.
    const sent: unknown[] = [];
    await page.route(`**/v1/bookings/${booking.id}/reviews`, (route) =>
      route.fulfill({
        json: {
          items: [
            {
              itemId,
              kind: 'tour',
              name: tour.title,
              endsOn: '2026-10-01',
              canReview: true,
              windowEndsOn: '2026-12-30',
              review: null,
            },
          ],
        },
      }),
    );
    await page.route(`**/v1/bookings/${booking.id}/items/${itemId}/review`, async (route) => {
      sent.push(route.request().postDataJSON());
      await route.fulfill({
        json: {
          id: '0192f0aa-0000-7000-8000-00000000e2e1',
          status: 'pending',
          rating: 9,
          title: null,
          liked: 'The dunes at sunset.',
          disliked: null,
          tripType: 'friends',
          showName: true,
          createdAt: new Date().toISOString(),
          publishedAt: null,
        },
      });
    });

    await page.goto(`/bookings/${booking.id}#access=${accessToken}`);
    await expect(page.getByTestId('booking-status')).toHaveText(t('booking.status.CONFIRMED'), {
      timeout: 30_000,
    });
    const card = page.getByTestId('trip-review-tour');
    await expect(card).toContainText(t('reviews.write.prompt', { name: tour.title }));
    await card.getByRole('button', { name: t('reviews.write.cta') }).click();
    await card.getByLabel(t('reviews.write.rating')).selectOption('9');
    await card.getByLabel(t('reviews.write.liked')).fill('The dunes at sunset.');
    await card.getByLabel(t('reviews.write.tripType')).selectOption('friends');
    await expectNoAxeViolations(page);
    await card.getByRole('button', { name: t('reviews.write.submit') }).click();

    await expect(card.getByRole('status')).toHaveText(t('reviews.write.saved'));
    await expect(card).toContainText(t('reviews.write.status.pending'));
    expect(sent).toEqual([
      expect.objectContaining({
        rating: 9,
        title: '',
        liked: 'The dunes at sunset.',
        disliked: '',
        tripType: 'friends',
        showName: true,
        locale: 'en-NG',
      }),
    ]);
  });
});
