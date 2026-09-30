import { Inject, Injectable, Logger } from '@nestjs/common';
import type { z } from 'zod';

import { equals, minOf, money, subtract, toWire, type Money } from '@suskii/shared';

import { AuditService } from '../audit/audit.service';
import { BackgroundTasks } from '../common/background-tasks';
import { toJsonValue } from '../common/json';
import { uuidv7 } from '../common/uuid';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { Prisma, type BookingStatus } from '../generated/prisma/client';
import { PrismaService } from '../infra/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import {
  PaymentProviderUnavailableError,
  type PaymentProvider,
} from '../payments/payment-provider';
import { PaymentProviders } from '../payments/payment-providers';
import { FxService } from '../pricing/fx.service';
import { PricingService } from '../pricing/pricing.service';
import type { ClientContext } from '../search/client-context';
import { offerUnavailable, supplierUnavailable } from '../search/search.errors';
import { SupplierRunner } from '../search/supplier-runner';
import { OfferUnavailableError } from '../suppliers/supplier.errors';
import type { FlightSupplier, HotelSupplier } from '../suppliers/supplier.types';
import { FLIGHT_SUPPLIERS, HOTEL_SUPPLIERS } from '../suppliers/suppliers.module';

import { BookingFundsService, PAYABLE_STATUSES } from './booking-funds.service';
import { BookingPaymentsService } from './booking-payments.service';
import {
  itemPayload,
  itemServices,
  pendingPrice,
  bookingPrice,
  type BookingRecord,
  type PendingPrice,
} from './booking-presenter';
import {
  bookedRate,
  matchService,
  priceBookingItem,
  totalOf,
  type ExtraSelection,
  type ItemPayload,
  type PromoInput,
} from './booking-pricing';
import { BookingTransitions, SYSTEM_ACTOR, type BookingActor } from './booking-transitions';
import {
  bookingConflict,
  bookingExpired,
  installmentInvalid,
  paymentProviderDown,
  priceChanged,
  providerUnavailable,
  walletInsufficient,
} from './booking.errors';
import { paymentReturnUrl } from './booking-urls';
import type { paymentSessionSchema, StartPaymentRequest } from './bookings.schemas';
import { BookingsService, customerActor, type BookingCaller } from './bookings.service';
import { TicketingService } from './ticketing.service';

/** Unpaid statuses that expire at the payment deadline (held bookings follow their plan). */
const EXPIRABLE: readonly BookingStatus[] = ['DRAFT', 'PRICED', 'AWAITING_PAYMENT'];
/** A checkout that is still open when the deadline passes gets this long to report back. */
const AWAITING_PAYMENT_GRACE_MS = 10 * 60_000;

type Tx = Prisma.TransactionClient;

const earliest = (...dates: Date[]): Date => new Date(Math.min(...dates.map((d) => d.getTime())));

function offerExpiry(payload: ItemPayload): Date {
  return new Date(
    payload.kind === 'flight' ? payload.offer.expiresAt : bookedRate(payload).expiresAt,
  );
}

function supplierOfferId(payload: ItemPayload): string {
  return payload.kind === 'flight'
    ? payload.offer.supplierOfferId
    : bookedRate(payload).supplierRateId;
}

/** Pricing context of an existing booking: its own channel and tier, not the current caller's. */
export function bookingClient(booking: Pick<BookingRecord, 'channel' | 'userId'>): ClientContext {
  return {
    channel: booking.channel,
    userTier: booking.userId ? 'member' : 'guest',
    userId: booking.userId,
  };
}

/** A price the supplier confirmed right now, with the extras mapped onto the fresh offer. */
export interface ConfirmedPrice {
  payload: ItemPayload;
  services: ExtraSelection[];
  total: Money;
}

type PaymentSession = z.infer<typeof paymentSessionSchema>;

/**
 * Payment start (ADR-014 steps 3-4, ADR-016, ADR-018): re-prices with the supplier immediately
 * before payment, answers 409 with the difference when the total moved, and otherwise opens a
 * hosted checkout with the chosen provider, or pays from the wallet. Payment plans pay the next
 * installment (or the balance) of a held booking. Also expires unpaid bookings.
 */
