import type { Schemas } from '@suskii/api-client';
import { getMessages } from '@suskii/i18n';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { router, useLocalSearchParams } from 'expo-router';

import { openHostedCheckout } from '../lib/payment';
import { activeTrip, quoteTripComponent, tripSearchPath } from '../lib/trip-builder';
import { json, mockApi, renderWithApp, signedInSession } from '../test/app';
import { flightQuote, hotelQuote, rentalQuote } from '../test/fixtures';

import { BuiltTripScreen } from './built-trip-screen';
import { TripPlanScreen } from './trip-plan-screen';

jest.mock('../config', () => ({
  appConfig: { apiBaseUrl: 'http://api.test', attestation: 'mock', playIntegrityProject: '' },
  CLIENT_ID: 'mobile-android/0.1.0',
}));
jest.mock('../lib/payment', () => ({
  ...jest.requireActual<object>('../lib/payment'),
  openHostedCheckout: jest.fn(() => Promise.resolve()),
}));

type Trip = Schemas['Trip'];
type Part = Trip['parts'][number];

const m = getMessages('en-NG');
const TRIP_ID = '0192d3a0-7c1e-7b2a-9f00-00000000d001';
const CITY_ID = '0192d3a0-7c1e-7b2a-9f00-00000000d002';
const FLIGHT_ID = '0192d3a0-7c1e-7b2a-9f00-00000000d003';
const HOTEL_ID = '0192d3a0-7c1e-7b2a-9f00-00000000d004';
const ADDON_ID = '0192d3a0-7c1e-7b2a-9f00-00000000d005';
const QUOTE_ID = '0192d3a0-7c1e-7b2a-9f00-00000000d006';
const CHECKOUT_URL = 'https://pay.example/checkout/trip';
const ngn = (amountMinor: number) => ({ amountMinor, currency: 'NGN' });

const PLAN: Trip['plan'] = {
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
    cityId: CITY_ID,
  },
  departDate: '2026-12-10',
  returnDate: '2026-12-17',
  adults: 2,
  children: 1,
  components: ['flight', 'hotel', 'car', 'transfer', 'insurance'],
};

function trip(patch: Partial<Trip> = {}): Trip {
  return {
    id: TRIP_ID,
    reference: 'T-AB12CD',
    createdAt: '2026-10-01T09:00:00.000Z',
    plan: PLAN,
    currency: 'NGN',
    state: 'empty',
    parts: [],
    missing: [...PLAN.components],
    total: ngn(0),
    due: ngn(0),
    payment: { providers: [], methods: [], open: null },
    ...patch,
  };
}

const flightPart = (patch: Partial<Part> = {}): Part => ({
  component: 'flight',
  state: 'to_pay',
  status: 'PRICED',
  booking: {
    id: FLIGHT_ID,
    reference: 'SK7Q2M',
    status: 'PRICED',
    vertical: 'flights',
    createdAt: '2026-10-01T09:05:00.000Z',
    total: ngn(95_000_000),
    startsOn: '2026-12-10',
    endsOn: '2026-12-17',
    flight: {
      tripType: 'round_trip',
      origin: { code: 'LOS', cityName: 'Lagos' },
      destination: { code: 'LHR', cityName: 'London' },
      airline: 'Mock Airways',
    },
    hotel: null,
    product: null,
  },
  due: ngn(95_000_000),
  priceChange: null,
  ...patch,
});

const hotelPart = (patch: Partial<Part> = {}): Part => ({
  component: 'hotel',
  state: 'to_pay',
  status: 'PRICED',
  booking: {
    id: HOTEL_ID,
    reference: 'SK8H3N',
    status: 'PRICED',
    vertical: 'hotels',
    createdAt: '2026-10-01T09:10:00.000Z',
    total: ngn(60_000_000),
    startsOn: '2026-12-10',
    endsOn: '2026-12-17',
    flight: null,
    hotel: { name: 'Paddington Court', cityName: 'London' },
    product: null,
  },
  due: ngn(60_000_000),
  priceChange: null,
  ...patch,
});

