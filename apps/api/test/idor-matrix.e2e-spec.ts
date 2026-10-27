import { addDays, BOOKING_TERMS_VERSION, localDate } from '@suskii/shared';

import { committedOpenApi, staffSession, type HttpMethod } from './helpers/admin';
import { bearer, signUp, type TokenSession } from './helpers/flows';
import { localIn, paidRental, PNG, rentalVehicle } from './helpers/rentals';
import { requestRide, rideCatalog } from './helpers/rides';
import { createTestApp, resetState, type TestContext } from './helpers/test-app';

/**
 * IDOR matrix (phase 11, ASVS V8.2.2): every customer operation with a path parameter on an owned
 * resource (bookings and everything under them, saved travellers, price alerts, sessions) comes
 * from the committed OpenAPI document. Each one is called with the owner's ids by another account,
 * by that account's own booking token and anonymously. All answer 404, except that `/v1/me`
 * routes answer 401 without a session. The owner's data is unchanged afterwards.
 *
 * Every operation with a path parameter must be either a case below or in NOT_OWNED with the
 * reason, so a new route fails this test until someone decides which it is.
 */

const today = localDate(new Date(), 'Africa/Lagos');
const inDays = (days: number): string => addDays(today, days);
let keySequence = 0;
const idempotencyKey = (): string => `e2e-idor-${Date.now()}-${(keySequence += 1)}`;
const PDF = Buffer.from('%PDF-1.7\n% IDOR-MATRIX\n%%EOF\n');

/** Path-parameter operations that do not address a resource someone owns. */
const NOT_OWNED: Record<string, string> = {
  getAddon: 'published catalog, by slug',
  getAirport: 'reference data',
  getCity: 'reference data',
  getContentPage: 'published CMS page',
  getDealRoute: 'published deal',
  getHotelDestination: 'published destination',
  getPackage: 'published catalog, by slug',
  getTour: 'published catalog, by slug',
  getVisaProduct: 'published catalog, by slug',
  getFlightOffer: 'search result in Redis; ids embed a fresh random search id and expire (410)',
  listFlightOffers: 'search results in Redis under an unguessable search id',
  quoteFlightOffer: 'creates a new quote from a search result; prices only',
  getHotel: 'search result in Redis under an unguessable search id',
  listHotels: 'search results in Redis under an unguessable search id',
  quoteHotelRate: 'creates a new quote from a search result; prices only',
  getQuote: 'an anonymous price quote (UUIDv7 with 74 random bits); no personal data',
  getMockPayment: 'mock provider page (refused in production); the reference is random',
  completeMockPayment: 'mock provider; completes through the signed webhook path',
  receivePaymentWebhook: 'provider callback, authenticated by its signature',
  getVisaDocumentContent: 'served only with a short-lived signed link (visa.e2e-spec.ts)',
  getBusTrip: 'published departure and its seat map (no personal data)',
  createBusHold:
    'creates a new seat hold on a published departure; holds are tested as releaseBusHold',
  getBusManifest:
    "operator agents only (403 for everyone else); other operators' agents get 404 (buses.e2e-spec.ts)",
  getSharedRide:
    'public live-trip link addressed by a 128-bit token, no rider data (rides.e2e-spec.ts)',
  uploadDriverDocument:
    "the document kind; always the caller's own driver profile (drivers.e2e-spec.ts)",
  activateDriverVehicle:
    "the caller's own vehicles only; another applicant's vehicle answers 404 (drivers.e2e-spec.ts)",
  acceptRideOffer:
    "drivers only (403 otherwise); another driver's offer answers 404 (rides.e2e-spec.ts)",
  declineRideOffer:
    "drivers only (403 otherwise); another driver's offer answers 404 (rides.e2e-spec.ts)",
  arriveForRide:
    "drivers only (403 otherwise); another driver's ride answers 404 (rides.e2e-spec.ts)",
  startRide: "drivers only (403 otherwise); another driver's ride answers 404 (rides.e2e-spec.ts)",
  completeRide:
    "drivers only (403 otherwise); another driver's ride answers 404 (rides.e2e-spec.ts)",
  handBackRide:
    "drivers only (403 otherwise); another driver's ride answers 404 (rides.e2e-spec.ts)",
  getRentalVehicle: 'published fleet, by slug',
  getRentalAvailability: 'blocked periods of a published car, with no booking data',
  followPartnerLink:
    'a sealed (AES-GCM) offer link the API issued; leads only to the partner (partners.e2e-spec.ts)',
  partnerPostbackGet: "affiliate network callback, authenticated by the network's secret",
  partnerPostback: "affiliate network callback, authenticated by the network's secret",
};