@Injectable()
export class CheckoutService {
  private readonly logger = new Logger(CheckoutService.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(FLIGHT_SUPPLIERS) private readonly flightSuppliers: FlightSupplier[],
    @Inject(HOTEL_SUPPLIERS) private readonly hotelSuppliers: HotelSupplier[],
    private readonly prisma: PrismaService,
    private readonly bookings: BookingsService,
    private readonly pricing: PricingService,
    private readonly fx: FxService,
    private readonly runner: SupplierRunner,
    private readonly providers: PaymentProviders,
    private readonly transitions: BookingTransitions,
    private readonly audit: AuditService,
    private readonly funds: BookingFundsService,
    private readonly payments: BookingPaymentsService,
    private readonly ledger: LedgerService,
    private readonly ticketing: TicketingService,
    private readonly background: BackgroundTasks,
  ) {}

  async startPayment(
    bookingId: string,
    caller: BookingCaller,
    request: StartPaymentRequest,
  ): Promise<PaymentSession> {
    const booking = await this.bookings.load(bookingId, caller);
    const item = booking.items[0];
    if (!item) throw bookingConflict();
    const pending = pendingPrice(booking);
    if (pending) throw priceChanged(this.change(booking, pending));
    if (!PAYABLE_STATUSES.includes(booking.status)) {
      throw bookingConflict('This booking is not waiting for payment.');
    }
    const now = new Date();
    const plan = booking.paymentPlan?.status === 'active' ? booking.paymentPlan : null;
    if (!plan && booking.paymentDeadline && booking.paymentDeadline <= now) {
      await this.expire(booking, 'payment_deadline');
      throw bookingExpired(itemPayload(item).request);
    }
    if (plan && plan.deadline <= now) throw bookingExpired(itemPayload(item).request);

    const actor = customerActor(caller);
    let amount: Money;
    let installmentId: string | null = null;
    let fresh: ConfirmedPrice | null = null;
    let expiresAt: Date;
    if (plan) {
      const paid = await this.funds.paid(this.prisma, booking);
      const remaining = subtract(money(plan.totalMinor, plan.currency), paid);
      if (remaining.minor <= 0n) throw bookingConflict('This booking is already paid.');
      const next = request.installmentId
        ? plan.installments.find((installment) => installment.id === request.installmentId)
        : plan.installments.find((installment) => installment.status === 'pending');
      if (request.installmentId && next?.status !== 'pending') throw installmentInvalid();
      if (plan.kind === 'hold') await this.recheckHeldPrice(booking, actor);
      if (request.payInFull || !next) {
        amount = remaining;
      } else {
        amount = minOf(money(next.amountMinor, next.currency), remaining);
        installmentId = next.id;
      }
      expiresAt = earliest(
        new Date(now.getTime() + this.config.PAYMENT_SESSION_TTL_MINUTES * 60_000),
        plan.deadline,
      );
    } else {
      fresh = await this.confirmPrice(booking, actor);
      amount = fresh.total;
      expiresAt = earliest(
        new Date(now.getTime() + this.config.PAYMENT_SESSION_TTL_MINUTES * 60_000),
        offerExpiry(fresh.payload),
      );
    }

    if (request.useWallet)
      return this.payFromWallet(booking, amount, installmentId, fresh, actor, caller);

    const provider = this.providers.choose(booking.currency, request.provider);
    if (!provider) throw providerUnavailable();
    const contact = this.bookings.contact(booking);
    const paymentId = uuidv7();
    let session: { providerReference: string; checkoutUrl: string };
    try {
      session = await provider.createCheckout({
        paymentId,
        reference: booking.reference,
        amount,
        customerEmail: contact.email,
        returnUrl: paymentReturnUrl(this.config, booking.id, caller.client.channel),
        expiresAt,
      });
    } catch (error) {
      this.logger.warn(
        { bookingId, provider: provider.name, reason: (error as Error).name },
        'checkout creation failed',
      );
      if (error instanceof PaymentProviderUnavailableError) throw paymentProviderDown();
      throw error;
    }

    const abandoned = await this.prisma.$transaction(async (tx) => {
      const { status, closed } = await this.abandonOpenPayments(tx, booking, actor, 'new_payment');
      if (fresh) await this.storeFresh(tx, item.id, fresh);
      await tx.payment.create({
        data: {
          id: paymentId,
          bookingId: booking.id,
          provider: provider.name,
          providerReference: session.providerReference,
          status: 'pending',
          amountMinor: amount.minor,
          currency: amount.currency,
          checkoutUrl: session.checkoutUrl,
          expiresAt,
          installmentId,
        },
      });
      // Held and partly paid bookings stay put: the pending payment shows the open checkout.
      if (!plan) {
        await this.transitions.apply(tx, { id: booking.id, status }, 'request_payment', actor, {
          data: { paymentDeadline: expiresAt },
        });
      }
      await this.audit.record(
        {
          action: 'payment.created',
          actorUserId: actor.userId ?? null,
          targetType: 'payment',
          targetId: paymentId,
          context: caller.context,
          metadata: {
            bookingId: booking.id,
            provider: provider.name,
            ...(installmentId ? { installmentId } : {}),
          },
        },
        tx,
      );
      return closed;
    });
    this.closeAtProviders(abandoned);

    return {
      paymentId,
      status: 'pending',
      checkoutUrl: session.checkoutUrl,
      amount: toWire(amount),
      expiresAt: expiresAt.toISOString(),
    };
  }

