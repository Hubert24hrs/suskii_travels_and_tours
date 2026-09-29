import { Inject, Injectable, Logger } from '@nestjs/common';

import { add, defaultRefund, money, type Money, type PaymentPlanKind } from '@suskii/shared';

import { AuditService } from '../audit/audit.service';
import { BackgroundTasks } from '../common/background-tasks';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { documentMoney } from '../documents/booking-pdf';
import { PrismaService } from '../infra/prisma.service';
import { LedgerService, transfer } from '../ledger/ledger.service';
import { offerUnavailable, supplierUnavailable } from '../search/search.errors';
import { SupplierRunner } from '../search/supplier-runner';
import { OfferUnavailableError, SupplierRequestError } from '../suppliers/supplier.errors';
import type { FlightHold, FlightSupplier } from '../suppliers/supplier.types';
import { FLIGHT_SUPPLIERS } from '../suppliers/suppliers.module';

import { BookingFundsService } from './booking-funds.service';
import { BookingNotifications } from './booking-notifications';
import { itemPayload, itemServices } from './booking-presenter';
import { BookingTransitions, SYSTEM_ACTOR, type BookingActor } from './booking-transitions';
import { bookingConflict, holdLimit, holdUnavailable } from './booking.errors';
import type { BookingDto } from './bookings.schemas';
import { BookingsService, customerActor, type BookingCaller } from './bookings.service';
import { CheckoutService } from './checkout.service';
import { holdTerms, planOptions, planPolicy } from './payment-options';
import { RefundsService } from './refunds.service';
import { TicketingService } from './ticketing.service';

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const BATCH = 50;
/** A sweep starts no new supplier call or email after this long. */
const SWEEP_BUDGET_MS = 20_000;

type CloseReason = 'missed_payment' | 'expired' | 'cancelled';

/**
 * Reserve now and pay later, and deposits with installments (ADR-018). Creating a plan holds the
 * seats at the airline first, then records the plan and moves the booking to HELD; the worker
 * sends reminders, and defaults or releases plans that miss a payment, refunding per policy.
 */
@Injectable()
export class PaymentPlansService {
  private readonly logger = new Logger(PaymentPlansService.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(FLIGHT_SUPPLIERS) private readonly flightSuppliers: FlightSupplier[],
    private readonly prisma: PrismaService,
    private readonly bookings: BookingsService,
    private readonly checkout: CheckoutService,
    private readonly ticketing: TicketingService,
    private readonly funds: BookingFundsService,
    private readonly ledger: LedgerService,
    private readonly refunds: RefundsService,
    private readonly transitions: BookingTransitions,
    private readonly audit: AuditService,
    private readonly notifications: BookingNotifications,
    private readonly runner: SupplierRunner,
    private readonly background: BackgroundTasks,
  ) {}

  // -------------------------------------------------------------------------
  // Creating a plan
  // -------------------------------------------------------------------------

