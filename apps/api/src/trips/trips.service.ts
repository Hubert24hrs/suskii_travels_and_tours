import { Injectable, NotFoundException } from '@nestjs/common';

import {
  add,
  money,
  subtract,
  toWire,
  TRIP_COMPONENTS,
  TRIP_MAX_OPEN,
  tripComponentOf,
  tripPartState,
  tripState,
  zero,
  type Money,
  type TripComponent,
  type TripPlan,
} from '@suskii/shared';

import { AuditService } from '../audit/audit.service';
import { bookingReference } from '../bookings/booking-codes';
import {
  bookingPrice,
  itemPayload,
  pendingPrice,
  toBookingSummary,
} from '../bookings/booking-presenter';
import { totalOf } from '../bookings/booking-pricing';
import type { BookingActor } from '../bookings/booking-transitions';
import { BookingsService, customerActor, type BookingCaller } from '../bookings/bookings.service';
import { CheckoutService } from '../bookings/checkout.service';
import { fromJsonValue, toJsonValue } from '../common/json';
import type { RequestContext } from '../common/request-context';
import { Prisma, type BookingStatus } from '../generated/prisma/client';
import { PrismaService } from '../infra/prisma.service';
import { PaymentProviders } from '../payments/payment-providers';

import {
  tooManyTrips,
  TRIP_PART_ISSUES,
  tripHasPayments,
  tripPartInvalid,
  tripPartPaid,
} from './trip-errors';
import { tripPreparedPartSchema, type TripDto, type TripPreparedPart } from './trips.schemas';

type Tx = Prisma.TransactionClient;

/** A trip with what its page shows: the bookings in it and a checkout still open. */
export const TRIP_INCLUDE = {
  bookings: {
    include: { items: { orderBy: { createdAt: 'asc' } }, paymentPlan: true },
  },
  payments: {
    where: { status: 'pending' },
    orderBy: { createdAt: 'desc' },
    take: 1,
  },
} satisfies Prisma.TripInclude;
export type TripRecord = Prisma.TripGetPayload<{ include: typeof TRIP_INCLUDE }>;
type TripBooking = TripRecord['bookings'][number];

/** Bookings one trip payment can still pay: priced, or with a checkout the traveller left. */
export const TRIP_PAYABLE: readonly BookingStatus[] = ['PRICED', 'AWAITING_PAYMENT'];
/** A trip counts as paid for once a booking in it has been. */
const SETTLED: readonly BookingStatus[] = ['PAID', 'TICKETING', 'CONFIRMED'];
/** Bookings that may leave a trip being deleted: nothing was ever paid on them through it. */
const DETACHABLE: readonly BookingStatus[] = ['DRAFT', 'PRICED', 'EXPIRED', 'CANCELLED'];

/** The prepared parts stored on a trip (ADR-117), each read again: a malformed one is dropped. */
export function storedPrepared(value: unknown): TripPreparedPart[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry: unknown) => {
    const parsed = tripPreparedPartSchema.safeParse(entry);
    return parsed.success ? [parsed.data] : [];
  });
}

/** The same trip: the same airports and the same days. */
const samePlan = (a: TripPlan, b: TripPlan): boolean =>
  a.origin.code === b.origin.code &&
  a.destination.code === b.destination.code &&
  a.departDate === b.departDate &&
  a.returnDate === b.returnDate;

/** Which part of a trip a booking is, read from what it sells. */
export function componentOfBooking(booking: {
  items: { payload: unknown }[];
}): TripComponent | null {
  const item = booking.items[0];
  if (!item) return null;
  const payload = itemPayload(item);
  return tripComponentOf({
    kind: payload.kind,
    addonType: payload.kind === 'addon' ? payload.type : null,
  });
}

/**
 * Combined trips (ADR-099). A trip groups bookings the traveller made in the ordinary way (a
 * flight, a hotel, a rental car, an airport transfer, travel insurance, or any of them) so they
 * are reviewed together and paid with one checkout (`TripCheckoutService`). Each booking keeps
 * its own lifecycle: its price re-check, its ticketing, its cancellation and its refund. A trip
 * belongs to an account; everyone else gets 404.
 */
