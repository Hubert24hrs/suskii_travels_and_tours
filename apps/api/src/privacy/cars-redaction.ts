import { fromJsonValue, toJsonValue } from '../common/json';
import type { Prisma } from '../generated/prisma/client';

type Tx = Prisma.TransactionClient;

export const REDACTED_PLACE = 'Redacted';

/**
 * Personal data on a booking's Cars records (ADR-029, ADR-053), cleared when the booking is
 * redacted (account deletion) or anonymised (retention): ride places are renamed, coordinates
 * rounded to about 1 km and the route dropped; rating comments and handover notes are cleared;
 * a rental's delivery address and licence go and its handover photos are destroyed. Fares,
 * seats, statuses, odometer readings and stars stay as the financial and safety record. Returns
 * the storage keys to delete after the commit.
 */
interface Point {
  label: string;
  lat: number;
  lng: number;
}
const round2 = (value: number): number => Math.round(value * 100) / 100;
const coarse = <T extends Point>(point: T): T => ({
  ...point,
  label: REDACTED_PLACE,
  lat: round2(point.lat),
  lng: round2(point.lng),
});

/** Ride places and a rental's delivery address in a snapshot, coarsened; null for other kinds. */
function redactSnapshot(raw: unknown): unknown {
  const payload = fromJsonValue<Record<string, unknown>>(raw);
  const request = payload.request as Record<string, unknown> | undefined;
  if (payload.kind === 'ride') {
    for (const target of [payload, request]) {
      if (!target) continue;
      for (const key of ['pickup', 'dropoff'] as const) {
        if (target[key]) target[key] = coarse(target[key] as Point);
      }
    }
    payload.polyline = '';
  } else if (payload.kind === 'rental') {
    for (const target of [payload, request]) {
      if (target?.delivery) target.delivery = coarse(target.delivery as Point);
    }
  } else {
    return null;
  }
  return toJsonValue(payload);
}

/**
 * The item and quote snapshots of a ride or rental keep the places the customer typed; they are
 * coarsened with the rest of the booking (fares and distances stay).
 */
async function redactPlacesInSnapshots(tx: Tx, bookingId: string): Promise<void> {
  const items = await tx.bookingItem.findMany({
    where: { bookingId, type: { in: ['ride', 'rental'] } },
    select: { id: true, payload: true, offerId: true },
  });
  for (const item of items) {
    const redacted = redactSnapshot(item.payload);
    if (redacted === null) continue;
    await tx.bookingItem.update({
      where: { id: item.id },
      data: { payload: redacted as Prisma.InputJsonValue },
    });
    const offer = await tx.offer.findUnique({
      where: { id: item.offerId },
      select: { payload: true },
    });
    const quoted = offer ? redactSnapshot(offer.payload) : null;
    if (quoted !== null) {
      await tx.offer.update({
        where: { id: item.offerId },
        data: { payload: quoted as Prisma.InputJsonValue },
      });
    }
  }
}

export async function redactCarsBooking(tx: Tx, bookingId: string): Promise<string[]> {
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
  const rental = { reservation: { bookingItem: { bookingId } } };
  await tx.rentalHandover.updateMany({ where: rental, data: { damageNotes: null } });
  await redactPlacesInSnapshots(tx, bookingId);
  const licences = await tx.rentalLicence.findMany({ where: rental, select: { storageKey: true } });
  await tx.rentalLicence.deleteMany({ where: rental });
  const photos = await tx.rentalHandoverPhoto.findMany({
    where: { ...rental, deletedAt: null },
    select: { storageKey: true },
  });
  await tx.rentalHandoverPhoto.updateMany({
    where: { ...rental, deletedAt: null },
    data: { storageKey: null, wrappedKey: '', deletedAt: new Date() },
  });
  return [...licences, ...photos].flatMap((row) => (row.storageKey ? [row.storageKey] : []));
}
