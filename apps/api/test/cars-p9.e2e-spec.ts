import { book, busInventory, inDays, passenger, staffSession } from './helpers/cars';
import { bearer, signUp } from './helpers/flows';
import { rentalQuote, rentalVehicle } from './helpers/rentals';
import {
  dispatch,
  driverSession,
  IKEJA,
  requestRide,
  rideCatalog,
  VICTORIA_ISLAND,
} from './helpers/rides';
import { createTestApp, resetState, type TestContext } from './helpers/test-app';

interface Line {
  code: string;
  amount: { amountMinor: number; currency: string };
  quantity: number;
}
const total = (lines: Line[]) => lines.reduce((acc, line) => acc + line.amount.amountMinor, 0);

/**
 * Cars P9 flagged features: the unified price breakdown (lines that add up to the fare and show
 * no margin), the departure planner, trip bundling suggestions, and the safety suite's route
 * deviation incident. Each answers 404 or stays silent while its flag is off.
 */
describe('Cars P9 features (e2e)', () => {
  let ctx: TestContext;
  let staff: Record<string, string>;
  let rider: Record<string, string>;
  let places: { id: string; name: string; cityName: string }[];

  beforeAll(async () => {
    ctx = await createTestApp({ RATE_LIMIT_ENABLED: false });
  });
  beforeEach(async () => {
    await ctx.background.drain();
    await resetState(ctx);
    staff = (await staffSession(ctx, 'p9-ops@suskii.test', ['operations', 'support'])).headers;
    await rideCatalog(ctx, staff);
    rider = bearer((await signUp(ctx, 'p9-rider@example.com')).accessToken);
    const listed = await ctx.http().get('/v1/rides/places').expect(200);
    places = listed.body.places as typeof places;
  });
  afterAll(async () => {
    await ctx.background.drain();
    await resetState(ctx);
    await ctx.close();
  });

  const place = (name: string) => {
    const found = places.find((candidate) => candidate.name === name);
    if (!found) throw new Error(`no place ${name}`);
    return found;
  };

  /** A guest bus booking on the departure `busInventory` creates; returns its id and token. */
  async function busBooking(): Promise<{ id: string; token: string; fareMinor: number }> {
    const { tripId } = await busInventory(ctx, staff, { departureInDays: 3 });
    const hold = await ctx
      .http()
      .post(`/v1/buses/trips/${tripId}/holds`)
      .send({ seats: ['1A', '1B'] })
      .expect(201);
    const quote = await ctx
      .http()
      .post('/v1/inhouse-quotes')
      .send({ kind: 'bus', holdId: hold.body.holdId, holdToken: hold.body.holdToken })
      .expect(201);
    const created = await book(ctx, {
      quoteId: quote.body.quoteId,
      passengers: [passenger('Ada', 'Obi'), passenger('Bayo', 'Obi')],
    }).expect(201);
    return {
      id: created.body.booking.id as string,
      token: created.body.accessToken as string,
      fareMinor: created.body.booking.price.fare.amountMinor as number,
    };
  }

  async function flightBooking(
    origin: string,
    destination: string,
    days: number,
  ): Promise<{ id: string; token: string }> {
    const search = await ctx
      .http()
      .post('/v1/flights/searches')
      .send({
        slices: [{ origin, destination, departureDate: inDays(days) }],
        passengers: { adults: 1, children: 0, infants: 0 },
        cabinClass: 'economy',
      })
      .expect(200);
    const quote = await ctx
      .http()
      .post(`/v1/flights/offers/${search.body.offers[0].id as string}/quote`)
      .expect(201);
    const created = await book(ctx, {
      quoteId: quote.body.quoteId,
      passengers: [passenger('Ada', 'Obi')],
    }).expect(201);
    return { id: created.body.booking.id as string, token: created.body.accessToken as string };
  }

  describe('unified price breakdown', () => {
    it('splits ride, bus and rental fares into lines that add up to the fare', async () => {
      const ride = await ctx
        .http()
        .post('/v1/inhouse-quotes')
        .set(rider)
        .send({ kind: 'ride', category: 'standard', pickup: IKEJA, dropoff: VICTORIA_ISLAND })
        .expect(201);
      const rideQuote = await ctx.http().get(`/v1/quotes/${ride.body.quoteId}`).expect(200);
      const rideLines = rideQuote.body.priceBreakdown as Line[];
      expect(rideLines.map((line) => line.code)).toEqual(
        expect.arrayContaining(['ride_base', 'ride_distance', 'ride_time', 'ride_booking_fee']),
      );
      expect(total(rideLines)).toBe(rideQuote.body.price.fare.amountMinor);

      const car = await rentalVehicle(ctx, staff);
      const rental = await rentalQuote(ctx, rider, {
        vehicleId: car.id,
        pickupAtLocal: `${inDays(5)}T10:00`,
        returnAtLocal: `${inDays(8)}T10:00`,
        chauffeur: true,
      }).expect(201);
      const rentalView = await ctx.http().get(`/v1/quotes/${rental.body.quoteId}`).expect(200);
      expect(rentalView.body.priceBreakdown).toEqual([
        expect.objectContaining({ code: 'rental_vehicle', quantity: 3 }),
        expect.objectContaining({ code: 'rental_chauffeur', quantity: 3 }),
      ]);
      // The deposit stays outside the fare and its lines.
      expect(total(rentalView.body.priceBreakdown as Line[])).toBe(
        rentalView.body.price.fare.amountMinor,
      );

      const bus = await busBooking();
      const booking = await ctx
        .http()
        .get(`/v1/bookings/${bus.id}`)
        .set('X-Booking-Token', bus.token)
        .expect(200);
      expect(booking.body.priceBreakdown).toEqual([
        { code: 'bus_seats', quantity: 2, amount: { amountMinor: bus.fareMinor, currency: 'NGN' } },
      ]);
    });
  });

  describe('departure planner', () => {
    it('tells a bus traveller when to leave and offers the ride', async () => {
      const bus = await busBooking();
      const from = place('Eko Hotel');
      const plan = await ctx
        .http()
        .get(`/v1/bookings/${bus.id}/departure-plan`)
        .query({ from: from.id })
        .set('X-Booking-Token', bus.token)
        .expect(200);
      expect(plan.body).toMatchObject({
        kind: 'bus',
        bufferMinutes: 30,
        marginMinutes: 15,
        from: { id: from.id, label: 'Eko Hotel' },
        destination: { label: 'jibowu' },
      });
      const departsAt = Date.parse(plan.body.departsAt as string);
      const arriveBy = Date.parse(plan.body.arriveBy as string);
      const leaveBy = Date.parse(plan.body.leaveBy as string);
      expect(departsAt - arriveBy).toBe(30 * 60_000);
      expect(arriveBy - leaveBy).toBe(
        (plan.body.travel.durationSeconds as number) * 1000 + 15 * 60_000,
      );
      expect(plan.body.ride).toMatchObject({
        pickup: { label: 'Eko Hotel' },
        dropoff: { label: 'jibowu' },
        scheduledFor: plan.body.leaveBy,
      });

      // Someone else's booking, or no token: as if it did not exist.
      await ctx
        .http()
        .get(`/v1/bookings/${bus.id}/departure-plan`)
        .query({ from: from.id })
        .expect(404);
      await ctx
        .http()
        .get(`/v1/bookings/${bus.id}/departure-plan`)
        .query({ from: from.id })
        .set(rider)
        .expect(404);
    });

    it('allows check-in time for a flight and refuses places in another city', async () => {
      const flight = await flightBooking('LOS', 'ABV', 30);
      const plan = await ctx
        .http()
        .get(`/v1/bookings/${flight.id}/departure-plan`)
        .query({ from: place('Lekki Phase 1').id })
        .set('X-Booking-Token', flight.token)
        .expect(200);
      expect(plan.body).toMatchObject({
        kind: 'flight',
        bufferMinutes: 120,
        destination: { label: 'Murtala Muhammed Airport' },
        // A month ahead is outside the ride scheduling window.
        ride: null,
      });

      const abuja = await ctx
        .http()
        .post('/v1/admin/rides/places')
        .set(staff)
        .send({ name: 'Wuse 2', kind: 'landmark', cityName: 'Abuja', lat: 9.0765, lng: 7.4986 })
        .expect(201);
      const refused = await ctx
        .http()
        .get(`/v1/bookings/${flight.id}/departure-plan`)
        .query({ from: abuja.body.id as string })
        .set('X-Booking-Token', flight.token)
        .expect(422);
      expect(refused.body).toMatchObject({ type: 'urn:suskii:problem:plan-unavailable' });
    });
  });

  describe('trip bundling', () => {
    it('suggests a ride from the arrival airport, a car and onward buses', async () => {
      await rentalVehicle(ctx, staff);
      await busInventory(ctx, staff);
      const flight = await flightBooking('ABV', 'LOS', 3);
      const suggestions = await ctx
        .http()
        .get(`/v1/bookings/${flight.id}/cars-suggestions`)
        .set('X-Booking-Token', flight.token)
        .expect(200);
      expect(suggestions.body.ride).toMatchObject({
        pickupPlaceId: place('Murtala Muhammed Airport').id,
        cityName: 'Lagos',
      });
      expect(Date.parse(suggestions.body.ride.scheduledFor as string)).toBeGreaterThan(Date.now());
      expect(suggestions.body.rental).toMatchObject({ cityName: 'Lagos' });
      expect(suggestions.body.rental.returnAtLocal > suggestions.body.rental.pickupAtLocal).toBe(
        true,
      );
      expect(suggestions.body.bus).toEqual({ from: 'Lagos', date: inDays(3) });

      await ctx.http().get(`/v1/bookings/${flight.id}/cars-suggestions`).expect(404);
    });

    it('has nothing to suggest for a city without Cars inventory', async () => {
      const flight = await flightBooking('LOS', 'ABV', 3);
      const suggestions = await ctx
        .http()
        .get(`/v1/bookings/${flight.id}/cars-suggestions`)
        .set('X-Booking-Token', flight.token)
        .expect(200);
      expect(suggestions.body).toEqual({ ride: null, rental: null, bus: null });
    });
  });

  describe('safety suite: route deviation', () => {
    /** About `metres` east of the straight Ikeja to Victoria Island line, near its start. */
    const offRoute = (metres: number) => ({
      lat: IKEJA.lat - 0.002,
      lng: IKEJA.lng + metres / 111_000,
    });

    it('opens one incident when a ride stays off its route for two minutes', async () => {
      const driver = await driverSession(ctx, 'p9-driver@example.com', IKEJA);
      const { rideId } = await requestRide(ctx, rider);
      await dispatch(ctx);
      const offers = await ctx.http().get('/v1/drivers/me/offers').set(driver.headers).expect(200);
      const offer = (offers.body.offers as { id: string; rideId: string }[]).find(
        (candidate) => candidate.rideId === rideId,
      );
      await ctx
        .http()
        .post(`/v1/drivers/me/offers/${offer?.id ?? ''}/accept`)
        .set(driver.headers)
        .expect(200);
      const pin = (await ctx.http().get(`/v1/rides/${rideId}`).set(rider).expect(200)).body
        .pin as string;
      await ctx
        .http()
        .post(`/v1/drivers/me/rides/${rideId}/arrive`)
        .set(driver.headers)
        .expect(200);
      await ctx
        .http()
        .post(`/v1/drivers/me/rides/${rideId}/start`)
        .set(driver.headers)
        .send({ pin })
        .expect(200);

      // The API takes fixes recorded up to five minutes ago, so the timeline runs in the recent
      // past, starting from a last fix at Ikeja a minute before it.
      const start = Date.now() - 270_000;
      await ctx.prisma.driver.update({
        where: { id: driver.driverId },
        data: { lastLat: IKEJA.lat, lastLng: IKEJA.lng, lastLocationAt: new Date(start - 60_000) },
      });
      const ping = (position: { lat: number; lng: number }, second: number) =>
        ctx
          .http()
          .post('/v1/drivers/me/location')
          .set(driver.headers)
          .send({ position, recordedAt: new Date(start + second * 1000).toISOString() })
          .expect(204);
      const incidents = () =>
        ctx.prisma.safetyIncident.count({ where: { rideId, kind: 'route_deviation' } });

      // Off the route, then back within the two minutes: nothing.
      await ping(offRoute(1500), 0);
      await ping(IKEJA, 60);
      expect(await incidents()).toBe(0);
      // Off the route for longer than RIDE_DEVIATION_SECONDS: one incident, raised once.
      await ping(offRoute(1500), 120);
      await ping(offRoute(1600), 200);
      expect(await incidents()).toBe(0);
      await ping(offRoute(1700), 260);
      expect(await incidents()).toBe(1);
      await ping(offRoute(1800), 280);
      expect(await incidents()).toBe(1);
      const listed = await ctx.http().get('/v1/admin/rides/incidents').set(staff).expect(200);
      expect(JSON.stringify(listed.body)).toContain('route_deviation');
    });
  });

  describe('switched off', () => {
    let off: TestContext;
    beforeAll(async () => {
      off = await createTestApp({
        RATE_LIMIT_ENABLED: false,
        CARS_PRICE_BREAKDOWN_ENABLED: false,
        CARS_DEPARTURE_PLANNER_ENABLED: false,
        CARS_BUNDLES_ENABLED: false,
      });
    });
    afterAll(async () => {
      await off.close();
    });

    it('hides the planner and suggestions and sends no breakdown', async () => {
      const id = '0192d3a0-7c1e-7b2a-9f00-1234567890ab';
      await off.http().get(`/v1/bookings/${id}/departure-plan`).query({ from: id }).expect(404);
      await off.http().get(`/v1/bookings/${id}/cars-suggestions`).expect(404);
      const features = await off.http().get('/v1/cars/features').expect(200);
      expect(features.body).toMatchObject({
        priceBreakdown: false,
        departurePlanner: false,
        bundles: false,
      });
      const offRider = bearer((await signUp(off, 'p9-off@example.com')).accessToken);
      const offStaff = (await staffSession(off, 'p9-off-ops@suskii.test', ['operations'])).headers;
      await rideCatalog(off, offStaff);
      const quote = await off
        .http()
        .post('/v1/inhouse-quotes')
        .set(offRider)
        .send({ kind: 'ride', category: 'standard', pickup: IKEJA, dropoff: VICTORIA_ISLAND })
        .expect(201);
      const view = await off.http().get(`/v1/quotes/${quote.body.quoteId}`).expect(200);
      expect(view.body.priceBreakdown).toBeNull();
    });
  });
});
