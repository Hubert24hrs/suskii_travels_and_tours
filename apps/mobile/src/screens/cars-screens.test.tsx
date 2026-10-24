import { getMessages } from '@suskii/i18n';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { getDocumentAsync } from 'expo-document-picker';
import { File } from 'expo-file-system';
import { router, useLocalSearchParams } from 'expo-router';
import { Share } from 'react-native';

import { openSecureCache, secureCache } from '../lib/cache';
import { tripStore } from '../lib/trips';
import { json, mockApi, offline, renderWithApp, signedInSession } from '../test/app';
import {
  BOOKING_ID,
  BUS_HOLD_ID,
  BUS_TRIP_ID,
  QUOTE_ID,
  RESERVATION_ID,
  RIDE_ID,
  busBooking,
  busCities,
  busTrip,
  busTripCard,
  carsFeatures,
  rentalBooking,
  rentalReservation,
  rentalVehicle,
  ride,
  rideBooking,
  ridePlaces,
} from '../test/fixtures';

import { BusSearchScreen } from './bus-search-screen';
import { BusTripScreen } from './bus-trip-screen';
import { CarsScreen } from './cars-screen';
import { HomeScreen } from './home-screen';
import { LiveRideScreen } from './live-ride-screen';
import { RentalCarScreen } from './rental-car-screen';
import { RentalSearchScreen } from './rental-search-screen';
import { RideRequestScreen } from './ride-request-screen';
import { TripScreen } from './trip-screen';

jest.mock('../lib/push', () => ({ followBooking: jest.fn(() => Promise.resolve(true)) }));

const m = getMessages('en-NG');
/** Puts a picked file in the mocked file system (jest.setup.js). */
const writeFile = (uri: string, bytes: Uint8Array): void =>
  (File as unknown as { __write: (uri: string, bytes: Uint8Array) => void }).__write(uri, bytes);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const quoteCreated = { quoteId: QUOTE_ID, expiresAt: '2026-10-01T09:30:00.000Z' };

const [YABA, VI] = ridePlaces.places;

/** Yaba to Victoria Island on the ride request form. */
async function choosePlaces(): Promise<void> {
  await fireEvent.press(await screen.findByTestId(`ride-pickup-${YABA?.id ?? ''}`));
  await fireEvent.press(screen.getByTestId(`ride-dropoff-${VI?.id ?? ''}`));
}

async function bodyBytes(request: Request | undefined): Promise<Uint8Array> {
  return new Uint8Array((await request?.arrayBuffer()) ?? new ArrayBuffer(0));
}

