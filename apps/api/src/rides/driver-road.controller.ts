import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { z } from 'zod';

import { CurrentAuth, type AuthContext } from '../auth/auth-context';
import { RequirePermissions } from '../auth/decorators';
import { requestContext } from '../common/request-context';
import { Contract } from '../contract/contract';
import { CarsFeatureRoute } from '../ground/cars-flags';
import { CARS_LIMITS, RateLimit } from '../rate-limit/rate-limit.decorator';

import { RideDriverService, type DriverCaller } from './ride-driver.service';
import {
  currentDriverRideSchema,
  driverEarningsSchema,
  driverRideSchema,
  driverStateSchema,
  goOnlineSchema,
  locationSchema,
  offerIdParamsSchema,
  rideIdParamsSchema,
  rideOfferListSchema,
  startRideSchema,
} from './rides.schemas';

const TAGS = ['Drivers'];

const caller = (auth: AuthContext, request: Request): DriverCaller => ({
  userId: auth.userId,
  context: requestContext(request),
});

/**
 * Approved drivers on the road (role `driver`, ADR-050 to ADR-053). Going online checks every
 * vetting gate again; offers come one at a time with a short accept window; the PIN starts a
 * trip. A ride or offer that is not the caller's answers 404.
 */
@CarsFeatureRoute('rides')
@RequirePermissions('driving')
@Controller('drivers/me')
export class DriverRoadController {
  constructor(private readonly road: RideDriverService) {}

  @Get('state')
  @Contract({
    operationId: 'getDriverState',
    summary: 'Online status and current ride',
    tags: TAGS,
    responses: { 200: driverStateSchema },
    errors: [401, 403, 404],
  })
  state(@CurrentAuth() auth: AuthContext): Promise<z.infer<typeof driverStateSchema>> {
    return this.road.state(auth.userId);
  }

  @Post('online')
  @HttpCode(HttpStatus.OK)
  @RateLimit(CARS_LIMITS.driverActionUser)
  @Contract({
    operationId: 'goOnline',
    summary: 'Start receiving ride offers',
    description:
      '409 `cannot-drive` with `reason` (`not_approved`, `checks_pending`, `licence_expired`, `no_vehicle`, `insurance_expired`) until every vetting gate passes. 422 `location-implausible` outside the service area.',
    tags: TAGS,
    body: goOnlineSchema,
    responses: { 200: driverStateSchema },
    errors: [401, 403, 404, 409, 422],
  })
  online(
    @CurrentAuth() auth: AuthContext,
    @Body() body: z.output<typeof goOnlineSchema>,
  ): Promise<z.infer<typeof driverStateSchema>> {
    return this.road.goOnline(auth.userId, body.position);
  }

  @Post('offline')
  @HttpCode(HttpStatus.OK)
  @RateLimit(CARS_LIMITS.driverActionUser)
  @Contract({
    operationId: 'goOffline',
    summary: 'Stop receiving offers (clears the last position)',
    description: '409 `ride-in-progress` during a ride.',
    tags: TAGS,
    responses: { 200: driverStateSchema },
    errors: [401, 403, 404, 409],
  })
  offline(@CurrentAuth() auth: AuthContext): Promise<z.infer<typeof driverStateSchema>> {
    return this.road.goOffline(auth.userId);
  }

  @Post('location')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RateLimit(CARS_LIMITS.locationUser)
  @Contract({
    operationId: 'reportDriverLocation',
    summary: "Report the driver's position",
    description:
      'At most one every 5 seconds. Positions outside the service area, too far from the last one for the time elapsed, or timestamped outside the last five minutes are refused (422 `location-implausible`).',
    tags: TAGS,
    body: locationSchema,
    responses: { 204: null },
    errors: [401, 403, 404, 409, 422],
  })
  async location(
    @CurrentAuth() auth: AuthContext,
    @Body() body: z.output<typeof locationSchema>,
  ): Promise<void> {
    await this.road.location(auth.userId, body.position, body.recordedAt);
  }

  @Get('offers')
  @Contract({
    operationId: 'listRideOffers',
    summary: 'Open ride offers',
    tags: TAGS,
    responses: { 200: rideOfferListSchema },
    errors: [401, 403, 404],
  })
  offers(@CurrentAuth() auth: AuthContext): Promise<z.infer<typeof rideOfferListSchema>> {
    return this.road.offers(auth.userId);
  }

  @Post('offers/:offerId/accept')
  @HttpCode(HttpStatus.OK)
  @RateLimit(CARS_LIMITS.driverActionUser)
  @Contract({
    operationId: 'acceptRideOffer',
    summary: 'Accept a ride offer',
    description:
      'One acceptance wins: 409 `offer-gone` when the offer expired or the ride moved on, 409 `ride-in-progress` while driving another ride.',
    tags: TAGS,
    params: offerIdParamsSchema,
    responses: { 200: driverRideSchema },
    errors: [401, 403, 404, 409],
  })
  accept(
    @CurrentAuth() auth: AuthContext,
    @Param('offerId') offerId: string,
    @Req() request: Request,
  ): Promise<z.infer<typeof driverRideSchema>> {
    return this.road.accept(offerId, caller(auth, request));
  }

