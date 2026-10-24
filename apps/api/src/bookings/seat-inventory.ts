import { HttpStatus } from '@nestjs/common';

import { ProblemDetailsException } from '../common/problem-details';
import { Prisma, type BookingStatus, type SeatState } from '../generated/prisma/client';

type Tx = Prisma.TransactionClient;

/** Booking statuses whose seats go back on sale (ADR-025). */
export const RELEASING_STATUSES: readonly BookingStatus[] = [
  'FAILED',
  'CANCELLED',
  'EXPIRED',
  'REFUND_PENDING',
  'REFUNDED',
];

export const soldOut = (): ProblemDetailsException =>
  new ProblemDetailsException(
    HttpStatus.CONFLICT,
    'sold-out',
    'Not enough places left',
    'This departure no longer has enough places for your group. Choose another date.',
  );

export interface SeatRequest {
  kind: 'package' | 'tour';
  departureId: string;
  seats: number;
}

/**
 * Reserves seats with one conditional update, so concurrent buyers can never take more than the
 * capacity (the check constraint backs it up). Throws 409 `sold-out` otherwise.
 */
export async function reserveSeats(tx: Tx, request: SeatRequest): Promise<void> {
  const count =
    request.kind === 'package'
      ? await tx.$executeRaw`
          UPDATE package_departures
             SET seats_reserved = seats_reserved + ${request.seats}, updated_at = now()
           WHERE id = ${request.departureId}::uuid
             AND status = 'open'
             AND start_date > CURRENT_DATE
             AND seats_reserved + seats_sold + ${request.seats} <= capacity`
      : await tx.$executeRaw`
          UPDATE tour_departures
             SET seats_reserved = seats_reserved + ${request.seats}, updated_at = now()
           WHERE id = ${request.departureId}::uuid
             AND status = 'open'
             AND starts_at_utc > now()
             AND seats_reserved + seats_sold + ${request.seats} <= capacity`;
  if (count !== 1) throw soldOut();
}

const MOVES: Record<'sold' | 'released', readonly SeatState[]> = {
  sold: ['reserved'],
  released: ['reserved', 'sold'],
};

/**
 * Moves a booking's seats to sold (confirmation) or back on sale (expiry, cancellation, failure,
 * refund), inside the caller's transaction. Each item moves once: the guard on its current state
 * makes a repeated call a no-op.
 */
export async function settleSeats(
  tx: Tx,
  bookingId: string,
  to: 'sold' | 'released',
): Promise<void> {
  const items = await tx.bookingItem.findMany({
    where: { bookingId, seatState: { in: [...MOVES[to]] } },
    select: {
      id: true,
      seats: true,
      seatState: true,
      packageDepartureId: true,
      tourDepartureId: true,
    },
  });
  for (const item of items) {
    const seats = item.seats ?? 0;
    const from = item.seatState;
    if (!from || seats <= 0) continue;
    const { count } = await tx.bookingItem.updateMany({
      where: { id: item.id, seatState: from },
      data: { seatState: to },
    });
    if (count !== 1) continue;
    const reserved = from === 'reserved' ? -seats : 0;
    const sold = (from === 'sold' ? -seats : 0) + (to === 'sold' ? seats : 0);
    if (item.packageDepartureId) {
      await tx.$executeRaw`
        UPDATE package_departures
           SET seats_reserved = seats_reserved + ${reserved},
               seats_sold = seats_sold + ${sold},
               updated_at = now()
         WHERE id = ${item.packageDepartureId}::uuid`;
    } else if (item.tourDepartureId) {
      await tx.$executeRaw`
        UPDATE tour_departures
           SET seats_reserved = seats_reserved + ${reserved},
               seats_sold = seats_sold + ${sold},
               updated_at = now()
         WHERE id = ${item.tourDepartureId}::uuid`;
    }
  }
}

export const seatTaken = (): ProblemDetailsException =>
  new ProblemDetailsException(
    HttpStatus.CONFLICT,
    'seat-taken',
    'Your seats are no longer held',
    'Your seat hold has ended or a seat was taken. Choose your seats again.',
  );

export interface BusSeatClaim {
  holdId: string;
  tripId: string;
  seats: readonly string[];
  bookingItemId: string;
  /** Booking passengers in seat order. */
  passengerIds: readonly string[];
}

/**
 * Turns a live seat hold into the booking's seats inside the booking-create transaction
 * (ADR-051): the hold row is locked, must still be live, unused and for these seats, and the
 * partial unique index on active assignments makes a seat impossible to sell twice. Throws 409
 * `seat-taken` otherwise.
 */
