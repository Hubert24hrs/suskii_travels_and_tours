import { Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import type { z } from 'zod';

import { Contract } from '../contract/contract';
import { InternalRoute } from '../internal/internal-route';

import { expiryRunSchema, ticketingRunSchema } from './bookings.schemas';
import { CheckoutService } from './checkout.service';
import { TicketingService } from './ticketing.service';

const TAGS = ['Internal'];

/** Worker-only booking housekeeping, called every minute (ADR-014). */
@InternalRoute()
@Controller('internal/bookings')
export class InternalBookingsController {
  constructor(
    private readonly checkout: CheckoutService,
    private readonly ticketing: TicketingService,
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
}
