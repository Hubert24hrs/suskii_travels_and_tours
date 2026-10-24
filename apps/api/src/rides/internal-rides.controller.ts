import { Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import type { z } from 'zod';

import { Contract } from '../contract/contract';
import { InternalRoute } from '../internal/internal-route';

import { RideDispatchService } from './ride-dispatch.service';
import { dispatchRunSchema } from './rides.schemas';

const TAGS = ['Internal'];

/** Worker-only ride matching (ADR-053), called every few seconds. */
@InternalRoute()
@Controller('internal/rides')
export class InternalRidesController {
  constructor(private readonly dispatch: RideDispatchService) {}

  @Post('dispatch')
  @HttpCode(HttpStatus.OK)
  @Contract({
    operationId: 'dispatchRides',
    summary: 'Start scheduled rides, expire offers, time out searches and offer rides to drivers',
    description: 'Does nothing while rides are off or another run holds the lock.',
    tags: TAGS,
    responses: { 200: dispatchRunSchema },
    errors: [401, 404],
  })
  run(): Promise<z.infer<typeof dispatchRunSchema>> {
    return this.dispatch.run();
  }
}
