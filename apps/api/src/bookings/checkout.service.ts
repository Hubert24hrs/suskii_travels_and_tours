import { Inject, Injectable, Logger } from '@nestjs/common';
import type { z } from 'zod';

import { equals, money, subtract, toWire, type Money } from '@suskii/shared';

import { AuditService } from '../audit/audit.service';
import { toJsonValue } from '../common/json';
import { uuidv7 } from '../common/uuid';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { Prisma, type BookingStatus } from '../generated/prisma/client';
import { PrismaService } from '../infra/prisma.service';
import { PaymentProvider } from '../payments/payment-provider';
import { FxService } from '../pricing/fx.service';
import { PricingService } from '../pricing/pricing.service';
import type { ClientContext } from '../search/client-context';
import { offerUnavailable, supplierUnavailable } from '../search/search.errors';
import { SupplierRunner } from '../search/supplier-runner';
import { OfferUnavailableError } from '../suppliers/supplier.errors';
import type { FlightSupplier, HotelSupplier } from '../suppliers/supplier.types';
import { FLIGHT_SUPPLIERS, HOTEL_SUPPLIERS } from '../suppliers/suppliers.module';

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
import { bookingConflict, bookingExpired, priceChanged } from './booking.errors';
import type { paymentSessionSchema } from './bookings.schemas';
import { BookingsService, customerActor, type BookingCaller } from './bookings.service';

const PAYABLE: readonly BookingStatus[] = ['PRICED', 'HELD', 'AWAITING_PAYMENT'];
const UNPAID: readonly BookingStatus[] = ['DRAFT', 'PRICED', 'HELD', 'AWAITING_PAYMENT'];
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

