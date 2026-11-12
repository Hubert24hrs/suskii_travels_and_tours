import { z } from 'zod';

import { REFERRAL_STATUSES } from '@suskii/shared';

import { named } from '../contract/contract';
import { moneySchema } from '../pricing/pricing.schemas';

import { REFERRAL_FLAGS } from './referrals.service';

const timestamp = z.iso.datetime();

export const myReferralsSchema = named(
  'MyReferrals',
  z.object({
    code: z.string(),
    active: z.boolean(),
    shareUrl: z.string().meta({ description: 'Registration link carrying the code.' }),
    counts: z.object({
      pending: z.number().int(),
      qualified: z.number().int(),
      rewarded: z.number().int(),
      review: z.number().int(),
      rejected: z.number().int(),
    }),
    rewards: z
      .object({
        referrer: moneySchema.nullable(),
        referee: moneySchema.nullable(),
        minSpend: moneySchema.nullable(),
      })
      .meta({ description: 'Null amounts: referrals are tracked but pay nothing yet.' }),
    referredBy: z.object({ status: z.enum(REFERRAL_STATUSES), createdAt: timestamp }).nullable(),
  }),
);

export const adminReferralSchema = named(
  'AdminReferral',
  z.object({
    id: z.uuid(),
    referrerId: z.uuid(),
    refereeId: z.uuid(),
    code: z.string(),
    status: z.enum(REFERRAL_STATUSES),
    flags: z.array(z.string()).meta({ description: `One of: ${REFERRAL_FLAGS.join(', ')}.` }),
    qualifyingBookingId: z.uuid().nullable(),
    createdAt: timestamp,
    qualifiedAt: timestamp.nullable(),
    reviewedAt: timestamp.nullable(),
  }),
);

export const adminReferralListSchema = named(
  'AdminReferralList',
  z.object({ referrals: z.array(adminReferralSchema) }),
);

export const adminReferralQuerySchema = z.object({
  status: z.enum(REFERRAL_STATUSES).default('review'),
});

export const referralIdParamsSchema = z.object({ id: z.uuid() });

export const referralDecisionSchema = named(
  'ReferralDecision',
  z.object({ decision: z.enum(['approve', 'reject']) }),
);

export const referralRunSchema = named(
  'ReferralRun',
  z.object({
    qualified: z.number().int(),
    review: z.number().int(),
    rewarded: z.number().int(),
  }),
);
