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

import {
  adminAssistedQuoteListSchema,
  adminAssistedQuoteQuerySchema,
  adminAssistedQuoteSchema,
  assistedQuoteParamsSchema,
  bookedAssistedQuoteSchema,
  closeAssistedQuoteSchema,
  offerAssistedQuoteSchema,
  unbookableAssistedQuoteSchema,
  type OfferAssistedQuoteInput,
} from './assisted-quotes.schemas';
import { AssistedQuotesService } from './assisted-quotes.service';

const TAGS = ['Admin'];
type Quote = z.infer<typeof adminAssistedQuoteSchema>;

/**
 * The assisted-quote queue in the console (ADR-104): requests waiting for a person to verify a
 * price, and paid bookings waiting for a person to book them with the supplier. Verifying is a
 * decision in the approvals queue (`ai:approve`); booking by hand changes a booking
 * (`bookings:manage`). No agent holds either.
 */
@Controller('admin/assisted-quotes')
export class AdminAssistedQuotesController {
  constructor(private readonly quotes: AssistedQuotesService) {}

  @Get()
  @AdminRoute('ai:read')
  @Contract({
    operationId: 'adminListAssistedQuotes',
    summary: 'Requests to verify and paid bookings to book, oldest first',
    tags: TAGS,
    query: adminAssistedQuoteQuerySchema,
    responses: { 200: adminAssistedQuoteListSchema },
    errors: [403, 404],
  })
  async list(
    @Query() query: z.infer<typeof adminAssistedQuoteQuerySchema>,
  ): Promise<z.infer<typeof adminAssistedQuoteListSchema>> {
    return { quotes: await this.quotes.queue(query.queue, query.limit) };
  }

  @Get(':assistedQuoteId')
  @AdminRoute('ai:read')
  @Contract({
    operationId: 'adminGetAssistedQuote',
    summary: 'One request, with what was verified and its booking',
    tags: TAGS,
    params: assistedQuoteParamsSchema,
    responses: { 200: adminAssistedQuoteSchema },
    errors: [403, 404],
  })
  get(@Param('assistedQuoteId') id: string): Promise<Quote> {
    return this.quotes.forStaff(id);
  }

  @Post(':assistedQuoteId/offer')
  @HttpCode(HttpStatus.OK)
  @AdminRoute('ai:approve')
  @Contract({
    operationId: 'adminOfferAssistedQuote',
    summary: 'The live price was verified with the supplier: make the offer',
    description:
      "Creates the offer the traveller can book for `ASSISTED_QUOTE_VALID_MINUTES` and tells them. The traveller's price is the supplier's price through the pricing rules of the `assisted` vertical, never below it. Verifying again replaces the offer. 409 `assisted-quote-closed` once it was withdrawn, closed or booked.",
    tags: TAGS,
    params: assistedQuoteParamsSchema,
    body: offerAssistedQuoteSchema,
    responses: { 200: adminAssistedQuoteSchema },
    errors: [403, 404, 409, 422],
    audit: ['assisted_quote.offered'],
  })
  offer(
    @CurrentAuth() auth: AuthContext,
    @Param('assistedQuoteId') id: string,
    @Body() body: OfferAssistedQuoteInput,
    @Req() request: Request,
  ): Promise<Quote> {
    return this.quotes.offer(id, body, staffActor(auth, request));
  }

  @Post(':assistedQuoteId/close')
  @HttpCode(HttpStatus.OK)
  @AdminRoute('ai:approve')
  @Contract({
    operationId: 'adminCloseAssistedQuote',
    summary: 'It cannot be had: close the request and tell the traveller',
    tags: TAGS,
    params: assistedQuoteParamsSchema,
    body: closeAssistedQuoteSchema,
    responses: { 200: adminAssistedQuoteSchema },
    errors: [403, 404, 409],
    audit: ['assisted_quote.closed'],
  })
  close(
    @CurrentAuth() auth: AuthContext,
    @Param('assistedQuoteId') id: string,
    @Body() body: z.infer<typeof closeAssistedQuoteSchema>,
    @Req() request: Request,
  ): Promise<Quote> {
    return this.quotes.close(id, body.reason, staffActor(auth, request));
  }

  @Post(':assistedQuoteId/booked')
  @HttpCode(HttpStatus.OK)
  @AdminRoute('bookings:manage')
  @Contract({
    operationId: 'adminMarkAssistedQuoteBooked',
    summary: 'The paid booking was booked with the supplier: record its confirmation',
    description:
      "Only this confirms the booking: it moves to `CONFIRMED` and the traveller gets the confirmation email with the supplier's reference. 409 `assisted-booking-not-waiting` when the booking is unpaid, held for a payment review, already booked or already refunded.",
    tags: TAGS,
    params: assistedQuoteParamsSchema,
    body: bookedAssistedQuoteSchema,
    responses: { 200: adminAssistedQuoteSchema },
    errors: [403, 404, 409],
    audit: ['assisted_quote.booked'],
  })
  booked(
    @CurrentAuth() auth: AuthContext,
    @Param('assistedQuoteId') id: string,
    @Body() body: z.infer<typeof bookedAssistedQuoteSchema>,
    @Req() request: Request,
  ): Promise<Quote> {
    return this.quotes.booked(id, body, staffActor(auth, request));
  }

  @Post(':assistedQuoteId/unbookable')
  @HttpCode(HttpStatus.OK)
  @AdminRoute('bookings:manage')
  @Contract({
    operationId: 'adminMarkAssistedQuoteUnbookable',
    summary: 'The paid booking could not be booked: refund it in full',
    description:
      'The booking moves to `REFUND_PENDING` and everything the traveller paid goes back through the refund pipeline. 409 `assisted-booking-not-waiting` when there is nothing waiting to be booked.',
    tags: TAGS,
    params: assistedQuoteParamsSchema,
    body: unbookableAssistedQuoteSchema,
    responses: { 200: adminAssistedQuoteSchema },
    errors: [403, 404, 409],
    audit: ['assisted_quote.unbookable'],
  })
  unbookable(
    @CurrentAuth() auth: AuthContext,
    @Param('assistedQuoteId') id: string,
    @Body() body: z.infer<typeof unbookableAssistedQuoteSchema>,
    @Req() request: Request,
  ): Promise<Quote> {
    return this.quotes.unbookable(id, body.reason, staffActor(auth, request));
  }
}
