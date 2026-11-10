import { Inject, Injectable, Logger } from '@nestjs/common';
import type { z } from 'zod';

import { add, subtract, toWire, zero, type Money } from '@suskii/shared';

import { AuditService } from '../audit/audit.service';
import {
  approvalRequired,
  paymentMethodUnavailable,
  paymentProviderDown,
  priceChanged,
  providerUnavailable,
} from '../bookings/booking.errors';
import { bookingPrice, pendingPrice } from '../bookings/booking-presenter';
import { totalOf } from '../bookings/booking-pricing';
import { BookingTransitions } from '../bookings/booking-transitions';
import { tripPaymentReturnUrl } from '../bookings/booking-urls';
import { BookingsService, customerActor, type BookingCaller } from '../bookings/bookings.service';
import {
  CheckoutService,
  earliest,
  offerExpiry,
  type ConfirmedPrice,
} from '../bookings/checkout.service';
import { uuidv7 } from '../common/uuid';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { HmacService } from '../crypto/hmac.service';
import { PrismaService } from '../infra/prisma.service';
import { PaymentProviderUnavailableError } from '../payments/payment-provider';
import { PaymentProviders } from '../payments/payment-providers';

import { tripNothingToPay } from './trip-errors';
import type { StartTripPaymentRequest, tripPaymentSessionSchema } from './trips.schemas';
import { TRIP_PAYABLE, TripsService } from './trips.service';

type TripPaymentSession = z.infer<typeof tripPaymentSessionSchema>;

/** The reference of a booking's share of a trip checkout: the provider never sees it. */
export const tripShareReference = (tripPaymentId: string, index: number): string =>
  `trip_${tripPaymentId}_${index + 1}`;

/**
 * One payment for a whole trip (ADR-099). Every unpaid booking in the trip is re-priced with its
 * supplier first, exactly as its own payment would be: a changed total stops here with 409
 * `price-changed` (the booking keeps the new price for the traveller's consent) and a part that
 * sold out fails on its own. Only when every part holds is one hosted checkout opened for the
 * sum, and each booking gets its share as a pending payment pointing at the trip payment.
 *
 * Nothing is paid here: the provider's webhook settles each share (`PaymentEventsService`).
 */
@Injectable()
export class TripCheckoutService {
  private readonly logger = new Logger(TripCheckoutService.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly trips: TripsService,
    private readonly bookings: BookingsService,
    private readonly checkout: CheckoutService,
    private readonly providers: PaymentProviders,
    private readonly transitions: BookingTransitions,
    private readonly audit: AuditService,
    private readonly hmac: HmacService,
  ) {}

