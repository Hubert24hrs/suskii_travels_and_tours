import { Controller, Get, Header, Param, Query, Req } from '@nestjs/common';
import type { z } from 'zod';

import type { AuthenticatedRequest } from '../auth/auth-context';
import { Public } from '../auth/decorators';
import { Contract } from '../contract/contract';
import { clientContext } from '../search/client-context';

import {
  currencyOnlyQuerySchema,
  destinationParamsSchema,
  hotelDestinationSchema,
  hotelDestinationsSchema,
} from './deals.schemas';
import { DestinationsService } from './destinations.service';

const TAGS = ['Destinations'];
const PRICED_CACHE = 'public, max-age=60, stale-while-revalidate=300';

@Public()
@Controller('destinations')
export class DestinationsController {
  constructor(private readonly destinations: DestinationsService) {}

  @Get('hotels')
  @Header('Cache-Control', PRICED_CACHE)
  @Header('Vary', 'X-Suskii-Client')
  @Contract({
    operationId: 'listHotelDestinations',
    summary: 'Featured hotel destinations with "from" nightly prices',
    tags: TAGS,
    query: currencyOnlyQuerySchema,
    responses: { 200: hotelDestinationsSchema },
  })
  featured(
    @Query() query: z.infer<typeof currencyOnlyQuerySchema>,
    @Req() request: AuthenticatedRequest,
  ): Promise<z.infer<typeof hotelDestinationsSchema>> {
    return this.destinations.featured(query.currency, clientContext(request));
  }

  @Get('hotels/:slug')
  @Header('Cache-Control', PRICED_CACHE)
  @Header('Vary', 'X-Suskii-Client')
  @Contract({
    operationId: 'getHotelDestination',
    summary: 'A published hotel destination',
    tags: TAGS,
    params: destinationParamsSchema,
    query: currencyOnlyQuerySchema,
    responses: { 200: hotelDestinationSchema },
    errors: [404],
  })
  bySlug(
    @Param('slug') slug: string,
    @Query() query: z.infer<typeof currencyOnlyQuerySchema>,
    @Req() request: AuthenticatedRequest,
  ): Promise<z.infer<typeof hotelDestinationSchema>> {
    return this.destinations.bySlug(slug, query.currency, clientContext(request));
  }
}
