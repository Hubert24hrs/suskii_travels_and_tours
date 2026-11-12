import { Controller, Get, Query } from '@nestjs/common';
import type { z } from 'zod';

import { AdminRoute } from '../auth/decorators';
import { Contract } from '../contract/contract';

import { PartnerConversionsService } from './partner-conversions.service';
import {
  partnerSummaryQuerySchema,
  partnerSummarySchema,
  type PartnerSummaryDto,
} from './partners.schemas';

@Controller('admin/partners')
export class AdminPartnersController {
  constructor(private readonly conversions: PartnerConversionsService) {}

  @Get('summary')
  @AdminRoute('reports:read')
  @Contract({
    operationId: 'adminGetPartnerSummary',
    summary: 'Affiliate clicks, conversions and commission per partner for a period',
    description:
      'Defaults to the last 30 days; at most 366. Commission is summed per currency from network postbacks and never converted; cancelled conversions earn nothing.',
    tags: ['Admin'],
    query: partnerSummaryQuerySchema,
    responses: { 200: partnerSummarySchema },
    errors: [403],
  })
  summary(@Query() query: z.infer<typeof partnerSummaryQuerySchema>): Promise<PartnerSummaryDto> {
    return this.conversions.summary(query);
  }
}