  async startPayment(
    tripId: string,
    caller: BookingCaller,
    userId: string,
    request: StartTripPaymentRequest,
  ): Promise<TripPaymentSession> {
    const trip = await this.trips.load(tripId, userId);
    const actor = customerActor(caller);
    const now = new Date();

    // The parts one payment can pay, each loaded as its owner would load it.
    const parts = [];
    for (const row of trip.bookings) {
      if (!TRIP_PAYABLE.includes(row.status)) continue;
      const booking = await this.bookings.load(row.id, caller);
      const item = booking.items[0];
      if (!item || booking.paymentPlan) continue;
      if (booking.paymentDeadline && booking.paymentDeadline <= now) {
        // Its price hold ran out: it leaves the total, like any unpaid booking would.
        await this.checkout.expire(booking, 'payment_deadline');
        continue;
      }
      const pending = pendingPrice(booking);
      if (pending) {
        const price = bookingPrice(booking);
        throw priceChanged({
          previous: price.total,
          current: pending.price.total,
          difference: toWire(subtract(totalOf(pending.price), totalOf(price))),
          price: pending.price,
        });
      }
      if (booking.approvalStatus === 'pending') throw approvalRequired();
      parts.push({ booking, item });
    }
    if (parts.length === 0) throw tripNothingToPay();

    // Each part's price, confirmed with its supplier now. A change or a sold-out part throws
    // from here with that booking's own answer (409 `price-changed`, 410), before any checkout.
    const confirmed: { part: (typeof parts)[number]; fresh: ConfirmedPrice }[] = [];
    for (const part of parts) {
      confirmed.push({ part, fresh: await this.checkout.confirmPrice(part.booking, actor) });
    }
    const total = confirmed.map(({ fresh }) => fresh.total).reduce<Money>(add, zero(trip.currency));
    const expiresAt = earliest(
      new Date(now.getTime() + this.config.PAYMENT_SESSION_TTL_MINUTES * 60_000),
      ...confirmed.map(({ fresh }) => offerExpiry(fresh.payload, now)),
    );

    const provider = this.providers.choose(trip.currency, request.provider, request.method);
    if (!provider) throw request.method ? paymentMethodUnavailable() : providerUnavailable();
    const first = confirmed[0];
    if (!first) throw tripNothingToPay();
    const tripPaymentId = uuidv7();
    let session: { providerReference: string; checkoutUrl: string };
    try {
      session = await provider.createCheckout({
        paymentId: tripPaymentId,
        reference: trip.reference,
        amount: total,
        // The contact of the trip's first part: the same traveller made every booking in it.
        customerEmail: this.bookings.contact(first.part.booking).email,
        returnUrl: tripPaymentReturnUrl(this.config, trip.id, caller.client.channel),
        expiresAt,
        method: request.method,
      });
    } catch (error) {
      this.logger.warn(
        { tripId, provider: provider.name, reason: (error as Error).name },
        'trip checkout creation failed',
      );
      if (error instanceof PaymentProviderUnavailableError) throw paymentProviderDown();
      throw error;
    }

    const abandoned = await this.prisma.$transaction(async (tx) => {
      // An earlier checkout for this trip is closed with every share it had: only one is open at
      // a time, and it charges what the trip shows now.
      const closed = await this.trips.closeOpenCheckout(tx, trip.id, actor, 'trip_payment');
      await tx.tripPayment.create({
        data: {
          id: tripPaymentId,
          tripId: trip.id,
          provider: provider.name,
          providerReference: session.providerReference,
          status: 'pending',
          amountMinor: total.minor,
          currency: total.currency,
          checkoutUrl: session.checkoutUrl,
          channel: caller.client.channel ?? 'web',
          expiresAt,
        },
      });
      for (const [index, { part, fresh }] of confirmed.entries()) {
        const { status, closed: sessions } = await this.checkout.abandonOpenPayments(
          tx,
          part.booking,
          actor,
          'trip_payment',
        );
        closed.push(...sessions);
        await this.checkout.storeFresh(tx, part.item.id, fresh);
        await tx.payment.create({
          data: {
            id: uuidv7(),
            bookingId: part.booking.id,
            tripPaymentId,
            provider: provider.name,
            providerReference: tripShareReference(tripPaymentId, index),
            status: 'pending',
            amountMinor: fresh.total.minor,
            currency: fresh.total.currency,
            // The one checkout: opening it from the booking pays the whole trip.
            checkoutUrl: session.checkoutUrl,
            expiresAt,
            // Risk signals (ADR-040): who paid from where, pseudonymised.
            ipHash: this.hmac.digest('ip', caller.context.ip),
            ipCountry: caller.context.country ?? null,
          },
        });
        await this.transitions.apply(
          tx,
          { id: part.booking.id, status },
          'request_payment',
          actor,
          { data: { paymentDeadline: expiresAt } },
        );
      }
      await this.audit.record(
        {
          action: 'trip.payment_created',
          actorUserId: userId,
          targetType: 'trip',
          targetId: trip.id,
          context: caller.context,
          metadata: {
            tripPaymentId,
            provider: provider.name,
            ...(request.method ? { method: request.method } : {}),
            bookingIds: confirmed.map(({ part }) => part.booking.id),
          },
        },
        tx,
      );
      return closed;
    });
    this.checkout.closeAtProviders(abandoned);

    return {
      paymentId: tripPaymentId,
      status: 'pending',
      checkoutUrl: session.checkoutUrl,
      amount: toWire(total),
      parts: confirmed.length,
      expiresAt: expiresAt.toISOString(),
    };
  }
}
