import { Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import type { z } from 'zod';

import { Contract } from '../contract/contract';
import { InternalRoute } from '../internal/internal-route';

import {
  expiryRunSchema,
  paymentRunSchema,
  planRunSchema,
  refundRunSchema,
  ticketingRunSchema,
} from './bookings.schemas';
import { CheckoutService } from './checkout.service';
import { PaymentPlansService } from './payment-plans.service';
import { PaymentReconciliationService } from './payment-reconciliation.service';
import { RefundsService } from './refunds.service';
import { TicketingService } from './ticketing.service';

const TAGS = ['Internal'];

/** Worker-only booking and money housekeeping, called every minute (ADR-014, ADR-016 to 019). */
@InternalRoute()
@Controller('internal/bookings')
export class InternalBookingsController {
  constructor(
    private readonly checkout: CheckoutService,
    private readonly ticketing: TicketingService,
    private readonly reconciliation: PaymentReconciliationService,
    private readonly plans: PaymentPlansService,
    private readonly refunds: RefundsService,
  ) {}

  @Post('expire-due')
  @HttpCode(HttpStatus.OK)
  @Contract({
    operationId: 'expireDueBookings',
    summary: 'Expire unpaid bookings past their payment deadline',
    tags: TAGS,
    responses: { 200: expiryRunSchema },
    errors: [401, 404],
  })
  async expire(): Promise<z.infer<typeof expiryRunSchema>> {
    return { expired: await this.checkout.expireDue() };
  }

  @Post('ticket-due')
  @HttpCode(HttpStatus.OK)
  @Contract({
    operationId: 'ticketDueBookings',
    summary: 'Ticket paid bookings and retry due ticketing attempts',
    tags: TAGS,
    responses: { 200: ticketingRunSchema },
    errors: [401, 404],
  })
  async ticket(): Promise<z.infer<typeof ticketingRunSchema>> {
    const { attempted, confirmed, retrying, exhausted } = await this.ticketing.processDue();
    return { attempted, confirmed, retrying, exhausted };
  }

  @Post('reconcile-payments')
  @HttpCode(HttpStatus.OK)
  @Contract({
    operationId: 'reconcileBookingPayments',
    summary: 'Verify stale pending payments with their provider (lost webhooks)',
    tags: TAGS,
    responses: { 200: paymentRunSchema },
    errors: [401, 404],
  })
  reconcile(): Promise<z.infer<typeof paymentRunSchema>> {
    return this.reconciliation.reconcileDue();
  }

  @Post('payment-plans-due')
  @HttpCode(HttpStatus.OK)
  @Contract({
    operationId: 'processDuePaymentPlans',
    summary: 'Send payment reminders and close plans that missed a payment',
    tags: TAGS,
    responses: { 200: planRunSchema },
    errors: [401, 404],
  })
  plansDue(): Promise<z.infer<typeof planRunSchema>> {
    return this.plans.processDue();
  }

  @Post('refunds-due')
  @HttpCode(HttpStatus.OK)
  @Contract({
    operationId: 'processDueRefunds',
    summary: 'Execute approved refunds and follow up pending ones',
    tags: TAGS,
    responses: { 200: refundRunSchema },
    errors: [401, 404],
  })
  refundsDue(): Promise<z.infer<typeof refundRunSchema>> {
    return this.refunds.processDue();
  }
}