/** A trip with a flight and a hotel waiting to be paid. */
const twoParts = (patch: Partial<Trip> = {}): Trip =>
  trip({
    state: 'open',
    parts: [flightPart(), hotelPart()],
    missing: ['car', 'transfer', 'insurance'],
    total: ngn(155_000_000),
    due: ngn(155_000_000),
    ...patch,
  });

const airport = (code: string, name: string, cityName: string): Schemas['PlaceSuggestion'] => ({
  type: 'airport',
  code,
  name,
  cityId: null,
  cityName,
  countryCode: code === 'LHR' ? 'GB' : 'NG',
  countryName: code === 'LHR' ? 'United Kingdom' : 'Nigeria',
  timeZone: code === 'LHR' ? 'Europe/London' : 'Africa/Lagos',
});
const PLACES: Record<string, Schemas['PlaceSuggestion']> = {
  lagos: airport('LOS', 'Murtala Muhammed International Airport', 'Lagos'),
  london: airport('LHR', 'London Heathrow Airport', 'London'),
};
const places = (request: Request) => {
  const q = new URL(request.url).searchParams.get('q')?.toLowerCase() ?? '';
  const match = Object.entries(PLACES).find(([key]) => key.startsWith(q));
  return json({ items: match ? [match[1]] : [] });
};

async function pick(testID: string, text: string, code: string): Promise<void> {
  await fireEvent.changeText(screen.getByTestId(testID), text);
  await fireEvent.press(await screen.findByTestId(`${testID}-option-${code}`));
}

const features = () =>
  json({ buses: true, rides: true, rentals: true, bookingFee: null, features: {} });

afterEach(() => {
  activeTrip.set(null);
});

describe('trip builder helpers', () => {
  it('names the part of a trip a quote would be', () => {
    expect(quoteTripComponent(flightQuote())).toBe('flight');
    expect(quoteTripComponent(hotelQuote())).toBe('hotel');
    expect(quoteTripComponent(rentalQuote())).toBe('car');
    expect(quoteTripComponent({ vertical: 'travel_addons', addon: { type: 'insurance' } })).toBe(
      'insurance',
    );
    expect(
      quoteTripComponent({ vertical: 'travel_addons', addon: { type: 'airport_transfer' } }),
    ).toBe('transfer');
    expect(quoteTripComponent({ vertical: 'travel_addons', addon: { type: 'esim' } })).toBeNull();
    expect(quoteTripComponent({ vertical: 'tours' })).toBeNull();
  });

  it('opens the search screen of a part with the plan filled in', () => {
    expect(tripSearchPath(PLAN, 'flight')).toBe(
      '/search/flights?trip=round_trip&from=LOS&to=LHR&depart=2026-12-10&return=2026-12-17&adults=2&children=1',
    );
    expect(tripSearchPath(PLAN, 'hotel')).toBe(
      `/search/hotels?dest=${CITY_ID}&checkin=2026-12-10&checkout=2026-12-17&room=2`,
    );
    expect(tripSearchPath(PLAN, 'car')).toBe(
      '/rentals?city=London&pickupAt=2026-12-10T10%3A00&returnAt=2026-12-17T10%3A00',
    );
    const noCity = { ...PLAN, destination: { ...PLAN.destination, cityId: null } };
    expect(tripSearchPath(noCity, 'hotel')).toBeNull();
  });
});

