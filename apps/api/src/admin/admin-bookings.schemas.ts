import { z } from 'zod';

import { BOOKING_STATUSES } from '@suskii/shared';

import {
  bookingSchema,
  bookingSummarySchema,
  bookingVerticalSchema,
} from '../bookings/bookings.schemas';
import { named } from '../contract/contract';
import { moneySchema } from '../pricing/pricing.schemas';

const timestamp = z.iso.datetime();
const isoDate = z.iso.date();

export const adminBookingQuerySchema = z.object({
  q: z
    .string()
    .trim()
    .min(1)
    .max(254)
    .optional()
    .meta({ description: 'A booking reference, or the contact email (matched through its HMAC).' }),
  status: z.enum(BOOKING_STATUSES).optional(),
  vertical: bookingVerticalSchema.optional(),
  from: isoDate.optional().meta({ description: 'Created on or after this UTC date.' }),
  to: isoDate.optional().meta({ description: 'Created on or before this UTC date.' }),
  cursor: z.uuid().optional().meta({ description: 'Id of the last booking of the previous page.' }),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const adminBookingRowSchema = named(
  'AdminBookingRow',
  z.object({
    id: z.uuid(),
    reference: z.string(),
    status: z.enum(BOOKING_STATUSES),
    vertical: bookingVerticalSchema,
    createdAt: timestamp,
    total: moneySchema,
    accountId: z.uuid().nullable().meta({ description: 'Null for guest bookings.' }),
    trip: bookingSummarySchema
      .nullable()
      .meta({ description: 'What was booked; null for Suskii Prime memberships.' }),
  }),
);

export const adminBookingPageSchema = named(
  'AdminBookingPage',
  z.object({ items: z.array(adminBookingRowSchema), nextCursor: z.uuid().nullable() }),
);

export const bookingNoteSchema = named(
  'BookingNote',
  z.object({ id: z.uuid(), authorId: z.uuid(), text: z.string(), createdAt: timestamp }),
);

export const adminBookingDetailSchema = named(
  'AdminBookingDetail',
  z.object({
    booking: bookingSchema.meta({ description: 'Contact details masked; reveal them on purpose.' }),
    accountId: z.uuid().nullable(),
    history: z.array(
      z.object({
        fromStatus: z.enum(BOOKING_STATUSES).nullable(),
        toStatus: z.enum(BOOKING_STATUSES),
        event: z.string(),
        reason: z.string().nullable(),
        actorType: z.enum(['customer', 'system', 'webhook', 'staff']),
        actorUserId: z.uuid().nullable(),
        occurredAt: timestamp,
      }),
    ),
    notes: z.array(bookingNoteSchema),
  }),
);

export const addBookingNoteBodySchema = named(
  'AddBookingNoteRequest',
  z.object({ text: z.string().trim().min(1).max(2000) }),
);

export const adminBookingContactSchema = named(
  'AdminBookingContact',
  z.object({
    email: z.string(),
    phone: z.string(),
    redacted: z.boolean().meta({ description: 'True once the owner deleted their account.' }),
  }),
);

export const bookingIdParamsSchema = z.object({ bookingId: z.uuid() });