/**
 * Payment start (ADR-014 steps 3-4): re-prices with the supplier immediately before payment,
 * answers 409 with the difference when the total moved, and otherwise opens a hosted checkout
 * session. Also expires unpaid bookings past their deadline.
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
    private readonly provider: PaymentProvider,
    private readonly transitions: BookingTransitions,
    private readonly audit: AuditService,
  ) {}

  async startPayment(
    bookingId: string,
    caller: BookingCaller,
  ): Promise<z.infer<typeof paymentSessionSchema>> {
    const booking = await this.bookings.load(bookingId, caller);
    const item = booking.items[0];
    if (!item) throw bookingConflict();
    const payload = itemPayload(item);
    const pending = pendingPrice(booking);
    if (pending) throw priceChanged(this.change(booking, pending));
    if (!PAYABLE.includes(booking.status)) {
      throw bookingConflict('This booking is not waiting for payment.');
    }
    const now = new Date();
    if (booking.paymentDeadline && booking.paymentDeadline <= now) {
      await this.expire(booking, 'payment_deadline');
      throw bookingExpired(payload.request);
    }

    const actor = customerActor(caller);
    let fresh: ItemPayload;
    try {
      fresh = await this.reprice(payload);
    } catch (error) {
      if (error instanceof OfferUnavailableError) {
        await this.failUnavailable(booking, actor);
        throw offerUnavailable(payload.request);
      }
      this.logger.warn(
        { bookingId, reason: (error as Error).name },
        're-price before payment failed',
      );
      throw supplierUnavailable();
    }
    const services = this.mapExtras(itemServices(item), fresh);
    if (!services) {
      await this.failUnavailable(booking, actor);
      throw offerUnavailable(payload.request);
    }

    const [pricer, fx, promo] = await Promise.all([
      this.pricing.pricer(booking.vertical, booking.currency),
      this.fx.converter(),
      this.promoFor(booking),
    ]);
    const priced = priceBookingItem(
      pricer,
      fx,
      fresh,
      bookingClient(booking),
      services,
      promo,
      now,
    );
    const agreed = money(booking.totalMinor, booking.currency);

    if (!equals(priced.total, agreed)) {
      const next: PendingPrice = {
        price: priced.price,
        items: [{ id: item.id, supplierOfferId: supplierOfferId(fresh), payload: fresh, services }],
      };
      await this.prisma.$transaction(async (tx) => {
        const status = await this.abandonOpenPayments(tx, booking, actor, 'price_changed');
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
            context: caller.context,
            metadata: {
              previousMinor: agreed.minor.toString(),
              currentMinor: priced.total.minor.toString(),
              currency: agreed.currency,
            },
          },
          tx,
        );
      });
      throw priceChanged(this.change(booking, next));
    }

    const contact = this.bookings.contact(booking);
    const paymentId = uuidv7();
    const expiresAt = earliest(
      new Date(now.getTime() + this.config.PAYMENT_SESSION_TTL_MINUTES * 60_000),
      offerExpiry(fresh),
    );
    const session = await this.provider.createCheckout({
      paymentId,
      reference: booking.reference,
      amount: priced.total,
      customerEmail: contact.email,
      returnUrl: bookingUrl(this.config, booking.id),
      expiresAt,
    });

    await this.prisma.$transaction(async (tx) => {
      const status = await this.abandonOpenPayments(tx, booking, actor, 'new_payment');
      await tx.bookingItem.update({
        where: { id: item.id },
        data: {
          supplierOfferId: supplierOfferId(fresh),
          payload: toJsonValue(fresh) as Prisma.InputJsonValue,
          services: services as unknown as Prisma.InputJsonValue,
        },
      });
      await tx.payment.create({
        data: {
          id: paymentId,
          bookingId: booking.id,
          provider: this.provider.name,
          providerReference: session.providerReference,
          status: 'pending',
          amountMinor: priced.total.minor,
          currency: priced.total.currency,
          checkoutUrl: session.checkoutUrl,
          expiresAt,
        },
      });
      await this.transitions.apply(tx, { id: booking.id, status }, 'request_payment', actor, {
        data: { paymentDeadline: expiresAt },
      });
      await this.audit.record(
        {
          action: 'payment.created',
          actorUserId: actor.userId ?? null,
          targetType: 'payment',
          targetId: paymentId,
          context: caller.context,
          metadata: { bookingId: booking.id, provider: this.provider.name },
        },
        tx,
      );
    });

    return {
      paymentId,
      checkoutUrl: session.checkoutUrl,
      amount: toWire(priced.total),
      expiresAt: expiresAt.toISOString(),
    };
  }

  /** Expires unpaid bookings whose payment deadline has passed. */
  async expireDue(now = new Date()): Promise<number> {
    const due = await this.prisma.booking.findMany({
      where: {
        OR: [
          { status: { in: ['DRAFT', 'PRICED', 'HELD'] }, paymentDeadline: { lt: now } },
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
    if (!UNPAID.includes(booking.status)) return;
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
    await this.prisma.$transaction(async (tx) => {
      const status = await this.abandonOpenPayments(tx, booking, actor, 'offer_unavailable');
      await this.transitions.apply(tx, { id: booking.id, status }, 'fail', SYSTEM_ACTOR, {
        reason: 'offer_unavailable',
      });
    });
  }

  /**
   * Closes pending checkout sessions; a booking waiting for one goes back to PRICED. A late success
   * for a closed session is still honoured by the webhook when its amount matches (ADR-014).
   */
  private async abandonOpenPayments(
    tx: Tx,
    booking: { id: string; status: BookingStatus },
    actor: BookingActor,
    reason: string,
  ): Promise<BookingStatus> {
    await tx.payment.updateMany({
      where: { bookingId: booking.id, status: 'pending' },
      data: { status: 'cancelled' },
    });
    if (booking.status !== 'AWAITING_PAYMENT') return booking.status;
    return this.transitions.apply(tx, booking, 'payment_abandoned', actor, { reason });
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

  private change(booking: BookingRecord, pending: PendingPrice) {
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

export const bookingUrl = (config: AppConfig, bookingId: string): string =>
  `${config.WEB_APP_URL.replace(/\/$/, '')}/bookings/${bookingId}`;
