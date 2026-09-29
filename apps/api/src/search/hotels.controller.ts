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

import { hotelSearchRequestSchema, type HotelSearchRequest } from '@suskii/shared';

import type { AuthenticatedRequest } from '../auth/auth-context';
import { Public } from '../auth/decorators';
import { Contract, named } from '../contract/contract';
import { RateLimit, SEARCH_LIMITS } from '../rate-limit/rate-limit.decorator';

import { clientContext } from './client-context';
import { HotelSearchService } from './hotel-search.service';
import {
  currencyQuerySchema,
  hotelDetailSchema,
  hotelQuoteSchema,
  hotelResultParamsSchema,
  hotelSearchIdParamsSchema,
  hotelSearchResultSchema,
  hotelsQuerySchema,
  rateIdParamsSchema,
} from './search.schemas';

const TAGS = ['Hotels'];
const requestSchema = named('HotelSearchRequest', hotelSearchRequestSchema);

@Public()
@Controller('hotels')
export class HotelsController {
  constructor(private readonly hotels: HotelSearchService) {}

  @Post('searches')
  @HttpCode(HttpStatus.OK)
  @RateLimit(SEARCH_LIMITS.searchIp, SEARCH_LIMITS.searchIpDaily, SEARCH_LIMITS.searchUser)
  @Contract({
    operationId: 'searchHotels',
    summary: 'Search hotels in a city',
    tags: TAGS,
    body: requestSchema,
    query: currencyQuerySchema,
    responses: { 200: hotelSearchResultSchema },
    errors: [503],
  })
  search(
    @Body() body: HotelSearchRequest,
    @Query() query: z.infer<typeof currencyQuerySchema>,
    @Req() request: AuthenticatedRequest,
  ): Promise<z.infer<typeof hotelSearchResultSchema>> {
    return this.hotels.search(body, query.currency, clientContext(request));
  }

  @Get('searches/:searchId/hotels')
  @Contract({
    operationId: 'listHotels',
    summary: 'Sort, filter and page the hotels of a search',
    tags: TAGS,
    params: hotelSearchIdParamsSchema,
    query: hotelsQuerySchema,
    responses: { 200: hotelSearchResultSchema },
    errors: [404, 410],
  })
  list(
    @Param('searchId') searchId: string,
    @Query() query: z.infer<typeof hotelsQuerySchema>,
    @Req() request: AuthenticatedRequest,
  ): Promise<z.infer<typeof hotelSearchResultSchema>> {
    return this.hotels.list(searchId, query, clientContext(request));
  }

  @Get('results/:hotelId')
  @Contract({
    operationId: 'getHotel',
    summary: 'A hotel from a search with every room rate',
    tags: TAGS,
    params: hotelResultParamsSchema,
    query: currencyQuerySchema,
    responses: { 200: hotelDetailSchema },
    errors: [404, 410],
  })
  hotel(
    @Param('hotelId') hotelId: string,
    @Query() query: z.infer<typeof currencyQuerySchema>,
    @Req() request: AuthenticatedRequest,
  ): Promise<z.infer<typeof hotelDetailSchema>> {
    return this.hotels.hotel(hotelId, query.currency, clientContext(request));
  }

  @Post('rates/:rateId/quote')
  @RateLimit(SEARCH_LIMITS.quoteIp)
  @Contract({
    operationId: 'quoteHotelRate',
    summary: 'Confirm the current price of a room rate',
    tags: TAGS,
    params: rateIdParamsSchema,
    query: currencyQuerySchema,
    responses: { 201: hotelQuoteSchema },
    errors: [404, 410, 503],
  })
  quote(
    @Param('rateId') rateId: string,
    @Query() query: z.infer<typeof currencyQuerySchema>,
    @Req() request: AuthenticatedRequest,
  ): Promise<z.infer<typeof hotelQuoteSchema>> {
    return this.hotels.quote(rateId, query.currency, clientContext(request));
  }
}