/** Owned resources that only accounts can have: anonymous callers get 401, as on `/v1/me`. */
const ACCOUNT_ONLY = /^\/v1\/(me|rides|rentals\/reservations)\//;

interface Fixture {
  flightBookingId: string;
  scheduleChangeId: string;
  bookingDocumentId: string;
  visaBookingId: string;
  applicationId: string;
  visaDocumentId: string;
  travellerId: string;
  priceAlertId: string;
  sessionId: string;
  deviceCredentialId: string;
  busHoldId: string;
  rideId: string;
  /** A Lagos ride place, where the flight leaves from (departure planner). */
  ridePlaceId: string;
  reservationId: string;
}

interface Case {
  /** Request path with the owner's ids. */
  path: (f: Fixture) => string;
  body?: (f: Fixture) => unknown;
  headers?: Record<string, string>;
  /** Raw request body (uploads). */
  raw?: { contentType: string; bytes: Buffer };
  /** Query string, kept out of `path` so the path still matches the operation's template. */
  query?: (f: Fixture) => Record<string, string>;
}

const CASES: Record<string, Case> = {
  getBooking: { path: (f) => `/v1/bookings/${f.flightBookingId}` },
  getDeparturePlan: {
    path: (f) => `/v1/bookings/${f.flightBookingId}/departure-plan`,
    query: (f) => ({ from: f.ridePlaceId }),
  },
  getCarsSuggestions: { path: (f) => `/v1/bookings/${f.flightBookingId}/cars-suggestions` },
  getBookingPartnerOffers: { path: (f) => `/v1/bookings/${f.flightBookingId}/partner-offers` },
  cancelBooking: { path: (f) => `/v1/bookings/${f.flightBookingId}/cancel` },
  quoteFlightCancellation: {
    path: (f) => `/v1/bookings/${f.flightBookingId}/cancellation-quote`,
  },
  acceptScheduleChange: {
    path: (f) => `/v1/bookings/${f.flightBookingId}/schedule-changes/${f.scheduleChangeId}/accept`,
  },
  downloadBookingDocument: {
    path: (f) => `/v1/bookings/${f.flightBookingId}/documents/${f.bookingDocumentId}`,
  },
  holdBooking: { path: (f) => `/v1/bookings/${f.flightBookingId}/hold`, headers: {} },
  createInstallmentPlan: { path: (f) => `/v1/bookings/${f.flightBookingId}/installment-plan` },
  startBookingPayment: {
    path: (f) => `/v1/bookings/${f.flightBookingId}/payments`,
    body: () => ({}),
  },
  consentToBookingPrice: {
    path: (f) => `/v1/bookings/${f.flightBookingId}/price-consent`,
    body: () => ({ total: { amountMinor: 100, currency: 'NGN' } }),
  },
  registerBookingPushToken: {
    path: (f) => `/v1/bookings/${f.flightBookingId}/push-token`,
    body: () => ({ token: 'ExponentPushToken[idor-intruder-01]', platform: 'android' }),
  },
  getVisaApplication: {
    path: (f) => `/v1/bookings/${f.visaBookingId}/visa-applications/${f.applicationId}`,
  },
  uploadVisaDocument: {
    path: (f) =>
      `/v1/bookings/${f.visaBookingId}/visa-applications/${f.applicationId}/documents/photo`,
    headers: { 'X-File-Name': 'intruder.pdf' },
    raw: { contentType: 'application/pdf', bytes: PDF },
  },
  createVisaDocumentLink: {
    path: (f) =>
      `/v1/bookings/${f.visaBookingId}/visa-applications/${f.applicationId}/documents/${f.visaDocumentId}/link`,
  },
  submitVisaApplication: {
    path: (f) => `/v1/bookings/${f.visaBookingId}/visa-applications/${f.applicationId}/submit`,
  },
  updateTraveller: {
    path: (f) => `/v1/me/travellers/${f.travellerId}`,
    body: () => ({
      title: 'mr',
      gender: 'm',
      givenNames: 'Intruder',
      surname: 'Changed',
      dateOfBirth: '1990-01-01',
      nationality: 'NG',
    }),
  },
  deleteTraveller: { path: (f) => `/v1/me/travellers/${f.travellerId}` },
  deletePriceAlert: { path: (f) => `/v1/me/price-alerts/${f.priceAlertId}` },
  revokeSession: { path: (f) => `/v1/me/sessions/${f.sessionId}` },
  revokeDeviceCredential: { path: (f) => `/v1/me/device-credentials/${f.deviceCredentialId}` },
  releaseBusHold: { path: (f) => `/v1/buses/holds/${f.busHoldId}` },
  getRide: { path: (f) => `/v1/rides/${f.rideId}` },
  cancelRide: { path: (f) => `/v1/rides/${f.rideId}/cancel` },
  rateRide: {
    path: (f) => `/v1/rides/${f.rideId}/rating`,
    body: () => ({ stars: 1, comment: null }),
  },
  shareRide: { path: (f) => `/v1/rides/${f.rideId}/share` },
  revokeRideShare: { path: (f) => `/v1/rides/${f.rideId}/share` },
  raiseRideSos: { path: (f) => `/v1/rides/${f.rideId}/sos`, body: () => ({}) },
  getRentalReservation: { path: (f) => `/v1/rentals/reservations/${f.reservationId}` },
  submitRentalLicence: {
    path: (f) => `/v1/rentals/reservations/${f.reservationId}/licence`,
    body: () => ({ number: 'LAGINTRUDER1', expiresOn: '2031-01-31' }),
  },
  uploadRentalLicence: {
    path: (f) => `/v1/rentals/reservations/${f.reservationId}/licence/document`,
    raw: { contentType: 'image/png', bytes: PNG },
  },
};