  /** The wallet pays the whole amount at once, in one transaction (ADR-017). */
  private async payFromWallet(
    booking: BookingRecord,
    amount: Money,
    installmentId: string | null,
    fresh: ConfirmedPrice | null,
    actor: BookingActor,
    caller: BookingCaller,
  ): Promise<PaymentSession> {
    const userId = booking.userId;
    if (!userId || caller.client.userId !== userId) throw walletInsufficient();
    const wallet = { kind: 'wallet', userId, currency: booking.currency } as const;
    const paymentId = uuidv7();
    const now = new Date();
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM bookings WHERE id = ${booking.id}::uuid FOR UPDATE`;
      if ((await this.ledger.balance(tx, wallet)).minor < amount.minor) throw walletInsufficient();
      const { closed } = await this.abandonOpenPayments(tx, booking, actor, 'wallet_payment');
      const item = booking.items[0];
      if (fresh && item) await this.storeFresh(tx, item.id, fresh);
      const current = await tx.booking.findUniqueOrThrow({ where: { id: booking.id } });
      const payment = await tx.payment.create({
        data: {
          id: paymentId,
          bookingId: booking.id,
          kind: 'wallet',
          provider: 'wallet',
          providerReference: `wallet_${paymentId}`,
          status: 'pending',
          amountMinor: amount.minor,
          currency: amount.currency,
          checkoutUrl: null,
          expiresAt: now,
          installmentId,
        },
      });
      const settled = await this.payments.applyReceived(
        tx,
        current,
        payment,
        { amount, providerTransactionId: null, method: 'wallet', occurredAt: now },
        wallet,
        actor,
      );
      if (settled.outcome !== 'paid' && settled.outcome !== 'partially_paid')
        throw bookingConflict();
      await this.audit.record(
        {
          action: 'payment.wallet',
          actorUserId: userId,
          targetType: 'payment',
          targetId: paymentId,
          context: caller.context,
          metadata: {
            bookingId: booking.id,
            amountMinor: amount.minor.toString(),
            currency: amount.currency,
          },
        },
        tx,
      );
      return { settled, closed };
    });
    this.closeAtProviders(result.closed);
    const paid = result.settled.paidBookingId;
    if (paid) this.background.run('ticketing', () => this.ticketing.process(paid));
    return {
      paymentId,
      status: 'succeeded',
      checkoutUrl: null,
      amount: toWire(amount),
      expiresAt: now.toISOString(),
    };
  }

  /**
   * Re-prices the booking's item with the supplier. A changed total is stored as the pending
   * price and answered with 409 `price-changed`; an offer that is gone fails the booking.
   */
  async confirmPrice(booking: BookingRecord, actor: BookingActor): Promise<ConfirmedPrice> {
    const item = booking.items[0];
    if (!item) throw bookingConflict();
    const payload = itemPayload(item);
    let freshPayload: ItemPayload;
    try {
      freshPayload = await this.reprice(payload);
    } catch (error) {
      if (error instanceof OfferUnavailableError) {
        await this.failUnavailable(booking, actor);
        throw offerUnavailable(payload.request);
      }
      this.logger.warn(
        { bookingId: booking.id, reason: (error as Error).name },
        're-price before payment failed',
      );
      throw supplierUnavailable();
    }
    const services = this.mapExtras(itemServices(item), freshPayload);
    if (!services) {
      await this.failUnavailable(booking, actor);
      throw offerUnavailable(payload.request);
    }
    const [pricer, fx, promo] = await Promise.all([
      this.pricing.pricer(booking.vertical, booking.currency),
      this.fx.converter(),
      this.promoFor(booking),
    ]);
    const now = new Date();
    const priced = priceBookingItem(
      pricer,
      fx,
      freshPayload,
      bookingClient(booking),
      services,
      promo,
      now,
    );
    const agreed = money(booking.totalMinor, booking.currency);
    if (!equals(priced.total, agreed)) {
      const next: PendingPrice = {
        price: priced.price,
        items: [
          {
            id: item.id,
            supplierOfferId: supplierOfferId(freshPayload),
            payload: freshPayload,
            services,
          },
        ],
      };
      const closed = await this.prisma.$transaction(async (tx) => {
        const { status, closed: abandoned } = await this.abandonOpenPayments(
          tx,
          booking,
          actor,
          'price_changed',
        );
        const { count } = await tx.booking.updateMany({
          where: { id: booking.id, status },
          data: { pendingPrice: toJsonValue(next) as Prisma.InputJsonValue },
        });
        if (count !== 1) throw bookingConflict();
        await this.audit.record(
          {
            action: 'booking.price_changed',
            actorType: 'system',
            targetType: 'booking',
            targetId: booking.id,
            ...(actor.context ? { context: actor.context } : {}),
            metadata: {
              previousMinor: agreed.minor.toString(),
              currentMinor: priced.total.minor.toString(),
              currency: agreed.currency,
            },
          },
          tx,
        );
        return abandoned;
      });
      this.closeAtProviders(closed);
      throw priceChanged(this.change(booking, next));
    }
    return { payload: freshPayload, services, total: priced.total };
  }

  /**
   * A held order's price can change once the airline's guarantee lapses (ADR-018): fetch it, and
   * send a changed total through the consent step like any re-price. Installment plans are only
   * offered with the price guaranteed throughout, so this concerns plain holds.
   */
  private async recheckHeldPrice(booking: BookingRecord, actor: BookingActor): Promise<void> {
    const item = booking.items[0];
    if (!item?.supplierOrderId) return;
    if (item.priceGuaranteedUntil && item.priceGuaranteedUntil > new Date()) return;
    const payload = itemPayload(item);
    if (payload.kind !== 'flight') return;
    const supplier = this.flightSuppliers.find((s) => s.name === payload.offer.supplier);
    if (!supplier) throw supplierUnavailable();
    const orderId = item.supplierOrderId;
    let held;
    try {
      held = await this.runner.call('flights', supplier.name, 'held-order', (signal) =>
        supplier.heldOrder(orderId, signal),
      );
    } catch (error) {
      if (error instanceof OfferUnavailableError) {
        await this.prisma.$transaction(async (tx) => {
          await tx.paymentPlan.updateMany({
            where: { bookingId: booking.id, status: 'active' },
            data: { status: 'expired', closedAt: new Date() },
          });
          await this.transitions.apply(tx, booking, 'fail', SYSTEM_ACTOR, {
            reason: 'hold_released',
          });
        });
        throw offerUnavailable(payload.request);
      }
      throw supplierUnavailable();
    }
    const current = held.price.base.minor + held.price.taxes.minor;
    const booked = payload.offer.price.base.minor + payload.offer.price.taxes.minor;
    if (current === booked) return;
    const freshPayload: ItemPayload = {
      ...payload,
      offer: { ...payload.offer, price: held.price },
    };
    const [pricer, fx, promo] = await Promise.all([
      this.pricing.pricer(booking.vertical, booking.currency),
      this.fx.converter(),
      this.promoFor(booking),
    ]);
    const priced = priceBookingItem(
      pricer,
      fx,
      freshPayload,
      bookingClient(booking),
      [],
      promo,
      new Date(),
    );
    if (equals(priced.total, money(booking.totalMinor, booking.currency))) return;
    const next: PendingPrice = {
      price: priced.price,
      items: [
        {
          id: item.id,
          supplierOfferId: supplierOfferId(freshPayload),
          payload: freshPayload,
          services: [],
        },
      ],
    };
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.booking.updateMany({
        where: { id: booking.id, status: booking.status },
        data: { pendingPrice: toJsonValue(next) as Prisma.InputJsonValue },
      });
      if (count !== 1) throw bookingConflict();
      await this.audit.record(
        {
          action: 'booking.price_changed',
          actorType: 'system',
          targetType: 'booking',
          targetId: booking.id,
          ...(actor.context ? { context: actor.context } : {}),
          metadata: {
            previousMinor: booking.totalMinor.toString(),
            currentMinor: priced.total.minor.toString(),
            currency: booking.currency,
            held: true,
          },
        },
        tx,
      );
    });
    throw priceChanged(this.change(booking, next));
  }

  /** Saves the re-priced offer on the item (its id changes with every re-price). */
  async storeFresh(tx: Tx, itemId: string, fresh: ConfirmedPrice): Promise<void> {
    await tx.bookingItem.update({
      where: { id: itemId },
      data: {
        supplierOfferId: supplierOfferId(fresh.payload),
        payload: toJsonValue(fresh.payload) as Prisma.InputJsonValue,
        services: fresh.services as unknown as Prisma.InputJsonValue,
      },
    });
  }

  /** Expires unpaid bookings whose payment deadline has passed (held bookings: see plans). */
  async expireDue(now = new Date()): Promise<number> {
    const due = await this.prisma.booking.findMany({
      where: {
        OR: [
          { status: { in: ['DRAFT', 'PRICED'] }, paymentDeadline: { lt: now } },
          {
            status: 'AWAITING_PAYMENT',
            paymentDeadline: { lt: new Date(now.getTime() - AWAITING_PAYMENT_GRACE_MS) },
          },
        ],
      },
      select: { id: true, status: true },
      orderBy: { paymentDeadline: 'asc' },
      take: 100,
    });
    let expired = 0;
    for (const booking of due) {
      try {
        await this.expire(booking, 'payment_deadline');
        expired += 1;
      } catch (error) {
        // A payment or cancellation got there first; the next run looks again.
        this.logger.debug(
          { bookingId: booking.id, reason: (error as Error).name },
          'expiry skipped',
        );
      }
    }
    return expired;
  }

  private async expire(
    booking: { id: string; status: BookingStatus },
    reason: string,
  ): Promise<void> {
    if (!EXPIRABLE.includes(booking.status)) return;
    await this.prisma.$transaction(async (tx) => {
      await tx.payment.updateMany({
        where: { bookingId: booking.id, status: 'pending' },
        data: { status: 'expired' },
      });
      await this.transitions.apply(tx, booking, 'expire', SYSTEM_ACTOR, {
        reason,
        data: { pendingPrice: Prisma.DbNull },
      });
    });
  }

  private async failUnavailable(booking: BookingRecord, actor: BookingActor): Promise<void> {
    const closed = await this.prisma.$transaction(async (tx) => {
      const { status, closed: abandoned } = await this.abandonOpenPayments(
        tx,
        booking,
        actor,
        'offer_unavailable',
      );
      await this.transitions.apply(tx, { id: booking.id, status }, 'fail', SYSTEM_ACTOR, {
        reason: 'offer_unavailable',
      });
      return abandoned;
    });
    this.closeAtProviders(closed);
  }

  /**
   * Closes pending checkout sessions; a booking waiting for one goes back to PRICED. A late success
   * for a closed session is still honoured when the booking can take it (ADR-014), otherwise it is
   * refunded automatically.
   */
  private async abandonOpenPayments(
    tx: Tx,
    booking: { id: string; status: BookingStatus },
    actor: BookingActor,
    reason: string,
  ): Promise<{ status: BookingStatus; closed: { provider: string; providerReference: string }[] }> {
    const open = await tx.payment.findMany({
      where: { bookingId: booking.id, status: 'pending' },
      select: { id: true, provider: true, providerReference: true },
    });
    if (open.length > 0) {
      await tx.payment.updateMany({
        where: { id: { in: open.map((payment) => payment.id) } },
        data: { status: 'cancelled' },
      });
    }
    const current = await tx.booking.findUniqueOrThrow({
      where: { id: booking.id },
      select: { status: true },
    });
    const status =
      current.status === 'AWAITING_PAYMENT'
        ? await this.transitions.apply(
            tx,
            { id: booking.id, status: current.status },
            'payment_abandoned',
            actor,
            { reason },
          )
        : current.status;
    return { status, closed: open };
  }

  /** Best effort: providers that can expire a session (Stripe) stop taking payments on it. */
  private closeAtProviders(sessions: { provider: string; providerReference: string }[]): void {
    for (const session of sessions) {
      const provider: PaymentProvider | undefined = this.providers.find(session.provider);
      if (provider)
        this.background.run('checkout-cancel', () =>
          provider.cancelCheckout(session.providerReference),
        );
    }
  }

  private async reprice(payload: ItemPayload): Promise<ItemPayload> {
    if (payload.kind === 'flight') {
      const supplier = this.flightSuppliers.find((s) => s.name === payload.offer.supplier);
      if (!supplier) throw new OfferUnavailableError(payload.offer.supplier, 'Supplier disabled');
      const offer = await this.runner.call('flights', supplier.name, 'reprice', (signal) =>
        supplier.reprice(payload.offer, signal),
      );
      return { ...payload, offer };
    }
    const supplier = this.hotelSuppliers.find((s) => s.name === payload.hotel.supplier);
    if (!supplier) throw new OfferUnavailableError(payload.hotel.supplier, 'Supplier disabled');
    const rate = await this.runner.call('hotels', supplier.name, 'reprice', (signal) =>
      supplier.reprice(payload.hotel, bookedRate(payload), payload.query, signal),
    );
    return { ...payload, hotel: { ...payload.hotel, rates: [rate] } };
  }

  /** Chosen extras against the re-priced offer; null when one is no longer sold. */
  private mapExtras(selections: ExtraSelection[], fresh: ItemPayload): ExtraSelection[] | null {
    if (selections.length === 0) return [];
    if (fresh.kind !== 'flight') return null;
    const mapped: ExtraSelection[] = [];
    for (const selection of selections) {
      const service = matchService(fresh.offer.services, selection);
      if (!service || selection.quantity > service.maxQuantity) return null;
      mapped.push({ ...selection, serviceId: service.id });
    }
    return mapped;
  }

  private async promoFor(booking: BookingRecord): Promise<PromoInput> {
    if (!booking.promoCodeId) return null;
    const promo = await this.prisma.promoCode.findUnique({ where: { id: booking.promoCodeId } });
    return promo ? this.pricing.findPromo(promo.code, booking.userId) : null;
  }

  change(booking: BookingRecord, pending: PendingPrice) {
    const previous: Money = totalOf(bookingPrice(booking));
    const current: Money = totalOf(pending.price);
    return {
      previous: toWire(previous),
      current: toWire(current),
      difference: toWire(subtract(current, previous)),
      price: pending.price,
    };
  }
}
