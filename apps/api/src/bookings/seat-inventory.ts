import { HttpStatus } from '@nestjs/common';

import { ProblemDetailsException } from '../common/problem-details';
import type { BookingStatus, Prisma, SeatState } from '../generated/prisma/client';

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
