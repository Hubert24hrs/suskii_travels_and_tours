import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';

import type { AuthenticatedRequest } from '../auth/auth-context';
import { Public } from '../auth/decorators';
import { requestContext } from '../common/request-context';
import { Contract } from '../contract/contract';
import { RateLimit, SEARCH_LIMITS, SkipRateLimit } from '../rate-limit/rate-limit.decorator';
import { clientContext } from '../search/client-context';

import { MetasearchService } from './metasearch.service';
import {
  METASEARCH_KEY_HEADER,
  metasearchFlightsQuerySchema,
  metasearchFlightsSchema,
  metasearchLandingBodySchema,
  metasearchLandingSchema,
  type MetasearchFlightsDto,
  type MetasearchFlightsQuery,
  type MetasearchLandingDto,
} from './metasearch.schemas';

const TAGS = ['Metasearch'];

/**
 * Metasearch partners (ADR-081). Public to the user guard: the price API checks the partner's
 * own key and limits, and landings need a sealed deep link.
 */
@Public()
@Controller('metasearch')
export class MetasearchController {
  constructor(private readonly metasearch: MetasearchService) {}

  @Get('flights')
  // Partner limits replace the per-address ones, which would cap a partner's egress address.
  @SkipRateLimit()
  @Contract({
    operationId: 'getMetasearchFlights',
    summary: 'Live flight prices for a metasearch partner',
    description:
      "Cheapest first, up to the partner's maximum. Totals are all-in for every traveller and match the website's price for a guest; each `deepLink` opens the itinerary at that price. 401 without a valid key, 429 above the partner's limits (see Retry-After).",
    tags: TAGS,
    query: metasearchFlightsQuerySchema,
    headers: [METASEARCH_KEY_HEADER],
    responses: { 200: metasearchFlightsSchema },
    errors: [400, 401, 429, 503],
  })
  async flights(
    @Query() query: MetasearchFlightsQuery,
    @Headers('x-api-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<MetasearchFlightsDto> {
    const { partner, window } = await this.metasearch.authenticate(key, requestContext(request).ip);
    if (window) {
      response.setHeader('RateLimit-Limit', String(window.limit));
      response.setHeader('RateLimit-Remaining', String(window.remaining));
      response.setHeader('RateLimit-Reset', String(window.resetSeconds));
    }
    response.setHeader('Cache-Control', 'no-store');
    return this.metasearch.flights(partner, query);
  }

  @Post('landings')
  @HttpCode(HttpStatus.OK)
  @RateLimit(SEARCH_LIMITS.quoteIp)
  @Contract({
    operationId: 'createMetasearchLanding',
    summary: 'Open a metasearch deep link: check the price again and quote the itinerary',
    description:
      "Finds the partner's itinerary in the current results, quotes it with the supplier and compares the total with the one the partner showed. Records the landing; a booking from `quoteId` is attributed to the partner. 404 for an altered or unknown link.",
    tags: TAGS,
    body: metasearchLandingBodySchema,
    responses: { 200: metasearchLandingSchema },
    errors: [404, 503],
  })
  land(
    @Body() body: { token: string },
    @Req() request: AuthenticatedRequest,
  ): Promise<MetasearchLandingDto> {
    return this.metasearch.land(body.token, clientContext(request));
  }
}
