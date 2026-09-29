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
import type { z } from 'zod';

import { flightSearchRequestSchema, type FlightSearchRequest } from '@suskii/shared';

import type { AuthenticatedRequest } from '../auth/auth-context';
import { Public } from '../auth/decorators';
import { Contract, named } from '../contract/contract';
import { RateLimit, SEARCH_LIMITS } from '../rate-limit/rate-limit.decorator';

import { clientContext } from './client-context';
import { FlightSearchService } from './flight-search.service';
import {
  currencyQuerySchema,
  flightOfferSchema,
  flightOffersQuerySchema,
  flightQuoteSchema,
  flightSearchIdParamsSchema,
  flightSearchResultSchema,
  offerIdParamsSchema,
} from './search.schemas';

const TAGS = ['Flights'];
const requestSchema = named('FlightSearchRequest', flightSearchRequestSchema);

@Public()
@Controller('flights')
export class FlightsController {
  constructor(private readonly flights: FlightSearchService) {}

  @Post('searches')
  @HttpCode(HttpStatus.OK)
  @RateLimit(SEARCH_LIMITS.searchIp, SEARCH_LIMITS.searchIpDaily, SEARCH_LIMITS.searchUser)
  @Contract({
    operationId: 'searchFlights',
    summary: 'Search flights across suppliers',
    description:
      'Calls every enabled supplier in parallel (12 s budget, per-supplier timeouts and circuit breakers). Identical searches are served from cache for a few minutes. When a supplier fails, the others are still returned with status `partial`.',
    tags: TAGS,
    body: requestSchema,
    query: currencyQuerySchema,
    responses: { 200: flightSearchResultSchema },
    errors: [503],
  })
  search(
    @Body() body: FlightSearchRequest,
    @Query() query: z.infer<typeof currencyQuerySchema>,
    @Req() request: AuthenticatedRequest,
  ): Promise<z.infer<typeof flightSearchResultSchema>> {
    return this.flights.search(body, query.currency, clientContext(request));
  }

  @Get('searches/:searchId/offers')
  @Contract({
    operationId: 'listFlightOffers',
    summary: 'Sort, filter and page the offers of a search',
    tags: TAGS,
    params: flightSearchIdParamsSchema,
    query: flightOffersQuerySchema,
    responses: { 200: flightSearchResultSchema },
    errors: [404, 410],
  })
  list(
    @Param('searchId') searchId: string,
    @Query() query: z.infer<typeof flightOffersQuerySchema>,
    @Req() request: AuthenticatedRequest,
  ): Promise<z.infer<typeof flightSearchResultSchema>> {
    return this.flights.list(searchId, query, clientContext(request));
  }

  @Get('offers/:offerId')
  @Contract({
    operationId: 'getFlightOffer',
    summary: 'One offer with fare conditions, baggage and layovers',
    description:
      'Expired offers answer 410 with the original request so the client can search again.',
    tags: TAGS,
    params: offerIdParamsSchema,
    query: currencyQuerySchema,
    responses: { 200: flightOfferSchema },
    errors: [404, 410],
  })
  offer(
    @Param('offerId') offerId: string,
    @Query() query: z.infer<typeof currencyQuerySchema>,
    @Req() request: AuthenticatedRequest,
  ): Promise<z.infer<typeof flightOfferSchema>> {
    return this.flights.offer(offerId, query.currency, clientContext(request));
  }

  @Post('offers/:offerId/quote')
  @RateLimit(SEARCH_LIMITS.quoteIp)
  @Contract({
    operationId: 'quoteFlightOffer',
    summary: 'Confirm the current price with the supplier',
    description:
      'Creates a quote to book from. `priceChange` is set when the total moved since the search: show it and ask for consent.',
    tags: TAGS,
    params: offerIdParamsSchema,
    query: currencyQuerySchema,
    responses: { 201: flightQuoteSchema },
    errors: [404, 410, 503],
  })
  quote(
    @Param('offerId') offerId: string,
    @Query() query: z.infer<typeof currencyQuerySchema>,
    @Req() request: AuthenticatedRequest,
  ): Promise<z.infer<typeof flightQuoteSchema>> {
    return this.flights.quote(offerId, query.currency, clientContext(request));
  }
}
