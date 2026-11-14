import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Req,
  StreamableFile,
} from '@nestjs/common';
import type { z } from 'zod';

import { fromWire, type TripComponent, type TripPartState } from '@suskii/shared';

import { DeviceAttested } from '../attestation/attestation.guard';
import { ATTESTATION_HEADER } from '../attestation/attestation.schemas';
import { CurrentAuth, type AuthContext, type AuthenticatedRequest } from '../auth/auth-context';
import { bookingCaller } from '../bookings/booking-caller';
import { requestContext } from '../common/request-context';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { Contract, fileResponse } from '../contract/contract';
import { renderTripPlanPdf } from '../documents/plan-pdf';
import { BOOKING_LIMITS, RateLimit } from '../rate-limit/rate-limit.decorator';

import { TripBookingService } from './trip-booking.service';
import { TripCheckoutService } from './trip-checkout.service';
import {
  addTripPartSchema,
  bookTripSchema,
  createTripSchema,
  startTripPaymentSchema,
  tripIdParamsSchema,
  tripListSchema,
  tripPartParamsSchema,
  tripPaymentSessionSchema,
  tripSchema,
  type BookTripRequest,
  type StartTripPaymentRequest,
} from './trips.schemas';
import { TripsService } from './trips.service';

type TripView = z.infer<typeof tripSchema>;
const TAGS = ['Trips'];

// The plan's PDF is written in English, like the other documents.
const PART_NAMES: Record<TripComponent, string> = {
  flight: 'Flight',
  hotel: 'Hotel',
  car: 'Rental car',
  transfer: 'Airport transfer',
  insurance: 'Travel insurance',
};
const PART_STATES: Record<TripPartState, string> = {
  to_pay: 'To pay',
  paying: 'Payment started',
  paid: 'Paid',
  confirmed: 'Confirmed',
  closed: 'No longer part of the trip',
};
const place = (point: { code: string; cityName: string | null }): string =>
  point.cityName ? `${point.cityName} (${point.code})` : point.code;

/** What a part is, in one line: a route and airline, a hotel and city, or a product's title. */
function partLine(booking: TripView['parts'][number]['booking']): string {
  if (booking.flight) {
    return `${place(booking.flight.origin)} to ${place(booking.flight.destination)}, ${booking.flight.airline}`;
  }
  if (booking.hotel) return `${booking.hotel.name}, ${booking.hotel.cityName}`;
  if (booking.product) {
    return booking.product.cityName
      ? `${booking.product.title}, ${booking.product.cityName}`
      : booking.product.title;
  }
  return booking.reference;
}

/**
 * Combined trips (ADR-099): a signed-in traveller plans a trip, adds bookings made in the
 * ordinary way as its parts (a flight, a hotel, a rental car, an airport transfer, travel
 * insurance, or any of them) and pays for all of them with one checkout. Every route acts on the
 * caller's own trips; another account's trip answers 404.
 */
