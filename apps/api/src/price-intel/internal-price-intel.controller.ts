import { Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import type { z } from 'zod';

import { Contract } from '../contract/contract';
import { InternalRoute } from '../internal/internal-route';

import { sweepResultSchema } from './price-intel.schemas';
import { PriceIntelService } from './price-intel.service';

/** Worker-only scheduled reads (ADR-102, the ADR-011 pattern). */
@InternalRoute()
@Controller('internal/price-intel')
export class InternalPriceIntelController {
  constructor(private readonly intel: PriceIntelService) {}

  @Post('sweep')
  @HttpCode(HttpStatus.OK)
  @Contract({
    operationId: 'sweepPriceIntel',
    summary: "Re-read stale answers inside each approved site's local night",
    description:
      'For approved sites whose local hour is inside their night window, re-reads the questions asked of them in the last week whose observations are stale. Bounded per site and per call; answers zeros while price intelligence is off.',
    tags: ['Internal'],
    responses: { 200: sweepResultSchema },
    errors: [401, 404],
  })
  sweep(): Promise<z.infer<typeof sweepResultSchema>> {
    return this.intel.sweep();
  }
}
