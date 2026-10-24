import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import type { z } from 'zod';

import type { RatingInput } from '@suskii/shared';

import { CurrentAuth, type AuthContext } from '../auth/auth-context';
import { Public } from '../auth/decorators';
import { requestContext } from '../common/request-context';
import { Contract } from '../contract/contract';
import { CarsFeatureRoute } from '../ground/cars-flags';
import { CARS_LIMITS, RateLimit } from '../rate-limit/rate-limit.decorator';

import { RidesCatalogService } from './rides-catalog.service';
import {
  cancelRideSchema,
  emergencyContactsBodySchema,
  emergencyContactsViewSchema,
  rateRideSchema,
  rideIdParamsSchema,
  rideListQuerySchema,
  rideListSchema,
  ridePlacesQuerySchema,
  ridePlacesSchema,
  rideSchema,
  shareCreatedSchema,
  sharedRideSchema,
  shareTokenParamsSchema,
  sosRequestSchema,
  sosResultSchema,
} from './rides.schemas';
import { RidesService, type Rider } from './rides.service';
import { SafetyService } from './safety.service';

const TAGS = ['Rides'];

const rider = (auth: AuthContext, request: Request): Rider => ({
  userId: auth.userId,
  context: requestContext(request),
});

/**
 * A rider's rides (ADR-049 to ADR-051). A ride is booked like every other product: a quote
 * (`createInhouseQuote`, kind `ride`), a booking and a payment; the ride starts searching once
 * the payment is confirmed. These routes follow it from there. Other people's rides answer 404.
 */
@CarsFeatureRoute('rides')
@Controller('rides')
export class RidesController {
  constructor(
    private readonly rides: RidesService,
    private readonly catalog: RidesCatalogService,
    private readonly safety: SafetyService,
  ) {}

  @Get('places')
  @Public()
  @RateLimit(CARS_LIMITS.catalogIp)
  @Contract({
    operationId: 'listRidePlaces',
    summary: 'Airports, terminals and landmarks rides can start or end at',
    tags: TAGS,
    query: ridePlacesQuerySchema,
    responses: { 200: ridePlacesSchema },
  })
  places(
    @Query() query: z.output<typeof ridePlacesQuerySchema>,
  ): Promise<z.infer<typeof ridePlacesSchema>> {
    return this.catalog.places(query.city);
  }

  @Get()
  @Contract({
    operationId: 'listRides',
    summary: "The caller's rides, newest first",
    tags: TAGS,
    query: rideListQuerySchema,
    responses: { 200: rideListSchema },
    errors: [401],
  })
  list(
    @CurrentAuth() auth: AuthContext,
    @Query() query: z.output<typeof rideListQuerySchema>,
  ): Promise<z.infer<typeof rideListSchema>> {
    return this.rides.list(auth.userId, query);
  }

  @Get(':rideId')
  @Contract({
    operationId: 'getRide',
    summary: 'A ride with its driver, live position, ETA and PIN',
    description:
      'The driver position is rounded to about 110 m and shown only while the ride is live. Follow changes on the `/v1/ws/rides` socket, or poll this route every 5 seconds.',
    tags: TAGS,
    params: rideIdParamsSchema,
    responses: { 200: rideSchema },
    errors: [401, 404],
  })
  get(
    @CurrentAuth() auth: AuthContext,
    @Param('rideId') rideId: string,
  ): Promise<z.infer<typeof rideSchema>> {
    return this.rides.get(rideId, auth.userId);
  }

  @Post(':rideId/cancel')
  @HttpCode(HttpStatus.OK)
  @RateLimit(CARS_LIMITS.rideActionUser)
  @Contract({
    operationId: 'cancelRide',
    summary: 'Cancel a ride',
    description:
      "Free until a driver accepts and for the fare rule's free window after; then the cancellation fee is kept and the rest refunded. 409 `ride-conflict` once the trip has started or ended.",
    tags: TAGS,
    params: rideIdParamsSchema,
    responses: { 200: cancelRideSchema },
    errors: [401, 404, 409],
  })
  cancel(
    @CurrentAuth() auth: AuthContext,
    @Param('rideId') rideId: string,
    @Req() request: Request,
  ): Promise<z.infer<typeof cancelRideSchema>> {
    return this.rides.cancel(rideId, rider(auth, request));
  }

