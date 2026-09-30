import { getMessages } from '@suskii/i18n';
import { fireEvent, screen } from '@testing-library/react-native';
import { router } from 'expo-router';

import { daysFromToday } from '../lib/dates';
import { openSecureCache, secureCache } from '../lib/cache';
import { tripStore } from '../lib/trips';
import { json, mockApi, offline, renderWithApp } from '../test/app';
import { BOOKING_ID, slice, withSlices } from '../test/fixtures';

import { TripsScreen } from './trips-screen';

const m = getMessages('en-NG');
const PAST_ID = '0192d3a0-7c1e-7b2a-9f00-0000000000bb';

describe('TripsScreen', () => {
  beforeEach(async () => {
    await openSecureCache();
    secureCache().clearAll();
  });

  it('invites a first booking when there are no trips', async () => {
    mockApi({});
    await renderWithApp(<TripsScreen />);
    expect(await screen.findByRole('header', { name: m.mobile.trips.empty })).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: m.mobile.account.signIn }));
    expect(router.push).toHaveBeenCalledWith('/sign-in');
  });

  it('splits guest trips into upcoming and past, and works offline from the cache', async () => {
    const upcoming = withSlices([slice('LOS', 'ABV', daysFromToday(20))]);
    const past = withSlices([slice('ABV', 'LOS', daysFromToday(-20))], {
      id: PAST_ID,
      reference: 'SK1OLD',
      createdAt: '2026-01-01T09:00:00.000Z',
    });
    await tripStore.addGuestTrip(PAST_ID, 'token-for-the-past-trip');
    await tripStore.addGuestTrip(BOOKING_ID, 'token-for-the-next-trip');
    tripStore.saveBooking(upcoming);
    tripStore.saveBooking(past);
    mockApi({
      [`GET /v1/bookings/${BOOKING_ID}`]: offline,
      [`GET /v1/bookings/${PAST_ID}`]: offline,
    });

    await renderWithApp(<TripsScreen />);

    expect(await screen.findByText(m.mobile.offline)).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: m.mobile.trips.upcoming })).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: m.mobile.trips.past })).toBeOnTheScreen();
    const cards = screen.getAllByTestId('trip-card');
    expect(cards).toHaveLength(2);
    expect(cards[0]).toHaveTextContent(/SK7Q2M/);
    expect(cards[1]).toHaveTextContent(/SK1OLD/);

    await fireEvent.press(screen.getAllByRole('button', { name: /SK7Q2M/ })[0]!);
    expect(router.push).toHaveBeenCalledWith(`/trips/${BOOKING_ID}`);
  });

  it('refreshes guest trips from the API when online', async () => {
    await tripStore.addGuestTrip(BOOKING_ID, 'token-for-the-next-trip');
    const fresh = withSlices([slice('LOS', 'ABV', daysFromToday(20))], { status: 'CONFIRMED' });
    mockApi({ [`GET /v1/bookings/${BOOKING_ID}`]: () => json(fresh) });

    await renderWithApp(<TripsScreen />);

    expect(await screen.findByText(m.booking.status.CONFIRMED)).toBeOnTheScreen();
    expect(screen.queryByText(m.mobile.offline)).toBeNull();
    expect(tripStore.cachedBooking(BOOKING_ID)?.booking.status).toBe('CONFIRMED');
  });
});