describe('TripPlanScreen', () => {
  it('asks a visitor to sign in: a trip belongs to an account', async () => {
    mockApi({});
    await renderWithApp(<TripPlanScreen />);
    expect(await screen.findByTestId('account-required')).toBeOnTheScreen();
    expect(screen.queryByTestId('trip-plan')).toBeNull();
  });

  it('takes the plan with only the parts wanted and opens the new trip', async () => {
    const { calls } = mockApi({
      'GET /v1/cars/features': features,
      'GET /v1/me/trips': () => json({ trips: [twoParts()] }),
      'GET /v1/catalog/places': places,
      'GET /v1/catalog/airports/LHR': () => json({ code: 'LHR', cityId: CITY_ID }),
      'POST /v1/trips': () => json(trip(), 201),
    });
    await renderWithApp(<TripPlanScreen />, await signedInSession());
    expect(await screen.findByTestId('trip-plan')).toBeOnTheScreen();
    // The trips already started are listed with their state and total.
    const card = await screen.findByTestId('built-trip-card');
    expect(card).toHaveTextContent(/Lagos to London/);
    expect(card).toHaveTextContent(/2 parts added/);
    expect(card).toHaveTextContent(/1,550,000/);

    // Nothing is sent before the plan is complete.
    await fireEvent.press(screen.getByTestId('plan-submit'));
    expect(await screen.findByText(m.trips.plan.errors.origin)).toBeOnTheScreen();
    expect(calls.some((request) => request.method === 'POST')).toBe(false);

    await pick('plan-from', 'Lagos', 'LOS');
    await pick('plan-to', 'London', 'LHR');
    // Every part is wanted to start with; this traveller needs no car and no insurance.
    for (const part of ['flight', 'hotel', 'car', 'transfer', 'insurance']) {
      expect(screen.getByTestId(`plan-part-${part}`)).toBeChecked();
    }
    await fireEvent.press(screen.getByTestId('plan-part-car'));
    await fireEvent.press(screen.getByTestId('plan-part-insurance'));
    await fireEvent.press(screen.getByLabelText(m.trips.plan.addAdult));
    await fireEvent.press(screen.getByTestId('plan-submit'));

    await waitFor(() => expect(router.push).toHaveBeenCalledWith(`/trips/built/${TRIP_ID}`));
    const create = calls.find(
      (request) => request.method === 'POST' && request.url.endsWith('/v1/trips'),
    );
    expect(await create?.json()).toMatchObject({
      currency: 'NGN',
      plan: {
        origin: { code: 'LOS', cityName: 'Lagos', countryCode: 'NG' },
        // The destination's catalog city comes from the airport, for the hotel search.
        destination: { code: 'LHR', cityName: 'London', countryCode: 'GB', cityId: CITY_ID },
        adults: 2,
        children: 0,
        components: ['flight', 'hotel', 'transfer'],
      },
    });
  });

  it('says why when the account already has ten unpaid trips', async () => {
    mockApi({
      'GET /v1/cars/features': features,
      'GET /v1/me/trips': () => json({ trips: [] }),
      'GET /v1/catalog/places': places,
      'GET /v1/catalog/airports/LHR': () => json({ code: 'LHR', cityId: CITY_ID }),
      'POST /v1/trips': () =>
        json({ type: 'urn:suskii:problem:too-many-trips', title: 'Too many', status: 409 }, 409),
    });
    await renderWithApp(<TripPlanScreen />, await signedInSession());
    await screen.findByTestId('trip-plan');
    await pick('plan-from', 'Lagos', 'LOS');
    await pick('plan-to', 'London', 'LHR');
    await fireEvent.press(screen.getByTestId('plan-submit'));
    expect(await screen.findByText(m.trips.plan.errors.tooMany)).toBeOnTheScreen();
    expect(router.push).not.toHaveBeenCalled();
  });
});

