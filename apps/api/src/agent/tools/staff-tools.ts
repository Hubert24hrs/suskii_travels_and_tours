import { Injectable, type OnModuleInit } from '@nestjs/common';
import { z } from 'zod';

import { isoDateSchema, money, toWire } from '@suskii/shared';

import { AdminDashboardService } from '../../admin/admin-dashboard.service';
import { promoCheck } from '../../admin/admin-promos.schemas';
import { AdminPromosService } from '../../admin/admin-promos.service';
import { STAFF_REFUND_REASONS, bookingVerticalSchema } from '../../bookings/bookings.schemas';
import { PrismaService } from '../../infra/prisma.service';
import { PriceIntelAdminService } from '../../price-intel/price-intel-admin.service';
import type { AgentGrant } from '../agent-grants';
import { agentTool, AgentToolError, AgentToolRegistry } from '../agent-tool';
import { AgentApprovalsService } from '../approvals/agent-approvals.service';

import { issueCodes, moneyOut, problemCodes, problemsSchema, utcTime } from './tool-support';

const count = z.number().int();
const period = z.object({
  from: isoDateSchema.optional().meta({ description: 'First UTC day; 30 days back by default.' }),
  to: isoDateSchema.optional().meta({ description: 'Last UTC day, inclusive; today by default.' }),
});

const proposalOut = z.object({
  problems: problemsSchema,
  /** True when the proposal now waits in the approvals queue. It has changed nothing. */
  waitsForApproval: z.boolean(),
  wasAlreadyWaiting: z.boolean(),
  approvalId: z.uuid().nullable(),
});

/**
 * What the staff agents read and prepare (ADR-107), in the console only. Every read is one the
 * staff member asking could make themselves: the grant carries the scopes their own
 * permissions open, and a tool outside them is refused. Nothing here decides anything: a
 * proposal is a row in the approvals queue, for someone other than the person who asked.
 * No tool returns a traveller's name, contact, document or booking reference.
 */
@Injectable()
export class StaffTools implements OnModuleInit {
  constructor(
    private readonly registry: AgentToolRegistry,
    private readonly prisma: PrismaService,
    private readonly dashboard: AdminDashboardService,
    private readonly promos: AdminPromosService,
    private readonly intel: PriceIntelAdminService,
    private readonly approvals: AgentApprovalsService,
  ) {}

