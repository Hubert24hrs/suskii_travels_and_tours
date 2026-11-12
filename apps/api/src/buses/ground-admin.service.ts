import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import type { z } from 'zod';

import {
  addDays,
  isValidDate,
  isValidTimeZone,
  layoutSeats,
  localToUtc,
  money,
  toWire,
  type BusSeatLayout,
} from '@suskii/shared';

import { conflict, fieldChanges, hasChanges, type StaffActor } from '../admin/admin-helpers';
import { AuditService } from '../audit/audit.service';
import { BookingTransitions, type BookingActor } from '../bookings/booking-transitions';
import { storedPolicy } from '../bookings/inhouse-catalog';
import { RefundsService } from '../bookings/refunds.service';
import { ProblemDetailsException } from '../common/problem-details';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../infra/prisma.service';

import type {
  adminLayoutListSchema,
  adminOperatorListSchema,
  adminRouteListSchema,
  adminTerminalListSchema,
  adminTripListSchema,
  cancelTripSchema,
  createLayoutSchema,
  createOperatorSchema,
  createRouteSchema,
  createTerminalSchema,
  createTripSchema,
  scheduleTripsSchema,
  updateLayoutSchema,
  updateOperatorSchema,
  updateRouteSchema,
  updateTerminalSchema,
  updateTripSchema,
} from './buses.schemas';

type In<T extends z.ZodType> = z.output<T>;

const MAX_SCHEDULE_DAYS = 120;
const UNPAID = ['DRAFT', 'PRICED', 'HELD', 'AWAITING_PAYMENT'] as const;
const PAID = ['PAID', 'CONFIRMED', 'PARTIALLY_PAID'] as const;

const invalid = (slug: string, title: string): ProblemDetailsException =>
  new ProblemDetailsException(HttpStatus.UNPROCESSABLE_ENTITY, slug, title);

const staffBookingActor = (staff: StaffActor): BookingActor => ({
  type: 'staff',
  userId: staff.userId,
  context: staff.context,
});

const uniqueViolation = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

/**
 * Bus inventory for operations (`ground:manage`, ADR-049): operators, terminals, routes, coach
 * layouts and departures, entered by staff (manual inventory is the decision-gate default).
 * Every change is audited with the fields it touched. Cancelling a departure refunds its paid
 * bookings in full and cancels the unpaid ones.
 */