  @Post(':rideId/rating')
  @RateLimit(CARS_LIMITS.rideActionUser)
  @Contract({
    operationId: 'rateRide',
    summary: 'Rate the driver of a completed ride',
    description: 'Once per ride; 409 `rating-closed` before completion or for a second rating.',
    tags: TAGS,
    params: rideIdParamsSchema,
    body: rateRideSchema,
    responses: { 201: rideSchema },
    errors: [401, 404, 409],
  })
  rate(
    @CurrentAuth() auth: AuthContext,
    @Param('rideId') rideId: string,
    @Body() body: RatingInput,
  ): Promise<z.infer<typeof rideSchema>> {
    return this.rides.rate(rideId, auth.userId, body);
  }

  @Post(':rideId/share')
  @RateLimit(CARS_LIMITS.rideActionUser)
  @Contract({
    operationId: 'shareRide',
    summary: 'Create a live-trip link',
    description:
      'The token is shown once and replaces any earlier link. The link shows the driver, vehicle and a rounded position, nothing about the rider, and expires 30 minutes after the trip.',
    tags: TAGS,
    params: rideIdParamsSchema,
    responses: { 201: shareCreatedSchema },
    errors: [401, 404, 409],
  })
  share(
    @CurrentAuth() auth: AuthContext,
    @Param('rideId') rideId: string,
    @Req() request: Request,
  ): Promise<z.infer<typeof shareCreatedSchema>> {
    return this.rides.share(rideId, rider(auth, request));
  }

  @Delete(':rideId/share')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RateLimit(CARS_LIMITS.rideActionUser)
  @Contract({
    operationId: 'revokeRideShare',
    summary: 'Stop sharing a ride',
    tags: TAGS,
    params: rideIdParamsSchema,
    responses: { 204: null },
    errors: [401, 404],
  })
  async revokeShare(
    @CurrentAuth() auth: AuthContext,
    @Param('rideId') rideId: string,
    @Req() request: Request,
  ): Promise<void> {
    await this.rides.revokeShare(rideId, rider(auth, request));
  }

  @Post(':rideId/sos')
  @HttpCode(HttpStatus.OK)
  @RateLimit(CARS_LIMITS.sosUser)
  @Contract({
    operationId: 'raiseRideSos',
    summary: 'Raise an SOS on a ride',
    description:
      "For the ride's rider or driver. Records an incident for the safety team and texts the rider's emergency contacts before answering. Call the emergency number too.",
    tags: TAGS,
    params: rideIdParamsSchema,
    body: sosRequestSchema,
    responses: { 200: sosResultSchema },
    errors: [401, 404],
  })
  sos(
    @CurrentAuth() auth: AuthContext,
    @Param('rideId') rideId: string,
    @Body() body: z.output<typeof sosRequestSchema>,
    @Req() request: Request,
  ): Promise<z.infer<typeof sosResultSchema>> {
    return this.safety.sos(rideId, rider(auth, request), body.position);
  }
}

/** What a live-trip link shows (ADR-050): no sign-in, no rider data, 404 once expired. */
@Public()
@CarsFeatureRoute('rides')
@Controller('public/trips')
export class SharedRidesController {
  constructor(private readonly rides: RidesService) {}

  @Get(':token')
  @RateLimit(CARS_LIMITS.shareIp)
  @Contract({
    operationId: 'getSharedRide',
    summary: 'A shared ride',
    tags: TAGS,
    params: shareTokenParamsSchema,
    responses: { 200: sharedRideSchema },
    errors: [404],
  })
  shared(@Param('token') token: string): Promise<z.infer<typeof sharedRideSchema>> {
    return this.rides.shared(token);
  }
}

/** The rider's trusted contacts for SOS (at most three, encrypted). */
@CarsFeatureRoute('rides')
@Controller('me/emergency-contacts')
export class EmergencyContactsController {
  constructor(private readonly safety: SafetyService) {}

  @Get()
  @Contract({
    operationId: 'getEmergencyContacts',
    summary: 'Emergency contacts',
    tags: ['Account'],
    responses: { 200: emergencyContactsViewSchema },
    errors: [401],
  })
  async get(
    @CurrentAuth() auth: AuthContext,
  ): Promise<z.infer<typeof emergencyContactsViewSchema>> {
    return { contacts: await this.safety.contacts(auth.userId) };
  }

  @Put()
  @Contract({
    operationId: 'setEmergencyContacts',
    summary: 'Replace the emergency contacts',
    tags: ['Account'],
    body: emergencyContactsBodySchema,
    responses: { 200: emergencyContactsViewSchema },
    audit: ['account.emergency_contacts_updated'],
    errors: [401],
  })
  set(
    @CurrentAuth() auth: AuthContext,
    @Body() body: z.output<typeof emergencyContactsBodySchema>,
    @Req() request: Request,
  ): Promise<z.infer<typeof emergencyContactsViewSchema>> {
    return this.safety.setContacts(auth.userId, body.contacts, requestContext(request));
  }
}
