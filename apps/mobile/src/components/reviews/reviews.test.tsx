import type { Schemas } from '@suskii/api-client';
import { getMessages } from '@suskii/i18n';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import { openSecureCache, secureCache } from '../../lib/cache';
import { tripStore } from '../../lib/trips';
import { json, mockApi, renderWithApp } from '../../test/app';
import { BOOKING_ID } from '../../test/fixtures';

import { ProductReviews } from './product-reviews';
import { TripReviews } from './trip-reviews';

const m = getMessages('en-NG');
const TOKEN = 'guest-token-abcdefghijklmnopqrstuvwxyz';
const ITEM_ID = '0192f0aa-0000-7000-8000-0000000000c1';
const TOUR_ID = '0192f0aa-0000-7000-8000-0000000000c2';
const REVIEWS = `GET /v1/bookings/${BOOKING_ID}/reviews`;
const REVIEW = `/v1/bookings/${BOOKING_ID}/items/${ITEM_ID}/review`;

const item = (review: Schemas['BookingReviews']['items'][number]['review'] = null) => ({
  itemId: ITEM_ID,
  kind: 'tour' as const,
  name: 'Lekki walk',
  endsOn: '2026-10-20',
  canReview: true,
  windowEndsOn: '2027-01-18',
  review,
});

const pending = {
  id: '0192f0aa-0000-7000-8000-0000000000c3',
  status: 'pending' as const,
  rating: 9,
  title: null,
  liked: 'The guide.',
  disliked: null,
  tripType: 'friends' as const,
  showName: true,
  createdAt: '2026-10-28T09:00:00.000Z',
  publishedAt: null,
};

describe('verified reviews in the app (ADR-077)', () => {
  beforeEach(async () => {
    await openSecureCache();
    secureCache().clearAll();
    await tripStore.addGuestTrip(BOOKING_ID, TOKEN);
  });

  it('asks for a review of a finished trip and sends what was written', async () => {
    let saved = false;
    const { calls } = mockApi({
      [REVIEWS]: () => json({ items: [item(saved ? pending : null)] }),
      [`PUT ${REVIEW}`]: () => {
        saved = true;
        return json(pending);
      },
    });
    await renderWithApp(<TripReviews bookingId={BOOKING_ID} />);

    expect(
      await screen.findByText(m.reviews.write.prompt.replace('{name}', 'Lekki walk')),
    ).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('review-write'));
    await fireEvent.press(screen.getByTestId('review-rating-9'));
    await fireEvent.changeText(screen.getByTestId('review-liked'), 'The guide.');
    await fireEvent.press(screen.getByTestId('review-trip-type-friends'));
    await fireEvent.press(screen.getByTestId('review-submit'));

    expect(await screen.findByText(m.reviews.write.saved)).toBeOnTheScreen();
    expect(await screen.findByText(m.reviews.write.status.pending)).toBeOnTheScreen();
    const put = calls.find((request) => request.method === 'PUT');
    expect(put?.headers.get('X-Booking-Token')).toBe(TOKEN);
    expect(await put?.clone().json()).toEqual({
      rating: 9,
      title: '',
      liked: 'The guide.',
      disliked: '',
      tripType: 'friends',
      showName: true,
      locale: 'en-NG',
    });
  });

  it('withdraws a review after asking first', async () => {
    let withdrawn = false;
    mockApi({
      [REVIEWS]: () => json({ items: [item(withdrawn ? null : pending)] }),
      [`DELETE ${REVIEW}`]: () => {
        withdrawn = true;
        return new Response(null, { status: 204 });
      },
    });
    await renderWithApp(<TripReviews bookingId={BOOKING_ID} />);

    await fireEvent.press(await screen.findByTestId('review-withdraw'));
    expect(screen.getByText(m.reviews.write.withdrawConfirm)).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('review-withdraw-confirm'));
    expect(await screen.findByText(m.reviews.write.withdrawn)).toBeOnTheScreen();
    expect(await screen.findByTestId('review-write')).toBeOnTheScreen();
  });

  it('shows nothing while no item can be reviewed', async () => {
    const { calls } = mockApi({
      [REVIEWS]: () => json({ items: [{ ...item(), canReview: false }] }),
    });
    const client = await renderWithApp(<TripReviews bookingId={BOOKING_ID} />);
    await waitFor(() => expect(calls).toHaveLength(1));
    await waitFor(() =>
      expect(client.getQueryState(['booking-reviews', BOOKING_ID])?.status).toBe('success'),
    );
    expect(screen.queryByTestId('trip-reviews')).toBeNull();
  });

  it('lists a product’s published reviews with its verified score', async () => {
    mockApi({
      'GET /v1/reviews': () =>
        json({
          summary: { subjectId: '0192f0aa-0000-7000-8000-0000000000c4', score: 8.5, count: 2 },
          items: [
            {
              id: '0192f0aa-0000-7000-8000-0000000000c5',
              rating: 9,
              title: 'Worth the early start',
              liked: 'The guide.',
              disliked: null,
              tripType: 'couple',
              displayName: 'Ada O.',
              locale: 'en-NG',
              travelledOn: '2026-10',
              publishedAt: '2026-10-25T10:00:00.000Z',
            },
          ],
          nextCursor: null,
        }),
    });
    await renderWithApp(<ProductReviews kind="tour" id={TOUR_ID} />);

    expect(await screen.findByText('Ada O.')).toBeOnTheScreen();
    expect(screen.getByText(/8\.5\/10/)).toBeOnTheScreen();
    expect(screen.getByText(m.reviews.verifiedNote)).toBeOnTheScreen();
    expect(screen.getByText('Worth the early start')).toBeOnTheScreen();
    expect(screen.queryByText(m.reviews.more)).toBeNull();
  });
});
