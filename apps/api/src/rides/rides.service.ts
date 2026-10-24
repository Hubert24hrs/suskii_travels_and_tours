import { Injectable, NotFoundException } from '@nestjs/common';
import type { z } from 'zod';

import { money, rideCancellationFee, toWire, type RatingInput } from '@suskii/shared';

import { AuditService } from '../audit/audit.service';
import { bookingPrice } from '../bookings/booking-presenter';
import { atBookedRate } from '../bookings/booking-pricing';
import type { RideItemPayload } from '../bookings/inhouse-items';
import { RefundsService } from '../bookings/refunds.service';
import { fromJsonValue } from '../common/json';
import type { RequestContext } from '../common/request-context';
import { ridePinContext } from '../crypto/encryption-contexts';
import { FieldEncryption } from '../crypto/field-encryption';
import { HmacService } from '../crypto/hmac.service';
import { randomToken } from '../crypto/random';
import { PrismaService } from '../infra/prisma.service';

import { ratingClosed, rideConflict } from './ride-errors';
import { RideEventsPublisher } from './ride-events.publisher';
import { RideSettlementService } from './ride-settlement.service';
import { RideTransitions } from './ride-transitions';
import { RIDE_INCLUDE, toRideDto, toSharedRide, type RideRecord } from './ride-views';
import type { cancelRideSchema, RideDto, rideListSchema, sharedRideSchema } from './rides.schemas';

/** Share links outlive the trip by this long (ADR-050). */
const SHARE_GRACE_MS = 30 * 60_000;
/** A share link created before the trip has an end; it lasts this long past the ETA. */
const SHARE_MAX_MS = 6 * 3_600_000;

export interface Rider {
  userId: string;
  context: RequestContext;
}

export const rideItemPayload = (ride: { bookingItem: { payload: unknown } }): RideItemPayload =>
  fromJsonValue<RideItemPayload>(ride.bookingItem.payload);

/**
 * A rider's rides (ADR-049 to ADR-051): the live view (driver, rounded position, ETA, PIN),
 * cancellation under the fare rule's free window, ratings, and live-share links. Anyone but the
 * rider gets 404.
 */
