import { Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import type { z } from 'zod';

import { Contract } from '../contract/contract';
import { InternalRoute } from '../internal/internal-route';

import { DriverPayoutsService } from './driver-payouts.service';
import { payoutRunSchema, reconciliationRunSchema } from './finance.schemas';
import { LedgerReconciliationService } from './ledger-reconciliation.service';

const TAGS = ['Internal'];

/** Worker-only money sweeps (ADR-051): ledger reconciliation and driver payout runs. */
@InternalRoute()
@Controller('internal/finance')
export class InternalFinanceController {
  constructor(
    private readonly reconciliation: LedgerReconciliationService,
    private readonly payouts: DriverPayoutsService,
  ) {}

  @Post('reconcile-ledger')
  @HttpCode(HttpStatus.OK)
  @Contract({
    operationId: 'reconcileLedger',
    summary: 'Compare captured payments, refunds and payouts with the ledger and the provider',
    tags: TAGS,
    responses: { 200: reconciliationRunSchema },
    errors: [401],
  })
  reconcile(): Promise<z.infer<typeof reconciliationRunSchema>> {
    return this.reconciliation.run();
  }

  @Post('driver-payouts')
  @HttpCode(HttpStatus.OK)
  @Contract({
    operationId: 'runDriverPayouts',
    summary: 'Follow up pending payouts and send due driver earnings in one batch',
    tags: TAGS,
    responses: { 200: payoutRunSchema },
    errors: [401],
  })
  payout(): Promise<z.infer<typeof payoutRunSchema>> {
    return this.payouts.run();
  }
}