  onModuleInit(): void {
    this.registry.register(
      agentTool({
        name: 'ops.queues',
        description:
          'What is waiting for a person in operations right now, as counts: assisted quotes to verify, paid bookings to book by hand, bookings whose ticketing is retrying or stuck, payments held for a risk review, refunds needing review, airline changes still open (and how many are significant), support conversations past their reply time, visa applications and referrals in review.',
        tier: 'read',
        scope: 'ops',
        agents: ['operations', 'executive'],
        input: z.object({}),
        output: z.object({
          assistedQuotesToVerify: count,
          assistedBookingsToBookByHand: count,
          ticketingRetrying: count,
          ticketingWaitingLong: count,
          paymentsHeldForRiskReview: count,
          refundsAwaitingApproval: count,
          refundsNeedingReview: count,
          bookingsWaitingForRefund: count,
          airlineChangesOpen: count,
          airlineChangesOpenAndSignificant: count,
          supportConversationsPastReplyTime: count,
          visaApplicationsToReview: count,
          referralsInReview: count,
          asOf: z.string(),
        }),
        run: async () => {
          const now = new Date();
          const hourAgo = new Date(now.getTime() - 3_600_000);
          const [summary, toVerify, toBook, retrying, stuck, held, changes, significant, late] =
            await Promise.all([
              this.dashboard.summary({}, now),
              this.prisma.assistedQuote.count({ where: { status: 'requested' } }),
              this.prisma.bookingItem.count({
                where: {
                  type: 'assisted',
                  bookedAt: null,
                  booking: { status: { in: ['PAID', 'TICKETING'] } },
                },
              }),
              this.prisma.booking.count({
                where: { status: 'TICKETING', nextTicketingAt: { not: null } },
              }),
              this.prisma.booking.count({
                where: {
                  status: 'TICKETING',
                  nextTicketingAt: null,
                  updatedAt: { lt: hourAgo },
                  vertical: { not: 'assisted' },
                },
              }),
              this.prisma.paymentRiskReview.count({ where: { status: 'open' } }),
              this.prisma.flightScheduleChange.count({ where: { status: 'open' } }),
              this.prisma.flightScheduleChange.count({
                where: { status: 'open', significant: true },
              }),
              this.prisma.supportConversation.count({
                where: { status: { not: 'resolved' }, dueAt: { lt: now } },
              }),
            ]);
          return {
            assistedQuotesToVerify: toVerify,
            assistedBookingsToBookByHand: toBook,
            ticketingRetrying: retrying,
            ticketingWaitingLong: stuck,
            paymentsHeldForRiskReview: held,
            refundsAwaitingApproval: summary.queues.refundsAwaitingApproval,
            refundsNeedingReview: summary.queues.refundsNeedingReview,
            bookingsWaitingForRefund: summary.queues.bookingsRefundPending,
            airlineChangesOpen: changes,
            airlineChangesOpenAndSignificant: significant,
            supportConversationsPastReplyTime: late,
            visaApplicationsToReview: summary.queues.visaApplicationsToReview,
            referralsInReview: summary.queues.referralsInReview,
            asOf: utcTime(now.toISOString()),
          };
        },
      }),
    );

    this.registry.register(
      agentTool({
        name: 'reports.sales',
        description:
          'Bookings and money for a period, from the ledger: bookings made, by status and by product, money received, paid from wallets and refunded per currency (never converted), accounts created, active Suskii Prime members and the most booked flight routes. At most a year at a time.',
        tier: 'read',
        scope: 'reports',
        agents: ['business_intelligence', 'executive', 'marketing'],
        input: period,
        output: z.object({
          problems: problemsSchema,
          from: z.string(),
          to: z.string(),
          bookingsMade: count,
          byStatus: z.array(z.object({ bookingState: z.string(), bookings: count })),
          byProduct: z.array(z.object({ product: z.string(), bookings: count })),
          money: z.array(
            z.object({
              currency: z.string(),
              received: moneyOut,
              paidFromWallets: moneyOut,
              refundedSoFar: moneyOut,
            }),
          ),
          accountsCreated: count,
          activePrimeMembers: count,
          mostBookedRoutes: z
            .array(z.object({ from: z.string(), to: z.string(), bookings: count }))
            .max(10),
        }),
        run: async (input) => {
          try {
            const summary = await this.dashboard.summary(input);
            return {
              problems: [],
              from: summary.range.from,
              to: summary.range.to,
              bookingsMade: summary.bookings.total,
              // Named "state", not "status": these are counts, not an outcome to report as one.
              byStatus: summary.bookings.byStatus.map((row) => ({
                bookingState: row.status.toLowerCase(),
                bookings: row.count,
              })),
              byProduct: summary.bookings.byVertical.map((row) => ({
                product: row.vertical,
                bookings: row.count,
              })),
              money: summary.money.map((row) => ({
                currency: row.currency,
                received: row.captured,
                paidFromWallets: row.fromWallet,
                refundedSoFar: row.refunded,
              })),
              accountsCreated: summary.accounts.created,
              activePrimeMembers: summary.accounts.activePrimeMembers,
              mostBookedRoutes: summary.topRoutes.slice(0, 10).map((route) => ({
                from: route.origin,
                to: route.destination,
                bookings: route.bookings,
              })),
            };
          } catch (error) {
            // A period that ends before it starts or is longer than a year: said in codes.
            const problems = problemCodes(error);
            if (!problems) throw error;
            return {
              problems,
              from: input.from ?? '',
              to: input.to ?? '',
              bookingsMade: 0,
              byStatus: [],
              byProduct: [],
              money: [],
              accountsCreated: 0,
              activePrimeMembers: 0,
              mostBookedRoutes: [],
            };
          }
        },
      }),
    );

    this.registry.register(
      agentTool({
        name: 'finance.overview',
        description:
          'What finance has open right now: refunds awaiting a second approver and refunds needing review, reconciliation discrepancies still open by kind, driver payouts not yet settled, and refund requests an agent prepared that wait for approval.',
        tier: 'read',
        scope: 'finance',
        agents: ['finance_prep', 'executive'],
        input: z.object({}),
        output: z.object({
          refundsAwaitingApproval: count,
          refundsNeedingReview: count,
          bookingsWaitingForRefund: count,
          openDiscrepancies: z.array(z.object({ kind: z.string(), open: count })),
          driverPayoutsNotSettled: count,
          refundRequestsPreparedAndWaiting: count,
          asOf: z.string(),
        }),
        run: async () => {
          const now = new Date();
          const [summary, discrepancies, payouts, prepared] = await Promise.all([
            this.dashboard.summary({}, now),
            this.prisma.reconciliationDiscrepancy.groupBy({
              by: ['kind'],
              where: { status: 'open' },
              _count: { _all: true },
            }),
            this.prisma.driverPayout.count({ where: { status: 'pending' } }),
            this.prisma.agentApproval.count({
              where: { kind: 'refund_request', status: 'pending', expiresAt: { gt: now } },
            }),
          ]);
          return {
            refundsAwaitingApproval: summary.queues.refundsAwaitingApproval,
            refundsNeedingReview: summary.queues.refundsNeedingReview,
            bookingsWaitingForRefund: summary.queues.bookingsRefundPending,
            openDiscrepancies: discrepancies
              .map((row) => ({ kind: row.kind, open: row._count._all }))
              .sort((a, b) => b.open - a.open),
            driverPayoutsNotSettled: payouts,
            refundRequestsPreparedAndWaiting: prepared,
            asOf: utcTime(now.toISOString()),
          };
        },
      }),
    );

    this.registry.register(
      agentTool({
        name: 'finance.booking_payments',
        description:
          'The payments of one booking, by its id, for preparing a refund request: each payment received with its amount and what of it was already refunded or is being refunded, and what is still refundable. It names no traveller.',
        tier: 'read',
        scope: 'finance',
        agents: ['finance_prep'],
        input: z.object({ bookingId: z.uuid() }),
        output: z.object({
          bookingId: z.uuid(),
          bookingStatus: z.string(),
          product: z.string(),
          total: moneyOut,
          payments: z
            .array(
              z.object({
                paymentId: z.uuid(),
                paymentStatus: z.string(),
                amount: moneyOut,
                alreadyRefundedOrOnItsWay: moneyOut,
                stillRefundable: moneyOut,
              }),
            )
            .max(20),
        }),
        run: async (input) => {
          const booking = await this.prisma.booking.findUnique({
            where: { id: input.bookingId },
            select: {
              id: true,
              status: true,
              vertical: true,
              totalMinor: true,
              currency: true,
              payments: {
                where: { status: 'succeeded' },
                orderBy: { createdAt: 'asc' },
                take: 20,
                select: {
                  id: true,
                  status: true,
                  amountMinor: true,
                  currency: true,
                  refunds: {
                    where: { status: { notIn: ['rejected', 'failed'] } },
                    select: { amountMinor: true },
                  },
                },
              },
            },
          });
          if (!booking) throw new AgentToolError('not_found');
          return {
            bookingId: booking.id,
            bookingStatus: booking.status.toLowerCase(),
            product: booking.vertical,
            total: toWire(money(booking.totalMinor, booking.currency)),
            payments: booking.payments.map((payment) => {
              const refunded = payment.refunds.reduce((sum, row) => sum + row.amountMinor, 0n);
              const left = payment.amountMinor > refunded ? payment.amountMinor - refunded : 0n;
              return {
                paymentId: payment.id,
                paymentStatus: payment.status,
                amount: toWire(money(payment.amountMinor, payment.currency)),
                alreadyRefundedOrOnItsWay: toWire(money(refunded, payment.currency)),
                stillRefundable: toWire(money(left, payment.currency)),
              };
            }),
          };
        },
      }),
    );

    this.registry.register(
      agentTool({
        name: 'finance.draft_refund_request',
        description:
          'Prepares a refund request for a person to decide: which payment of which booking, how much (in minor units of the payment currency, never above what is still refundable) and why, as one of the reasons. It refunds nothing and requests nothing: the draft waits in the approvals queue, someone other than the person you are working for approves or rejects it, and an approved one becomes an ordinary refund request with its own second approver. Read finance.booking_payments first.',
        tier: 'propose',
        scope: 'finance',
        agents: ['finance_prep'],
        input: z.object({
          bookingId: z.uuid(),
          paymentId: z.uuid(),
          amountMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
          reason: z.enum(STAFF_REFUND_REASONS),
          cancelBooking: z.boolean().default(false),
        }),
        output: proposalOut,
        run: async (input, { grant, agent }) => {
          const payment = await this.prisma.payment.findFirst({
            where: { id: input.paymentId, bookingId: input.bookingId, status: 'succeeded' },
            select: {
              amountMinor: true,
              currency: true,
              refunds: {
                where: { status: { notIn: ['rejected', 'failed'] } },
                select: { amountMinor: true },
              },
            },
          });
          if (!payment) throw new AgentToolError('not_found');
          const refunded = payment.refunds.reduce((sum, row) => sum + row.amountMinor, 0n);
          if (BigInt(input.amountMinor) > payment.amountMinor - refunded) {
            return this.proposed(['amount_above_refundable']);
          }
          return this.propose(grant, agent, 'refund_request', {
            subject: { type: 'booking', id: input.bookingId },
            payload: {
              bookingId: input.bookingId,
              paymentId: input.paymentId,
              amount: { amountMinor: input.amountMinor, currency: payment.currency },
              reason: input.reason,
              cancelBooking: input.cancelBooking,
            },
          });
        },
      }),
    );

    this.registry.register(
      agentTool({
        name: 'marketing.promos',
        description:
          'The promo codes that are switched on: each code, what it gives (basis points for a percentage, minor units for a fixed amount), where it applies, until when, and how often it was used.',
        tier: 'read',
        scope: 'marketing',
        agents: ['marketing', 'executive'],
        input: z.object({}),
        output: z.object({
          found: count,
          promos: z
            .array(
              z.object({
                code: z.string(),
                gives: z.enum(['percentage', 'fixed']),
                value: count,
                currency: z.string().nullable(),
                products: z.array(z.string()),
                validUntil: z.string().nullable(),
                timesUsed: count,
                usesAllowed: count.nullable(),
              }),
            )
            .max(30),
        }),
        run: async () => {
          const page = await this.promos.list({ active: true, limit: 30 });
          return {
            found: page.items.length,
            promos: page.items.map((promo) => ({
              code: promo.code,
              gives: promo.type,
              value: promo.value,
              currency: promo.currency,
              products: promo.verticals,
              validUntil: promo.validTo ? utcTime(promo.validTo) : null,
              timesUsed: promo.redemptions,
              usesAllowed: promo.maxRedemptions,
            })),
          };
        },
      }),
    );

    this.registry.register(
      agentTool({
        name: 'marketing.draft_promo',
        description:
          'Prepares a promo code for a person to decide: the code (4 to 20 letters and digits), a percentage in basis points (1000 is 10%) or a fixed amount in minor units of a currency, where it applies, its dates and how often it may be used. It creates nothing: the draft waits in the approvals queue, someone other than the person you are working for approves or rejects it, and an approved one is created switched off for a person to switch on.',
        tier: 'propose',
        scope: 'marketing',
        agents: ['marketing'],
        input: z.object({
          code: z.string().trim().min(4).max(20),
          internalNote: z.string().trim().max(200).optional(),
          gives: z.enum(['percentage', 'fixed']),
          value: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
          currency: z
            .string()
            .regex(/^[A-Z]{3}$/)
            .optional(),
          maxDiscountMinor: z.number().int().min(0).optional(),
          minSpendMinor: z.number().int().min(0).optional(),
          products: z.array(bookingVerticalSchema).max(7).default([]),
          validFrom: z.iso.datetime().optional(),
          validTo: z.iso.datetime().optional(),
          usesAllowed: z.number().int().min(1).max(1_000_000).optional(),
          usesPerAccount: z.number().int().min(1).max(1_000_000).optional(),
          needsAnAccount: z.boolean().default(true),
        }),
        output: proposalOut,
        run: async (input, { grant, agent }) => {
          const promo = promoCheck.safeParse({
            code: input.code,
            description: input.internalNote ?? null,
            type: input.gives,
            value: input.value,
            currency: input.currency ?? null,
            maxDiscountMinor: input.maxDiscountMinor ?? null,
            minSpendMinor: input.minSpendMinor ?? null,
            verticals: input.products,
            validFrom: input.validFrom ?? null,
            validTo: input.validTo ?? null,
            maxRedemptions: input.usesAllowed ?? null,
            maxRedemptionsPerUser: input.usesPerAccount ?? null,
            requiresAccount: input.needsAnAccount,
            active: false,
          });
          if (!promo.success) return this.proposed(issueCodes(promo.error));
          const taken = await this.prisma.promoCode.count({ where: { code: promo.data.code } });
          if (taken > 0) return this.proposed(['code_taken']);
          return this.propose(grant, agent, 'promo_code', { subject: null, payload: promo.data });
        },
      }),
    );

    this.registry.register(
      agentTool({
        name: 'sources.overview',
        description:
          "How price intelligence stands: whether it is switched on, each vendor and whether its key works, what is switched off, what reading has cost today and this month against each cap, and how many sites are in review, approved and blocked. Approving a site is a person's decision in the console.",
        tier: 'read',
        scope: 'datasources',
        agents: ['price_intel', 'executive'],
        input: z.object({}),
        output: z.object({
          switchedOn: z.boolean(),
          vendors: z.array(z.object({ vendor: z.string(), keyWorks: z.boolean().nullable() })),
          switchedOff: z.array(z.object({ what: z.string(), which: z.string().nullable() })),
          spend: z
            .array(
              z.object({
                what: z.string(),
                which: z.string().nullable(),
                spentTodayMicroUsd: count,
                dailyCapMicroUsd: count,
                spentThisMonthMicroUsd: count,
                monthlyCapMicroUsd: count,
              }),
            )
            .max(40),
          sitesInReview: count,
          sitesApproved: count,
          sitesBlocked: count,
        }),
        run: async () => {
          const overview = await this.intel.overview();
          return {
            switchedOn: overview.enabled,
            vendors: overview.vendors.map((vendor) => ({
              vendor: vendor.vendor,
              keyWorks: vendor.ok,
            })),
            switchedOff: overview.switches.map((entry) => ({
              what: entry.scope,
              which: entry.subject ?? null,
            })),
            spend: overview.budgets.slice(0, 40).map((line) => ({
              what: line.scope,
              which: line.subject ?? null,
              spentTodayMicroUsd: line.spentTodayMicroUsd,
              dailyCapMicroUsd: line.dailyCapMicroUsd,
              spentThisMonthMicroUsd: line.spentThisMonthMicroUsd,
              monthlyCapMicroUsd: line.monthlyCapMicroUsd,
            })),
            sitesInReview: overview.sources.review,
            sitesApproved: overview.sources.approved,
            sitesBlocked: overview.sources.blocked,
          };
        },
      }),
    );
  }

  private proposed(problems: string[]): z.infer<typeof proposalOut> {
    return { problems, waitsForApproval: false, wasAlreadyWaiting: false, approvalId: null };
  }

  /** Puts a proposal in the queue for the staff member the run works for. */
  private async propose(
    grant: AgentGrant,
    agent: Parameters<AgentApprovalsService['propose']>[0]['agent'],
    kind: Parameters<AgentApprovalsService['propose']>[0]['kind'],
    proposal: { subject: { type: string; id: string } | null; payload: unknown },
  ): Promise<z.infer<typeof proposalOut>> {
    // A proposal is somebody's: without a person to ask for, there is nobody it is for.
    if (!grant.userId) throw new AgentToolError('not_found');
    const result = await this.approvals.propose({
      kind,
      requestedBy: grant.userId,
      agent,
      runId: grant.runId,
      conversationId: grant.conversationId,
      subject: proposal.subject,
      payload: proposal.payload,
    });
    if ('refused' in result) return this.proposed(['too_many_waiting']);
    return {
      problems: [],
      waitsForApproval: true,
      wasAlreadyWaiting: !result.created,
      approvalId: result.id,
    };
  }
}