  async create(
    bookingId: string,
    caller: BookingCaller,
    kind: PaymentPlanKind,
  ): Promise<BookingDto> {
    const booking = await this.bookings.load(bookingId, caller);
    if (booking.paymentPlan) {
      if (booking.paymentPlan.kind === kind && booking.paymentPlan.status === 'active') {
        return this.bookings.present(booking);
      }
      throw bookingConflict('This booking already has a payment plan.');
    }
    if (booking.status !== 'PRICED') throw bookingConflict('Only unpaid bookings can be reserved.');
    const item = booking.items[0];
    if (!item || itemPayload(item).kind !== 'flight' || itemServices(item).length > 0) {
      throw holdUnavailable();
    }
    const active = await this.prisma.paymentPlan.count({
      where: {
        status: 'active',
        booking: booking.userId
          ? { userId: booking.userId }
          : { contactEmailHash: booking.contactEmailHash },
      },
    });
    if (active >= this.config.HOLD_MAX_ACTIVE) throw holdLimit(this.config.HOLD_MAX_ACTIVE);

    const actor = customerActor(caller);
    const now = new Date();
    const policy = planPolicy(this.config);
    // The price must still hold right now (may answer 409 `price-changed`).
    const fresh = await this.checkout.confirmPrice(booking, actor);
    const offered = planOptions(holdTerms(fresh.payload), fresh.total, false, policy, now);
    if (!offered.hold || (kind === 'installments' && !offered.installments))
      throw holdUnavailable();
    if (fresh.payload.kind !== 'flight') throw holdUnavailable();

    const offer = fresh.payload.offer;
    const supplier = this.flightSuppliers.find((candidate) => candidate.name === offer.supplier);
    if (!supplier) throw supplierUnavailable();
    let held: FlightHold;
    try {
      held = await this.runner.call(
        'flights',
        supplier.name,
        'hold',
        (signal) =>
          supplier.hold(
            {
              offer,
              passengers: this.ticketing.supplierPassengers(booking),
              contact: this.bookings.contact(booking),
              idempotencyKey: item.id,
            },
            signal,
          ),
        this.config.SUPPLIER_BOOKING_TIMEOUT_MS,
      );
    } catch (error) {
      if (error instanceof OfferUnavailableError) throw offerUnavailable(fresh.payload.request);
      if (error instanceof SupplierRequestError) throw holdUnavailable();
      this.logger.warn({ bookingId, reason: (error as Error).name }, 'supplier hold failed');
      throw supplierUnavailable();
    }

    // Plan against what the airline actually granted, not what the offer promised.
    const heldTotal = add(held.price.base, held.price.taxes);
    const offerTotal = add(offer.price.base, offer.price.taxes);
    const granted = planOptions(
      {
        paymentRequiredBy: new Date(held.paymentRequiredBy),
        priceGuaranteedUntil: held.priceGuaranteedUntil
          ? new Date(held.priceGuaranteedUntil)
          : null,
      },
      fresh.total,
      false,
      policy,
      now,
    );
    const schedule =
      kind === 'installments'
        ? granted.installments?.schedule.payments
        : granted.hold
          ? [{ sequence: 0, dueAt: granted.hold.deadline, amount: fresh.total }]
          : undefined;
    const deadline = granted.hold?.deadline;
    if (heldTotal.minor !== offerTotal.minor || !schedule || !deadline) {
      await this.releaseHold(offer.supplier, held.orderId);
      throw holdUnavailable();
    }
    const total =
      kind === 'installments' && granted.installments
        ? granted.installments.schedule.total
        : fresh.total;
    const fee =
      kind === 'installments' && granted.installments
        ? granted.installments.schedule.fee
        : money(0n, fresh.total.currency);

    try {
      await this.prisma.$transaction(async (tx) => {
        await this.checkout.storeFresh(tx, item.id, fresh);
        await tx.bookingItem.update({
          where: { id: item.id },
          data: {
            supplierOrderId: held.orderId,
            supplierReference: held.supplierReference,
            heldUntil: new Date(held.paymentRequiredBy),
            priceGuaranteedUntil: held.priceGuaranteedUntil
              ? new Date(held.priceGuaranteedUntil)
              : null,
          },
        });
        const plan = await tx.paymentPlan.create({
          data: {
            bookingId,
            kind,
            currency: total.currency,
            totalMinor: total.minor,
            feeMinor: fee.minor,
            graceHours: policy.graceHours,
            defaultFeeBps: policy.defaultFeeBps,
            deadline,
            installments: {
              create: schedule.map((payment) => ({
                sequence: payment.sequence,
                dueAt: payment.dueAt,
                amountMinor: payment.amount.minor,
                currency: payment.amount.currency,
              })),
            },
          },
        });
        await this.transitions.apply(tx, { id: bookingId, status: 'PRICED' }, 'hold', actor, {
          data: { paymentDeadline: deadline },
        });
        await this.audit.record(
          {
            action: 'payment_plan.created',
            actorUserId: actor.userId ?? null,
            targetType: 'booking',
            targetId: bookingId,
            context: caller.context,
            metadata: {
              planId: plan.id,
              kind,
              deadline: deadline.toISOString(),
              totalMinor: total.minor.toString(),
              currency: total.currency,
              installments: schedule.length,
            },
          },
          tx,
        );
      });
    } catch (error) {
      await this.releaseHold(offer.supplier, held.orderId);
      throw error;
    }
    this.background.run('plan-created', () => this.notifications.planCreated(bookingId));
    return this.bookings.present(await this.bookings.reload(bookingId));
  }

  // -------------------------------------------------------------------------
  // Cancelling, defaulting, expiring
  // -------------------------------------------------------------------------

  /** Customer cancellation: through the plan policy when a plan is running. */
  async cancel(bookingId: string, caller: BookingCaller): Promise<BookingDto> {
    const booking = await this.bookings.load(bookingId, caller);
    if (booking.paymentPlan?.status !== 'active') return this.bookings.cancel(bookingId, caller);
    await this.close(bookingId, 'cancelled', customerActor(caller));
    return this.bookings.present(await this.bookings.reload(bookingId));
  }

