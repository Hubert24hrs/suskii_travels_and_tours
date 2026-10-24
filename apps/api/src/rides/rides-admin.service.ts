import { Injectable, NotFoundException } from '@nestjs/common';
import type { z } from 'zod';

import { RIDE_LIVE_STATUSES, type RideStatus } from '@suskii/shared';

import { fieldChanges, hasChanges, type StaffActor } from '../admin/admin-helpers';
import { AuditService } from '../audit/audit.service';
import type { BookingActor } from '../bookings/booking-transitions';
import { RefundsService } from '../bookings/refunds.service';
import { PrismaService } from '../infra/prisma.service';

import { RideEventsPublisher } from './ride-events.publisher';
import { RideSettlementService } from './ride-settlement.service';
import { RideTransitions } from './ride-transitions';
import { lastPosition } from './ride-views';
import type {
  adminLiveRidesSchema,
  fareRuleBodySchema,
  fareRuleListSchema,
  placeBodySchema,
  placeUpdateSchema,
  staffCancelSchema,
} from './rides.schemas';

type In<T extends z.ZodType> = z.output<T>;

const OPEN_STATUSES: readonly RideStatus[] = ['scheduled', 'searching', ...RIDE_LIVE_STATUSES];

/** The editable terms of a rule, as plain numbers for the audit's field changes. */
const ruleTerms = (row: {
  currency: string;
  baseMinor: bigint;
  perKmMinor: bigint;
  perMinuteMinor: bigint;
  bookingFeeMinor: bigint;
  minimumMinor: bigint;
  cancellationFeeMinor: bigint;
  freeCancelSeconds: number;
  waitGraceSeconds: number;
  driverShareBps: number;
  surgeBps: number;
  active: boolean;
}) => ({
  currency: row.currency,
  baseMinor: Number(row.baseMinor),
  perKmMinor: Number(row.perKmMinor),
  perMinuteMinor: Number(row.perMinuteMinor),
  bookingFeeMinor: Number(row.bookingFeeMinor),
  minimumMinor: Number(row.minimumMinor),
  cancellationFeeMinor: Number(row.cancellationFeeMinor),
  freeCancelSeconds: row.freeCancelSeconds,
  waitGraceSeconds: row.waitGraceSeconds,
  driverShareBps: row.driverShareBps,
  surgeBps: row.surgeBps,
  active: row.active,
});

const staffBookingActor = (staff: StaffActor): BookingActor => ({
  type: 'staff',
  userId: staff.userId,
  context: staff.context,
});

/**
 * Ride operations for staff (ADR-049 to ADR-051): fare rules per city and category (data, not
 * code), curated places, the live board, and stopping a ride (always a full refund).
 */