export async function claimBusSeats(tx: Tx, claim: BusSeatClaim, now: Date): Promise<void> {
  const [hold] = await tx.$queryRaw<
    {
      trip_id: string;
      seats: string[];
      expires_at: Date;
      released_at: Date | null;
      booking_item_id: string | null;
    }[]
  >`SELECT trip_id, seats, expires_at, released_at, booking_item_id
      FROM bus_seat_holds WHERE id = ${claim.holdId}::uuid FOR UPDATE`;
  if (!hold) throw seatTaken();
  const sameSeats =
    hold.seats.length === claim.seats.length &&
    claim.seats.every((seat) => hold.seats.includes(seat));
  if (
    hold.trip_id !== claim.tripId ||
    !sameSeats ||
    hold.released_at !== null ||
    hold.booking_item_id !== null ||
    hold.expires_at <= now
  ) {
    throw seatTaken();
  }
  if (claim.passengerIds.length !== claim.seats.length) {
    throw new Error('Every held seat needs exactly one passenger');
  }
  try {
    // A lost race aborts the booking's transaction; the caller sees 409 and nothing is written.
    await tx.busSeatAssignment.createMany({
      data: claim.seats.map((seatNumber, index) => ({
        tripId: claim.tripId,
        seatNumber,
        bookingItemId: claim.bookingItemId,
        passengerId: claim.passengerIds[index] ?? '',
      })),
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw seatTaken();
    }
    throw error;
  }
  await tx.busSeatHold.update({
    where: { id: claim.holdId },
    data: { bookingItemId: claim.bookingItemId },
  });
}

/**
 * Puts a booking's bus seats back on sale and voids its unused boarding passes, with the other
 * releasing transitions (ADR-051). Repeated calls change nothing.
 */
export async function releaseBusSeats(tx: Tx, bookingId: string, now: Date): Promise<void> {
  await tx.busSeatAssignment.updateMany({
    where: { active: true, bookingItem: { bookingId } },
    data: { active: false, releasedAt: now },
  });
  await tx.busTicket.updateMany({
    where: { bookingId, status: 'valid' },
    data: { status: 'void' },
  });
}

export const vehicleUnavailable = (): ProblemDetailsException =>
  new ProblemDetailsException(
    HttpStatus.CONFLICT,
    'vehicle-unavailable',
    'This car is no longer free for those dates',
    'Someone booked it first. Choose other dates or another car.',
  );

/** Postgres refused the row because of the rental overlap exclusion constraint (23P01). */
function overlapViolation(error: unknown): boolean {
  const text = `${(error as { message?: string }).message ?? ''} ${JSON.stringify(
    (error as { meta?: unknown }).meta ?? {},
  )}`;
  return text.includes('rental_reservations_no_overlap') || text.includes('23P01');
}

/**
 * Blocks the car for the rental period plus the turnaround inside the booking-create transaction
 * (ADR-051). The exclusion constraint on active reservations is the guarantee: of two concurrent
 * bookings for overlapping periods exactly one commits, the other gets 409 `vehicle-unavailable`.
 */
export async function claimRental(
  tx: Tx,
  payload: {
    vehicleId: string;
    pickupAtUtc: string;
    returnAtUtc: string;
    chauffeur: boolean;
    charge: { deposit: { minor: bigint; currency: string } };
  },
  bookingItemId: string,
  config: { RENTAL_TURNAROUND_HOURS: number },
): Promise<void> {
  const returnAt = new Date(payload.returnAtUtc);
  try {
    // A lost race aborts the booking's transaction; the caller sees 409 and nothing is written.
    await tx.rentalReservation.create({
      data: {
        vehicleId: payload.vehicleId,
        bookingItemId,
        pickupAt: new Date(payload.pickupAtUtc),
        returnAt,
        blockedUntil: new Date(returnAt.getTime() + config.RENTAL_TURNAROUND_HOURS * 3_600_000),
        chauffeur: payload.chauffeur,
        licenceRequired: !payload.chauffeur,
        depositMinor: payload.charge.deposit.minor,
        currency: payload.charge.deposit.currency,
      },
    });
  } catch (error) {
    if (overlapViolation(error)) throw vehicleUnavailable();
    throw error;
  }
}

/**
 * A booking that will not go ahead frees its car (expiry, cancellation, refund). A rental that
 * has started (checked out) keeps its record; returning the car ends it.
 */
export async function releaseRental(tx: Tx, bookingId: string): Promise<void> {
  await tx.rentalReservation.updateMany({
    where: { bookingItem: { bookingId }, active: true, status: 'reserved' },
    data: { active: false, status: 'cancelled' },
  });
}
