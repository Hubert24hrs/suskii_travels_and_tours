import { z } from 'zod';

import {
  APPROVAL_MODES,
  APPROVAL_REJECT_REASONS,
  BOOKING_APPROVAL_STATUSES,
  CABIN_CLASSES,
  COMPANY_ROLES,
  COMPANY_STATUSES,
  COMPANY_TOP_UP_STATUSES,
  PAYMENT_PROVIDER_NAMES,
  POLICY_FINDINGS,
  approvalRejectSchema,
  companyInputSchema,
  companyTopUpInputSchema,
  companyInvitationInputSchema,
  travelPolicySchema,
} from '@suskii/shared';

import { bookingSummarySchema, PAYMENT_METHODS } from '../bookings/bookings.schemas';
import { named } from '../contract/contract';
import { LEDGER_KINDS } from '../ledger/ledger-accounts';
import { moneySchema } from '../pricing/pricing.schemas';

const timestamp = z.iso.datetime();

export const companyPolicySchema = named(
  'CompanyPolicy',
  z.object({
    hotelNightlyCap: moneySchema.nullable(),
    maxCabin: z.enum(CABIN_CLASSES).nullable(),
    minAdvanceDays: z.number().int().nullable(),
    approvalMode: z.enum(APPROVAL_MODES),
  }),
);

export const companySchema = named(
  'Company',
  z.object({
    id: z.uuid(),
    name: z.string(),
    countryCode: z.string().length(2),
    registrationNumber: z.string().nullable(),
    taxId: z.string().nullable(),
    billingEmail: z.string(),
    status: z.enum(COMPANY_STATUSES),
    myRole: z.enum(COMPANY_ROLES),
    policy: companyPolicySchema,
    createdAt: timestamp,
  }),
);

export const myCompanySchema = named(
  'MyCompany',
  z.object({
    company: companySchema
      .nullable()
      .meta({ description: 'Null when the caller is in no company.' }),
  }),
);

export const companyMemberSchema = named(
  'CompanyMember',
  z.object({
    id: z.uuid(),
    userId: z.uuid(),
    name: z.string().nullable(),
    email: z.string().nullable().meta({ description: 'Shown to admins only.' }),
    role: z.enum(COMPANY_ROLES),
    joinedAt: timestamp,
  }),
);

export const companyInvitationSchema = named(
  'CompanyInvitation',
  z.object({
    id: z.uuid(),
    emailHint: z.string(),
    role: z.enum(COMPANY_ROLES),
    expiresAt: timestamp,
    createdAt: timestamp,
  }),
);

export const companyMembersSchema = named(
  'CompanyMembers',
  z.object({
    members: z.array(companyMemberSchema),
    invitations: z.array(companyInvitationSchema).meta({
      description: 'Open invitations; admins only (empty for everyone else).',
    }),
  }),
);

export const companyBookingSchema = named(
  'CompanyBooking',
  bookingSummarySchema.extend({
    travellerName: z.string().nullable().meta({ description: 'The lead traveller.' }),
    bookerName: z.string().nullable().meta({ description: 'The member who booked.' }),
    bookedByMe: z.boolean(),
    approvalStatus: z.enum(BOOKING_APPROVAL_STATUSES),
    approvalRejectReason: z.enum(APPROVAL_REJECT_REASONS).nullable(),
    policyFindings: z.array(z.enum(POLICY_FINDINGS)),
    canDecide: z.boolean().meta({
      description:
        'The caller may approve or reject it now: an approver or admin, waiting for approval, unpaid, and not their own trip.',
    }),
  }),
);

export const companyBookingPageSchema = named(
  'CompanyBookingPage',
  z.object({ items: z.array(companyBookingSchema), nextCursor: z.uuid().nullable() }),
);