@Injectable()
export class RidesAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transitions: RideTransitions,
    private readonly settlement: RideSettlementService,
    private readonly refunds: RefundsService,
    private readonly publisher: RideEventsPublisher,
    private readonly audit: AuditService,
  ) {}

  async fareRules(): Promise<z.infer<typeof fareRuleListSchema>> {
    const rows = await this.prisma.rideFareRule.findMany({
      orderBy: [{ cityName: 'asc' }, { category: 'asc' }],
    });
    return {
      rules: rows.map((row) => ({
        id: row.id,
        cityName: row.cityName,
        category: row.category,
        ...ruleTerms(row),
      })),
    };
  }

  /**
   * Creates or replaces the rule for a city and category. Booked rides keep the terms copied into
   * their quote, so a change only affects new quotes.
   */
  async saveFareRule(
    input: In<typeof fareRuleBodySchema>,
    staff: StaffActor,
  ): Promise<{ id: string }> {
    const data = {
      currency: input.currency,
      baseMinor: BigInt(input.baseMinor),
      perKmMinor: BigInt(input.perKmMinor),
      perMinuteMinor: BigInt(input.perMinuteMinor),
      bookingFeeMinor: BigInt(input.bookingFeeMinor),
      minimumMinor: BigInt(input.minimumMinor),
      cancellationFeeMinor: BigInt(input.cancellationFeeMinor),
      freeCancelSeconds: input.freeCancelSeconds,
      waitGraceSeconds: input.waitGraceSeconds,
      driverShareBps: input.driverShareBps,
      surgeBps: input.surgeBps,
      active: input.active,
    };
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.rideFareRule.findUnique({
        where: { cityName_category: { cityName: input.cityName, category: input.category } },
      });
      const row = await tx.rideFareRule.upsert({
        where: { cityName_category: { cityName: input.cityName, category: input.category } },
        create: { cityName: input.cityName, category: input.category, ...data },
        update: data,
      });
      const changes = current ? fieldChanges(ruleTerms(current), ruleTerms(row)) : null;
      await this.audit.record(
        {
          action: 'ride.fare_rule_saved',
          actorUserId: staff.userId,
          targetType: 'ride_fare_rule',
          targetId: row.id,
          context: staff.context,
          metadata: {
            cityName: input.cityName,
            category: input.category,
            created: current === null,
            ...(changes ? { changes } : {}),
          },
        },
        tx,
      );
      return { id: row.id };
    });
  }

  async createPlace(input: In<typeof placeBodySchema>, staff: StaffActor): Promise<{ id: string }> {
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.ridePlace.create({ data: input });
      await this.audit.record(
        {
          action: 'ride.place_created',
          actorUserId: staff.userId,
          targetType: 'ride_place',
          targetId: row.id,
          context: staff.context,
          metadata: { cityName: input.cityName, kind: input.kind },
        },
        tx,
      );
      return { id: row.id };
    });
  }

  async updatePlace(
    id: string,
    input: In<typeof placeUpdateSchema>,
    staff: StaffActor,
  ): Promise<void> {
    const current = await this.prisma.ridePlace.findUnique({ where: { id } });
    if (!current) throw new NotFoundException();
    const before = {
      name: current.name,
      kind: current.kind,
      cityName: current.cityName,
      lat: current.lat,
      lng: current.lng,
      active: current.active,
    };
    const changes = fieldChanges(before, { ...before, ...input });
    if (!hasChanges(changes)) return;
    await this.prisma.$transaction(async (tx) => {
      await tx.ridePlace.update({ where: { id }, data: input });
      await this.audit.record(
        {
          action: 'ride.place_updated',
          actorUserId: staff.userId,
          targetType: 'ride_place',
          targetId: id,
          context: staff.context,
          metadata: { changes },
        },
        tx,
      );
    });
  }

  /** Rides not yet finished, with the driver's exact last position (staff only). */
  async liveRides(): Promise<z.infer<typeof adminLiveRidesSchema>> {
    const rows = await this.prisma.ride.findMany({
      where: { status: { in: [...OPEN_STATUSES] } },
      include: {
        driver: { select: { lastLat: true, lastLng: true, lastLocationAt: true } },
        _count: { select: { incidents: { where: { status: { not: 'resolved' } } } } },
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    return {
      rides: rows.map((ride) => {
        const position = lastPosition(ride.driver);
        return {
          id: ride.id,
          bookingId: ride.bookingId,
          status: ride.status,
          category: ride.category,
          cityName: ride.cityName,
          driverId: ride.driverId,
          driverPosition:
            position && ride.driver?.lastLocationAt
              ? { ...position, at: ride.driver.lastLocationAt.toISOString() }
              : null,
          pickup: { lat: ride.pickupLat, lng: ride.pickupLng },
          offRoute: ride.offRouteSince !== null,
          openIncidents: ride._count.incidents,
          createdAt: ride.createdAt.toISOString(),
        };
      }),
    };
  }

  /** Stops a ride at any point before completion (safety, fraud, support); refunds in full. */
  async cancel(
    rideId: string,
    input: In<typeof staffCancelSchema>,
    staff: StaffActor,
  ): Promise<void> {
    const found = await this.prisma.ride.findUnique({
      where: { id: rideId },
      select: { bookingId: true },
    });
    if (!found) throw new NotFoundException();
    const refundIds = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM bookings WHERE id = ${found.bookingId}::uuid FOR UPDATE`;
      const ride = await tx.ride.findUniqueOrThrow({ where: { id: rideId } });
      const now = new Date();
      await this.transitions.apply(
        tx,
        ride,
        'staff_cancel',
        { kind: 'staff', userId: staff.userId },
        {
          data: { cancelledAt: now, cancelledBy: 'staff', offRouteSince: null },
          metadata: { reason: input.reason },
        },
      );
      await tx.rideOffer.updateMany({
        where: { rideId, status: 'open' },
        data: { status: 'withdrawn', respondedAt: now },
      });
      const booking = await tx.booking.findUniqueOrThrow({ where: { id: ride.bookingId } });
      const ids = await this.settlement.refundInFull(
        tx,
        booking,
        'staff_cancelled',
        staffBookingActor(staff),
      );
      await this.audit.record(
        {
          action: 'ride.staff_cancelled',
          actorUserId: staff.userId,
          targetType: 'ride',
          targetId: rideId,
          context: staff.context,
          metadata: { reason: input.reason, from: ride.status },
        },
        tx,
      );
      return ids;
    });
    this.refunds.executeLater(refundIds);
    await this.publisher.toRide(rideId, { type: 'ride.updated', rideId, status: 'cancelled' });
  }
}
