import { z } from 'zod';

import { named } from '../contract/contract';
import { moneySchema } from '../pricing/pricing.schemas';

/** Ledger reconciliation and driver payouts (ADR-051). Ids, codes and amounts only. */

const timestamp = z.iso.datetime();

export const DISCREPANCY_KINDS = [
  'ledger_missing',
  'ledger_amount',
  'provider_status',
  'provider_amount',
  'orphan_ledger',
] as const;
export const DISCREPANCY_SUBJECTS = ['payment', 'refund', 'payout'] as const;
export const DISCREPANCY_STATUSES = ['open', 'resolved'] as const;
export const DISCREPANCY_RESOLUTIONS = ['corrected', 'accepted'] as const;
export const PAYOUT_STATUSES = ['pending', 'paid', 'failed'] as const;

export const reconciliationRunSchema = named(
  'LedgerReconciliationRun',
  z.object({
    checked: z.number().int().meta({ description: 'Payments, refunds and payouts compared.' }),
    discrepancies: z.number().int().meta({ description: 'New or reopened discrepancies.' }),
    unconfirmed: z
      .number()
      .int()
      .meta({ description: 'Payments the provider could not confirm either way.' }),
  }),
);

export const payoutRunSchema = named(
  'DriverPayoutRun',
  z.object({
    sent: z.number().int().meta({ description: 'New payouts in this run.' }),
    paid: z.number().int(),
    failed: z.number().int(),
    pending: z.number().int().meta({ description: 'Still waiting on the bank.' }),
  }),
);

export const discrepancyQuerySchema = z.object({
  status: z.enum(DISCREPANCY_STATUSES).default('open'),
});

export const discrepancySchema = named(
  'ReconciliationDiscrepancy',
  z.object({
    id: z.uuid(),
    kind: z.enum(DISCREPANCY_KINDS),
    subjectType: z.enum(DISCREPANCY_SUBJECTS),
    subjectId: z.uuid(),
    bookingId: z.uuid().nullable(),
    expected: moneySchema.nullable().meta({ description: 'What our records say.' }),
    actual: moneySchema
      .nullable()
      .meta({ description: 'What the ledger or the provider says; null when missing.' }),
    status: z.enum(DISCREPANCY_STATUSES),
    resolution: z.enum(DISCREPANCY_RESOLUTIONS).nullable(),
    resolvedById: z.uuid().nullable(),
    resolvedAt: timestamp.nullable(),
    detectedAt: timestamp,
    lastSeenAt: timestamp,
  }),
);

export const discrepancyListSchema = named(
  'ReconciliationDiscrepancies',
  z.object({ discrepancies: z.array(discrepancySchema) }),
);

export const discrepancyIdParamsSchema = z.object({ id: z.uuid() });

export const resolveDiscrepancySchema = z.object({
  resolution: z.enum(DISCREPANCY_RESOLUTIONS).meta({
    description:
      '`corrected`: the record was fixed, so the next sweep checks it again (and reopens it if it still differs). `accepted`: a known difference that stays resolved.',
  }),
});

export const payoutQuerySchema = z.object({
  status: z.enum(PAYOUT_STATUSES).optional(),
});

export const adminPayoutListSchema = named(
  'AdminDriverPayouts',
  z.object({
    payouts: z.array(
      z.object({
        id: z.uuid(),
        driverId: z.uuid(),
        driverName: z.string(),
        amount: moneySchema,
        status: z.enum(PAYOUT_STATUSES),
        provider: z.string(),
        failureReason: z.string().nullable(),
        batchId: z.uuid().nullable(),
        attempts: z.number().int(),
        createdAt: timestamp,
        settledAt: timestamp.nullable(),
      }),
    ),
  }),
);