@Controller()
export class TripsController {
  constructor(
    private readonly trips: TripsService,
    private readonly checkout: TripCheckoutService,
    private readonly booking: TripBookingService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Post('trips')
  @RateLimit(BOOKING_LIMITS.createUser)
  @Contract({
    operationId: 'createTrip',
    summary: 'Start a trip from a plan',
    description:
      'The plan names where from and to, the dates, the travellers and the parts wanted (any of flight, hotel, car, transfer, insurance). Nothing is booked or priced here: each part is added as a booking with `addTripPart`. 409 `too-many-trips` when the account already has ten trips with nothing paid.',
    tags: TAGS,
    body: createTripSchema,
    responses: { 201: tripSchema },
    errors: [409],
  })
  @HttpCode(HttpStatus.CREATED)
  create(
    @CurrentAuth() auth: AuthContext,
    @Body() body: z.output<typeof createTripSchema>,
    @Req() request: AuthenticatedRequest,
  ): Promise<TripView> {
    return this.trips.create(auth.userId, body, requestContext(request));
  }

  @Get('me/trips')
  @Contract({
    operationId: 'listMyTrips',
    summary: "The caller's trips, newest first",
    tags: TAGS,
    responses: { 200: tripListSchema },
  })
  list(@CurrentAuth() auth: AuthContext): Promise<z.infer<typeof tripListSchema>> {
    return this.trips.list(auth.userId);
  }

  @Get('trips/:tripId')
  @Contract({
    operationId: 'getTrip',
    summary: 'A trip: its parts, a price per part and the total',
    description:
      'Poll while `state` is `awaiting_payment` or a part is `paid` (ticketing). Each part carries its booking summary, what it still costs and a price change waiting for consent, if any.',
    tags: TAGS,
    params: tripIdParamsSchema,
    responses: { 200: tripSchema },
    errors: [404],
  })
  get(@Param('tripId') tripId: string, @CurrentAuth() auth: AuthContext): Promise<TripView> {
    return this.trips.get(tripId, auth.userId);
  }

  @Get('trips/:tripId/pdf')
  @Contract({
    operationId: 'downloadTripPlan',
    summary: 'The plan of one of my trips as a PDF to keep or pass on',
    description:
      'The route, the dates, the head counts, each part chosen with its price and where it stands, the parts still to choose, the total and what is still to pay. It says that a plan is not a booking and that an unpaid part is not reserved. No name or contact is printed on it.',
    tags: TAGS,
    params: tripIdParamsSchema,
    responses: { 200: fileResponse('application/pdf') },
    errors: [404],
  })
  async pdf(
    @Param('tripId') tripId: string,
    @CurrentAuth() auth: AuthContext,
  ): Promise<StreamableFile> {
    const trip = await this.trips.get(tripId, auth.userId);
    const bytes = await renderTripPlanPdf({
      reference: trip.reference,
      issuedAt: new Date(),
      link: `${this.config.WEB_APP_URL.replace(/\/$/, '')}/trips/${trip.id}`,
      origin: place(trip.plan.origin),
      destination: place(trip.plan.destination),
      departDate: trip.plan.departDate,
      returnDate: trip.plan.returnDate,
      adults: trip.plan.adults,
      children: trip.plan.children,
      // A part that was cancelled or refunded is no longer in the total, so not in the plan.
      parts: trip.parts
        .filter((part) => part.state !== 'closed')
        .map((part) => ({
          part: PART_NAMES[part.component],
          what: partLine(part.booking),
          state: PART_STATES[part.state],
          price: fromWire(part.booking.total),
        })),
      missing: trip.missing.map((component) => PART_NAMES[component]),
      total: fromWire(trip.total),
      due: fromWire(trip.due),
    });
    return new StreamableFile(bytes, {
      type: 'application/pdf',
      disposition: `attachment; filename="suskii-trip-${trip.reference}.pdf"`,
      length: bytes.byteLength,
    });
  }

  @Delete('trips/:tripId')
  @Contract({
    operationId: 'deleteTrip',
    summary: 'Delete a trip nobody started paying',
    description:
      'The bookings in it are not cancelled: they leave the trip and stay ordinary unpaid bookings. 409 `trip-has-payments` once a payment was started or a part is paid.',
    tags: TAGS,
    params: tripIdParamsSchema,
    responses: { 204: null },
    errors: [404, 409],
  })
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('tripId') tripId: string,
    @CurrentAuth() auth: AuthContext,
    @Req() request: AuthenticatedRequest,
  ): Promise<void> {
    await this.trips.remove(tripId, auth.userId, requestContext(request));
  }

  @Post('trips/:tripId/parts')
  @RateLimit(BOOKING_LIMITS.createUser)
  @Contract({
    operationId: 'addTripPart',
    summary: "Add one of the caller's unpaid bookings to the trip",
    description:
      'The booking becomes the part it sells: a flight, a hotel stay, a rental car, an airport transfer or travel insurance. 422 `trip-part-invalid` with `code` when it is something else, in another currency, on a payment plan, booked for a company, not waiting for payment, in another trip, or a part the plan does not ask for. An unpaid part of the same kind gives way to the new one; a paid one answers 409 `trip-part-paid`. A checkout the trip has open is closed, since the total changes.',
    tags: TAGS,
    params: tripIdParamsSchema,
    body: addTripPartSchema,
    responses: { 200: tripSchema },
    errors: [404, 409, 422],
  })
  @HttpCode(HttpStatus.OK)
  addPart(
    @Param('tripId') tripId: string,
    @CurrentAuth() auth: AuthContext,
    @Body() body: z.output<typeof addTripPartSchema>,
    @Req() request: AuthenticatedRequest,
  ): Promise<TripView> {
    return this.trips.addPart(tripId, body.bookingId, bookingCaller(request), auth.userId);
  }

