import { Injectable } from '@nestjs/common';
import type { z } from 'zod';

import { BOOKING_STATUSES, money, toWire, zero } from '@suskii/shared';

import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../infra/prisma.service';
import type { LedgerKind } from '../ledger/ledger-accounts';

import {
  DEFAULT_DASHBOARD_DAYS,
  dashboardRangeCheck,
  type adminDashboardSchema,
  type dashboardQuerySchema,
} from './admin-dashboard.schemas';
import { checkMerged } from './admin-helpers';

type Dashboard = z.infer<typeof adminDashboardSchema>;

const DAY_MS = 86_400_000;
const isoDate = (value: Date): string => value.toISOString().slice(0, 10);

/** Ledger transaction kinds behind each money figure (ADR-017, ADR-036). */
const MONEY_KINDS = {
  captured: ['payment_captured', 'payment_unapplied'],
  fromWallet: ['wallet_payment'],
  refunded: ['refund_settled', 'refund_to_wallet'],
} as const satisfies Record<string, readonly LedgerKind[]>;

/** Statuses a booking reaches only after it was paid in full. */
const PAID_STATUSES = ['PAID', 'TICKETING', 'CONFIRMED', 'REFUND_PENDING', 'REFUNDED'] as const;

/**
 * The admin dashboard (ADR-036): counts and per-currency sums for a period, plus the work queues
 * as they are now. Money comes from the ledger, never from booking totals, and is never converted.
 */
@Injectable()
export class AdminDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(query: z.infer<typeof dashboardQuerySchema>, now = new Date()): Promise<Dashboard> {
    const to = query.to ?? isoDate(now);
    const from =
      query.from ?? isoDate(new Date(Date.parse(to) - (DEFAULT_DASHBOARD_DAYS - 1) * DAY_MS));
    const range = checkMerged(dashboardRangeCheck, { from, to });
    const createdAt = {
      gte: new Date(`${range.from}T00:00:00.000Z`),
      lt: new Date(Date.parse(`${range.to}T00:00:00.000Z`) + DAY_MS),
    };

    const [byStatus, byVertical, money, queues, accounts, topRoutes] = await Promise.all([
      this.prisma.booking.groupBy({ by: ['status'], where: { createdAt }, _count: { _all: true } }),
      this.prisma.booking.groupBy({
        by: ['vertical'],
        where: { createdAt },
        _count: { _all: true },
      }),
      this.money(createdAt),
      this.queues(),
      this.accounts(createdAt, now),
      this.topRoutes(createdAt),
    ]);
    const statusOrder = (status: string) => (BOOKING_STATUSES as readonly string[]).indexOf(status);
    return {
      range,
      bookings: {
        total: byStatus.reduce((sum, row) => sum + row._count._all, 0),
        byStatus: byStatus
          .map((row) => ({ status: row.status, count: row._count._all }))
          .sort((a, b) => statusOrder(a.status) - statusOrder(b.status)),
        byVertical: byVertical
          .map((row) => ({ vertical: row.vertical, count: row._count._all }))
          .sort((a, b) => b.count - a.count || a.vertical.localeCompare(b.vertical)),
      },
      money,
      queues,
      accounts,
      topRoutes,
      generatedAt: now.toISOString(),
    };
  }

  /** Each transfer has one credit line per currency, so summing credits counts each amount once. */
  private async money(createdAt: { gte: Date; lt: Date }): Promise<Dashboard['money']> {
    const sums = await Promise.all(
      Object.values(MONEY_KINDS).map((kinds) =>
        this.prisma.ledgerEntry.groupBy({
          by: ['currency'],
          where: { direction: 'credit', transaction: { kind: { in: [...kinds] }, createdAt } },
          _sum: { amountMinor: true },
        }),
      ),
    );
    const [captured, fromWallet, refunded] = sums.map(
      (rows) => new Map(rows.map((row) => [row.currency, row._sum.amountMinor ?? 0n])),
    );
    const currencies = [...new Set(sums.flatMap((rows) => rows.map((row) => row.currency)))].sort();
    const amount = (sum: Map<string, bigint> | undefined, currency: string) =>
      toWire(sum?.has(currency) ? money(sum.get(currency) ?? 0n, currency) : zero(currency));
    return currencies.map((currency) => ({
      currency,
      captured: amount(captured, currency),
      fromWallet: amount(fromWallet, currency),
      refunded: amount(refunded, currency),
    }));
  }

  private async queues(): Promise<Dashboard['queues']> {
    const [awaiting, review, refundPending, visa, referrals] = await Promise.all([
      this.prisma.refund.count({ where: { status: 'pending_approval' } }),
      this.prisma.refund.count({ where: { status: 'needs_review' } }),
      this.prisma.booking.count({ where: { status: 'REFUND_PENDING' } }),
      this.prisma.visaApplication.count({ where: { status: { in: ['submitted', 'in_review'] } } }),
      this.prisma.referral.count({ where: { status: 'review' } }),
    ]);
    return {
      refundsAwaitingApproval: awaiting,
      refundsNeedingReview: review,
      bookingsRefundPending: refundPending,
      visaApplicationsToReview: visa,
      referralsInReview: referrals,
    };
  }

  private async accounts(
    createdAt: { gte: Date; lt: Date },
    now: Date,
  ): Promise<Dashboard['accounts']> {
    const [created, members] = await Promise.all([
      this.prisma.user.count({ where: { createdAt } }),
      this.prisma.primeMembership.groupBy({
        by: ['userId'],
        where: { status: 'active', startsAt: { lte: now }, endsAt: { gt: now } },
      }),
    ]);
    return { created, activePrimeMembers: members.length };
  }

  /** Origin and destination of the first slice; round trips count once, by their outbound. */
  private async topRoutes(createdAt: { gte: Date; lt: Date }): Promise<Dashboard['topRoutes']> {
    const rows = await this.prisma.$queryRaw<
      { origin: string | null; destination: string | null; bookings: number }[]
    >`
      SELECT bi.payload #>> '{offer,slices,0,origin,code}' AS origin,
             bi.payload #>> '{offer,slices,0,destination,code}' AS destination,
             count(DISTINCT b.id)::int AS bookings
      FROM bookings b
      JOIN booking_items bi ON bi.booking_id = b.id
      WHERE b.vertical = 'flights'
        AND b.status::text IN (${Prisma.join([...PAID_STATUSES])})
        AND b.created_at >= ${createdAt.gte}
        AND b.created_at < ${createdAt.lt}
        AND bi.payload ->> 'kind' = 'flight'
      GROUP BY 1, 2
      ORDER BY bookings DESC, origin, destination
      LIMIT 10
    `;
    return rows
      .filter((row) => row.origin !== null && row.destination !== null)
      .map((row) => ({
        origin: row.origin ?? '',
        destination: row.destination ?? '',
        bookings: row.bookings,
      }));
  }
}
