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
import type { Request } from 'express';
import type { z } from 'zod';

import { staffActor } from '../admin/admin-helpers';
import { CurrentAuth, type AuthContext } from '../auth/auth-context';
import { AdminRoute } from '../auth/decorators';
import { Contract } from '../contract/contract';

import { FinanceAdminService } from './finance-admin.service';
import {
  adminPayoutListSchema,
  discrepancyIdParamsSchema,
  discrepancyListSchema,
  discrepancyQuerySchema,
  payoutQuerySchema,
  resolveDiscrepancySchema,
} from './finance.schemas';

const TAGS = ['Admin'];

/**
 * Finance (`finance:reconcile`, ADR-051): where the ledger and the payment provider disagree,
 * and driver payouts. Not behind a Cars flag: money owed or misbooked is reviewed regardless.
 */
@Controller('admin/finance')
export class AdminFinanceController {
  constructor(private readonly finance: FinanceAdminService) {}

  @Get('discrepancies')
  @AdminRoute('finance:reconcile')
  @Contract({
    operationId: 'adminListReconciliationDiscrepancies',
    summary: 'Ledger reconciliation discrepancies (open first-detected first)',
    tags: TAGS,
    query: discrepancyQuerySchema,
    responses: { 200: discrepancyListSchema },
    errors: [403],
  })
  discrepancies(
    @Query() query: z.output<typeof discrepancyQuerySchema>,
  ): Promise<z.infer<typeof discrepancyListSchema>> {
    return this.finance.discrepancies(query.status);
  }

  @Post('discrepancies/:id/resolve')
  @HttpCode(HttpStatus.NO_CONTENT)
  @AdminRoute('finance:reconcile')
  @Contract({
    operationId: 'adminResolveReconciliationDiscrepancy',
    summary: 'Resolve a discrepancy as corrected (checked again) or accepted',
    description: '409 `discrepancy-resolved` when it is no longer open.',
    tags: TAGS,
    params: discrepancyIdParamsSchema,
    body: resolveDiscrepancySchema,
    responses: { 204: null },
    audit: ['reconciliation.discrepancy_resolved'],
    errors: [403, 404, 409],
  })
  async resolve(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Body() body: z.output<typeof resolveDiscrepancySchema>,
    @Req() request: Request,
  ): Promise<void> {
    await this.finance.resolve(id, body, staffActor(auth, request));
  }

  @Get('payouts')
  @AdminRoute('finance:reconcile')
  @Contract({
    operationId: 'adminListDriverPayouts',
    summary: 'Driver payouts, newest first (no bank details)',
    tags: TAGS,
    query: payoutQuerySchema,
    responses: { 200: adminPayoutListSchema },
    errors: [403],
  })
  payouts(
    @Query() query: z.output<typeof payoutQuerySchema>,
  ): Promise<z.infer<typeof adminPayoutListSchema>> {
    return this.finance.payouts(query);
  }
}
