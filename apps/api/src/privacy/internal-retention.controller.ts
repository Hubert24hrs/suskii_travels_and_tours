import { Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { z } from 'zod';

import { Contract, named } from '../contract/contract';
import { InternalRoute } from '../internal/internal-route';

import { RETENTION_RULES, RetentionService, type RetentionRun } from './retention.service';

const retentionRunSchema = named(
  'RetentionRun',
  z.object(
    Object.fromEntries(RETENTION_RULES.map((rule) => [rule, z.number().int().min(0)])) as Record<
      (typeof RETENTION_RULES)[number],
      z.ZodNumber
    >,
  ),
);

/** Worker-only daily retention sweep (ADR-039). */
@InternalRoute()
@Controller('internal/retention')
export class InternalRetentionController {
  constructor(private readonly retention: RetentionService) {}

  @Post('run')
  @HttpCode(HttpStatus.OK)
  @Contract({
    operationId: 'runRetention',
    summary: 'Purge records past their retention period',
    description:
      'Rows removed (or bookings anonymised) per rule. Idempotent; the worker calls it daily.',
    tags: ['Internal'],
    responses: { 200: retentionRunSchema },
    errors: [401, 404],
  })
  run(): Promise<RetentionRun> {
    return this.retention.run();
  }
}
