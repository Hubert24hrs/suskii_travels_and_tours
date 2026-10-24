import type { Prisma } from '../generated/prisma/client';

type Tx = Prisma.TransactionClient;

export const REDACTED_PLACE = 'Redacted';

/**
 * Personal data on a booking's Cars records (ADR-029, ADR-053), cleared when the booking is
 * redacted (account deletion) or anonymised (retention): ride places are renamed, coordinates
 * rounded to about 1 km and the route dropped; rating comments and handover notes are cleared.
 * Fares, seats, statuses and stars stay as the financial and safety record.
 */
export async function redactCarsBooking(tx: Tx, bookingId: string): Promise<void> {
  await tx.$executeRaw`
    UPDATE rides
       SET pickup_label = ${REDACTED_PLACE},
           dropoff_label = ${REDACTED_PLACE},
           pickup_lat = round(pickup_lat::numeric, 2)::float8,
           pickup_lng = round(pickup_lng::numeric, 2)::float8,
           dropoff_lat = round(dropoff_lat::numeric, 2)::float8,
           dropoff_lng = round(dropoff_lng::numeric, 2)::float8,
           polyline = '',
           locations_redacted_at = COALESCE(locations_redacted_at, now())
     WHERE booking_id = ${bookingId}::uuid`;
  await tx.rideLocationPing.deleteMany({ where: { ride: { bookingId } } });
  await tx.rideShareLink.deleteMany({ where: { ride: { bookingId } } });
  await tx.rideRating.updateMany({ where: { ride: { bookingId } }, data: { comment: null } });
  await tx.rentalHandover.updateMany({
    where: { reservation: { bookingItem: { bookingId } } },
    data: { damageNotes: null },
  });
}