export const companyBookingQuerySchema = z.object({
  approval: z
    .enum(['pending'])
    .optional()
    .meta({ description: 'Only trips waiting for approval.' }),
  cursor: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const spendLineSchema = z.object({
  total: moneySchema,
  bookings: z.number().int(),
});

export const companySpendSchema = named(
  'CompanySpend',
  z
    .object({
      from: z.string(),
      to: z.string(),
      byMonth: z.array(
        spendLineSchema.extend({ month: z.string().meta({ description: 'YYYY-MM' }) }),
      ),
      byTraveller: z.array(spendLineSchema.extend({ travellerName: z.string() })),
      totals: z.array(spendLineSchema).meta({ description: 'One line per currency.' }),
    })
    .meta({
      description:
        'Committed spend: company bookings that are paid or confirmed (partly paid, paid, ticketing, confirmed), by the day they were booked (UTC). Amounts stay in their own currency.',
    }),
);

export const companySpendQuerySchema = z
  .object({
    from: z.iso
      .date()
      .meta({ description: 'First booking date, inclusive (default: a year ago).' }),
    to: z.iso.date().meta({ description: 'Last booking date, inclusive (default: today).' }),
  })
  .partial()
  .refine((range) => !range.from || !range.to || range.from <= range.to, {
    message: '`from` must not be after `to`',
    path: ['from'],
  });

export const createCompanySchema = companyInputSchema;
export const updateCompanySchema = companyInputSchema;
export const updatePolicySchema = travelPolicySchema;
export const inviteMemberSchema = companyInvitationInputSchema;
export const acceptInvitationSchema = z.object({ token: z.string().min(20).max(200) });
export const changeRoleSchema = z.object({ role: z.enum(COMPANY_ROLES) });
export const rejectApprovalSchema = approvalRejectSchema;
export const memberParamsSchema = z.object({ memberId: z.uuid() });
export const invitationParamsSchema = z.object({ invitationId: z.uuid() });
export const companyBookingParamsSchema = z.object({ bookingId: z.uuid() });

export const adminCompanySchema = named(
  'AdminCompany',
  z.object({
    id: z.uuid(),
    name: z.string(),
    countryCode: z.string(),
    registrationNumber: z.string().nullable(),
    taxId: z.string().nullable(),
    billingEmail: z.string(),
    status: z.enum(COMPANY_STATUSES),
    members: z.number().int(),
    bookings: z.number().int(),
    createdAt: timestamp,
  }),
);
// ---------------------------------------------------------------------------
// Company wallet (ADR-090)

export const companyTopUpSchema = named(
  'CompanyTopUp',
  z.object({
    id: z.uuid(),
    reference: z.string().meta({ description: 'Shown on the payment page, such as `W-K7QX3M`.' }),
    status: z.enum(COMPANY_TOP_UP_STATUSES),
    amount: moneySchema,
    received: moneySchema.nullable().meta({
      description: 'What the provider charged when it differs from `amount`; that is credited.',
    }),
    checkoutUrl: z.url().nullable().meta({
      description: 'The hosted payment page, for the admin who started it while it is pending.',
    }),
    expiresAt: timestamp,
    createdAt: timestamp,
    succeededAt: timestamp.nullable(),
  }),
);

export const companyWalletSchema = named(
  'CompanyWallet',
  z.object({
    balances: z.array(moneySchema).meta({ description: 'One balance per currency ever used.' }),
    canTopUp: z.boolean().meta({ description: 'Admins of an active company can add funds.' }),
    topUpOptions: z
      .array(z.object({ currency: z.string().length(3), min: moneySchema, max: moneySchema }))
      .meta({ description: 'Currencies a top-up can be paid in now, with the amount limits.' }),
    topUpsPerDay: z.number().int(),
    movements: z.array(
      z.object({
        id: z.uuid(),
        kind: z.enum(LEDGER_KINDS),
        amount: moneySchema.meta({ description: 'Positive when money came into the wallet.' }),
        bookingId: z.uuid().nullable(),
        bookingReference: z.string().nullable(),
        occurredAt: timestamp,
      }),
    ),
    topUps: z.array(companyTopUpSchema).meta({ description: 'The latest 20, newest first.' }),
  }),
);

export const startTopUpSchema = named(
  'StartCompanyTopUp',
  companyTopUpInputSchema.extend({
    provider: z.enum(PAYMENT_PROVIDER_NAMES).nullable().default(null),
    method: z.enum(PAYMENT_METHODS).nullable().default(null),
  }),
);
export const topUpParamsSchema = z.object({ topUpId: z.uuid() });

export const adminCompanyDetailSchema = named(
  'AdminCompanyDetail',
  adminCompanySchema.extend({
    policy: companyPolicySchema,
    walletBalances: z.array(moneySchema),
    recentTopUps: z
      .array(companyTopUpSchema.omit({ checkoutUrl: true }))
      .meta({ description: 'The latest 10 company wallet top-ups (ADR-090).' }),
    memberList: z.array(
      z.object({
        userId: z.uuid(),
        name: z.string().nullable(),
        email: z.string().nullable(),
        role: z.enum(COMPANY_ROLES),
        joinedAt: timestamp,
      }),
    ),
  }),
);
export const adminCompanyPageSchema = named(
  'AdminCompanyPage',
  z.object({ items: z.array(adminCompanySchema), nextCursor: z.uuid().nullable() }),
);
export const adminCompanyQuerySchema = z.object({
  q: z.string().trim().min(2).max(80).optional().meta({ description: 'Name starts with.' }),
  status: z.enum(COMPANY_STATUSES).optional(),
  cursor: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export const adminCompanyParamsSchema = z.object({ id: z.uuid() });

export { APPROVAL_REJECT_REASONS };