@Injectable()
export class GroundAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly transitions: BookingTransitions,
    private readonly refunds: RefundsService,
  ) {}

  // --- Operators -----------------------------------------------------------------------------

  async operators(): Promise<z.infer<typeof adminOperatorListSchema>> {
    const rows = await this.prisma.busOperator.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { members: true } } },
    });
    return {
      operators: rows.map((row) => ({
        id: row.id,
        slug: row.slug,
        name: row.name,
        status: row.status,
        sample: row.sample,
        cancellationPolicy: storedPolicy(row.cancellationPolicy),
        agents: row._count.members,
      })),
    };
  }

  async createOperator(input: In<typeof createOperatorSchema>, staff: StaffActor) {
    try {
      const row = await this.prisma.$transaction(async (tx) => {
        const created = await tx.busOperator.create({
          data: {
            slug: input.slug,
            name: input.name,
            cancellationPolicy: input.cancellationPolicy,
          },
        });
        await this.record(tx, 'ground.operator_created', 'bus_operator', created.id, staff, {
          slug: input.slug,
        });
        return created;
      });
      return { id: row.id };
    } catch (error) {
      if (uniqueViolation(error)) throw conflict('slug-taken', 'That slug is already used');
      throw error;
    }
  }

  async updateOperator(id: string, input: In<typeof updateOperatorSchema>, staff: StaffActor) {
    const current = await this.prisma.busOperator.findUnique({ where: { id } });
    if (!current) throw new NotFoundException();
    const changes = fieldChanges(
      {
        name: current.name,
        status: current.status,
        cancellationPolicy: JSON.stringify(current.cancellationPolicy),
      },
      {
        name: input.name ?? current.name,
        status: input.status ?? current.status,
        cancellationPolicy: JSON.stringify(input.cancellationPolicy ?? current.cancellationPolicy),
      },
    );
    if (!hasChanges(changes)) return;
    await this.prisma.$transaction(async (tx) => {
      await tx.busOperator.update({
        where: { id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
          ...(input.cancellationPolicy !== undefined
            ? { cancellationPolicy: input.cancellationPolicy }
            : {}),
        },
      });
      await this.record(tx, 'ground.operator_updated', 'bus_operator', id, staff, { changes });
    });
  }

  /** Makes an account an agent of the operator (role `operator_agent`, ADR-050). */
  async addAgent(operatorId: string, userId: string, staff: StaffActor): Promise<void> {
    const [operator, user] = await Promise.all([
      this.prisma.busOperator.findUnique({ where: { id: operatorId }, select: { id: true } }),
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { status: true, roles: { select: { roleKey: true } } },
      }),
    ]);
    if (!operator || user?.status !== 'active') throw new NotFoundException();
    await this.prisma.$transaction(async (tx) => {
      await tx.operatorMember.upsert({
        where: { operatorId_userId: { operatorId, userId } },
        create: { operatorId, userId },
        update: {},
      });
      await tx.userRole.upsert({
        where: { userId_roleKey: { userId, roleKey: 'operator_agent' } },
        create: { userId, roleKey: 'operator_agent', grantedById: staff.userId },
        update: {},
      });
      await this.record(tx, 'ground.agent_added', 'bus_operator', operatorId, staff, { userId });
    });
  }

  async removeAgent(operatorId: string, userId: string, staff: StaffActor): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.operatorMember.deleteMany({ where: { operatorId, userId } });
      if (count === 0) throw new NotFoundException();
      // The role goes with the last operator the account boarded for.
      if ((await tx.operatorMember.count({ where: { userId } })) === 0) {
        await tx.userRole.deleteMany({ where: { userId, roleKey: 'operator_agent' } });
      }
      await this.record(tx, 'ground.agent_removed', 'bus_operator', operatorId, staff, { userId });
    });
  }

  // --- Terminals -----------------------------------------------------------------------------

  async terminals(): Promise<z.infer<typeof adminTerminalListSchema>> {
    const rows = await this.prisma.busTerminal.findMany({
      orderBy: [{ cityName: 'asc' }, { name: 'asc' }],
    });
    return {
      terminals: rows.map((row) => ({
        id: row.id,
        slug: row.slug,
        name: row.name,
        cityName: row.cityName,
        stateName: row.stateName,
        countryCode: row.countryCode,
        address: row.address,
        lat: row.lat,
        lng: row.lng,
        timeZone: row.timeZone,
        active: row.active,
        sample: row.sample,
      })),
    };
  }

  async createTerminal(input: In<typeof createTerminalSchema>, staff: StaffActor) {
    if (!isValidTimeZone(input.timeZone)) throw invalid('time-zone-invalid', 'Unknown time zone');
    try {
      const row = await this.prisma.$transaction(async (tx) => {
        const created = await tx.busTerminal.create({ data: input });
        await this.record(tx, 'ground.terminal_created', 'bus_terminal', created.id, staff, {
          slug: input.slug,
        });
        return created;
      });
      return { id: row.id };
    } catch (error) {
      if (uniqueViolation(error)) throw conflict('slug-taken', 'That slug is already used');
      throw error;
    }
  }

  async updateTerminal(id: string, input: In<typeof updateTerminalSchema>, staff: StaffActor) {
    const current = await this.prisma.busTerminal.findUnique({ where: { id } });
    if (!current) throw new NotFoundException();
    if (input.timeZone !== undefined && !isValidTimeZone(input.timeZone)) {
      throw invalid('time-zone-invalid', 'Unknown time zone');
    }
    const before = {
      name: current.name,
      cityName: current.cityName,
      stateName: current.stateName,
      countryCode: current.countryCode,
      address: current.address,
      lat: current.lat,
      lng: current.lng,
      timeZone: current.timeZone,
      active: current.active,
    };
    const after = { ...before, ...input };
    const changes = fieldChanges(before, after);
    if (!hasChanges(changes)) return;
    await this.prisma.$transaction(async (tx) => {
      await tx.busTerminal.update({ where: { id }, data: input });
      await this.record(tx, 'ground.terminal_updated', 'bus_terminal', id, staff, { changes });
    });
  }

  // --- Routes --------------------------------------------------------------------------------

  async routes(): Promise<z.infer<typeof adminRouteListSchema>> {
    const rows = await this.prisma.busRoute.findMany({
      include: { operator: true, origin: true, destination: true },
      orderBy: [{ operator: { name: 'asc' } }, { origin: { cityName: 'asc' } }],
    });
    return {
      routes: rows.map((row) => ({
        id: row.id,
        operatorId: row.operatorId,
        operatorName: row.operator.name,
        originId: row.originId,
        origin: row.origin.name,
        destinationId: row.destinationId,
        destination: row.destination.name,
        distanceKm: row.distanceKm,
        durationMinutes: row.durationMinutes,
        active: row.active,
      })),
    };
  }

  async createRoute(input: In<typeof createRouteSchema>, staff: StaffActor) {
    if (input.originId === input.destinationId) {
      throw invalid('route-invalid', 'A route needs two different terminals');
    }
    const [operator, terminals] = await Promise.all([
      this.prisma.busOperator.count({ where: { id: input.operatorId } }),
      this.prisma.busTerminal.count({
        where: { id: { in: [input.originId, input.destinationId] } },
      }),
    ]);
    if (operator !== 1 || terminals !== 2) throw new NotFoundException();
    try {
      const row = await this.prisma.$transaction(async (tx) => {
        const created = await tx.busRoute.create({ data: input });
        await this.record(tx, 'ground.route_created', 'bus_route', created.id, staff, {
          operatorId: input.operatorId,
          originId: input.originId,
          destinationId: input.destinationId,
        });
        return created;
      });
      return { id: row.id };
    } catch (error) {
      if (uniqueViolation(error)) throw conflict('route-exists', 'The operator already runs it');
      throw error;
    }
  }

  async updateRoute(id: string, input: In<typeof updateRouteSchema>, staff: StaffActor) {
    const current = await this.prisma.busRoute.findUnique({ where: { id } });
    if (!current) throw new NotFoundException();
    const before = {
      distanceKm: current.distanceKm,
      durationMinutes: current.durationMinutes,
      active: current.active,
    };
    const changes = fieldChanges(before, { ...before, ...input });
    if (!hasChanges(changes)) return;
    await this.prisma.$transaction(async (tx) => {
      await tx.busRoute.update({ where: { id }, data: input });
      await this.record(tx, 'ground.route_updated', 'bus_route', id, staff, { changes });
    });
  }

  // --- Layouts -------------------------------------------------------------------------------

  async layouts(): Promise<z.infer<typeof adminLayoutListSchema>> {
    const rows = await this.prisma.busLayout.findMany({ orderBy: { name: 'asc' } });
    return {
      layouts: rows.map((row) => ({
        id: row.id,
        operatorId: row.operatorId,
        name: row.name,
        seatCount: row.seatCount,
        amenities: row.amenities,
        layout: row.layout as unknown as BusSeatLayout,
      })),
    };
  }

  async createLayout(input: In<typeof createLayoutSchema>, staff: StaffActor) {
    if ((await this.prisma.busOperator.count({ where: { id: input.operatorId } })) !== 1) {
      throw new NotFoundException();
    }
    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.busLayout.create({
        data: {
          operatorId: input.operatorId,
          name: input.name,
          layout: input.layout,
          seatCount: layoutSeats(input.layout).length,
          amenities: input.amenities,
        },
      });
      await this.record(tx, 'ground.layout_created', 'bus_layout', created.id, staff, {
        seatCount: created.seatCount,
      });
      return created;
    });
    return { id: row.id };
  }

  async updateLayout(id: string, input: In<typeof updateLayoutSchema>, staff: StaffActor) {
    const current = await this.prisma.busLayout.findUnique({ where: { id } });
    if (!current) throw new NotFoundException();
    if (input.layout) {
      // Sold seats must still exist on every future departure that uses this coach.
      const seats = new Set(layoutSeats(input.layout));
      const sold = await this.prisma.busSeatAssignment.findMany({
        where: { active: true, trip: { layoutId: id, departsAt: { gt: new Date() } } },
        select: { seatNumber: true },
      });
      if (sold.some((seat) => !seats.has(seat.seatNumber))) {
        throw conflict('layout-in-use', 'Sold seats would disappear from future departures');
      }
    }
    const changes = fieldChanges(
      {
        name: current.name,
        amenities: current.amenities,
        layout: JSON.stringify(current.layout),
      },
      {
        name: input.name ?? current.name,
        amenities: input.amenities ?? current.amenities,
        layout: JSON.stringify(input.layout ?? current.layout),
      },
      ['layout'],
    );
    if (!hasChanges(changes)) return;
    await this.prisma.$transaction(async (tx) => {
      await tx.busLayout.update({
        where: { id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.amenities !== undefined ? { amenities: input.amenities } : {}),
          ...(input.layout
            ? { layout: input.layout, seatCount: layoutSeats(input.layout).length }
            : {}),
        },
      });
      await this.record(tx, 'ground.layout_updated', 'bus_layout', id, staff, { changes });
    });
  }

  // --- Trips ---------------------------------------------------------------------------------

  async trips(query: { routeId?: string; from: string; to: string }) {
    const rows = await this.prisma.busTrip.findMany({
      where: {
        ...(query.routeId ? { routeId: query.routeId } : {}),
        departsAtLocal: { gte: query.from, lt: addDays(query.to, 1) },
      },
      include: {
        layout: { select: { seatCount: true } },
        route: { include: { operator: true, origin: true, destination: true } },
        _count: { select: { assignments: { where: { active: true } } } },
      },
      orderBy: { departsAt: 'asc' },
      take: 500,
    });
    return {
      trips: rows.map((row) => ({
        id: row.id,
        routeId: row.routeId,
        layoutId: row.layoutId,
        operatorName: row.route.operator.name,
        origin: row.route.origin.name,
        destination: row.route.destination.name,
        departsAtLocal: row.departsAtLocal,
        departsAt: row.departsAt.toISOString(),
        status: row.status,
        fare: toWire(money(row.fareMinor, row.currency)),
        seatCount: row.layout.seatCount,
        sold: row._count.assignments,
        blockedSeats: row.blockedSeats,
        sample: row.sample,
      })),
    } satisfies z.infer<typeof adminTripListSchema>;
  }

  async createTrip(input: In<typeof createTripSchema>, staff: StaffActor) {
    const { route } = await this.routeAndLayout(input.routeId, input.layoutId);
    const departsAt = localToUtc(input.departsAtLocal, route.origin.timeZone);
    if (departsAt <= new Date()) throw invalid('departure-past', 'The departure is in the past');
    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.busTrip.create({
        data: {
          routeId: input.routeId,
          layoutId: input.layoutId,
          departsAt,
          departsAtLocal: input.departsAtLocal,
          arrivesAt: new Date(departsAt.getTime() + route.durationMinutes * 60_000),
          fareMinor: BigInt(input.fareMinor),
          currency: input.currency,
        },
      });
      await this.record(tx, 'ground.trip_created', 'bus_trip', created.id, staff, {
        routeId: input.routeId,
        fareMinor: String(input.fareMinor),
      });
      return created;
    });
    return { id: row.id };
  }

  /** A timetable: one departure per date and time, skipping those that already exist. */
  async scheduleTrips(input: In<typeof scheduleTripsSchema>, staff: StaffActor) {
    if (
      !isValidDate(input.fromDate) ||
      !isValidDate(input.toDate) ||
      input.toDate < input.fromDate
    ) {
      throw invalid('dates-invalid', 'Choose a valid date range');
    }
    if (addDays(input.fromDate, MAX_SCHEDULE_DAYS) < input.toDate) {
      throw invalid('dates-invalid', `Schedule at most ${MAX_SCHEDULE_DAYS} days at a time`);
    }
    const { route } = await this.routeAndLayout(input.routeId, input.layoutId);
    const existing = new Set(
      (
        await this.prisma.busTrip.findMany({
          where: {
            routeId: input.routeId,
            departsAtLocal: { gte: input.fromDate, lt: addDays(input.toDate, 1) },
          },
          select: { departsAtLocal: true },
        })
      ).map((trip) => trip.departsAtLocal),
    );
    const now = new Date();
    const data: Prisma.BusTripCreateManyInput[] = [];
    let skipped = 0;
    for (let date = input.fromDate; date <= input.toDate; date = addDays(date, 1)) {
      for (const time of [...new Set(input.times)]) {
        const local = `${date}T${time}`;
        const departsAt = localToUtc(local, route.origin.timeZone);
        if (existing.has(local) || departsAt <= now) {
          skipped += 1;
          continue;
        }
        data.push({
          routeId: input.routeId,
          layoutId: input.layoutId,
          departsAt,
          departsAtLocal: local,
          arrivesAt: new Date(departsAt.getTime() + route.durationMinutes * 60_000),
          fareMinor: BigInt(input.fareMinor),
          currency: input.currency,
        });
      }
    }
    await this.prisma.$transaction(async (tx) => {
      if (data.length > 0) await tx.busTrip.createMany({ data });
      await this.record(tx, 'ground.trips_scheduled', 'bus_route', input.routeId, staff, {
        created: data.length,
        skipped,
      });
    });
    return { created: data.length, skipped };
  }

  async updateTrip(id: string, input: In<typeof updateTripSchema>, staff: StaffActor) {
    const current = await this.prisma.busTrip.findUnique({
      where: { id },
      include: { layout: true },
    });
    if (!current) throw new NotFoundException();
    if (current.status === 'cancelled')
      throw conflict('trip-cancelled', 'The departure is cancelled');
    if (input.blockedSeats) {
      const seats = new Set(layoutSeats(current.layout.layout as unknown as BusSeatLayout));
      if (input.blockedSeats.some((seat) => !seats.has(seat))) {
        throw invalid('seat-invalid', 'Blocked seats must be on the seat map');
      }
      const sold = await this.prisma.busSeatAssignment.count({
        where: { tripId: id, active: true, seatNumber: { in: input.blockedSeats } },
      });
      if (sold > 0) throw conflict('seat-sold', 'A sold seat cannot be blocked');
    }
    const before = {
      fareMinor: Number(current.fareMinor),
      blockedSeats: current.blockedSeats,
      status: current.status,
    };
    const changes = fieldChanges(before, { ...before, ...input });
    if (!hasChanges(changes)) return;
    await this.prisma.$transaction(async (tx) => {
      await tx.busTrip.update({
        where: { id },
        data: {
          ...(input.fareMinor !== undefined ? { fareMinor: BigInt(input.fareMinor) } : {}),
          ...(input.blockedSeats !== undefined ? { blockedSeats: input.blockedSeats } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
        },
      });
      await this.record(tx, 'ground.trip_updated', 'bus_trip', id, staff, { changes });
    });
  }

  /**
   * Cancels a departure: paid bookings are refunded in full (non-discretionary, so automatic),
   * unpaid ones cancelled, and the seats released with them (ADR-051).
   */
  async cancelTrip(id: string, input: In<typeof cancelTripSchema>, staff: StaffActor) {
    const trip = await this.prisma.busTrip.findUnique({ where: { id } });
    if (!trip) throw new NotFoundException();
    if (trip.status === 'cancelled') return { refundedBookings: 0, releasedBookings: 0 };
    const bookings = await this.prisma.booking.findMany({
      where: { items: { some: { busSeats: { some: { tripId: id, active: true } } } } },
      select: { id: true, currency: true },
    });
    const actor = staffBookingActor(staff);
    let refundedBookings = 0;
    let releasedBookings = 0;
    const refundIds: string[] = [];
    for (const booking of bookings) {
      await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM bookings WHERE id = ${booking.id}::uuid FOR UPDATE`;
        const current = await tx.booking.findUniqueOrThrow({ where: { id: booking.id } });
        if ((PAID as readonly string[]).includes(current.status)) {
          await this.transitions.apply(tx, current, 'request_refund', actor, {
            reason: 'trip_cancelled',
          });
          refundIds.push(
            ...(await this.refunds.refundBookingBalance(tx, current, 'supplier_cancellation')),
          );
          refundedBookings += 1;
        } else if ((UNPAID as readonly string[]).includes(current.status)) {
          await this.transitions.apply(tx, current, 'cancel', actor, { reason: 'trip_cancelled' });
          releasedBookings += 1;
        }
      });
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.busTrip.update({ where: { id }, data: { status: 'cancelled' } });
      await this.record(tx, 'ground.trip_cancelled', 'bus_trip', id, staff, {
        reason: input.reason,
        refundedBookings,
        releasedBookings,
      });
    });
    this.refunds.executeLater(refundIds);
    return { refundedBookings, releasedBookings };
  }

  private async routeAndLayout(routeId: string, layoutId: string) {
    const [route, layout] = await Promise.all([
      this.prisma.busRoute.findUnique({ where: { id: routeId }, include: { origin: true } }),
      this.prisma.busLayout.findUnique({ where: { id: layoutId } }),
    ]);
    if (!route || !layout) throw new NotFoundException();
    if (layout.operatorId !== route.operatorId) {
      throw invalid('layout-mismatch', 'The coach belongs to another operator');
    }
    return { route, layout };
  }

  private record(
    tx: Prisma.TransactionClient,
    action: Parameters<AuditService['record']>[0]['action'],
    targetType: string,
    targetId: string,
    staff: StaffActor,
    metadata: Prisma.InputJsonObject,
  ): Promise<void> {
    return this.audit.record(
      { action, actorUserId: staff.userId, targetType, targetId, context: staff.context, metadata },
      tx,
    );
  }
}
