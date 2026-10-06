import { z } from 'zod';

import { BOOKING_STATUSES } from '@suskii/shared';

import { bookingVerticalSchema } from '../bookings/bookings.schemas';
import { named } from '../contract/contract';
import { moneySchema } from '../pricing/pricing.schemas';

const isoDate = z.iso.date();
const count = z.number().int().min(0);

export const MAX_DASHBOARD_DAYS = 366;
export const DEFAULT_DASHBOARD_DAYS = 30;

export const dashboardQuerySchema = z.object({
  from: isoDate.optional().meta({ description: 'First UTC day; defaults to 30 days before `to`.' }),
  to: isoDate.optional().meta({ description: 'Last UTC day (inclusive); defaults to today.' }),
});

/** The resolved period: ordered and at most a year (ADR-036). */
export const dashboardRangeCheck = z
  .object({ from: isoDate, to: isoDate })
  .superRefine((range, ctx) => {
    const days = (Date.parse(range.to) - Date.parse(range.from)) / 86_400_000 + 1;
    if (days < 1) ctx.addIssue({ code: 'custom', path: ['to'], message: 'ends_before_start' });
    if (days > MAX_DASHBOARD_DAYS) {
      ctx.addIssue({ code: 'custom', path: ['from'], message: 'range_too_long' });
    }
  });

export const adminDashboardSchema = named(
  'AdminDashboard',
  z.object({
    range: z.object({ from: isoDate, to: isoDate }),
    bookings: z.object({
      total: count,
      byStatus: z.array(z.object({ status: z.enum(BOOKING_STATUSES), count })),
      byVertical: z.array(z.object({ vertical: bookingVerticalSchema, count })),
    }),
    money: z
      .array(
        z.object({
          currency: z.string(),
          captured: moneySchema.meta({ description: 'Card and transfer payments received.' }),
          fromWallet: moneySchema.meta({ description: 'Paid from wallet credit.' }),
          refunded: moneySchema.meta({ description: 'Refunds paid out or credited to wallets.' }),
        }),
      )
      .meta({ description: 'From the ledger, per currency; never converted.' }),
    queues: z.object({
      refundsAwaitingApproval: count,
      refundsNeedingReview: count,
      bookingsRefundPending: count,
      visaApplicationsToReview: count,
      referralsInReview: count,
    }),
    accounts: z.object({ created: count, activePrimeMembers: count }),
    topRoutes: z
      .array(z.object({ origin: z.string(), destination: z.string(), bookings: count }))
      .meta({ description: 'Most booked flight routes among bookings that were paid.' }),
    generatedAt: z.iso.datetime(),
  }),
);
