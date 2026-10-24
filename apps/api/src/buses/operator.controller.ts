import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import type { z } from 'zod';

import { CurrentAuth, type AuthContext } from '../auth/auth-context';
import { RequirePermissions } from '../auth/decorators';
import { requestContext } from '../common/request-context';
import { Contract } from '../contract/contract';
import { CarsFeatureRoute } from '../ground/cars-flags';
import { CARS_LIMITS, RateLimit } from '../rate-limit/rate-limit.decorator';

import { BusTicketsService, type Agent } from './bus-tickets.service';
import {
  manifestSchema,
  operatorTripListSchema,
  operatorTripsQuerySchema,
  scanRequestSchema,
  scanResultSchema,
  syncScansRequestSchema,
  syncScansResultSchema,
  tripIdParamsSchema,
} from './buses.schemas';

const TAGS = ['Bus operators'];

const agent = (auth: AuthContext, request: Request): Agent => ({
  userId: auth.userId,
  context: requestContext(request),
});

/**
 * Boarding for bus operators' agents (role `operator_agent`, ADR-050): the day's departures of
 * their own operators, the manifest and ticket scans. Other operators' trips and tickets answer
 * 404 or `not_found`, as if they did not exist.
 */
@CarsFeatureRoute('buses')
@RequirePermissions('tickets:scan')
@Controller('operator')
export class OperatorController {
  constructor(private readonly tickets: BusTicketsService) {}

  @Get('trips')
  @Contract({
    operationId: 'listOperatorTrips',
    summary: "Departures of the agent's operators on a date",
    tags: TAGS,
    query: operatorTripsQuerySchema,
    responses: { 200: operatorTripListSchema },
    errors: [401, 403],
  })
  trips(
    @CurrentAuth() auth: AuthContext,
    @Query() query: z.output<typeof operatorTripsQuerySchema>,
  ): Promise<z.infer<typeof operatorTripListSchema>> {
    return this.tickets.trips(auth.userId, query.date);
  }

  @Get('trips/:tripId/manifest')
  @Contract({
    operationId: 'getBusManifest',
    summary: 'Passengers and boarding status of a departure',
    tags: TAGS,
    params: tripIdParamsSchema,
    responses: { 200: manifestSchema },
    errors: [401, 403, 404],
  })
  manifest(
    @CurrentAuth() auth: AuthContext,
    @Param('tripId') tripId: string,
  ): Promise<z.infer<typeof manifestSchema>> {
    return this.tickets.manifest(auth.userId, tripId);
  }

  @Post('tickets/scan')
  @HttpCode(HttpStatus.OK)
  @RateLimit(CARS_LIMITS.scanUser)
  @Contract({
    operationId: 'scanBusTicket',
    summary: 'Board a passenger by their ticket QR code',
    description:
      'Checks the signature and boarding window, then boards the ticket once: `boarded`, `already_boarded` (with the first boarding time), `void` (cancelled or refunded), `not_found` or `invalid` with a reason.',
    tags: TAGS,
    body: scanRequestSchema,
    responses: { 200: scanResultSchema },
    errors: [401, 403],
  })
  scan(
    @CurrentAuth() auth: AuthContext,
    @Body() body: z.output<typeof scanRequestSchema>,
    @Req() request: Request,
  ): Promise<z.infer<typeof scanResultSchema>> {
    return this.tickets.scan(body.qrPayload, agent(auth, request));
  }

  @Post('tickets/sync')
  @HttpCode(HttpStatus.OK)
  @RateLimit(CARS_LIMITS.scanUser)
  @Contract({
    operationId: 'syncBusTicketScans',
    summary: 'Upload scans made offline',
    description:
      'Up to 200 scans, applied in the order they were made. A ticket boarded twice (two offline devices) answers `already_boarded` and is audited.',
    tags: TAGS,
    body: syncScansRequestSchema,
    responses: { 200: syncScansResultSchema },
    errors: [401, 403],
  })
  async sync(
    @CurrentAuth() auth: AuthContext,
    @Body() body: z.output<typeof syncScansRequestSchema>,
    @Req() request: Request,
  ): Promise<z.infer<typeof syncScansResultSchema>> {
    return { results: await this.tickets.sync(body.scans, agent(auth, request)) };
  }
}
