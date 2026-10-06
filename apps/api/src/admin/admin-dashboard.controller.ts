import { Controller, Get, Query } from '@nestjs/common';
import type { z } from 'zod';

import { AdminRoute } from '../auth/decorators';
import { Contract } from '../contract/contract';

import { adminDashboardSchema, dashboardQuerySchema } from './admin-dashboard.schemas';
import { AdminDashboardService } from './admin-dashboard.service';

@Controller('admin/dashboard')
export class AdminDashboardController {
  constructor(private readonly dashboard: AdminDashboardService) {}

  @Get()
  @AdminRoute('reports:read')
  @Contract({
    operationId: 'adminGetDashboard',
    summary: 'Bookings, money, work queues and top routes for a period',
    description:
      'Defaults to the last 30 days; at most 366. Money is summed from the ledger per currency.',
    tags: ['Admin'],
    query: dashboardQuerySchema,
    responses: { 200: adminDashboardSchema },
    errors: [403],
  })
  summary(
    @Query() query: z.infer<typeof dashboardQuerySchema>,
  ): Promise<z.infer<typeof adminDashboardSchema>> {
    return this.dashboard.summary(query);
  }
}