interface Operation {
  method: HttpMethod;
  path: string;
  operationId: string;
  idempotent: boolean;
}

/** Customer operations with a path parameter (admin and internal routes have their own suites). */
function pathParameterOperations(): Operation[] {
  const document = committedOpenApi();
  const operations: Operation[] = [];
  for (const [path, item] of Object.entries(document.paths)) {
    if (!path.includes('{') || /^\/v1\/(admin|internal)\//.test(path)) continue;
    for (const [method, operation] of Object.entries(item) as [HttpMethod, unknown][]) {
      const op = operation as {
        operationId?: string;
        parameters?: { name?: string; in?: string }[];
      };
      if (!op.operationId) continue;
      const idempotent = (op.parameters ?? []).some(
        (parameter) => parameter.in === 'header' && parameter.name === 'Idempotency-Key',
      );
      operations.push({ method, path, operationId: op.operationId, idempotent });
    }
  }
  return operations;
}

describe('IDOR matrix (e2e): other people’s resources answer 404', () => {
  let ctx: TestContext;
  let owner: TokenSession;
  let intruder: TokenSession;
  let intruderBookingToken: string;
  let fixture: Fixture;

  beforeAll(async () => {
    ctx = await createTestApp({ RATE_LIMIT_ENABLED: false });
    await resetState(ctx);
    owner = await signUp(ctx, 'idor-owner@example.com');
    intruder = await signUp(ctx, 'idor-intruder@example.com');
    fixture = await ownerResources();
    // The intruder's own guest booking gives them a valid token for a different booking.
    intruderBookingToken = (await createFlightBooking(null)).token;
  });
  afterAll(async () => {
    await ctx.close();
  });

  async function flightQuote(): Promise<string> {
    const search = await ctx
      .http()
      .post('/v1/flights/searches')
      .send({
        slices: [{ origin: 'LOS', destination: 'ABV', departureDate: inDays(30) }],
        passengers: { adults: 1, children: 0, infants: 0 },
        cabinClass: 'economy',
      })
      .expect(200);
    const quoted = await ctx
      .http()
      .post(`/v1/flights/offers/${search.body.offers[0].id as string}/quote`)
      .expect(201);
    return quoted.body.quoteId as string;
  }

  /** A flight booking for the account (or a guest when `session` is null). */
  async function createFlightBooking(
    session: TokenSession | null,
  ): Promise<{ bookingId: string; token: string }> {
    const quoteId = await flightQuote();
    const request = ctx.http().post('/v1/bookings').set('Idempotency-Key', idempotencyKey());
    if (session) request.set(bearer(session.accessToken));
    const created = await request
      .send({
        quoteId,
        contact: { email: 'traveller@example.com', phone: '+2348012345678' },
        passengers: [
          {
            type: 'adult',
            title: 'mr',
            gender: 'm',
            givenNames: 'Tunde',
            surname: 'Bello',
            dateOfBirth: '1987-03-12',
            nationality: 'NG',
            document: { number: 'C7654321', issuingCountry: 'NG', expiryDate: inDays(3650) },
          },
        ],
        termsVersion: BOOKING_TERMS_VERSION,
        acceptTerms: true,
        turnstileToken: 'e2e-turnstile',
      })
      .expect(201);
    return {
      bookingId: created.body.booking.id as string,
      token: created.body.accessToken as string,
    };
  }

  async function pay(bookingId: string): Promise<void> {
    const payment = await ctx
      .http()
      .post(`/v1/bookings/${bookingId}/payments`)
      .set(bearer(owner.accessToken))
      .set('Idempotency-Key', idempotencyKey())
      .send({})
      .expect(201);
    const reference = (payment.body.checkoutUrl as string).split('/').pop() ?? '';
    await ctx
      .http()
      .post(`/v1/payments/mock/${reference}/complete`)
      .send({ outcome: 'succeeded' })
      .expect(200);
    await ctx.background.drain();
  }

  async function ownerResources(): Promise<Fixture> {
    const auth = bearer(owner.accessToken);
    const flight = await createFlightBooking(owner);
    await pay(flight.bookingId);
    const flightBooking = await ctx
      .http()
      .get(`/v1/bookings/${flight.bookingId}`)
      .set(auth)
      .expect(200);

    // A published visa product, then a paid visa assistance booking with one upload.
    const catalog = await staffSession(ctx, 'idor-catalog@suskii.test', ['content_manager']);
    const product = await ctx
      .http()
      .post('/v1/admin/visa-products')
      .set(bearer(catalog.accessToken))
      .send({
        slug: 'idor-uk-visitor',
        title: 'UK visitor visa assistance',
        summary: 'We check and submit your application.',
        destination: 'GB',
        purposes: ['tourism'],
        processingDaysMin: 15,
        processingDaysMax: 30,
        price: { amountMinor: 8_000_000, currency: 'NGN' },
        checklist: [
          { key: 'passport', label: 'Passport', description: 'Bio page', required: true },
          { key: 'photo', label: 'Photo', description: 'Plain background', required: true },
        ],
      })
      .expect(201);
    await ctx
      .http()
      .patch(`/v1/admin/visa-products/${product.body.id as string}`)
      .set(bearer(catalog.accessToken))
      .send({ status: 'published' })
      .expect(204);
    const quote = await ctx
      .http()
      .post('/v1/inhouse-quotes')
      .send({
        kind: 'visa',
        productId: product.body.id,
        purpose: 'tourism',
        nationality: 'NG',
        travelDate: inDays(60),
        travellers: { adults: 1, children: 0, infants: 0 },
      })
      .expect(201);
    const visa = await ctx
      .http()
      .post('/v1/bookings')
      .set(auth)
      .set('Idempotency-Key', idempotencyKey())
      .send({
        quoteId: quote.body.quoteId,
        contact: { email: 'applicant@example.com', phone: '+2348012345678' },
        passengers: [
          {
            type: 'adult',
            title: 'mr',
            gender: 'm',
            givenNames: 'Chinedu',
            surname: 'Okoro',
            dateOfBirth: '1988-06-15',
            nationality: 'NG',
            document: { number: 'A1234567', issuingCountry: 'NG', expiryDate: inDays(3000) },
          },
        ],
        termsVersion: BOOKING_TERMS_VERSION,
        acceptTerms: true,
      })
      .expect(201);
    const visaBookingId = visa.body.booking.id as string;
    await pay(visaBookingId);
    const visaBooking = await ctx.http().get(`/v1/bookings/${visaBookingId}`).set(auth).expect(200);
    const applicationId = visaBooking.body.visa.applications[0].id as string;
    const uploaded = await ctx
      .http()
      .put(`/v1/bookings/${visaBookingId}/visa-applications/${applicationId}/documents/passport`)
      .set(auth)
      .set('Content-Type', 'application/pdf')
      .set('X-File-Name', 'passport.pdf')
      .send(PDF)
      .expect(200);
    const passport = (
      uploaded.body.checklist as { key: string; document: { id: string } | null }[]
    ).find((item) => item.key === 'passport');

    const traveller = await ctx
      .http()
      .post('/v1/me/travellers')
      .set(auth)
      .send({
        title: 'ms',
        gender: 'f',
        givenNames: 'Ngozi',
        surname: 'Eze',
        dateOfBirth: '1990-04-02',
        nationality: 'NG',
      })
      .expect(201);
    const credential = await ctx
      .http()
      .post('/v1/me/device-credentials')
      .set(auth)
      .send({ label: 'Pixel 9' })
      .expect(201);
    const alert = await ctx
      .http()
      .post('/v1/me/price-alerts')
      .set(auth)
      .send({ origin: 'LOS', destination: 'DXB', departureDate: inDays(40), currency: 'NGN' })
      .expect(201);

    // A bus seat hold, on a departure created straight in the database.
    const operator = await ctx.prisma.busOperator.create({
      data: {
        slug: 'idor-coaches',
        name: 'IDOR Coaches',
        status: 'published',
        cancellationPolicy: [],
      },
    });
    const terminal = (slug: string) =>
      ctx.prisma.busTerminal.create({
        data: {
          slug,
          name: slug,
          cityName: slug,
          stateName: 'Lagos',
          countryCode: 'NG',
          address: 'Road',
          lat: 6.5,
          lng: 3.4,
          timeZone: 'Africa/Lagos',
        },
      });
    const route = await ctx.prisma.busRoute.create({
      data: {
        operatorId: operator.id,
        originId: (await terminal('idor-from')).id,
        destinationId: (await terminal('idor-to')).id,
        distanceKm: 100,
        durationMinutes: 120,
      },
    });
    const layout = await ctx.prisma.busLayout.create({
      data: {
        operatorId: operator.id,
        name: 'Two',
        layout: { rows: [['1A', '1B']] },
        seatCount: 2,
      },
    });
    const departsAt = new Date(Date.now() + 3 * 86_400_000);
    const trip = await ctx.prisma.busTrip.create({
      data: {
        routeId: route.id,
        layoutId: layout.id,
        departsAt,
        departsAtLocal: `${inDays(3)}T07:00`,
        arrivesAt: new Date(departsAt.getTime() + 7_200_000),
        fareMinor: 500_000n,
        currency: 'NGN',
      },
    });
    const hold = await ctx
      .http()
      .post(`/v1/buses/trips/${trip.id}/holds`)
      .set(auth)
      .send({ seats: ['1A'] })
      .expect(201);

    // A paid ride, through the admin catalog and the booking pipeline.
    const staff = await staffSession(ctx, 'idor-rides@suskii.test', ['operations']);
    await rideCatalog(ctx, bearer(staff.accessToken));
    const { rideId } = await requestRide(ctx, auth);
    const places = await ctx.http().get('/v1/rides/places').expect(200);
    const ridePlace = (places.body.places as { id: string; name: string }[]).find(
      (place) => place.name === 'Eko Hotel',
    );
    // A paid self-drive rental.
    const car = await rentalVehicle(ctx, bearer(staff.accessToken));
    const { reservationId } = await paidRental(ctx, auth, {
      vehicleId: car.id,
      pickupAtLocal: localIn(5),
      returnAtLocal: localIn(29),
    });

    // An airline schedule change waiting for the owner (ADR-065), stored as the sweep would.
    const flightItem = await ctx.prisma.bookingItem.findFirstOrThrow({
      where: { bookingId: flight.bookingId },
    });
    const scheduleChange = await ctx.prisma.flightScheduleChange.create({
      data: {
        bookingId: flight.bookingId,
        bookingItemId: flightItem.id,
        supplier: 'mock',
        supplierChangeId: 'idor-change',
        removed: [],
        added: [],
        acceptable: true,
        changedAt: new Date(),
      },
    });

    return {
      rideId,
      ridePlaceId: ridePlace?.id ?? '',
      scheduleChangeId: scheduleChange.id,
      reservationId,
      busHoldId: hold.body.holdId as string,
      flightBookingId: flight.bookingId,
      bookingDocumentId: flightBooking.body.documents[0].id as string,
      visaBookingId,
      applicationId,
      visaDocumentId: passport?.document?.id ?? '',
      travellerId: traveller.body.id as string,
      priceAlertId: alert.body.id as string,
      sessionId: owner.sessionId,
      deviceCredentialId: credential.body.credentialId as string,
    };
  }

  function call(operation: Operation, testCase: Case, headers: Record<string, string>) {
    let request = ctx.http()[operation.method](testCase.path(fixture)).set(headers);
    if (testCase.headers) request = request.set(testCase.headers);
    if (testCase.query) request = request.query(testCase.query(fixture));
    if (operation.idempotent) request = request.set('Idempotency-Key', idempotencyKey());
    if (testCase.raw) {
      return request.set('Content-Type', testCase.raw.contentType).send(testCase.raw.bytes);
    }
    const body = testCase.body?.(fixture);
    return body === undefined ? request : request.send(body as object);
  }

  it('classifies every operation with a path parameter', () => {
    const unclassified = pathParameterOperations()
      .map((operation) => operation.operationId)
      .filter((id) => !(id in CASES) && !(id in NOT_OWNED));
    expect(unclassified).toEqual([]);
    const stale = [...Object.keys(CASES), ...Object.keys(NOT_OWNED)].filter(
      (id) => !pathParameterOperations().some((operation) => operation.operationId === id),
    );
    expect(stale).toEqual([]);
  });

  it('answers 404 to another account, another booking’s token and anonymous callers', async () => {
    const owned = pathParameterOperations().filter((operation) => operation.operationId in CASES);
    const outcomes: string[] = [];
    for (const operation of owned) {
      const testCase = CASES[operation.operationId]!;
      const account = ACCOUNT_ONLY.test(operation.path);
      // A typo would also answer 404 (no such route): the path must fit the operation's template,
      // and the owner must be able to read it.
      const template = new RegExp(`^${operation.path.replace(/\{[^}]+\}/g, '[^/]+')}$`);
      if (!template.test(testCase.path(fixture))) {
        outcomes.push(
          `${operation.operationId}: ${testCase.path(fixture)} is not ${operation.path}`,
        );
      }
      if (operation.method === 'get') {
        const own = await call(operation, testCase, bearer(owner.accessToken));
        if (own.status !== 200) outcomes.push(`${operation.operationId} as owner: ${own.status}`);
      }
      const callers: [name: string, headers: Record<string, string>, expected: number][] = [
        ['another account', bearer(intruder.accessToken), 404],
        ['anonymous', {}, account ? 401 : 404],
      ];
      if (!account) {
        callers.push(['another booking token', { 'X-Booking-Token': intruderBookingToken }, 404]);
      }
      for (const [name, headers, expected] of callers) {
        const response = await call(operation, testCase, headers);
        if (response.status !== expected) {
          outcomes.push(`${operation.operationId} as ${name}: ${response.status}, not ${expected}`);
        }
      }
    }
    expect(outcomes).toEqual([]);
  });

  it('leaves the owner’s data exactly as it was', async () => {
    const auth = bearer(owner.accessToken);
    const flight = await ctx
      .http()
      .get(`/v1/bookings/${fixture.flightBookingId}`)
      .set(auth)
      .expect(200);
    expect(flight.body.status).toBe('CONFIRMED');
    const application = await ctx
      .http()
      .get(`/v1/bookings/${fixture.visaBookingId}/visa-applications/${fixture.applicationId}`)
      .set(auth)
      .expect(200);
    const uploads = (application.body.checklist as { key: string; document: unknown }[])
      .filter((item) => item.document !== null)
      .map((item) => item.key);
    expect(uploads).toEqual(['passport']);
    expect(application.body.status).not.toBe('submitted');

    const travellers = await ctx.http().get('/v1/me/travellers').set(auth).expect(200);
    expect(travellers.body.travellers).toEqual([
      expect.objectContaining({ id: fixture.travellerId, surname: 'EZE' }),
    ]);
    const alerts = await ctx.http().get('/v1/me/price-alerts').set(auth).expect(200);
    expect(alerts.body.alerts).toEqual([expect.objectContaining({ id: fixture.priceAlertId })]);
    const credentials = await ctx.http().get('/v1/me/device-credentials').set(auth).expect(200);
    expect(credentials.body.credentials).toEqual([
      expect.objectContaining({ id: fixture.deviceCredentialId }),
    ]);
    const busHold = await ctx.prisma.busSeatHold.findUniqueOrThrow({
      where: { id: fixture.busHoldId },
    });
    expect(busHold.releasedAt).toBeNull();
    await ctx.http().get('/v1/me').set(auth).expect(200);

    // Nothing was attached to the owner's bookings either.
    expect(
      await ctx.prisma.payment.count({
        where: {
          bookingId: { in: [fixture.flightBookingId, fixture.visaBookingId] },
          status: { not: 'succeeded' },
        },
      }),
    ).toBe(0);
    expect(
      await ctx.prisma.pushToken.count({
        where: { bookingId: { in: [fixture.flightBookingId, fixture.visaBookingId] } },
      }),
    ).toBe(0);
  });
});
