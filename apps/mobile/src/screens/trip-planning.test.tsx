import type { Schemas } from '@suskii/api-client';
import { getMessages } from '@suskii/i18n';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { router, useLocalSearchParams } from 'expo-router';

import { openSecureCache, secureCache } from '../lib/cache';
import type { Booking } from '../lib/trips';
import { json, mockApi, renderWithApp, signedInSession } from '../test/app';
import {
  BOOKING_ID,
  QUOTE_ID,
  busBooking,
  busCities,
  busTripCard,
  carsFeatures,
  rentalVehicle,
  ridePlaces,
  slice,
  withSlices,
} from '../test/fixtures';

import { BusSearchScreen } from './bus-search-screen';
import { RentalSearchScreen } from './rental-search-screen';
import { RideRequestScreen } from './ride-request-screen';
import { TripScreen } from './trip-screen';

jest.mock('../lib/push', () => ({ followBooking: jest.fn(() => Promise.resolve(true)) }));

const m = getMessages('en-NG');
const [YABA, VI] = ridePlaces.places;
const AIRPORT_ID = '0192d3a0-7c1e-7b2a-9f00-00000000c213';
const quoteCreated = { quoteId: QUOTE_ID, expiresAt: '2026-10-01T09:30:00.000Z' };
const point = (place: typeof YABA) => ({
  label: place?.name ?? '',
  lat: place?.lat ?? 0,
  lng: place?.lng ?? 0,
});

/** A whole minute this many days ahead, so wall times round-trip exactly. */
const inDays = (days: number): Date =>
  new Date(Math.ceil(Date.now() / 60_000) * 60_000 + days * 86_400_000);
const isoDay = (date: Date): string => date.toISOString().slice(0, 10);

/** The fixture bus booking, leaving in two days whenever the test runs. */
function upcomingBus(): Booking {
  const base = busBooking();
  return { ...base, bus: base.bus ? { ...base.bus, departsAt: inDays(2).toISOString() } : null };
}

function departurePlan(departsAt: Date): Schemas['DeparturePlan'] {
  const arriveBy = new Date(departsAt.getTime() - 30 * 60_000);
  const leaveBy = new Date(arriveBy.getTime() - 40 * 60_000);
  const terminal = { label: 'Jibowu Terminal', lat: 6.5156, lng: 3.3683 };
  return {
    kind: 'bus',
    departsAt: departsAt.toISOString(),
    destination: terminal,
    bufferMinutes: 30,
    marginMinutes: 15,
    arriveBy: arriveBy.toISOString(),
    leaveBy: leaveBy.toISOString(),
    travel: { durationSeconds: 1500, distanceMetres: 9_400, estimate: 'routed' },
    from: { id: YABA?.id ?? '', ...point(YABA) },
    ride: { pickup: point(YABA), dropoff: terminal, scheduledFor: leaveBy.toISOString() },
  };
}

