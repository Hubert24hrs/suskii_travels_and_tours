import type { Schemas } from '@suskii/api-client';
import { getMessages } from '@suskii/i18n';
import { fireEvent, screen } from '@testing-library/react-native';
import { router } from 'expo-router';

import { daysFromToday } from '../lib/dates';
import { openSecureCache, secureCache } from '../lib/cache';
import { tripStore } from '../lib/trips';
import { json, mockApi, offline, renderWithApp, signedInSession } from '../test/app';
import { BOOKING_ID, slice, withSlices } from '../test/fixtures';

import { TripsScreen } from './trips-screen';

const m = getMessages('en-NG');
const PAST_ID = '0192d3a0-7c1e-7b2a-9f00-0000000000bb';
const TRIP_ID = '0192d3a0-7c1e-7b2a-9f00-00000000d001';

/** A combined trip (ADR-099), paid, with its receipt. */
const paidTrip: Schemas['Trip'] = {
  id: TRIP_ID,
  reference: 'T-AB12CD',
  createdAt: '2026-10-01T09:00:00.000Z',
  plan: {
    origin: {
      code: 'LOS',
      name: 'Murtala Muhammed International Airport',
      cityName: 'Lagos',
      countryCode: 'NG',
    },
    destination: {
      code: 'LHR',
      name: 'London Heathrow Airport',
      cityName: 'London',
      countryCode: 'GB',
      cityId: null,
    },
    departDate: daysFromToday(30),
    returnDate: daysFromToday(37),
    adults: 1,
    children: 0,
    components: ['flight'],
  },
  currency: 'NGN',
  state: 'paid',
  parts: [],
  missing: [],
  total: { amountMinor: 95_000_000, currency: 'NGN' },
  due: { amountMinor: 0, currency: 'NGN' },
  payment: { providers: [], methods: [], open: null },
  receipt: {
    paidAt: '2026-11-14T10:20:00.000Z',
    amount: { amountMinor: 95_000_000, currency: 'NGN' },
  },
};

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

  it("lists a signed-in traveller's combined trips first, each opening its trip and receipt", async () => {
    const { calls } = mockApi({
      'GET /v1/me/bookings': () => json({ bookings: [], nextCursor: null }),
      'GET /v1/me/trips': () => json({ trips: [paidTrip] }),
    });

    await renderWithApp(<TripsScreen />, await signedInSession());

    const list = await screen.findByTestId('combined-trips');
    expect(screen.getByRole('header', { name: m.account.trips.combinedHeading })).toBeOnTheScreen();
    expect(list).toHaveTextContent(new RegExp(m.trips.states.paid));
    expect(list).toHaveTextContent(/950,000/);
    // Not the invitation to a first booking: the account has a trip.
    expect(screen.queryByRole('header', { name: m.mobile.trips.empty })).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: /T-AB12CD/ }));
    expect(router.push).toHaveBeenCalledWith(`/trips/built/${TRIP_ID}`);
    expect(calls.some((call) => call.url.endsWith('/v1/me/trips'))).toBe(true);
  });

  it('asks nothing about combined trips without an account', async () => {
    const { calls } = mockApi({});
    await renderWithApp(<TripsScreen />);
    expect(await screen.findByRole('header', { name: m.mobile.trips.empty })).toBeOnTheScreen();
    expect(screen.queryByTestId('combined-trips')).toBeNull();
    expect(calls.some((call) => call.url.endsWith('/v1/me/trips'))).toBe(false);
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