  /**
   * Closes an active plan (ADR-018): nothing paid expires or cancels the booking; something paid
   * refunds it minus the policy fee (cancelled when the fee takes everything). The airline hold is
   * released afterwards.
   */
  async close(bookingId: string, reason: CloseReason, actor: BookingActor): Promise<boolean> {
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM bookings WHERE id = ${bookingId}::uuid FOR UPDATE`;
      const booking = await tx.booking.findUniqueOrThrow({
        where: { id: bookingId },
        include: { items: true },
      });
      const plan = await tx.paymentPlan.findUnique({ where: { bookingId } });
      if (plan?.status !== 'active') return null;
      const paid = await this.funds.paid(tx, booking);
      await tx.paymentPlan.update({
        where: { id: plan.id },
        data: {
          status:
            reason === 'cancelled' ? 'cancelled' : paid.minor === 0n ? 'expired' : 'defaulted',
          closedAt: new Date(),
        },
      });
      await tx.installment.updateMany({
        where: { planId: plan.id, status: 'pending' },
        data: { status: 'cancelled' },
      });
      await tx.payment.updateMany({
        where: { bookingId, status: 'pending' },
        data: { status: 'cancelled' },
      });

      let refund: Money | null = null;
      let fee: Money | null = null;
      let refundIds: string[] = [];
      if (paid.minor === 0n) {
        await this.transitions.apply(
          tx,
          booking,
          reason === 'cancelled' ? 'cancel' : 'expire',
          actor,
          {
            reason: reason === 'cancelled' ? 'customer_request' : 'hold_deadline',
          },
        );
      } else {
        const split = defaultRefund(paid, plan.defaultFeeBps);
        refund = split.refund.minor > 0n ? split.refund : null;
        fee = split.fee.minor > 0n ? split.fee : null;
        if (fee) {
          await this.ledger.post(tx, {
            key: `plan:${plan.id}:cancellation-fee`,
            kind: 'cancellation_fee',
            bookingId,
            lines: transfer(
              { kind: 'booking', bookingId, currency: booking.currency },
              { kind: 'cancellation-fees', currency: booking.currency },
              fee,
            ),
          });
        }
        if (refund) {
          await this.transitions.apply(tx, booking, 'default', actor, { reason });
          refundIds = await this.refunds.refundBookingBalance(
            tx,
            booking,
            reason === 'cancelled' ? 'customer_cancellation' : 'installment_default',
            { amount: refund },
          );
        } else {
          await this.transitions.apply(tx, booking, 'cancel', actor, { reason });
        }
      }
      await this.audit.record(
        {
          action: reason === 'cancelled' ? 'booking.plan_cancelled' : 'booking.plan_defaulted',
          actorType: actor.type === 'customer' ? 'user' : 'system',
          actorUserId: actor.userId ?? null,
          targetType: 'booking',
          targetId: bookingId,
          metadata: {
            planId: plan.id,
            reason,
            paidMinor: paid.minor.toString(),
            refundMinor: (refund?.minor ?? 0n).toString(),
            feeMinor: (fee?.minor ?? 0n).toString(),
            currency: booking.currency,
          },
        },
        tx,
      );
      const item = booking.items[0];
      return {
        reference: booking.reference,
        refund,
        fee,
        refundIds,
        paid,
        hold: item?.supplierOrderId
          ? { supplier: item.supplier, orderId: item.supplierOrderId }
          : null,
      };
    });
    if (!result) return false;
    if (result.hold) await this.releaseHold(result.hold.supplier, result.hold.orderId);
    this.refunds.executeLater(result.refundIds);
    await this.notifications.planClosed(bookingId, {
      reason: result.paid.minor === 0n && reason === 'missed_payment' ? 'expired' : reason,
      refund: result.refund ? documentMoney(result.refund) : null,
      fee: result.fee ? documentMoney(result.fee) : null,
    });
    if (reason === 'missed_payment' && result.paid.minor > 0n) {
      await this.notifications.ops('installment.default', result.reference, {
        bookingId,
        refundMinor: (result.refund?.minor ?? 0n).toString(),
        feeMinor: (result.fee?.minor ?? 0n).toString(),
      });
    }
    return true;
  }

  // -------------------------------------------------------------------------
  // Worker sweep
  // -------------------------------------------------------------------------

  async processDue(
    now = new Date(),
  ): Promise<{ reminders: number; defaulted: number; expired: number }> {
    const counts = { reminders: 0, defaulted: 0, expired: 0 };
    const stopStartingAt = Date.now() + SWEEP_BUDGET_MS;

    // Reminders 3 days and 1 day before each due date (not the deposit, due at once).
    const upcoming = await this.prisma.installment.findMany({
      where: {
        status: 'pending',
        plan: { status: 'active' },
        dueAt: { gt: now, lte: new Date(now.getTime() + 3 * DAY_MS) },
        OR: [{ reminder3dSentAt: null }, { reminder1dSentAt: null }],
      },
      include: { plan: true },
      orderBy: { dueAt: 'asc' },
      take: BATCH,
    });
    for (const installment of upcoming) {
      if (Date.now() > stopStartingAt) return counts;
      if (installment.plan.kind === 'installments' && installment.sequence === 0) continue;
      const due = installment.dueAt.getTime();
      const created = installment.plan.createdAt.getTime();
      const windows = [
        { field: 'reminder1dSentAt' as const, sent: installment.reminder1dSentAt, lead: DAY_MS },
        {
          field: 'reminder3dSentAt' as const,
          sent: installment.reminder3dSentAt,
          lead: 3 * DAY_MS,
        },
      ];
      for (const window of windows) {
        if (window.sent || now.getTime() < due - window.lead) continue;
        // Already inside the window when the plan was made: the plan email said it all.
        const skip = created >= due - window.lead;
        const { count } = await this.prisma.installment.updateMany({
          where: { id: installment.id, [window.field]: null },
          data: {
            [window.field]: now,
            ...(window.field === 'reminder1dSentAt'
              ? { reminder3dSentAt: installment.reminder3dSentAt ?? now }
              : {}),
          },
        });
        if (count === 1 && !skip) {
          await this.notifications.paymentDue(
            installment.plan.bookingId,
            money(installment.amountMinor, installment.currency),
            installment.dueAt,
          );
          counts.reminders += 1;
        }
        break;
      }
    }

    // Missed payments: past the due date plus grace (the deposit: the checkout window).
    const overdue = await this.prisma.installment.findMany({
      where: { status: 'pending', plan: { status: 'active' }, dueAt: { lt: now } },
      include: { plan: true },
      orderBy: { dueAt: 'asc' },
      take: BATCH,
    });
    const handled = new Set<string>();
    for (const installment of overdue) {
      if (Date.now() > stopStartingAt) return counts;
      const plan = installment.plan;
      if (handled.has(plan.id)) continue;
      const grace =
        plan.kind === 'hold'
          ? 0
          : installment.sequence === 0
            ? (this.config.PAYMENT_SESSION_TTL_MINUTES + 10) * 60_000
            : plan.graceHours * HOUR_MS;
      const cutoff = Math.min(installment.dueAt.getTime() + grace, plan.deadline.getTime());
      if (now.getTime() <= cutoff) continue;
      handled.add(plan.id);
      if (await this.tryClose(plan.bookingId, 'missed_payment')) counts.defaulted += 1;
    }

    // Safety net: any active plan past its deadline.
    const lapsed = await this.prisma.paymentPlan.findMany({
      where: { status: 'active', deadline: { lt: now } },
      select: { id: true, bookingId: true },
      take: BATCH,
    });
    for (const plan of lapsed) {
      if (Date.now() > stopStartingAt) return counts;
      if (handled.has(plan.id)) continue;
      if (await this.tryClose(plan.bookingId, 'expired')) counts.expired += 1;
    }
    return counts;
  }

  private async tryClose(bookingId: string, reason: CloseReason): Promise<boolean> {
    try {
      return await this.close(bookingId, reason, SYSTEM_ACTOR);
    } catch (error) {
      // A payment landed at the same moment: the next sweep looks again.
      this.logger.warn({ bookingId, reason: (error as Error).name }, 'closing the plan failed');
      return false;
    }
  }

  private async releaseHold(supplierName: string, orderId: string): Promise<void> {
    const supplier = this.flightSuppliers.find((candidate) => candidate.name === supplierName);
    if (!supplier) return;
    try {
      await this.runner.call('flights', supplier.name, 'cancel-hold', (signal) =>
        supplier.cancelHold(orderId, signal),
      );
    } catch (error) {
      // The airline releases unpaid holds at their deadline anyway.
      this.logger.warn({ reason: (error as Error).name }, 'releasing the hold failed');
    }
  }
}
