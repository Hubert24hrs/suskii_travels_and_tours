import { Controller, Get, Header } from '@nestjs/common';
import { z } from 'zod';

import { Public } from '../auth/decorators';
import { Contract, named } from '../contract/contract';
import { CARS_LIMITS, RateLimit } from '../rate-limit/rate-limit.decorator';

import { CarsFlags } from './cars-flags';

const carsFeaturesSchema = named(
  'CarsFeatures',
  z.object({
    buses: z.boolean(),
    rides: z.boolean(),
    rentals: z.boolean(),
    bundles: z.boolean(),
    priceBreakdown: z.boolean(),
    safetySuite: z.boolean(),
    offlineQr: z.boolean(),
    departurePlanner: z.boolean(),
  }),
);

/**
 * Which Cars products and features are switched on (ADR-049), so the website and the app show
 * only what works. Switched-off routes still answer 404 whatever a client shows.
 */
@Controller('cars')
export class CarsFeaturesController {
  constructor(private readonly flags: CarsFlags) {}

  @Get('features')
  @Public()
  @RateLimit(CARS_LIMITS.catalogIp)
  @Header('Cache-Control', 'public, max-age=60')
  @Contract({
    operationId: 'getCarsFeatures',
    summary: 'Cars products and features that are switched on',
    tags: ['Cars'],
    responses: { 200: carsFeaturesSchema },
  })
  features(): z.infer<typeof carsFeaturesSchema> {
    return {
      buses: this.flags.enabled('buses'),
      rides: this.flags.enabled('rides'),
      rentals: this.flags.enabled('rentals'),
      bundles: this.flags.enabled('bundles'),
      priceBreakdown: this.flags.enabled('price_breakdown'),
      safetySuite: this.flags.enabled('safety_suite'),
      offlineQr: this.flags.enabled('offline_qr'),
      departurePlanner: this.flags.enabled('departure_planner'),
    };
  }
}