describe('BuiltTripScreen', () => {
  beforeEach(() => {
    jest.mocked(useLocalSearchParams).mockReturnValue({ tripId: TRIP_ID });
  });

  it('shows a price for each part and one total, and sends the traveller to choose the rest', async () => {
    const { calls } = mockApi({
      [`GET /v1/trips/${TRIP_ID}`]: () => json(twoParts()),
      'GET /v1/addons': () =>
        json({
          addons: [
            {
              id: ADDON_ID,
              slug: 'sample-travel-insurance',
              type: 'insurance',
              title: 'Travel insurance (sample)',
              summary: 'Medical and trip cover.',
              pricingBasis: 'per_person_per_day',
              unitPrice: ngn(150_000),
              sample: true,
              countryCodes: [],
              maxTravellers: null,
              requiredDetails: ['dates_of_birth'],
            },
          ],
        }),
      'POST /v1/inhouse-quotes': () => json({ quoteId: QUOTE_ID }, 201),
    });
    await renderWithApp(<BuiltTripScreen />, await signedInSession());

    expect(await screen.findByTestId('built-trip')).toBeOnTheScreen();
    expect(screen.getByText('Lagos to London')).toBeOnTheScreen();
    expect(screen.getByTestId('built-trip-state')).toHaveTextContent(
      new RegExp(m.trips.states.open),
    );
    expect(screen.getByTestId('trip-price-flight')).toHaveTextContent(/950,000/);
    expect(screen.getByTestId('trip-price-hotel')).toHaveTextContent(/600,000/);
    expect(screen.getByTestId('trip-total')).toHaveTextContent(/1,550,000/);
    expect(screen.getByTestId('trip-part-flight')).toHaveTextContent(
      /Lagos to London, Mock Airways/,
    );
    expect(screen.getByTestId('trip-part-hotel')).toHaveTextContent(/Paddington Court, London/);
    // The parts not chosen yet say so, each with its way in.
    expect(screen.getByTestId('trip-part-car')).toHaveTextContent(
      new RegExp(m.trips.page.notAdded),
    );
    expect(screen.queryByTestId('trip-choose-flight')).toBeNull();

    // The car: the ordinary rental search for the destination and the trip's days.
    await fireEvent.press(screen.getByTestId('trip-choose-car'));
    expect(router.push).toHaveBeenCalledWith(
      '/rentals?city=London&pickupAt=2026-12-10T10%3A00&returnAt=2026-12-17T10%3A00',
    );
    expect(activeTrip.get()).toEqual({ id: TRIP_ID, reference: 'T-AB12CD', component: 'car' });

    // Insurance: the add-ons on sale there, quoted for the trip's dates and travellers.
    await fireEvent.press(screen.getByTestId('trip-choose-insurance'));
    await fireEvent.press(await screen.findByTestId('trip-addon-sample-travel-insurance'));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith(`/checkout/${QUOTE_ID}`));
    expect(activeTrip.get()).toMatchObject({ component: 'insurance' });
    const list = calls.find((request) => new URL(request.url).pathname === '/v1/addons');
    expect(Object.fromEntries(new URL(list?.url ?? '').searchParams)).toMatchObject({
      type: 'insurance',
      cityId: CITY_ID,
    });
    const quote = calls.find((request) => request.url.endsWith('/v1/inhouse-quotes'));
    expect(await quote?.json()).toMatchObject({
      kind: 'addon',
      addonId: ADDON_ID,
      startDate: '2026-12-10',
      endDate: '2026-12-17',
      travellers: { adults: 2, children: 1, infants: 0 },
      linkToken: null,
    });
  });

  it('pays for every part with one hosted checkout', async () => {
    const { calls } = mockApi({
      [`GET /v1/trips/${TRIP_ID}`]: () => json(twoParts()),
      'POST /v1/attestation/challenges': () =>
        json({ challenge: 'challenge-1', expiresAt: '2026-10-01T09:05:00.000Z' }, 201),
      [`POST /v1/trips/${TRIP_ID}/payments`]: () =>
        json(
          {
            paymentId: '0192d3a0-7c1e-7b2a-9f00-00000000d0a1',
            status: 'pending',
            checkoutUrl: CHECKOUT_URL,
            amount: ngn(155_000_000),
            parts: 2,
            expiresAt: '2026-10-01T10:00:00.000Z',
          },
          201,
        ),
    });
    await renderWithApp(<BuiltTripScreen />, await signedInSession());
    const pay = await screen.findByTestId('trip-pay');
    expect(pay).toHaveTextContent(/Pay .*1,550,000/);
    await fireEvent.press(pay);

    await waitFor(() => expect(openHostedCheckout).toHaveBeenCalledWith(CHECKOUT_URL));
    const started = calls.find((request) => request.url.endsWith('/payments'));
    expect(started?.headers.get('Idempotency-Key')).toMatch(/^[0-9a-f-]{36}$/);
    expect(started?.headers.get('X-Suskii-Attestation')).toBeTruthy();
    // Back from the provider's page the trip is read again: the webhook decides the outcome.
    await waitFor(() =>
      expect(calls.filter((request) => request.method === 'GET').length).toBeGreaterThan(1),
    );
  });

  it('asks for consent to a changed price, then removes a part the traveller drops', async () => {
    const changed = flightPart({
      priceChange: {
        previous: ngn(95_000_000),
        current: ngn(99_000_000),
        difference: ngn(4_000_000),
        price: flightQuote().flight?.offer.price as NonNullable<Part['priceChange']>['price'],
      },
    });
    let current = twoParts({ parts: [changed, hotelPart()] });
    const { calls } = mockApi({
      [`GET /v1/trips/${TRIP_ID}`]: () => json(current),
      [`POST /v1/bookings/${FLIGHT_ID}/price-consent`]: () => {
        current = twoParts();
        return json({ id: FLIGHT_ID });
      },
      [`DELETE /v1/trips/${TRIP_ID}/parts/${HOTEL_ID}`]: () => {
        current = twoParts({ parts: [flightPart()], total: ngn(95_000_000), due: ngn(95_000_000) });
        return json(current);
      },
    });
    await renderWithApp(<BuiltTripScreen />, await signedInSession());
    expect(
      await screen.findByText(/The price changed from .*950,000.* to .*990,000/),
    ).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('trip-accept-flight'));
    await waitFor(() => expect(screen.queryByTestId('trip-accept-flight')).toBeNull());
    const consent = calls.find((request) => request.url.endsWith('/price-consent'));
    expect(await consent?.json()).toEqual({ total: ngn(99_000_000) });

    await fireEvent.press(screen.getByTestId('trip-remove-hotel'));
    await waitFor(() =>
      expect(screen.getByTestId('trip-part-hotel')).toHaveTextContent(
        new RegExp(m.trips.page.notAdded),
      ),
    );
    expect(screen.getByTestId('trip-total')).toHaveTextContent(/950,000/);
  });

  it('shows a paid trip with nothing left to pay or delete', async () => {
    mockApi({
      [`GET /v1/trips/${TRIP_ID}`]: () =>
        json(
          twoParts({
            state: 'paid',
            parts: [
              flightPart({ state: 'confirmed', status: 'CONFIRMED', due: ngn(0) }),
              hotelPart({ state: 'confirmed', status: 'CONFIRMED', due: ngn(0) }),
            ],
            due: ngn(0),
          }),
        ),
    });
    await renderWithApp(<BuiltTripScreen />, await signedInSession());
    expect(await screen.findByTestId('built-trip-paid')).toBeOnTheScreen();
    expect(screen.queryByTestId('trip-pay')).toBeNull();
    expect(screen.queryByTestId('trip-delete')).toBeNull();
    expect(screen.queryByTestId('trip-remove-flight')).toBeNull();
    // Each part is an ordinary booking with its own screen.
    await fireEvent.press(screen.getByTestId('trip-view-flight'));
    expect(router.push).toHaveBeenCalledWith(`/trips/${FLIGHT_ID}`);
  });

  it('deletes an unpaid trip after asking, and says so when the trip is not there', async () => {
    let gone = false;
    mockApi({
      [`GET /v1/trips/${TRIP_ID}`]: () => (gone ? json({ status: 404 }, 404) : json(trip())),
      [`DELETE /v1/trips/${TRIP_ID}`]: () => {
        gone = true;
        return new Response(null, { status: 204 });
      },
    });
    await renderWithApp(<BuiltTripScreen />, await signedInSession());
    await fireEvent.press(await screen.findByTestId('trip-delete'));
    expect(screen.getByText(m.trips.page.deleteConfirm)).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('trip-delete-yes'));
    await waitFor(() => expect(router.back).toHaveBeenCalled());
  });
});
