import { Controller, Get, Header, Param, Query, Req } from '@nestjs/common';
import type { z } from 'zod';

import type { AuthenticatedRequest } from '../auth/auth-context';
import { Public } from '../auth/decorators';
import { Contract } from '../contract/contract';
import { clientContext } from '../search/client-context';

import {
  currencyOnlyQuerySchema,
  dealRouteParamsSchema,
  dealRouteSchema,
  dealRoutesSchema,
  dealsQuerySchema,
  flightDealsSchema,
} from './deals.schemas';
import { DealsService } from './deals.service';

const TAGS = ['Deals'];
/** Prices depend on the sales channel header; shared caches must key on it. */
const PRICED_CACHE = 'public, max-age=60, stale-while-revalidate=300';

@Public()
@Controller('deals')
export class DealsController {
  constructor(private readonly deals: DealsService) {}

  @Get('flights')
  @Header('Cache-Control', PRICED_CACHE)
  @Header('Vary', 'X-Suskii-Client')
  @Contract({
    operationId: 'listFlightDeals',
    summary: 'Fresh flight deals on popular routes',
    description:
      'Latest cheapest fare per route found by the deals worker within DEALS_MAX_AGE_HOURS, priced with current rules. Mock supplier fares are flagged `sample`.',
    tags: TAGS,
    query: dealsQuerySchema,
    responses: { 200: flightDealsSchema },
  })
  list(
    @Query() query: z.infer<typeof dealsQuerySchema>,
    @Req() request: AuthenticatedRequest,
  ): Promise<z.infer<typeof flightDealsSchema>> {
    return this.deals.list(query, clientContext(request));
  }

  @Get('routes')
  @Header('Cache-Control', 'public, max-age=300')
  @Contract({
    operationId: 'listDealRoutes',
    summary: 'Popular routes (SEO route pages and sitemap)',
    tags: TAGS,
    responses: { 200: dealRoutesSchema },
  })
  routes(): Promise<z.infer<typeof dealRoutesSchema>> {
    return this.deals.routes();
  }

  @Get('routes/:slug')
  @Header('Cache-Control', PRICED_CACHE)
  @Header('Vary', 'X-Suskii-Client')
  @Contract({
    operationId: 'getDealRoute',
    summary: 'A popular route with its latest fresh fare',
    tags: TAGS,
    params: dealRouteParamsSchema,
    query: currencyOnlyQuerySchema,
    responses: { 200: dealRouteSchema },
    errors: [404],
  })
  route(
    @Param('slug') slug: string,
    @Query() query: z.infer<typeof currencyOnlyQuerySchema>,
    @Req() request: AuthenticatedRequest,
  ): Promise<z.infer<typeof dealRouteSchema>> {
    return this.deals.route(slug, query.currency, clientContext(request));
  }
}