@Injectable()
export class RidesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: FieldEncryption,
    private readonly hmac: HmacService,
    private readonly transitions: RideTransitions,
    private readonly settlement: RideSettlementService,
    private readonly refunds: RefundsService,
    private readonly publisher: RideEventsPublisher,
    private readonly audit: AuditService,
  ) {}

  async get(rideId: string, userId: string): Promise<RideDto> {
    return this.present(await this.owned(rideId, userId));
  }

  async list(
    userId: string,
    query: { cursor?: string; limit: number },
  ): Promise<z.infer<typeof rideListSchema>> {
    const rows = await this.prisma.ride.findMany({
      where: { riderUserId: userId, ...(query.cursor ? { id: { lt: query.cursor } } : {}) },
      include: RIDE_INCLUDE,
      orderBy: { id: 'desc' },
      take: query.limit + 1,
    });
    const page = rows.slice(0, query.limit);
    return {
      rides: page.map((ride) => this.present(ride)),
      nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
    };
  }

  /**
   * The rider cancels (ADR-051): free before a driver accepts and within the fare rule's free
   * window after; then the fee is kept, shared with the driver who came, and the rest refunded.
   */
  async cancel(rideId: string, rider: Rider): Promise<z.infer<typeof cancelRideSchema>> {
    const owned = await this.owned(rideId, rider.userId);
    const payload = rideItemPayload(owned);
    const outcome = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM bookings WHERE id = ${owned.bookingId}::uuid FOR UPDATE`;
      const ride = await tx.ride.findUniqueOrThrow({ where: { id: rideId } });
      const booking = await tx.booking.findUniqueOrThrow({ where: { id: ride.bookingId } });
      if (booking.status !== 'CONFIRMED') throw rideConflict();
      const now = new Date();
      const paid = await this.settlement.previewCancellation(
        tx,
        booking,
        money(0, booking.currency),
      );
      const price = bookingPrice(booking);
      const fee = rideCancellationFee(
        payload.rule,
        ride.status,
        ride.assignedAt,
        paid.refund,
        now,
        (amount) => atBookedRate(amount, price),
      );
      await this.transitions.apply(
        tx,
        ride,
        'rider_cancel',
        { kind: 'rider', userId: rider.userId },
        {
          data: { cancelledAt: now, cancelledBy: 'rider', cancellationFeeMinor: fee.minor },
          metadata: { feeMinor: fee.minor.toString() },
        },
      );
      await tx.rideOffer.updateMany({
        where: { rideId, status: 'open' },
        data: { status: 'withdrawn', respondedAt: now },
      });
      const settled = await this.settlement.riderCancelled(tx, ride, payload, booking, fee, {
        type: 'customer',
        userId: rider.userId,
        context: rider.context,
      });
      await this.audit.record(
        {
          action: 'ride.cancelled',
          actorUserId: rider.userId,
          targetType: 'ride',
          targetId: rideId,
          context: rider.context,
          metadata: {
            by: 'rider',
            feeMinor: settled.fee.minor.toString(),
            refundMinor: settled.refund.minor.toString(),
            currency: booking.currency,
          },
        },
        tx,
      );
      return { settled, driverId: ride.driverId };
    });
    this.refunds.executeLater(outcome.settled.refundIds);
    await this.publisher.toRide(rideId, { type: 'ride.updated', rideId, status: 'cancelled' });
    return {
      ride: await this.get(rideId, rider.userId),
      fee: toWire(outcome.settled.fee),
      refund: toWire(outcome.settled.refund),
    };
  }

  /** One rating per completed ride; the driver's average updates with it. */
  async rate(rideId: string, userId: string, input: RatingInput): Promise<RideDto> {
    const ride = await this.owned(rideId, userId);
    if (ride.status !== 'completed' || !ride.driverId) throw ratingClosed();
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.rideRating.create({
          data: { rideId, raterKind: 'rider', stars: input.stars, comment: input.comment },
        });
        await tx.driver.update({
          where: { id: ride.driverId ?? '' },
          data: { ratingSum: { increment: input.stars }, ratingCount: { increment: 1 } },
        });
      });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') throw ratingClosed();
      throw error;
    }
    return this.get(rideId, userId);
  }

  /**
   * A live-trip link (ADR-050): 128 random bits, stored as an HMAC, expiring 30 minutes after the
   * trip. Creating a new link revokes the previous one.
   */
  async share(rideId: string, rider: Rider): Promise<{ token: string; expiresAt: string }> {
    const ride = await this.owned(rideId, rider.userId);
    if (['completed', 'cancelled', 'no_driver'].includes(ride.status)) throw rideConflict();
    const token = randomToken(16);
    const now = Date.now();
    const plannedEnd =
      (ride.scheduledFor?.getTime() ?? now) + ride.durationSeconds * 1000 + SHARE_GRACE_MS;
    const expiresAt = new Date(
      Math.min(Math.max(plannedEnd, now + SHARE_GRACE_MS), now + SHARE_MAX_MS + SHARE_GRACE_MS),
    );
    await this.prisma.$transaction(async (tx) => {
      await tx.rideShareLink.updateMany({
        where: { rideId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await tx.rideShareLink.create({
        data: { rideId, tokenHash: this.hmac.digest('ride-share', token), expiresAt },
      });
      await this.audit.record(
        {
          action: 'ride.share_created',
          actorUserId: rider.userId,
          targetType: 'ride',
          targetId: rideId,
          context: rider.context,
        },
        tx,
      );
    });
    return { token, expiresAt: expiresAt.toISOString() };
  }

  async revokeShare(rideId: string, rider: Rider): Promise<void> {
    await this.owned(rideId, rider.userId);
    await this.prisma.$transaction(async (tx) => {
      await tx.rideShareLink.updateMany({
        where: { rideId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.audit.record(
        {
          action: 'ride.share_revoked',
          actorUserId: rider.userId,
          targetType: 'ride',
          targetId: rideId,
          context: rider.context,
        },
        tx,
      );
    });
  }

  /** The public view of a live link; 404 for unknown, revoked or expired tokens. */
  async shared(token: string): Promise<z.infer<typeof sharedRideSchema>> {
    const link = await this.prisma.rideShareLink.findUnique({
      where: { tokenHash: this.hmac.digest('ride-share', token) },
    });
    const now = new Date();
    if (!link || link.revokedAt || link.expiresAt <= now) throw new NotFoundException();
    const ride = await this.prisma.ride.findUniqueOrThrow({
      where: { id: link.rideId },
      include: RIDE_INCLUDE,
    });
    return toSharedRide(ride);
  }

  async owned(rideId: string, userId: string): Promise<RideRecord> {
    const ride = await this.prisma.ride.findUnique({
      where: { id: rideId },
      include: RIDE_INCLUDE,
    });
    if (ride?.riderUserId !== userId) throw new NotFoundException();
    return ride;
  }

  present(ride: RideRecord): RideDto {
    const pin = this.encryption.decrypt(ride.pinEncrypted, ridePinContext(ride.id));
    return toRideDto(ride, pin, new Date());
  }
}
