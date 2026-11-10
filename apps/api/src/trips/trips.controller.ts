import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import type { z } from 'zod';

import { DeviceAttested } from '../attestation/attestation.guard';
import { ATTESTATION_HEADER } from '../attestation/attestation.schemas';
import { CurrentAuth, type AuthContext, type AuthenticatedRequest } from '../auth/auth-context';
import { bookingCaller } from '../bookings/booking-caller';
import { requestContext } from '../common/request-context';
import { Contract } from '../contract/contract';
import { BOOKING_LIMITS, RateLimit } from '../rate-limit/rate-limit.decorator';

import { TripCheckoutService } from './trip-checkout.service';
import {
  addTripPartSchema,
  createTripSchema,
  startTripPaymentSchema,
  tripIdParamsSchema,
  tripListSchema,
  tripPartParamsSchema,
  tripPaymentSessionSchema,
  tripSchema,
  type StartTripPaymentRequest,
} from './trips.schemas';
import { TripsService } from './trips.service';

type TripView = z.infer<typeof tripSchema>;
const TAGS = ['Trips'];

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
