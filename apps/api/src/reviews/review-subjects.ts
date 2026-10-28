import type { ReviewSubjectKind, ReviewableItemKind } from '@suskii/shared';

import { isInhouse, type ItemPayload } from '../bookings/booking-pricing';
import type { Prisma, ReviewSubject } from '../generated/prisma/client';
import { hotelNameKey, metresBetween, SAME_HOTEL_METRES } from '../search/results';

/** What a booking item's review is about, before it is stored (ADR-077). */
export type SubjectRef =
  | {
      kind: 'hotel';
      name: string;
      nameKey: string;
      latitude: number;
      longitude: number;
    }
  | { kind: Exclude<ReviewSubjectKind, 'hotel' | 'bus_operator'>; refId: string; name: string }
  /** The operator is found through the trip: bus payloads carry the trip, not the operator. */
  | { kind: 'bus_operator'; tripId: string; name: string };

/** The reviewable kind of a booking item, or null (flights, visas, add-ons, rides, memberships). */
export function reviewableKind(payload: ItemPayload): ReviewableItemKind | null {
  switch (payload.kind) {
    case 'hotel':
    case 'package':
    case 'tour':
    case 'bus':
    case 'rental':
      return payload.kind;
    case 'flight':
    case 'visa':
    case 'addon':
    case 'membership':
    case 'ride':
      return null;
  }
}

/** The subject a review of this item attaches to; null when the item cannot be reviewed. */
export function subjectRefOf(payload: ItemPayload): SubjectRef | null {
  if (payload.kind === 'hotel') {
    const nameKey = hotelNameKey(payload.hotel.name);
    if (!nameKey) return null;
    return {
      kind: 'hotel',
      name: payload.hotel.name,
      nameKey,
      latitude: payload.hotel.latitude,
      longitude: payload.hotel.longitude,
    };
  }
  if (!isInhouse(payload)) return null;
  switch (payload.kind) {
    case 'package':
      return { kind: 'package', refId: payload.productId, name: payload.title };
    case 'tour':
      return { kind: 'tour', refId: payload.productId, name: payload.title };
    case 'rental':
      return { kind: 'rental_vehicle', refId: payload.vehicleId, name: payload.title };
    case 'bus':
      return { kind: 'bus_operator', tripId: payload.tripId, name: payload.operatorName };
    case 'visa':
    case 'addon':
    case 'membership':
    case 'ride':
      return null;
  }
}

/** The name shown in "How was {name}?" for a reviewable item. */
export function reviewName(payload: ItemPayload): string {
  return subjectRefOf(payload)?.name ?? '';
}

/**
 * The stored subject for a reference, created on first use. Hotels match by normalised name
 * within 250 m, the rule search uses to merge duplicate hotels, under an advisory lock so two
 * first reviews of one hotel cannot create two subjects.
 */
export async function findOrCreateSubject(
  tx: Prisma.TransactionClient,
  ref: SubjectRef,
): Promise<ReviewSubject> {
  if (ref.kind === 'hotel') {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`review-hotel:${ref.nameKey}`}))`;
    const candidates = await tx.reviewSubject.findMany({
      where: { kind: 'hotel', nameKey: ref.nameKey },
    });
    const match = candidates.find(
      (subject) =>
        subject.latitude !== null &&
        subject.longitude !== null &&
        metresBetween(
          { latitude: subject.latitude, longitude: subject.longitude },
          { latitude: ref.latitude, longitude: ref.longitude },
        ) <= SAME_HOTEL_METRES,
    );
    if (match) return match;
    return tx.reviewSubject.create({
      data: {
        kind: 'hotel',
        name: ref.name,
        nameKey: ref.nameKey,
        latitude: ref.latitude,
        longitude: ref.longitude,
      },
    });
  }
  let refId: string;
  let name = ref.name;
  if (ref.kind === 'bus_operator') {
    const trip = await tx.busTrip.findUnique({
      where: { id: ref.tripId },
      select: { route: { select: { operator: { select: { id: true, name: true } } } } },
    });
    if (!trip) throw new Error('The bus trip of a reviewable item no longer exists');
    refId = trip.route.operator.id;
    name = trip.route.operator.name;
  } else {
    refId = ref.refId;
  }
  return tx.reviewSubject.upsert({
    where: { kind_refId: { kind: ref.kind, refId } },
    create: { kind: ref.kind, refId, name },
    update: { name },
  });
}
