import { z } from './zod-setup';

import { emailSchema } from './auth';
import { iataCodeSchema, isoDateSchema } from './search';
import { CABIN_CLASSES, SEARCH_ISSUES } from './search-limits';
import {
  GROUP_MAX_TRAVELLERS,
  GROUP_MIN_TRAVELLERS,
  GROUP_NOTES_MAX,
  GROUP_ORGANISATION_MAX,
  GROUP_TRIP_TYPES,
  SUPPORT_CATEGORIES,
  SUPPORT_MESSAGE_MAX,
} from './support';
import { isValidDate } from './time';

/** A message as a traveller or staff member types it: trimmed, not empty, capped. */
export const supportMessageTextSchema = z.string().trim().min(1).max(SUPPORT_MESSAGE_MAX);

/**
 * What a traveller sends to start a conversation (ADR-083). `bookingId` ties it to one of their
 * bookings; `email` is needed only when they have neither an account nor a booking to reach them
 * through.
 */
export const supportStartSchema = z.object({
  category: z.enum(SUPPORT_CATEGORIES),
  message: supportMessageTextSchema,
  bookingId: z.uuid().nullish(),
  email: emailSchema.nullish(),
});
export type SupportStartInput = z.infer<typeof supportStartSchema>;

export const supportReplySchema = z.object({ message: supportMessageTextSchema });
export type SupportReplyInput = z.infer<typeof supportReplySchema>;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    // Left empty is the same as left out.
    .transform((value) => (value === '' ? null : (value ?? null)));

/**
 * A flight for ten travellers or more: the airline's group desk prices it, so it is a request
 * the team answers in a support conversation, not a search. `email` as in `supportStartSchema`.
 */
export const groupRequestSchema = z
  .object({
    tripType: z.enum(GROUP_TRIP_TYPES),
    origin: iataCodeSchema,
    destination: iataCodeSchema,
    departureDate: isoDateSchema,
    returnDate: isoDateSchema.nullish().transform((value) => value ?? null),
    travellers: z.number().int().min(GROUP_MIN_TRAVELLERS).max(GROUP_MAX_TRAVELLERS),
    cabinClass: z.enum(CABIN_CLASSES).default('economy'),
    organisation: optionalText(GROUP_ORGANISATION_MAX),
    notes: optionalText(GROUP_NOTES_MAX),
    email: emailSchema.nullish(),
  })
  .superRefine((request, ctx) => {
    const report = (path: string, message: string) =>
      ctx.addIssue({ code: 'custom', path: [path], message });
    if (request.origin === request.destination)
      report('destination', SEARCH_ISSUES.sameOriginDestination);
    if (request.tripType === 'one_way') {
      if (request.returnDate !== null) report('returnDate', 'not_for_one_way');
      return;
    }
    if (request.returnDate === null) report('returnDate', 'required');
    else if (
      isValidDate(request.departureDate) &&
      isValidDate(request.returnDate) &&
      request.returnDate < request.departureDate
    )
      report('returnDate', SEARCH_ISSUES.returnBeforeDeparture);
  });
export type GroupRequestInput = z.output<typeof groupRequestSchema>;
