import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { z } from 'zod';

import type { AuthenticatedRequest } from '../auth/auth-context';
import { Public } from '../auth/decorators';
import { requestContext } from '../common/request-context';
import { Contract } from '../contract/contract';
import { CarsFeatureRoute } from '../ground/cars-flags';
import { CARS_LIMITS, RateLimit } from '../rate-limit/rate-limit.decorator';
import { clientContext } from '../search/client-context';

import { BusHoldsService } from './bus-holds.service';
import { BusTicketsService } from './bus-tickets.service';
import {
  busCitiesSchema,
  busHoldSchema,
  busSearchQuerySchema,
  busSearchResultSchema,
  busTripDetailSchema,
  busTripQuerySchema,
  createHoldSchema,
  HOLD_TOKEN_HEADER,
  holdIdParamsSchema,
  ticketKeysSchema,
  tripIdParamsSchema,
  type BusSearchQuery,
  type CreateHoldRequest,
} from './buses.schemas';
import { BusesService } from './buses.service';

const TAGS = ['Buses'];

const holdToken = (request: AuthenticatedRequest): string | null => {
  const value = request.headers[HOLD_TOKEN_HEADER.name.toLowerCase()];
  return typeof value === 'string' && value.length <= 100 ? value : null;
};

/**
 * Interstate buses for travellers (ADR-049, ADR-051): cities, search, seat maps and ten-minute
 * seat holds, which a quote (`createInhouseQuote`, kind `bus`) and a booking then use. Holds are
 * open to guests; a guest proves a hold with its token.
 */
@Public()
@CarsFeatureRoute('buses')
@Controller('buses')
export class BusesController {
  constructor(
    private readonly buses: BusesService,
    private readonly holds: BusHoldsService,
    private readonly tickets: BusTicketsService,
  ) {}

  @Get('cities')
  @RateLimit(CARS_LIMITS.catalogIp)
  @Contract({
    operationId: 'listBusCities',
    summary: 'Cities with bus terminals',
    tags: TAGS,
    responses: { 200: busCitiesSchema },
  })
  cities(): Promise<z.infer<typeof busCitiesSchema>> {
    return this.buses.cities();
  }

  @Get('search')
  @RateLimit(CARS_LIMITS.catalogIp)
  @Contract({
    operationId: 'searchBuses',
    summary: 'Bus departures between two cities on a date',
    description:
      'Departures with at least `seats` seats left, priced per seat for the caller. Sales close 30 minutes before departure.',
    tags: TAGS,
    query: busSearchQuerySchema,
    responses: { 200: busSearchResultSchema },
  })
  async search(
    @Query() query: BusSearchQuery,
    @Req() request: AuthenticatedRequest,
  ): Promise<z.infer<typeof busSearchResultSchema>> {
    return { trips: await this.buses.search(query, clientContext(request)) };
  }

  @Get('trips/:tripId')
  @RateLimit(CARS_LIMITS.catalogIp)
  @Contract({
    operationId: 'getBusTrip',
    summary: 'A bus departure with its live seat map',
    description: '409 `trip-closed` once the departure is no longer on sale.',
    tags: TAGS,
    params: tripIdParamsSchema,
    query: busTripQuerySchema,
    responses: { 200: busTripDetailSchema },
    errors: [404, 409],
  })
  trip(
    @Param('tripId') tripId: string,
    @Query() query: z.output<typeof busTripQuerySchema>,
    @Req() request: AuthenticatedRequest,
  ): Promise<z.infer<typeof busTripDetailSchema>> {
    return this.buses.detail(tripId, query.currency, clientContext(request));
  }

  @Post('trips/:tripId/holds')
  @RateLimit(CARS_LIMITS.holdIp, CARS_LIMITS.holdUser)
  @Contract({
    operationId: 'createBusHold',
    summary: 'Hold seats for ten minutes',
    description:
      'Every seat is held or none (409 `seat-taken`). At most six seats per hold and two live holds per account (guests: per address), else 409 `hold-limit`. 422 `seat-invalid` for seats not on the map. Pay for the booking before `expiresAt`.',
    tags: TAGS,
    params: tripIdParamsSchema,
    body: createHoldSchema,
    responses: { 201: busHoldSchema },
    errors: [404, 409, 422],
  })
  async hold(
    @Param('tripId') tripId: string,
    @Body() body: CreateHoldRequest,
    @Req() request: AuthenticatedRequest,
  ): Promise<z.infer<typeof busHoldSchema>> {
    const hold = await this.holds.create(tripId, body.seats, {
      userId: clientContext(request).userId,
      ip: requestContext(request).ip,
    });
    return { ...hold, expiresAt: hold.expiresAt.toISOString() };
  }

  @Delete('holds/:holdId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RateLimit(CARS_LIMITS.holdIp)
  @Contract({
    operationId: 'releaseBusHold',
    summary: 'Release held seats',
    description:
      'Guests send the hold token in `X-Hold-Token`. A booked hold stays with its booking.',
    tags: TAGS,
    headers: [HOLD_TOKEN_HEADER],
    params: holdIdParamsSchema,
    responses: { 204: null },
    errors: [404],
  })
  async release(
    @Param('holdId') holdId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<void> {
    await this.holds.release(holdId, {
      userId: clientContext(request).userId,
      ip: requestContext(request).ip,
      holdToken: holdToken(request),
    });
  }

  @Get('ticket-keys')
  @RateLimit(CARS_LIMITS.catalogIp)
  @Contract({
    operationId: 'getBusTicketKeys',
    summary: 'Public keys for checking ticket QR codes offline',
    tags: TAGS,
    responses: { 200: ticketKeysSchema },
  })
  keys(): z.infer<typeof ticketKeysSchema> {
    return this.tickets.keys();
  }
}