@Injectable()
export class TripsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bookings: BookingsService,
    private readonly providers: PaymentProviders,
    private readonly audit: AuditService,
    private readonly checkout: CheckoutService,
  ) {}

  /**
   * Closes the checkout a trip has open: its parts are about to change, or a new checkout is
   * replacing it, and the traveller must only ever pay what the trip shows. The bookings go back
   * to unpaid (each share is cancelled as an abandoned checkout is). Returns the provider
   * sessions to close once the transaction has committed. A payment that still arrives on the
   * closed checkout is handled by the webhook: each share is taken or refunded.
   */
  async closeOpenCheckout(
    tx: Tx,
    tripId: string,
    actor: BookingActor,
    reason: string,
  ): Promise<{ provider: string; providerReference: string }[]> {
    const open = await tx.tripPayment.findMany({
      where: { tripId, status: 'pending' },
      select: { id: true, provider: true, providerReference: true },
    });
    if (open.length === 0) return [];
    const ids = open.map((payment) => payment.id);
    const shares = await tx.payment.findMany({
      where: { tripPaymentId: { in: ids }, status: 'pending' },
      select: { booking: { select: { id: true, status: true } } },
      orderBy: { bookingId: 'asc' },
    });
    for (const share of shares) {
      await this.checkout.abandonOpenPayments(tx, share.booking, actor, reason);
    }
    await tx.tripPayment.updateMany({
      where: { id: { in: ids }, status: 'pending' },
      data: { status: 'cancelled' },
    });
    return open.map(({ provider, providerReference }) => ({ provider, providerReference }));
  }

  async create(
    userId: string,
    input: { plan: TripPlan; currency: string },
    context: RequestContext,
  ): Promise<TripDto> {
    // Trips nobody paid anything on: a cap against filling the table from one account.
    const open = await this.prisma.trip.count({
      where: { userId, bookings: { none: { status: { in: [...SETTLED] } } } },
    });
    if (open >= TRIP_MAX_OPEN) throw tooManyTrips();
    const trip = await this.prisma.$transaction(async (tx) => {
      const created = await tx.trip.create({
        data: {
          reference: `T-${bookingReference()}`,
          userId,
          plan: toJsonValue(input.plan) as Prisma.InputJsonValue,
          currency: input.currency,
        },
        include: TRIP_INCLUDE,
      });
      await this.audit.record(
        {
          action: 'trip.created',
          actorUserId: userId,
          targetType: 'trip',
          targetId: created.id,
          context,
          metadata: { components: [...input.plan.components], currency: input.currency },
        },
        tx,
      );
      return created;
    });
    return this.present(trip);
  }

  /**
   * Puts the parts Ask Suskii prepared on a trip (ADR-117), for the traveller to book from the
   * trip page and pay once: on `tripId` (the trip the conversation already built) while it is
   * still the same trip and nothing on it is paid or being paid, otherwise on a new trip from
   * `plan`. A prepared part of the same kind gives way to the newer one, a part in `drop` (one
   * the traveller turned down) leaves, and the plan comes to want every prepared part. Null
   * when there is neither. Prepared parts are quotes: nothing is held, booked or paid here, and
   * each still goes through its own checkout.
   */
  async prepare(
    userId: string,
    input: {
      tripId: string | null;
      plan: TripPlan | null;
      currency: string;
      prepared: readonly TripPreparedPart[];
      drop?: readonly TripComponent[];
    },
    context: RequestContext,
  ): Promise<TripDto | null> {
    const components = TRIP_COMPONENTS.filter((component) =>
      input.prepared.some((part) => part.component === component),
    );
    if (components.length === 0) return null;
    const existing = input.tripId ? await this.reusable(input.tripId, userId, input) : null;
    if (existing) {
      await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM trips WHERE id = ${existing.id}::uuid FOR UPDATE`;
        const row = await tx.trip.findUniqueOrThrow({
          where: { id: existing.id },
          select: { plan: true, prepared: true },
        });
        const plan = fromJsonValue<TripPlan>(row.plan);
        const kept = storedPrepared(row.prepared).filter(
          (part) => !components.includes(part.component) && !input.drop?.includes(part.component),
        );
        await tx.trip.update({
          where: { id: existing.id },
          data: {
            plan: toJsonValue({
              ...plan,
              components: TRIP_COMPONENTS.filter(
                (component) =>
                  plan.components.includes(component) || components.includes(component),
              ),
            }) as Prisma.InputJsonValue,
            prepared: toJsonValue([...kept, ...input.prepared]) as Prisma.InputJsonValue,
          },
        });
        await this.audit.record(
          {
            action: 'trip.parts_prepared',
            actorUserId: userId,
            targetType: 'trip',
            targetId: existing.id,
            context,
            metadata: { components },
          },
          tx,
        );
      });
      return this.get(existing.id, userId);
    }
    if (!input.plan) return null;
    const open = await this.prisma.trip.count({
      where: { userId, bookings: { none: { status: { in: [...SETTLED] } } } },
    });
    if (open >= TRIP_MAX_OPEN) throw tooManyTrips();
    const plan: TripPlan = { ...input.plan, components };
    const trip = await this.prisma.$transaction(async (tx) => {
      const created = await tx.trip.create({
        data: {
          reference: `T-${bookingReference()}`,
          userId,
          plan: toJsonValue(plan) as Prisma.InputJsonValue,
          currency: input.currency,
          prepared: toJsonValue(input.prepared) as Prisma.InputJsonValue,
        },
        include: TRIP_INCLUDE,
      });
      await this.audit.record(
        {
          action: 'trip.created',
          actorUserId: userId,
          targetType: 'trip',
          targetId: created.id,
          context,
          metadata: { components, currency: input.currency, prepared: true },
        },
        tx,
      );
      return created;
    });
    return this.present(trip);
  }

  /** The conversation's trip, while the prepared parts still belong on it. */
  private async reusable(
    tripId: string,
    userId: string,
    input: { plan: TripPlan | null; currency: string },
  ): Promise<TripRecord | null> {
    const trip = await this.prisma.trip.findUnique({
      where: { id: tripId },
      include: TRIP_INCLUDE,
    });
    if (trip?.userId !== userId || trip.currency !== input.currency) return null;
    // Paid, or with a checkout open: that trip is under way; the new parts start another.
    if (
      trip.payments.length > 0 ||
      trip.bookings.some((booking) => SETTLED.includes(booking.status))
    )
      return null;
    return !input.plan || samePlan(fromJsonValue<TripPlan>(trip.plan), input.plan) ? trip : null;
  }

  /** The caller's own trip, or 404. */
  async load(tripId: string, userId: string): Promise<TripRecord> {
    const trip = await this.prisma.trip.findUnique({
      where: { id: tripId },
      include: TRIP_INCLUDE,
    });
    if (trip?.userId !== userId) throw new NotFoundException();
    return trip;
  }

  async get(tripId: string, userId: string): Promise<TripDto> {
    return this.present(await this.load(tripId, userId));
  }

  async list(userId: string): Promise<{ trips: TripDto[] }> {
    const trips = await this.prisma.trip.findMany({
      where: { userId },
      include: TRIP_INCLUDE,
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    return { trips: trips.map((trip) => this.present(trip)) };
  }

  /**
   * Puts one of the caller's unpaid bookings in the trip as the part it sells. A part the trip
   * already has gives way when it is still unpaid (the earlier booking leaves the trip and stays
   * an ordinary booking); a paid one stays.
   */
  async addPart(
    tripId: string,
    bookingId: string,
    caller: BookingCaller,
    userId: string,
  ): Promise<TripDto> {
    const trip = await this.load(tripId, userId);
    const booking = await this.bookings.load(bookingId, caller);
    // By session only: a guest booking opened with its token is not the account's to group.
    if (booking.userId !== userId) throw new NotFoundException();
    const component = componentOfBooking(booking);
    if (!component) throw tripPartInvalid(TRIP_PART_ISSUES.unsupported);
    const plan = fromJsonValue<TripPlan>(trip.plan);
    if (!plan.components.includes(component)) throw tripPartInvalid(TRIP_PART_ISSUES.notWanted);
    if (booking.currency !== trip.currency) throw tripPartInvalid(TRIP_PART_ISSUES.currency);
    if (booking.companyId) throw tripPartInvalid(TRIP_PART_ISSUES.company);
    if (booking.paymentPlan) throw tripPartInvalid(TRIP_PART_ISSUES.paymentPlan);
    if (!TRIP_PAYABLE.includes(booking.status)) throw tripPartInvalid(TRIP_PART_ISSUES.notPayable);
    if (booking.tripId && booking.tripId !== trip.id) {
      throw tripPartInvalid(TRIP_PART_ISSUES.otherTrip);
    }

    const closed = await this.prisma.$transaction(async (tx) => {
      // One change to a trip's parts at a time.
      await tx.$queryRaw`SELECT id FROM trips WHERE id = ${trip.id}::uuid FOR UPDATE`;
      // A checkout opened for the old set of parts would charge the old total.
      const sessions = await this.closeOpenCheckout(
        tx,
        trip.id,
        customerActor(caller),
        'trip_changed',
      );
      const current = await tx.booking.findFirst({
        where: { tripId: trip.id, tripComponent: component, id: { not: booking.id } },
        select: { id: true, status: true },
      });
      if (current) {
        const state = tripPartState(current.status);
        if (state === 'paid' || state === 'confirmed') throw tripPartPaid();
        await this.detach(tx, trip.id, current.id, userId, caller.context, 'replaced');
      }
      await tx.booking.update({
        where: { id: booking.id },
        data: { tripId: trip.id, tripComponent: component },
      });
      // The part Ask Suskii prepared for it is now this booking (ADR-117).
      const row = await tx.trip.findUniqueOrThrow({
        where: { id: trip.id },
        select: { prepared: true },
      });
      const prepared = storedPrepared(row.prepared);
      if (prepared.some((part) => part.component === component)) {
        await tx.trip.update({
          where: { id: trip.id },
          data: {
            prepared: toJsonValue(
              prepared.filter((part) => part.component !== component),
            ) as Prisma.InputJsonValue,
          },
        });
      }
      await this.audit.record(
        {
          action: 'trip.part_added',
          actorUserId: userId,
          targetType: 'trip',
          targetId: trip.id,
          context: caller.context,
          metadata: { bookingId: booking.id, component },
        },
        tx,
      );
      return sessions;
    });
    this.checkout.closeAtProviders(closed);
    return this.get(trip.id, userId);
  }

  /**
   * Takes an unpaid booking out of the trip. The booking itself is not cancelled. A checkout the
   * trip has open is closed with it: its total counted this part.
   */
  async removePart(
    tripId: string,
    bookingId: string,
    caller: BookingCaller,
    userId: string,
  ): Promise<TripDto> {
    const trip = await this.load(tripId, userId);
    const part = trip.bookings.find((booking) => booking.id === bookingId);
    if (!part) throw new NotFoundException();
    const state = tripPartState(part.status);
    if (state === 'paid' || state === 'confirmed') throw tripPartPaid();
    const closed = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM trips WHERE id = ${trip.id}::uuid FOR UPDATE`;
      const sessions = await this.closeOpenCheckout(
        tx,
        trip.id,
        customerActor(caller),
        'trip_changed',
      );
      await this.detach(tx, trip.id, bookingId, userId, caller.context, 'removed');
      return sessions;
    });
    this.checkout.closeAtProviders(closed);
    return this.get(trip.id, userId);
  }

  /**
   * Deletes a trip nobody started paying. Its bookings are not cancelled: they leave the trip
   * and stay ordinary unpaid bookings. A trip with a payment, even a failed one, is a financial
   * record and stays (409 `trip-has-payments`).
   */
  async remove(tripId: string, userId: string, context: RequestContext): Promise<void> {
    const trip = await this.load(tripId, userId);
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM trips WHERE id = ${trip.id}::uuid FOR UPDATE`;
      const [payments, settled] = await Promise.all([
        tx.tripPayment.count({ where: { tripId: trip.id } }),
        tx.booking.count({
          where: { tripId: trip.id, status: { notIn: [...DETACHABLE] } },
        }),
      ]);
      if (payments > 0 || settled > 0) throw tripHasPayments();
      const detached = await tx.booking.updateMany({
        where: { tripId: trip.id },
        data: { tripId: null, tripComponent: null },
      });
      await tx.trip.delete({ where: { id: trip.id } });
      await this.audit.record(
        {
          action: 'trip.deleted',
          actorUserId: userId,
          targetType: 'trip',
          targetId: trip.id,
          context,
          metadata: { parts: detached.count },
        },
        tx,
      );
    });
  }

  private async detach(
    tx: Tx,
    tripId: string,
    bookingId: string,
    userId: string,
    context: RequestContext,
    reason: 'removed' | 'replaced',
  ): Promise<void> {
    await tx.booking.updateMany({
      where: { id: bookingId, tripId },
      data: { tripId: null, tripComponent: null },
    });
    await this.audit.record(
      {
        action: 'trip.part_removed',
        actorUserId: userId,
        targetType: 'trip',
        targetId: tripId,
        context,
        metadata: { bookingId, reason },
      },
      tx,
    );
  }

  /** What one payment would charge for a part now: its total while it is unpaid, else nothing. */
  static due(booking: Pick<TripBooking, 'status' | 'totalMinor' | 'currency'>): Money {
    return TRIP_PAYABLE.includes(booking.status)
      ? money(booking.totalMinor, booking.currency)
      : zero(booking.currency);
  }

  present(trip: TripRecord): TripDto {
    const plan = fromJsonValue<TripPlan>(trip.plan);
    const order = (component: string | null): number =>
      TRIP_COMPONENTS.indexOf(component as TripComponent);
    const parts = [...trip.bookings]
      .sort((a, b) => order(a.tripComponent) - order(b.tripComponent))
      .flatMap((booking) => {
        const summary = toBookingSummary(booking);
        const component = TRIP_COMPONENTS.find((item) => item === booking.tripComponent);
        if (!summary || !component) return [];
        const price = bookingPrice(booking);
        const pending = pendingPrice(booking);
        return [
          {
            component,
            state: tripPartState(booking.status),
            status: booking.status,
            booking: summary,
            due: toWire(TripsService.due(booking)),
            priceChange: pending
              ? {
                  previous: price.total,
                  current: pending.price.total,
                  difference: toWire(subtract(totalOf(pending.price), totalOf(price))),
                  price: pending.price,
                }
              : null,
          },
        ];
      });
    const live = parts.filter((part) => part.state !== 'closed');
    const sum = (amounts: Money[]): Money => amounts.reduce(add, zero(trip.currency));
    const open = trip.payments[0];
    // Each part in the trip's currency (checked when it joined), so the sums are exact.
    const total = sum(
      live.map((part) => money(BigInt(part.booking.total.amountMinor), trip.currency)),
    );
    const now = Date.now();
    const prepared = storedPrepared(trip.prepared).filter(
      (part) =>
        plan.components.includes(part.component) &&
        !live.some((entry) => entry.component === part.component) &&
        part.price.currency === trip.currency &&
        Date.parse(part.expiresAt) > now,
    );
    return {
      id: trip.id,
      reference: trip.reference,
      createdAt: trip.createdAt.toISOString(),
      plan,
      currency: trip.currency,
      state: tripState(parts.map((part) => part.state)),
      parts,
      missing: plan.components.filter(
        (component) => !live.some((part) => part.component === component),
      ),
      total: toWire(total),
      due: toWire(sum(live.map((part) => money(BigInt(part.due.amountMinor), trip.currency)))),
      prepared,
      totalWithPrepared: toWire(
        add(
          total,
          sum(prepared.map((part) => money(BigInt(part.price.amountMinor), trip.currency))),
        ),
      ),
      payment: {
        ...this.providers.options(trip.currency),
        open:
          open && open.expiresAt > new Date()
            ? {
                id: open.id,
                checkoutUrl: open.checkoutUrl,
                amount: toWire(money(open.amountMinor, open.currency)),
                expiresAt: open.expiresAt.toISOString(),
              }
            : null,
      },
    };
  }
}