  @Post('offers/:offerId/decline')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RateLimit(CARS_LIMITS.driverActionUser)
  @Contract({
    operationId: 'declineRideOffer',
    summary: 'Decline a ride offer',
    tags: TAGS,
    params: offerIdParamsSchema,
    responses: { 204: null },
    errors: [401, 403, 404, 409],
  })
  async decline(
    @CurrentAuth() auth: AuthContext,
    @Param('offerId') offerId: string,
  ): Promise<void> {
    await this.road.decline(offerId, auth.userId);
  }

  @Get('ride')
  @Contract({
    operationId: 'getCurrentDriverRide',
    summary: "The driver's live ride, if any",
    tags: TAGS,
    responses: { 200: currentDriverRideSchema },
    errors: [401, 403, 404],
  })
  current(@CurrentAuth() auth: AuthContext): Promise<z.infer<typeof currentDriverRideSchema>> {
    return this.road.current(auth.userId);
  }

  @Post('rides/:rideId/arrive')
  @HttpCode(HttpStatus.OK)
  @RateLimit(CARS_LIMITS.driverActionUser)
  @Contract({
    operationId: 'arriveForRide',
    summary: 'Tell the rider the driver is at the pickup',
    tags: TAGS,
    params: rideIdParamsSchema,
    responses: { 200: driverRideSchema },
    errors: [401, 403, 404, 409],
  })
  arrive(
    @CurrentAuth() auth: AuthContext,
    @Param('rideId') rideId: string,
    @Req() request: Request,
  ): Promise<z.infer<typeof driverRideSchema>> {
    return this.road.arrive(rideId, caller(auth, request));
  }

  @Post('rides/:rideId/start')
  @HttpCode(HttpStatus.OK)
  @RateLimit(CARS_LIMITS.driverActionUser)
  @Contract({
    operationId: 'startRide',
    summary: "Start the trip with the rider's PIN",
    description:
      '422 `pin-invalid` with `attemptsLeft`; the fifth wrong PIN locks the ride (423 `pin-locked`) and alerts the safety team.',
    tags: TAGS,
    params: rideIdParamsSchema,
    body: startRideSchema,
    responses: { 200: driverRideSchema },
    errors: [401, 403, 404, 409, 422, 423],
  })
  start(
    @CurrentAuth() auth: AuthContext,
    @Param('rideId') rideId: string,
    @Body() body: z.output<typeof startRideSchema>,
    @Req() request: Request,
  ): Promise<z.infer<typeof driverRideSchema>> {
    return this.road.start(rideId, body.pin, caller(auth, request));
  }

  @Post('rides/:rideId/complete')
  @HttpCode(HttpStatus.OK)
  @RateLimit(CARS_LIMITS.driverActionUser)
  @Contract({
    operationId: 'completeRide',
    summary: 'Complete the trip',
    description: "Posts the driver's share of the fare to their earnings.",
    tags: TAGS,
    params: rideIdParamsSchema,
    responses: { 200: driverRideSchema },
    errors: [401, 403, 404, 409],
  })
  complete(
    @CurrentAuth() auth: AuthContext,
    @Param('rideId') rideId: string,
    @Req() request: Request,
  ): Promise<z.infer<typeof driverRideSchema>> {
    return this.road.complete(rideId, caller(auth, request));
  }

  @Post('rides/:rideId/cancel')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RateLimit(CARS_LIMITS.driverActionUser)
  @Contract({
    operationId: 'handBackRide',
    summary: 'Hand a ride back before the trip starts',
    description: 'The ride searches for another driver; it is never offered to this driver again.',
    tags: TAGS,
    params: rideIdParamsSchema,
    responses: { 204: null },
    errors: [401, 403, 404, 409],
  })
  async cancel(
    @CurrentAuth() auth: AuthContext,
    @Param('rideId') rideId: string,
    @Req() request: Request,
  ): Promise<void> {
    await this.road.cancel(rideId, caller(auth, request));
  }

  @Get('earnings')
  @Contract({
    operationId: 'getDriverEarnings',
    summary: 'Earnings balance, recent rides and payouts',
    tags: TAGS,
    responses: { 200: driverEarningsSchema },
    errors: [401, 403, 404],
  })
  earnings(@CurrentAuth() auth: AuthContext): Promise<z.infer<typeof driverEarningsSchema>> {
    return this.road.earnings(auth.userId);
  }
}
