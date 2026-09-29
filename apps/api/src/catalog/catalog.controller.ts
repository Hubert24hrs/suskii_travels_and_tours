import { Controller, Get, Header, NotFoundException, Param, Query } from '@nestjs/common';
import type { z } from 'zod';

import { Public } from '../auth/decorators';
import { Contract } from '../contract/contract';

import {
  airportParamsSchema,
  airportSchema,
  cityDetailSchema,
  cityParamsSchema,
  countriesSchema,
  placesQuerySchema,
  placeSuggestionsSchema,
  popularPlacesSchema,
} from './catalog.schemas';
import { CatalogService } from './catalog.service';

const TAGS = ['Catalog'];
/** Reference data changes only when the seed runs; CDNs may serve it for a day. */
const CACHE_ONE_DAY = 'public, max-age=86400, stale-while-revalidate=604800';

@Public()
@Controller('catalog')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('places')
  @Header('Cache-Control', 'public, max-age=300')
  @Contract({
    operationId: 'suggestPlaces',
    summary: 'Airport and city autocomplete',
    description:
      'Matches IATA codes exactly and names by prefix and typo-tolerant trigram similarity, ignoring accents. Cities list their airports.',
    tags: TAGS,
    query: placesQuerySchema,
    responses: { 200: placeSuggestionsSchema },
  })
  async places(
    @Query() query: z.infer<typeof placesQuerySchema>,
  ): Promise<z.infer<typeof placeSuggestionsSchema>> {
    const types = query.types.split(',') as ('airport' | 'city')[];
    return { items: await this.catalog.suggest(query.q, types, query.limit) };
  }

  @Get('places/popular')
  @Header('Cache-Control', CACHE_ONE_DAY)
  @Contract({
    operationId: 'getPopularPlaces',
    summary: 'Compact airport index for instant client-side suggestions',
    description:
      'Large airports worldwide plus every airport in Nigeria. Cache at the edge; use /catalog/places for the long tail.',
    tags: TAGS,
    responses: { 200: popularPlacesSchema },
  })
  popular(): Promise<z.infer<typeof popularPlacesSchema>> {
    return this.catalog.popularPlaces();
  }

  @Get('airports/:iataCode')
  @Header('Cache-Control', CACHE_ONE_DAY)
  @Contract({
    operationId: 'getAirport',
    summary: 'Airport by IATA code',
    tags: TAGS,
    params: airportParamsSchema,
    responses: { 200: airportSchema },
    errors: [404],
  })
  async airport(@Param('iataCode') iataCode: string): Promise<z.infer<typeof airportSchema>> {
    const airport = await this.catalog.airport(iataCode);
    if (!airport) throw new NotFoundException();
    return airport;
  }

  @Get('cities/:cityId')
  @Header('Cache-Control', CACHE_ONE_DAY)
  @Contract({
    operationId: 'getCity',
    summary: 'City by id',
    tags: TAGS,
    params: cityParamsSchema,
    responses: { 200: cityDetailSchema },
    errors: [404],
  })
  async city(@Param('cityId') cityId: string): Promise<z.infer<typeof cityDetailSchema>> {
    const city = await this.catalog.cityDetail(cityId);
    if (!city) throw new NotFoundException();
    return city;
  }

  @Get('countries')
  @Header('Cache-Control', CACHE_ONE_DAY)
  @Contract({
    operationId: 'listCountries',
    summary: 'Countries (ISO 3166-1)',
    tags: TAGS,
    responses: { 200: countriesSchema },
  })
  async countries(): Promise<z.infer<typeof countriesSchema>> {
    return { items: await this.catalog.countries() };
  }
}
