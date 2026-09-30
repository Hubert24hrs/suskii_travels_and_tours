import * as SecureStore from 'expo-secure-store';

import { BOOKING_ID, booking, slice, withSlices } from '../test/fixtures';

import { openSecureCache, secureCache } from './cache';
import { summaryOf, tripStore } from './trips';

const OTHER_ID = '0192d3a0-7c1e-7b2a-9f00-0000000000bb';
const TOKEN = 'guest-token-abcdefghijklmnop';

describe('summaryOf', () => {
  it('summarises a one-way flight', () => {
    expect(summaryOf(booking())).toEqual({
      id: BOOKING_ID,
      reference: 'SK7Q2M',
      status: 'CONFIRMED',
      vertical: 'flights',
      createdAt: '2026-10-01T09:00:00.000Z',
      total: { amountMinor: 8_500_000, currency: 'NGN' },
      startsOn: '2026-11-02',
      endsOn: null,
      flight: {
        tripType: 'one_way',
        origin: { code: 'LOS', cityName: 'Lagos' },
        destination: { code: 'ABV', cityName: 'Abuja' },
        airline: 'Demo Air',
      },
      hotel: null,
      product: null,
    });
  });

  it('summarises a package with its title, place and dates', () => {
    const summary = summaryOf(
      booking({
        vertical: 'packages',
        flight: null,
        package: {
          product: {
            id: BOOKING_ID,
            slug: 'zanzibar',
            title: 'Zanzibar beach break',
            sample: true,
            artKey: null,
          },
          departureId: BOOKING_ID,
          cityName: 'Zanzibar',
          countryCode: 'TZ',
          nights: 5,
          startDate: '2026-12-01',
          endDate: '2026-12-06',
          passportRequired: true,
          inclusions: [],
          travellers: { adults: 2, children: 0, infants: 0 },
          cancellationPolicy: [],
        },
      }),
    );
    expect(summary).toMatchObject({
      vertical: 'packages',
      startsOn: '2026-12-01',
      endsOn: '2026-12-06',
      flight: null,
      product: { title: 'Zanzibar beach break', cityName: 'Zanzibar', countryCode: 'TZ' },
    });
  });

  it('shows a round trip as its outbound destination with the return date', () => {
    const summary = summaryOf(
      withSlices([slice('LOS', 'ABV', '2026-11-02'), slice('ABV', 'LOS', '2026-11-09')]),
    );
    expect(summary.flight).toMatchObject({
      tripType: 'round_trip',
      destination: { code: 'ABV', cityName: 'Abuja' },
    });
    expect(summary.endsOn).toBe('2026-11-09');
  });

  it('shows a multi-city trip from the first origin to the last destination', () => {
    const summary = summaryOf(
      withSlices([slice('LOS', 'ABV', '2026-11-02'), slice('ABV', 'PHC', '2026-11-05')]),
    );
    expect(summary.flight).toMatchObject({
      tripType: 'multi_city',
      origin: { code: 'LOS' },
      destination: { code: 'PHC' },
    });
  });

  it('uses the stay dates for a hotel', () => {
    const base = booking();
    const summary = summaryOf({
      ...base,
      vertical: 'hotels',
      flight: null,
      hotel: {
        name: 'Harbour View',
        stars: 4,
        area: 'Victoria Island',
        cityName: 'Lagos',
        countryCode: 'NG',
        checkIn: '2026-12-10',
        checkOut: '2026-12-13',
        nights: 3,
        rooms: 1,
        roomName: 'Deluxe King',
        board: 'breakfast_included',
        refundable: true,
        freeCancellationUntil: null,
        payAtProperty: null,
        confirmationNumber: null,
        request: {
          destination: { type: 'city', cityId: '0192d3a0-7c1e-7b2a-9f00-0000000000cc' },
          checkIn: '2026-12-10',
          checkOut: '2026-12-13',
          rooms: [{ adults: 2, childAges: [] }],
          freeCancellationOnly: false,
        },
      },
    });
    expect(summary).toMatchObject({
      startsOn: '2026-12-10',
      endsOn: '2026-12-13',
      flight: null,
      hotel: { name: 'Harbour View', cityName: 'Lagos' },
    });
  });
});

describe('tripStore', () => {
  beforeAll(async () => {
    await openSecureCache();
  });
  beforeEach(() => {
    secureCache().clearAll();
  });

  it('keeps guest trips newest first with their token in the secure store', async () => {
    await tripStore.addGuestTrip(OTHER_ID, 'older-token-abcdefghijk');
    await tripStore.addGuestTrip(BOOKING_ID, TOKEN);
    await tripStore.addGuestTrip(BOOKING_ID, TOKEN);

    expect(tripStore.deviceTripIds()).toEqual([BOOKING_ID, OTHER_ID]);
    expect(await tripStore.bookingHeaders(BOOKING_ID)).toEqual({ 'X-Booking-Token': TOKEN });
    // The token never lands in the cache, only in the Keychain / Keystore.
    expect(
      JSON.stringify(
        secureCache()
          .getAllKeys()
          .map((key) => secureCache().getString(key)),
      ),
    ).not.toContain(TOKEN);
  });

  it('forgets a trip, its offline copy and its token', async () => {
    await tripStore.addGuestTrip(BOOKING_ID, TOKEN);
    tripStore.saveBooking(booking(), new Date('2026-10-02T10:00:00Z'));
    expect(tripStore.cachedBooking(BOOKING_ID)?.savedAt).toBe('2026-10-02T10:00:00.000Z');

    await tripStore.forget(BOOKING_ID);

    expect(tripStore.deviceTripIds()).toEqual([]);
    expect(tripStore.cachedBooking(BOOKING_ID)).toBeNull();
    expect(await SecureStore.getItemAsync(`booking.${BOOKING_ID}`)).toBeNull();
    expect(await tripStore.bookingHeaders(BOOKING_ID)).toEqual({});
  });

  it('drops account trips on sign-out but keeps guest trips made on this phone', async () => {
    await tripStore.addGuestTrip(BOOKING_ID, TOKEN);
    tripStore.saveBooking(booking());
    tripStore.saveBooking(booking({ id: OTHER_ID }));
    tripStore.saveAccountTrips([summaryOf(booking()), summaryOf(booking({ id: OTHER_ID }))]);

    tripStore.forgetAccount();

    expect(tripStore.accountTrips()).toEqual([]);
    expect(tripStore.cachedBooking(OTHER_ID)).toBeNull();
    expect(tripStore.cachedBooking(BOOKING_ID)).not.toBeNull();
  });

  it('discards a corrupt cache entry instead of crashing', () => {
    secureCache().set('trips.device', '{not json');
    expect(tripStore.deviceTripIds()).toEqual([]);
    expect(secureCache().contains('trips.device')).toBe(false);
  });
});