  @Post('trips/:tripId/book')
  @RateLimit(BOOKING_LIMITS.createUser)
  @Contract({
    operationId: 'bookTrip',
    summary: 'Book every prepared part of the trip with one set of details',
    description:
      "One form for the whole trip (ADR-118): the contact and each traveller once, for every part Ask Suskii prepared (`prepared`). Each part is booked as an ordinary booking, with the travellers its quote was priced for, and joins the trip; then the trip is paid once with `startTripPayment`. All or nothing: when a part cannot be booked, nothing this request booked stays, and the problem carries `part` (the trip part) and, for a traveller's detail, `issues` whose `index` is the traveller's place in `travellers`. 409 `trip-nothing-prepared` when no part waits for details; 422 `trip-travellers-short` when a part was priced for more travellers of a kind than the form names; 410 when a prepared part's price has run out.",
    tags: TAGS,
    params: tripIdParamsSchema,
    body: bookTripSchema,
    responses: { 200: tripSchema },
    errors: [404, 409, 410, 422, 503],
    idempotent: true,
  })
  @HttpCode(HttpStatus.OK)
  book(
    @Param('tripId') tripId: string,
    @CurrentAuth() auth: AuthContext,
    @Body() body: BookTripRequest,
    @Req() request: AuthenticatedRequest,
  ): Promise<TripView> {
    return this.booking.book(tripId, body, bookingCaller(request), auth.userId);
  }

  @Delete('trips/:tripId/parts/:bookingId')
  @Contract({
    operationId: 'removeTripPart',
    summary: 'Take an unpaid booking out of the trip',
    description:
      'The booking is not cancelled: it stays an ordinary unpaid booking and expires on its own. A checkout the trip has open is closed, since its total counted this part. 409 `trip-part-paid` for a paid part.',
    tags: TAGS,
    params: tripPartParamsSchema,
    responses: { 200: tripSchema },
    errors: [404, 409],
  })
  removePart(
    @Param('tripId') tripId: string,
    @Param('bookingId') bookingId: string,
    @CurrentAuth() auth: AuthContext,
    @Req() request: AuthenticatedRequest,
  ): Promise<TripView> {
    return this.trips.removePart(tripId, bookingId, bookingCaller(request), auth.userId);
  }

  @Post('trips/:tripId/payments')
  @RateLimit(BOOKING_LIMITS.paymentIp)
  @DeviceAttested('payment')
  @Contract({
    operationId: 'startTripPayment',
    summary: 'Re-check every part and open one hosted checkout for the whole trip',
    description:
      "Re-prices each unpaid part with its supplier first. A changed total answers 409 `price-changed` with that booking's `priceChange`: accept it with the booking's `price-consent`, then call this again. A part that sold out answers 410 and leaves the total. When every part holds, one checkout opens for the sum; the provider's webhook then settles each booking. 409 `trip-nothing-to-pay` when no part is waiting for payment.",
    tags: TAGS,
    params: tripIdParamsSchema,
    headers: [ATTESTATION_HEADER],
    body: startTripPaymentSchema,
    responses: { 201: tripPaymentSessionSchema },
    errors: [403, 404, 409, 410, 422, 503],
    idempotent: true,
  })
  pay(
    @Param('tripId') tripId: string,
    @CurrentAuth() auth: AuthContext,
    @Body() body: StartTripPaymentRequest,
    @Req() request: AuthenticatedRequest,
  ): Promise<z.infer<typeof tripPaymentSessionSchema>> {
    return this.checkout.startPayment(tripId, bookingCaller(request), auth.userId, body);
  }
}