describe('Cars on mobile', () => {
  beforeEach(async () => {
    await openSecureCache();
    secureCache().clearAll();
  });

  describe('entry points', () => {
    it('links the Cars hub from home only while a product is on', async () => {
      mockApi({
        'GET /v1/deals/flights': () => json({ currency: 'NGN', origins: [], deals: [] }),
        'GET /v1/cars/features': () => json(carsFeatures),
      });
      await renderWithApp(<HomeScreen />);

      await fireEvent.press(await screen.findByTestId('home-cars'));
      expect(router.push).toHaveBeenCalledWith('/cars');
    });

    it('hides the Cars card when every product is off', async () => {
      mockApi({
        'GET /v1/deals/flights': () => json({ currency: 'NGN', origins: [], deals: [] }),
        'GET /v1/cars/features': () =>
          json({ ...carsFeatures, buses: false, rides: false, rentals: false }),
      });
      await renderWithApp(<HomeScreen />);
      await screen.findByText(m.hero.headline);
      await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(2));
      expect(screen.queryByTestId('home-cars')).toBeNull();
    });

    it('offers ticket scanning to operator agents only', async () => {
      mockApi({ 'GET /v1/cars/features': () => json({ ...carsFeatures, rentals: false }) });
      await renderWithApp(<CarsScreen />, await signedInSession());
      expect(await screen.findByTestId('cars-buses')).toBeOnTheScreen();
      expect(screen.getByTestId('cars-rides')).toBeOnTheScreen();
      expect(screen.getByTestId('cars-drive')).toBeOnTheScreen();
      expect(screen.queryByTestId('cars-rentals')).toBeNull();
      expect(screen.queryByTestId('cars-scan')).toBeNull();
    });

    it('shows the scanner entry to an operator agent', async () => {
      mockApi({ 'GET /v1/cars/features': () => json(carsFeatures) });
      await renderWithApp(
        <CarsScreen />,
        await signedInSession({ roles: ['customer', 'operator_agent'] }),
      );
      await fireEvent.press(await screen.findByTestId('cars-scan'));
      expect(router.push).toHaveBeenCalledWith('/operator/scan');
    });
  });

  describe('buses', () => {
    it('searches a route and opens a departure for the chosen seats', async () => {
      const { calls } = mockApi({
        'GET /v1/buses/cities': () => json(busCities),
        'GET /v1/buses/search': () => json({ trips: [busTripCard] }),
      });
      await renderWithApp(<BusSearchScreen />);

      await fireEvent.press(await screen.findByTestId('bus-from-Lagos'));
      await fireEvent.press(screen.getByTestId('bus-to-Ibadan'));
      await fireEvent.press(screen.getByTestId('bus-seats-2'));
      await fireEvent.press(screen.getByTestId('bus-search-submit'));

      const card = await screen.findByTestId(`bus-trip-${BUS_TRIP_ID}`);
      expect(card).toHaveTextContent(/Lagoon Express/);
      expect(card).toHaveTextContent(/₦8,500/);
      // Known amenities are named; one the app does not know yet is left out.
      expect(card).toHaveTextContent(/Air conditioning/);
      expect(card).not.toHaveTextContent(/a_future_amenity/);
      const search = new URL(calls.find((request) => request.url.includes('/search'))?.url ?? '');
      expect(Object.fromEntries(search.searchParams)).toMatchObject({
        from: 'Lagos',
        to: 'Ibadan',
        seats: '2',
        currency: 'NGN',
      });
      expect(search.searchParams.get('date')).toMatch(/^\d{4}-\d{2}-\d{2}$/);

      await fireEvent.press(card);
      expect(router.push).toHaveBeenCalledWith(`/buses/trips/${BUS_TRIP_ID}?seats=2`);
    });

    it('holds two seats, quotes the hold and opens checkout', async () => {
      jest.mocked(useLocalSearchParams).mockReturnValue({ tripId: BUS_TRIP_ID });
      const { calls } = mockApi({
        [`GET /v1/buses/trips/${BUS_TRIP_ID}`]: () => json(busTrip()),
        [`POST /v1/buses/trips/${BUS_TRIP_ID}/holds`]: () =>
          json(
            {
              holdId: BUS_HOLD_ID,
              holdToken: 'hold-token',
              tripId: BUS_TRIP_ID,
              seats: ['1A', '2A'],
              expiresAt: '2026-10-01T09:10:00.000Z',
            },
            201,
          ),
        'POST /v1/inhouse-quotes': () => json(quoteCreated, 201),
      });
      await renderWithApp(<BusTripScreen />);

      expect(await screen.findByTestId('seat-1B')).toBeDisabled();
      await fireEvent.press(screen.getByTestId('seat-1A'));
      await fireEvent.press(screen.getByTestId('seat-2A'));
      expect(screen.getByTestId('seats-chosen')).toHaveTextContent(/2 seats chosen \(1A, 2A\)/);
      await fireEvent.press(screen.getByTestId('hold-seats'));

      await waitFor(() => expect(router.push).toHaveBeenCalledWith(`/checkout/${QUOTE_ID}`));
      const hold = calls.find((request) => request.url.endsWith('/holds'));
      expect(await hold?.json()).toEqual({ seats: ['1A', '2A'] });
      const quote = calls.find((request) => request.url.endsWith('/v1/inhouse-quotes'));
      expect(await quote?.json()).toEqual({
        kind: 'bus',
        holdId: BUS_HOLD_ID,
        holdToken: 'hold-token',
        currency: 'NGN',
      });
    });

    it('reloads the map when someone else took a seat first', async () => {
      jest.mocked(useLocalSearchParams).mockReturnValue({ tripId: BUS_TRIP_ID });
      let loads = 0;
      mockApi({
        [`GET /v1/buses/trips/${BUS_TRIP_ID}`]: () => {
          loads += 1;
          return json(busTrip());
        },
        [`POST /v1/buses/trips/${BUS_TRIP_ID}/holds`]: () =>
          json({ type: 'urn:suskii:problem:seat-taken', title: 'Seat taken', status: 409 }, 409),
      });
      await renderWithApp(<BusTripScreen />);
      await fireEvent.press(await screen.findByTestId('seat-2B'));
      await fireEvent.press(screen.getByTestId('hold-seats'));

      expect(await screen.findByRole('alert')).toHaveTextContent(m.cars.buses.trip.errors.taken);
      await waitFor(() => expect(loads).toBe(2));
      expect(screen.getByTestId('seats-chosen')).toHaveTextContent(/0 seats chosen/);
      expect(router.push).not.toHaveBeenCalled();
    });

    it('shows one QR boarding pass per seat', async () => {
      jest.mocked(useLocalSearchParams).mockReturnValue({ id: BOOKING_ID });
      mockApi({ [`GET /v1/bookings/${BOOKING_ID}`]: () => json(busBooking()) });
      await renderWithApp(<TripScreen />);

      expect(await screen.findByTestId('ticket-qr-1A')).toBeOnTheScreen();
      expect(screen.getByTestId('ticket-qr-2A')).toBeOnTheScreen();
      expect(screen.getByLabelText('Boarding QR code for seat 1A')).toBeOnTheScreen();
      expect(screen.getByTestId('trip-cars')).toHaveTextContent(/Lagos to Ibadan/);
      expect(screen.getByText(/Seat 2A · Bola Okafor/)).toBeOnTheScreen();
    });

    it('draws the boarding passes from the copy saved on the phone when offline', async () => {
      jest.mocked(useLocalSearchParams).mockReturnValue({ id: BOOKING_ID });
      // No connection at the coach door: the copy saved at the last visit still draws the codes.
      tripStore.saveBooking(busBooking());
      mockApi({ [`GET /v1/bookings/${BOOKING_ID}`]: offline });
      await renderWithApp(<TripScreen />);
      expect(await screen.findByText(m.mobile.offline)).toBeOnTheScreen();
      expect(screen.getByTestId('ticket-qr-1A')).toBeOnTheScreen();
      expect(screen.getByTestId('ticket-qr-2A')).toBeOnTheScreen();
    });

    it('draws no QR code for a boarded or cancelled ticket', async () => {
      jest.mocked(useLocalSearchParams).mockReturnValue({ id: BOOKING_ID });
      const base = busBooking();
      mockApi({
        [`GET /v1/bookings/${BOOKING_ID}`]: () =>
          json(
            busBooking({
              busTickets: base.busTickets.map((ticket, index) => ({
                ...ticket,
                status: index === 0 ? 'boarded' : 'void',
                boardedAt: index === 0 ? '2026-11-02T06:40:00.000Z' : null,
              })),
            }),
          ),
      });
      await renderWithApp(<TripScreen />);
      expect(await screen.findByTestId('ticket-state-1A')).toHaveTextContent(
        m.booking.cars.bus.ticketStates.boarded,
      );
      expect(screen.getByTestId('ticket-state-2A')).toHaveTextContent(
        m.booking.cars.bus.ticketStates.void,
      );
      expect(screen.queryByTestId('ticket-qr-1A')).toBeNull();
      expect(screen.queryByTestId('ticket-qr-2A')).toBeNull();
    });
  });

  describe('rides', () => {
    it('asks a signed-out visitor to sign in first', async () => {
      mockApi({});
      await renderWithApp(<RideRequestScreen />);
      expect(await screen.findByTestId('account-required')).toBeOnTheScreen();
    });

    it('quotes a ride between two places and opens checkout', async () => {
      const { calls } = mockApi({
        'GET /v1/rides/places': () => json(ridePlaces),
        'POST /v1/inhouse-quotes': () => json(quoteCreated, 201),
      });
      await renderWithApp(<RideRequestScreen />, await signedInSession());

      await choosePlaces();
      await fireEvent.press(screen.getByTestId('ride-category-comfort'));
      await fireEvent.press(screen.getByTestId('ride-quote'));

      await waitFor(() => expect(router.push).toHaveBeenCalledWith(`/checkout/${QUOTE_ID}`));
      const quote = calls.find((request) => request.url.endsWith('/v1/inhouse-quotes'));
      expect(await quote?.json()).toEqual({
        kind: 'ride',
        category: 'comfort',
        pickup: { label: 'Yaba', lat: 6.5095, lng: 3.3711 },
        dropoff: { label: 'Victoria Island', lat: 6.4281, lng: 3.4219 },
        scheduledFor: null,
        currency: 'NGN',
      });
    });

    it('explains a trip outside the area served', async () => {
      mockApi({
        'GET /v1/rides/places': () => json(ridePlaces),
        'POST /v1/inhouse-quotes': () =>
          json(
            {
              type: 'urn:suskii:problem:quote-invalid',
              title: 'This ride cannot be booked',
              status: 422,
              code: 'outside_service_area',
            },
            422,
          ),
      });
      await renderWithApp(<RideRequestScreen />, await signedInSession());
      await choosePlaces();
      await fireEvent.press(screen.getByTestId('ride-quote'));
      expect(await screen.findByRole('alert')).toHaveTextContent(m.cars.rides.errors.outsideArea);
    });

    it('opens the live ride from the trip', async () => {
      jest.mocked(useLocalSearchParams).mockReturnValue({ id: BOOKING_ID });
      mockApi({ [`GET /v1/bookings/${BOOKING_ID}`]: () => json(rideBooking()) });
      await renderWithApp(<TripScreen />, await signedInSession());
      await fireEvent.press(await screen.findByTestId('track-ride'));
      expect(router.push).toHaveBeenCalledWith(`/rides/${RIDE_ID}`);
    });

    it('shows the driver and PIN, shares the trip and sends an SOS', async () => {
      jest.mocked(useLocalSearchParams).mockReturnValue({ rideId: RIDE_ID });
      const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' });
      const { calls } = mockApi({
        [`GET /v1/rides/${RIDE_ID}`]: () => json(ride()),
        [`GET /v1/bookings/${BOOKING_ID}`]: () => json(rideBooking()),
        [`POST /v1/rides/${RIDE_ID}/share`]: () =>
          json(
            { token: 'share-token-abcdefghijklmnopqrstu', expiresAt: '2026-10-01T10:30:00Z' },
            201,
          ),
        [`POST /v1/rides/${RIDE_ID}/sos`]: () => new Response(null, { status: 201 }),
      });
      await renderWithApp(<LiveRideScreen />, await signedInSession());

      expect(await screen.findByTestId('ride-status')).toHaveTextContent(
        m.cars.rides.live.status.assigned,
      );
      expect(screen.getByTestId('ride-driver')).toHaveTextContent(/Tunde · 4.8/);
      expect(screen.getByTestId('ride-driver')).toHaveTextContent(
        /Silver Toyota Corolla · KJA-123-AB/,
      );
      expect(screen.getByTestId('ride-pin')).toHaveTextContent('Trip PIN: 4827');

      await fireEvent.press(screen.getByTestId('ride-share'));
      await waitFor(() =>
        expect(share).toHaveBeenCalledWith({
          message: expect.stringMatching(/\/trip\/share-token-abcdefghijklmnopqrstu$/) as string,
        }),
      );

      await fireEvent.press(screen.getByTestId('ride-sos'));
      expect(screen.getByText(m.cars.rides.live.sosBody)).toBeOnTheScreen();
      await fireEvent.press(screen.getByTestId('ride-sos-confirm'));
      expect(await screen.findByTestId('ride-notice')).toHaveTextContent(m.cars.rides.live.sosSent);
      const sos = calls.find((request) => request.url.endsWith('/sos'));
      // The app has no location access: the safety team works from the ride's own trace.
      expect(await sos?.json()).toEqual({ position: null });
    });

    it('warns about the fee once the free window has passed, then cancels', async () => {
      jest.mocked(useLocalSearchParams).mockReturnValue({ rideId: RIDE_ID });
      let cancelled = false;
      mockApi({
        [`GET /v1/rides/${RIDE_ID}`]: () =>
          json(
            cancelled
              ? ride({ status: 'cancelled', cancelledBy: 'rider', pin: null })
              : ride({ assignedAt: '2026-10-01T09:00:00.000Z' }),
          ),
        [`GET /v1/bookings/${BOOKING_ID}`]: () => json(rideBooking()),
        [`POST /v1/rides/${RIDE_ID}/cancel`]: () => {
          cancelled = true;
          return json(ride({ status: 'cancelled', cancelledBy: 'rider', pin: null }));
        },
      });
      await renderWithApp(<LiveRideScreen />, await signedInSession());
      await screen.findByTestId('ride-status');
      // The terms come from the booking: wait for them before opening the dialog.
      await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(2));

      await fireEvent.press(screen.getByTestId('ride-cancel'));
      expect(
        screen.getByText(m.cars.rides.live.cancelFee.replace('{fee}', '₦500')),
      ).toBeOnTheScreen();
      await fireEvent.press(screen.getByTestId('ride-cancel-confirm'));
      expect(await screen.findByTestId('ride-status')).toHaveTextContent(
        m.cars.rides.live.status.cancelled,
      );
    });

    it('rates the driver after the trip', async () => {
      jest.mocked(useLocalSearchParams).mockReturnValue({ rideId: RIDE_ID });
      const { calls } = mockApi({
        [`GET /v1/rides/${RIDE_ID}`]: () =>
          json(ride({ status: 'completed', pin: null, completedAt: '2026-10-01T09:40:00Z' })),
        [`GET /v1/bookings/${BOOKING_ID}`]: () => json(rideBooking()),
        [`POST /v1/rides/${RIDE_ID}/rating`]: () => new Response(null, { status: 204 }),
      });
      await renderWithApp(<LiveRideScreen />, await signedInSession());
      await fireEvent.press(await screen.findByTestId('ride-stars-4'));
      await fireEvent.press(screen.getByTestId('ride-rate'));
      expect(await screen.findByTestId('ride-notice')).toHaveTextContent(m.cars.rides.live.rated);
      const rating = calls.find((request) => request.url.endsWith('/rating'));
      expect(await rating?.json()).toEqual({ stars: 4, comment: null });
      expect(screen.queryByTestId('ride-sos')).toBeNull();
    });
  });

  describe('car rental', () => {
    it('searches free cars for the period and opens one with the same dates', async () => {
      const { calls } = mockApi({
        'GET /v1/rentals/vehicles': () =>
          json({
            days: 2,
            vehicles: [
              {
                ...rentalVehicle,
                estimate: {
                  rental: { amountMinor: 7_000_000, currency: 'NGN' },
                  deposit: rentalVehicle.deposit,
                },
              },
            ],
          }),
      });
      await renderWithApp(<RentalSearchScreen />);
      await fireEvent.changeText(screen.getByTestId('rental-pickup'), '2026-11-05T10:00');
      await fireEvent.changeText(screen.getByTestId('rental-return'), '2026-11-07T10:00');
      await fireEvent.press(screen.getByTestId('rental-category-compact'));
      await fireEvent.press(screen.getByTestId('rental-search-submit'));

      const card = await screen.findByTestId(`rental-car-${rentalVehicle.slug}`);
      expect(card).toHaveTextContent(/₦70,000 for 2 days/);
      expect(card).toHaveTextContent(/Refundable deposit ₦100,000/);
      const search = new URL(calls[0]?.url ?? '');
      expect(Object.fromEntries(search.searchParams)).toEqual({
        pickupAt: '2026-11-05T10:00',
        returnAt: '2026-11-07T10:00',
        category: 'compact',
      });
      await fireEvent.press(card);
      expect(router.push).toHaveBeenCalledWith(
        `/rentals/${rentalVehicle.slug}?pickupAt=2026-11-05T10%3A00&returnAt=2026-11-07T10%3A00`,
      );
    });

    it('refuses a return before the pick-up without calling the API', async () => {
      const { calls } = mockApi({});
      await renderWithApp(<RentalSearchScreen />);
      await fireEvent.changeText(screen.getByTestId('rental-pickup'), '2026-11-07T10:00');
      await fireEvent.changeText(screen.getByTestId('rental-return'), '2026-11-05T10:00');
      await fireEvent.press(screen.getByTestId('rental-search-submit'));
      expect(screen.getByRole('alert')).toHaveTextContent(m.cars.rentals.book.errors.period);
      expect(calls).toHaveLength(0);
    });

    it('books the car for the chosen period with a chauffeur', async () => {
      jest.mocked(useLocalSearchParams).mockReturnValue({
        slug: rentalVehicle.slug,
        pickupAt: '2026-11-05T10:00',
        returnAt: '2026-11-07T10:00',
      });
      const { calls } = mockApi({
        [`GET /v1/rentals/vehicles/${rentalVehicle.slug}`]: () => json(rentalVehicle),
        'POST /v1/inhouse-quotes': () => json(quoteCreated, 201),
      });
      await renderWithApp(<RentalCarScreen />, await signedInSession());

      expect(await screen.findByTestId('book-pickup')).toHaveDisplayValue('2026-11-05T10:00');
      expect(screen.getByText(m.cars.rentals.detail.licenceNote)).toBeOnTheScreen();
      await fireEvent.press(screen.getByTestId('book-chauffeur'));
      await fireEvent.press(screen.getByTestId('book-rental'));

      await waitFor(() => expect(router.push).toHaveBeenCalledWith(`/checkout/${QUOTE_ID}`));
      const quote = calls.find((request) => request.url.endsWith('/v1/inhouse-quotes'));
      expect(await quote?.json()).toEqual({
        kind: 'rental',
        vehicleId: rentalVehicle.id,
        pickupAtLocal: '2026-11-05T10:00',
        returnAtLocal: '2026-11-07T10:00',
        chauffeur: true,
        delivery: null,
      });
    });

    it('takes the licence details, then the scan from the document picker', async () => {
      jest.mocked(useLocalSearchParams).mockReturnValue({ id: BOOKING_ID });
      const pickedUri = 'file:///data/cache/DocumentPicker/licence.png';
      writeFile(pickedUri, PNG);
      jest.mocked(getDocumentAsync).mockResolvedValueOnce({
        canceled: false,
        assets: [
          { uri: pickedUri, name: 'licence.png', mimeType: 'image/png', size: 8, lastModified: 0 },
        ],
      });
      let licence: Parameters<typeof rentalReservation>[0] = null;
      const reservation = `/v1/rentals/reservations/${RESERVATION_ID}`;
      const { calls } = mockApi({
        [`GET /v1/bookings/${BOOKING_ID}`]: () => json(rentalBooking()),
        [`GET ${reservation}`]: () => json(rentalReservation(licence)),
        [`PUT ${reservation}/licence`]: () => {
          licence = {
            status: 'pending_upload',
            expiresOn: '2029-03-31',
            numberEndsWith: 'B67',
            rejectionReason: null,
          };
          return json(rentalReservation(licence));
        },
        [`PUT ${reservation}/licence/document`]: () => {
          licence = { ...licence!, status: 'pending_review' };
          return json(rentalReservation(licence));
        },
      });
      await renderWithApp(<TripScreen />, await signedInSession());

      await fireEvent.changeText(await screen.findByTestId('licence-number'), 'lag12345ab67');
      await fireEvent.changeText(screen.getByTestId('licence-expiry'), '2029-03-31');
      await fireEvent.press(screen.getByTestId('licence-save'));
      expect(await screen.findByTestId('licence-status')).toHaveTextContent(
        m.booking.cars.rental.licence.states.pending_upload,
      );
      const saved = calls.find((request) => request.url.endsWith('/licence'));
      expect(await saved?.json()).toEqual({ number: 'lag12345ab67', expiresOn: '2029-03-31' });

      await fireEvent.press(screen.getByTestId('licence-upload'));
      await waitFor(() =>
        expect(screen.getByTestId('licence-status')).toHaveTextContent(
          m.booking.cars.rental.licence.states.pending_review,
        ),
      );
      const upload = calls.find((request) => request.url.endsWith('/licence/document'));
      expect(upload?.headers.get('Content-Type')).toBe('image/png');
      expect(await bodyBytes(upload)).toEqual(PNG);
      expect(new File(pickedUri).exists).toBe(false);
    });

    it('waits for the payment before asking for the licence', async () => {
      jest.mocked(useLocalSearchParams).mockReturnValue({ id: BOOKING_ID });
      await tripStore.addGuestTrip(BOOKING_ID, 'guest-token-abcdefghijklmnopqrstuvwxyz');
      mockApi({
        [`GET /v1/bookings/${BOOKING_ID}`]: () =>
          json(rentalBooking({ status: 'AWAITING_PAYMENT' })),
      });
      await renderWithApp(<TripScreen />);
      expect(await screen.findByText(m.booking.cars.rental.pending)).toBeOnTheScreen();
      expect(screen.queryByTestId('rental-licence')).toBeNull();
    });
  });
});
