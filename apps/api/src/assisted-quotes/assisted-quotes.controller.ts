import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import type { z } from 'zod';

import type { AssistedQuoteInput } from '@suskii/shared';

import { CurrentAuth, type AuthContext } from '../auth/auth-context';
import { Contract } from '../contract/contract';
import { ASSISTED_QUOTE_LIMITS, RateLimit } from '../rate-limit/rate-limit.decorator';

import {
  assistedQuoteBodySchema,
  assistedQuoteListSchema,
  assistedQuoteParamsSchema,
  assistedQuoteSchema,
} from './assisted-quotes.schemas';
import { AssistedQuotesService } from './assisted-quotes.service';

const TAGS = ['Quotes'];

/**
 * Assisted quotes for the signed-in traveller (ADR-104): ask for a price to be confirmed by a
 * person, read the answer, withdraw. Booking the offer is the ordinary checkout. Every route
 * acts on the caller's own requests; anyone else's answers 404.
 */
@Controller('quotes/assisted')
export class AssistedQuotesController {
  constructor(private readonly quotes: AssistedQuotesService) {}

  @Post()
  @RateLimit(ASSISTED_QUOTE_LIMITS.requestUser)
  @Contract({
    operationId: 'requestAssistedQuote',
    summary: 'Ask for a price to be confirmed by a person',
    description:
      'For something seen at an indicative price (send its `observationId`) or something the ordinary search does not sell. It holds places, dates and head counts only: no names and no contact details (422). A person verifies the live price with the supplier and answers with an offer, or says it cannot be had; a request nobody answered closes as `expired`. Up to five can wait at once (409 `assisted-quote-limit`). 404 while assisted quotes are switched off.',
    tags: TAGS,
    body: assistedQuoteBodySchema,
    responses: { 201: assistedQuoteSchema },
    errors: [404, 409, 422],
    idempotent: true,
  })
  request(
    @CurrentAuth() auth: AuthContext,
    @Body() body: AssistedQuoteInput,
  ): Promise<z.infer<typeof assistedQuoteSchema>> {
    return this.quotes.request(auth.userId, body);
  }

  @Get(':assistedQuoteId')
  @Contract({
    operationId: 'getAssistedQuote',
    summary: 'One of my requests',
    description:
      'With `status` `offered`, `offer.quoteId` is an ordinary quote: read it with `GET /v1/quotes/{quoteId}` and book it with `POST /v1/bookings` before `offer.expiresAt`. The booking is paid as any other, then booked by a person with the supplier; it is `CONFIRMED` only once they have the confirmation, and refunded in full if it cannot be booked.',
    tags: TAGS,
    params: assistedQuoteParamsSchema,
    responses: { 200: assistedQuoteSchema },
    errors: [404],
  })
  get(
    @CurrentAuth() auth: AuthContext,
    @Param('assistedQuoteId') id: string,
  ): Promise<z.infer<typeof assistedQuoteSchema>> {
    return this.quotes.get(id, auth.userId);
  }

  @Post(':assistedQuoteId/withdraw')
  @HttpCode(HttpStatus.OK)
  @Contract({
    operationId: 'withdrawAssistedQuote',
    summary: 'I no longer want this',
    description:
      'For a request that is waiting or on offer. One that became a booking is cancelled as a booking (409 `assisted-quote-closed`).',
    tags: TAGS,
    params: assistedQuoteParamsSchema,
    responses: { 200: assistedQuoteSchema },
    errors: [404, 409],
  })
  withdraw(
    @CurrentAuth() auth: AuthContext,
    @Param('assistedQuoteId') id: string,
  ): Promise<z.infer<typeof assistedQuoteSchema>> {
    return this.quotes.withdraw(id, auth.userId);
  }
}

/**
 * The signed-in traveller's own requests. The list lives under `/v1/me`, as price alerts do:
 * `GET /v1/quotes/{quoteId}` already answers for one segment under `/v1/quotes`.
 */
@Controller('me/assisted-quotes')
export class MyAssistedQuotesController {
  constructor(private readonly quotes: AssistedQuotesService) {}

  @Get()
  @Contract({
    operationId: 'listAssistedQuotes',
    summary: 'My requests and their answers, newest first',
    tags: TAGS,
    responses: { 200: assistedQuoteListSchema },
    errors: [404],
  })
  async list(@CurrentAuth() auth: AuthContext): Promise<z.infer<typeof assistedQuoteListSchema>> {
    return { quotes: await this.quotes.list(auth.userId) };
  }
}
