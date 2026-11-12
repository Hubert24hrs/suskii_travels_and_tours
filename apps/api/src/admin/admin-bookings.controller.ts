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

import { CurrentAuth, type AuthContext } from '../auth/auth-context';
import { AdminRoute } from '../auth/decorators';
import { Contract } from '../contract/contract';

import {
  addBookingNoteBodySchema,
  adminBookingContactSchema,
  adminBookingDetailSchema,
  adminBookingPageSchema,
  adminBookingQuerySchema,
  bookingIdParamsSchema,
  bookingNoteSchema,
} from './admin-bookings.schemas';
import { AdminBookingsService } from './admin-bookings.service';
import { staffActor } from './admin-helpers';

const TAGS = ['Admin'];

@Controller('admin/bookings')
export class AdminBookingsController {
  constructor(private readonly bookings: AdminBookingsService) {}

  @Get()
  @AdminRoute('bookings:read')
  @Contract({
    operationId: 'adminListBookings',
    summary: 'Search bookings (newest first)',
    tags: TAGS,
    query: adminBookingQuerySchema,
    responses: { 200: adminBookingPageSchema },
    errors: [403],
  })
  list(
    @Query() query: z.infer<typeof adminBookingQuerySchema>,
  ): Promise<z.infer<typeof adminBookingPageSchema>> {
    return this.bookings.list(query);
  }

  @Get(':bookingId')
  @AdminRoute('bookings:read')
  @Contract({
    operationId: 'adminGetBooking',
    summary: 'A booking with its status timeline and internal notes',
    tags: TAGS,
    params: bookingIdParamsSchema,
    responses: { 200: adminBookingDetailSchema },
    errors: [403, 404],
  })
  detail(@Param('bookingId') bookingId: string): Promise<z.infer<typeof adminBookingDetailSchema>> {
    return this.bookings.detail(bookingId);
  }

  @Post(':bookingId/notes')
  @AdminRoute('bookings:read')
  @Contract({
    operationId: 'adminAddBookingNote',
    summary: 'Add an internal note to a booking',
    description:
      'Notes are encrypted, never shown to the traveller and included in their data export.',
    tags: TAGS,
    params: bookingIdParamsSchema,
    body: addBookingNoteBodySchema,
    responses: { 201: bookingNoteSchema },
    errors: [403, 404],
    audit: ['booking.note_added'],
  })
  addNote(
    @CurrentAuth() auth: AuthContext,
    @Param('bookingId') bookingId: string,
    @Body() body: z.infer<typeof addBookingNoteBodySchema>,
    @Req() request: Request,
  ): Promise<z.infer<typeof bookingNoteSchema>> {
    return this.bookings.addNote(bookingId, staffActor(auth, request), body.text);
  }

  @Post(':bookingId/contact')
  @HttpCode(HttpStatus.OK)
  @AdminRoute('bookings:read')
  @Contract({
    operationId: 'adminRevealBookingContact',
    summary: "Reveal a booking's contact details",
    description: 'Audited on every call; the booking view itself shows them masked.',
    tags: TAGS,
    params: bookingIdParamsSchema,
    responses: { 200: adminBookingContactSchema },
    errors: [403, 404],
    audit: ['booking.contact_revealed'],
  })
  revealContact(
    @CurrentAuth() auth: AuthContext,
    @Param('bookingId') bookingId: string,
    @Req() request: Request,
  ): Promise<z.infer<typeof adminBookingContactSchema>> {
    return this.bookings.revealContact(bookingId, staffActor(auth, request));
  }

  @Post(':bookingId/confirmation')
  @HttpCode(HttpStatus.NO_CONTENT)
  @AdminRoute('bookings:manage')
  @Contract({
    operationId: 'adminResendBookingConfirmation',
    summary: 'Send the confirmation email again, with the documents',
    tags: TAGS,
    params: bookingIdParamsSchema,
    responses: { 204: null },
    errors: [403, 404, 409],
    audit: ['booking.confirmation_resent'],
  })
  resendConfirmation(
    @CurrentAuth() auth: AuthContext,
    @Param('bookingId') bookingId: string,
    @Req() request: Request,
  ): Promise<void> {
    return this.bookings.resendConfirmation(bookingId, staffActor(auth, request));
  }
}
