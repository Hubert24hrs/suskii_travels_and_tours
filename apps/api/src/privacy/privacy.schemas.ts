import { z } from 'zod';

import { reauthProofSchema } from '../auth/auth.schemas';
import { named } from '../contract/contract';

import { DELETION_BLOCKERS } from './account-deletion.service';

export const dataExportBodySchema = named('DataExportRequest', reauthProofSchema);

export const deleteAccountBodySchema = named(
  'DeleteAccountRequest',
  reauthProofSchema.extend({
    confirm: z.literal('DELETE').describe('Typed by the user to confirm.'),
  }),
);

export const deletionCheckSchema = named(
  'AccountDeletionCheck',
  z.object({
    allowed: z.boolean(),
    blockers: z.array(z.enum(DELETION_BLOCKERS)),
    retentionYears: z
      .number()
      .int()
      .describe('Bookings, payments and refunds are kept this long, without contact details.'),
  }),
);

export const accountDeletedSchema = named(
  'AccountDeleted',
  z.object({
    deletedAt: z.iso.datetime(),
    retainedBookings: z.number().int().nonnegative(),
    retentionYears: z.number().int(),
  }),
);
