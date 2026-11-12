import { Controller, Get, Query } from '@nestjs/common';
import type { z } from 'zod';

import { CurrentAuth, type AuthContext } from '../auth/auth-context';
import { Contract } from '../contract/contract';

import { bookingListQuerySchema, bookingSummaryPageSchema } from './bookings.schemas';
import { BookingsService } from './bookings.service';

/** The signed-in traveller's trips (mobile Trips tab; web accounts in phase 9). */
@Controller('me/bookings')
export class MeBookingsController {
  constructor(private readonly bookings: BookingsService) {}

  @Get()
  @Contract({
    operationId: 'listMyBookings',
    summary: 'Trips booked with this account',
    description:
      'Newest first, 20 per page by default. Summaries carry no traveller data; open a trip with `GET /v1/bookings/{id}`. Suskii Prime purchases are listed by `getMyPrime`.',
    tags: ['Account'],
    query: bookingListQuerySchema,
    responses: { 200: bookingSummaryPageSchema },
  })
  list(
    @CurrentAuth() auth: AuthContext,
    @Query() query: z.infer<typeof bookingListQuerySchema>,
  ): Promise<z.infer<typeof bookingSummaryPageSchema>> {
    return this.bookings.listForUser(auth.userId, query);
  }
}
