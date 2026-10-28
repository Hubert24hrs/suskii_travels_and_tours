import { z } from 'zod';

import {
  APPROVAL_MODES,
  APPROVAL_REJECT_REASONS,
  BOOKING_APPROVAL_STATUSES,
  CABIN_CLASSES,
  COMPANY_ROLES,
  COMPANY_STATUSES,
  POLICY_FINDINGS,
  approvalRejectSchema,
  companyInputSchema,
  companyInvitationInputSchema,
  travelPolicySchema,
} from '@suskii/shared';

import { bookingSummarySchema } from '../bookings/bookings.schemas';
import { named } from '../contract/contract';
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
export const adminCompanyDetailSchema = named(
  'AdminCompanyDetail',
  adminCompanySchema.extend({
    policy: companyPolicySchema,
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
