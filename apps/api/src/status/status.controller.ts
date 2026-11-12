import { Controller, Get, Header } from '@nestjs/common';

import { Public } from '../auth/decorators';
import { Contract } from '../contract/contract';

import { statusPageSchema } from './status.schemas';
import { StatusService, type StatusPage } from './status.service';

/**
 * Clients and the edge may reuse an answer for 30 s; while the API does not answer at all,
 * Cloudflare serves the last good copy for a day (`stale-if-error`, ADR-087).
 */
const STATUS_CACHE = 'public, max-age=30, stale-while-revalidate=30, stale-if-error=86400';

@Public()
@Controller('status')
export class StatusController {
  constructor(private readonly status: StatusService) {}

  @Get()
  @Header('Cache-Control', STATUS_CACHE)
  @Contract({
    operationId: 'getStatus',
    summary: 'Service status and incidents',
    description:
      'How search, bookings, payments, accounts and support work right now (measured by the API and declared by open incidents), open incidents and those resolved in the last 7 days. Measured every 30 seconds.',
    tags: ['Status'],
    responses: { 200: statusPageSchema },
  })
  get(): Promise<StatusPage> {
    return this.status.current();
  }
}