describe('Cars help on a trip', () => {
  beforeEach(async () => {
    await openSecureCache();
    secureCache().clearAll();
  });

  describe('departure planner', () => {
    it('works out when to leave for the bus and books a ride for that time', async () => {
      jest.mocked(useLocalSearchParams).mockReturnValue({ id: BOOKING_ID });
      const bus = upcomingBus();
      const plan = departurePlan(new Date(bus.bus?.departsAt ?? ''));
      const { calls } = mockApi({
        [`GET /v1/bookings/${BOOKING_ID}`]: () => json(bus),
        'GET /v1/cars/features': () => json({ ...carsFeatures, departurePlanner: true }),
        'GET /v1/rides/places': () => json(ridePlaces),
        [`GET /v1/bookings/${BOOKING_ID}/departure-plan`]: () => json(plan),
        'POST /v1/inhouse-quotes': () => json(quoteCreated, 201),
      });
      await renderWithApp(<TripScreen />, await signedInSession());

      expect(await screen.findByTestId('departure-plan')).toHaveTextContent(
        new RegExp(m.booking.cars.plan.heading),
      );
      expect(screen.getByTestId('plan-submit')).toBeDisabled();
      await fireEvent.press(screen.getByTestId(`plan-from-${YABA?.id ?? ''}`));
      await fireEvent.press(screen.getByTestId('plan-submit'));

      expect(await screen.findByTestId('plan-leave-by')).toHaveTextContent(/^Leave by /);
      expect(screen.getByTestId('departure-plan')).toHaveTextContent(/Be at Jibowu Terminal by/);
      expect(screen.getByTestId('departure-plan')).toHaveTextContent(
        /That is 30 min before your bus, for boarding\. About 25 min for 9\.4 km, plus 15 min for traffic\./,
      );
      const asked = new URL(calls.find((call) => call.url.includes('departure-plan'))?.url ?? '');
      expect(asked.searchParams.get('from')).toBe(YABA?.id);

      await fireEvent.press(screen.getByTestId('plan-book-ride'));
      await waitFor(() => expect(router.push).toHaveBeenCalledWith(`/checkout/${QUOTE_ID}`));
      const quote = calls.find((call) => call.url.endsWith('/v1/inhouse-quotes'));
      expect(await quote?.json()).toEqual({
        kind: 'ride',
        category: 'standard',
        pickup: point(YABA),
        dropoff: plan.ride?.dropoff,
        scheduledFor: plan.leaveBy,
        currency: 'NGN',
      });
    });

    it('asks a guest to sign in before booking the ride', async () => {
      jest.mocked(useLocalSearchParams).mockReturnValue({ id: BOOKING_ID });
      const bus = upcomingBus();
      mockApi({
        [`GET /v1/bookings/${BOOKING_ID}`]: () => json(bus),
        'GET /v1/cars/features': () => json({ ...carsFeatures, departurePlanner: true }),
        'GET /v1/rides/places': () => json(ridePlaces),
        [`GET /v1/bookings/${BOOKING_ID}/departure-plan`]: () =>
          json(departurePlan(new Date(bus.bus?.departsAt ?? ''))),
      });
      await renderWithApp(<TripScreen />);

      await fireEvent.press(await screen.findByTestId(`plan-from-${YABA?.id ?? ''}`));
      await fireEvent.press(screen.getByTestId('plan-submit'));
      await fireEvent.press(await screen.findByTestId('plan-sign-in'));
      expect(router.push).toHaveBeenCalledWith('/sign-in');
      expect(screen.queryByTestId('plan-book-ride')).toBeNull();
    });

    it('says why a place cannot be planned from', async () => {
      jest.mocked(useLocalSearchParams).mockReturnValue({ id: BOOKING_ID });
      mockApi({
        [`GET /v1/bookings/${BOOKING_ID}`]: () => json(upcomingBus()),
        'GET /v1/cars/features': () => json({ ...carsFeatures, departurePlanner: true }),
        'GET /v1/rides/places': () => json(ridePlaces),
        [`GET /v1/bookings/${BOOKING_ID}/departure-plan`]: () =>
          json({ type: 'about:blank', title: 'We cannot plan this trip', status: 422 }, 422),
      });
      await renderWithApp(<TripScreen />);

      await fireEvent.press(await screen.findByTestId(`plan-from-${VI?.id ?? ''}`));
      await fireEvent.press(screen.getByTestId('plan-submit'));
      expect(await screen.findByText(m.booking.cars.plan.errors.unavailable)).toBeOnTheScreen();
      expect(screen.queryByTestId('plan-leave-by')).toBeNull();
    });

    it('stays hidden while the planner and suggestions are switched off', async () => {
      jest.mocked(useLocalSearchParams).mockReturnValue({ id: BOOKING_ID });
      const { calls } = mockApi({
        [`GET /v1/bookings/${BOOKING_ID}`]: () => json(upcomingBus()),
        'GET /v1/cars/features': () => json(carsFeatures),
      });
      await renderWithApp(<TripScreen />);

      expect(await screen.findByTestId('trip-cars')).toBeOnTheScreen();
      await waitFor(() =>
        expect(calls.some((call) => call.url.endsWith('/v1/cars/features'))).toBe(true),
      );
      expect(screen.queryByTestId('departure-plan')).toBeNull();
      expect(screen.queryByTestId('cars-suggestions')).toBeNull();
      expect(calls.some((call) => call.url.includes('/rides/places'))).toBe(false);
    });
  });

  describe('trip bundling', () => {
    const arrival = isoDay(inDays(3));
    const suggestions: Schemas['CarsSuggestions'] = {
      ride: {
        pickupPlaceId: AIRPORT_ID,
        pickupLabel: 'Murtala Muhammed International Airport',
        cityName: 'Lagos',
        scheduledFor: `${arrival}T08:10:00.000Z`,
      },
      rental: {
        cityName: 'Lagos',
        pickupAtLocal: `${arrival}T10:00`,
        returnAtLocal: `${arrival}T18:00`,
      },
      bus: { from: 'Lagos', date: arrival },
    };

    it('offers a ride, a car and onward buses after a flight, each as a prefilled search', async () => {
      jest.mocked(useLocalSearchParams).mockReturnValue({ id: BOOKING_ID });
      mockApi({
        [`GET /v1/bookings/${BOOKING_ID}`]: () => json(withSlices([slice('ABV', 'LOS', arrival)])),
        'GET /v1/cars/features': () => json({ ...carsFeatures, bundles: true }),
        [`GET /v1/bookings/${BOOKING_ID}/cars-suggestions`]: () => json(suggestions),
      });
      await renderWithApp(<TripScreen />);

      const card = await screen.findByTestId('cars-suggestions');
      expect(card).toHaveTextContent(/A ride from Murtala Muhammed International Airport/);
      expect(card).toHaveTextContent(/A car in Lagos/);
      expect(card).toHaveTextContent(/Buses onward from Lagos/);

      await fireEvent.press(screen.getByTestId('suggest-ride'));
      expect(router.push).toHaveBeenLastCalledWith(
        `/rides?pickup=${AIRPORT_ID}&at=${encodeURIComponent(suggestions.ride?.scheduledFor ?? '')}`,
      );
      await fireEvent.press(screen.getByTestId('suggest-rental'));
      expect(router.push).toHaveBeenLastCalledWith(
        `/rentals?city=Lagos&pickupAt=${arrival}T10%3A00&returnAt=${arrival}T18%3A00`,
      );
      await fireEvent.press(screen.getByTestId('suggest-bus'));
      expect(router.push).toHaveBeenLastCalledWith(`/buses?from=Lagos&date=${arrival}`);
    });

    it('shows nothing when no Cars product fits the trip', async () => {
      jest.mocked(useLocalSearchParams).mockReturnValue({ id: BOOKING_ID });
      const { calls } = mockApi({
        [`GET /v1/bookings/${BOOKING_ID}`]: () => json(withSlices([slice('LOS', 'ABV', arrival)])),
        'GET /v1/cars/features': () => json({ ...carsFeatures, bundles: true }),
        [`GET /v1/bookings/${BOOKING_ID}/cars-suggestions`]: () =>
          json({ ride: null, rental: null, bus: null }),
      });
      await renderWithApp(<TripScreen />);

      await waitFor(() =>
        expect(calls.some((call) => call.url.endsWith('/cars-suggestions'))).toBe(true),
      );
      expect(screen.queryByTestId('cars-suggestions')).toBeNull();
    });
  });

  describe('prefilled searches', () => {
    it('opens the ride form at the suggested pick-up and time', async () => {
      const at = inDays(1);
      jest
        .mocked(useLocalSearchParams)
        .mockReturnValue({ pickup: YABA?.id ?? '', at: at.toISOString() });
      const { calls } = mockApi({
        'GET /v1/rides/places': () => json(ridePlaces),
        'POST /v1/inhouse-quotes': () => json(quoteCreated, 201),
      });
      await renderWithApp(<RideRequestScreen />, await signedInSession());

      await fireEvent.press(await screen.findByTestId(`ride-dropoff-${VI?.id ?? ''}`));
      await fireEvent.press(screen.getByTestId('ride-quote'));

      await waitFor(() => expect(router.push).toHaveBeenCalledWith(`/checkout/${QUOTE_ID}`));
      const quote = calls.find((call) => call.url.endsWith('/v1/inhouse-quotes'));
      expect(await quote?.json()).toMatchObject({
        pickup: point(YABA),
        dropoff: point(VI),
        scheduledFor: at.toISOString(),
      });
    });

    it('searches cars for a suggested city and period straight away', async () => {
      jest.mocked(useLocalSearchParams).mockReturnValue({
        city: 'Lagos',
        pickupAt: '2026-11-05T10:00',
        returnAt: '2026-11-08T10:00',
      });
      const { calls } = mockApi({
        'GET /v1/rentals/vehicles': () =>
          json({
            days: 3,
            vehicles: [
              {
                ...rentalVehicle,
                estimate: {
                  rental: { amountMinor: 10_500_000, currency: 'NGN' },
                  deposit: rentalVehicle.deposit,
                },
              },
            ],
          }),
      });
      await renderWithApp(<RentalSearchScreen />);

      expect(await screen.findByTestId(`rental-car-${rentalVehicle.slug}`)).toBeOnTheScreen();
      expect(screen.getByTestId('rental-pickup')).toHaveDisplayValue('2026-11-05T10:00');
      const search = new URL(calls[0]?.url ?? '');
      expect(Object.fromEntries(search.searchParams)).toEqual({
        city: 'Lagos',
        pickupAt: '2026-11-05T10:00',
        returnAt: '2026-11-08T10:00',
      });
    });

    it('starts a bus search from the suggested city and day', async () => {
      jest.mocked(useLocalSearchParams).mockReturnValue({ from: 'Lagos', date: '2026-11-05' });
      const { calls } = mockApi({
        'GET /v1/buses/cities': () => json(busCities),
        'GET /v1/buses/search': () => json({ trips: [busTripCard] }),
      });
      await renderWithApp(<BusSearchScreen />);

      await fireEvent.press(await screen.findByTestId('bus-to-Ibadan'));
      await fireEvent.press(screen.getByTestId('bus-search-submit'));

      await screen.findByTestId(`bus-trip-${busTripCard.id}`);
      const search = new URL(calls.find((call) => call.url.includes('/search'))?.url ?? '');
      expect(Object.fromEntries(search.searchParams)).toMatchObject({
        from: 'Lagos',
        to: 'Ibadan',
        date: '2026-11-05',
      });
    });
  });
});
