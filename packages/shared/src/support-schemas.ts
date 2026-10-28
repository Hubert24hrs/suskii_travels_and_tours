import { z } from './zod-setup';

import { emailSchema } from './auth';
import { SUPPORT_CATEGORIES, SUPPORT_MESSAGE_MAX } from './support';

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
