import type { z } from 'zod';

import { money, toWire, utcToLocal } from '@suskii/shared';

import { documentDateTime } from '../documents/booking-pdf';

import type { ItemPayload } from './booking-pricing';
import type {
  addonItemSchema,
  busItemSchema,
  rideItemSchema,
  rentalItemSchema,
  membershipItemSchema,
  packageItemSchema,
  tourItemSchema,
  visaApplicationSummarySchema,
  visaItemSchema,
} from './bookings.schemas';
import type { InhouseItemPayload } from './inhouse-items';
import type { RentalReservationDto } from './rental-views';

export type PackageItemDto = z.infer<typeof packageItemSchema>;
export type TourItemDto = z.infer<typeof tourItemSchema>;
export type VisaItemDto = z.infer<typeof visaItemSchema>;
export type AddonItemDto = z.infer<typeof addonItemSchema>;
export type VisaApplicationSummaryDto = z.infer<typeof visaApplicationSummarySchema>;
export type MembershipItemDto = z.infer<typeof membershipItemSchema>;
export type BusItemDto = z.infer<typeof busItemSchema>;
export type RideItemDto = z.infer<typeof rideItemSchema>;
export type RentalItemDto = z.infer<typeof rentalItemSchema>;

export interface InhouseSections {
  package: PackageItemDto | null;
  tour: TourItemDto | null;
  visa: VisaItemDto | null;
  addon: AddonItemDto | null;
  membership: MembershipItemDto | null;
  bus: BusItemDto | null;
  ride: RideItemDto | null;
  rental: RentalItemDto | null;
}

export const NO_INHOUSE: InhouseSections = {
  package: null,
  tour: null,
  visa: null,
  addon: null,
  membership: null,
  bus: null,
  ride: null,
  rental: null,
};

const product = (payload: InhouseItemPayload) => ({
  id: payload.productId,
  slug: payload.slug,
  title: payload.title,
  sample: payload.sample,
  artKey: payload.artKey,
});

const counts = (payload: InhouseItemPayload) => ({
  adults: payload.travellers.adults,
  children: payload.travellers.children,
  infants: payload.travellers.infants,
});

/** The customer view of an in-house item, shared by quotes and bookings. */
export function inhouseSections(
  payload: ItemPayload,
  context: {
    applications?: VisaApplicationSummaryDto[];
    linkedBooking?: { id: string; reference: string } | null;
    membershipTerm?: { startsAt: Date; endsAt: Date } | null;
    rideId?: string | null;
    rental?: RentalReservationDto | null;
  } = {},
): InhouseSections {
  switch (payload.kind) {
    case 'package':
      return {
        ...NO_INHOUSE,
        package: {
          product: product(payload),
          departureId: payload.departureId,
          cityName: payload.cityName,
          countryCode: payload.countryCode,
          nights: payload.nights,
          startDate: payload.startDate,
          endDate: payload.endDate,
          passportRequired: payload.passportRequired,
          inclusions: payload.inclusions,
          travellers: counts(payload),
          cancellationPolicy: payload.cancellationPolicy,
        },
      };
    case 'tour':
      return {
        ...NO_INHOUSE,
        tour: {
          product: product(payload),
          departureId: payload.departureId,
          cityName: payload.cityName,
          countryCode: payload.countryCode,
          timeZone: payload.timeZone,
          startsAtLocal: payload.startsAtLocal,
          startsAt: payload.startsAtUtc,
          durationMinutes: payload.durationMinutes,
          meetingPoint: payload.meetingPoint,
          inclusions: payload.inclusions,
          travellers: counts(payload),
          cancellationPolicy: payload.cancellationPolicy,
        },
      };
    case 'visa':
      return {
        ...NO_INHOUSE,
        visa: {
          product: product(payload),
          destination: payload.destination,
          purpose: payload.purpose,
          nationality: payload.nationality,
          travelDate: payload.travelDate,
          processingDaysMin: payload.processingDaysMin,
          processingDaysMax: payload.processingDaysMax,
          governmentFeeNote: payload.governmentFeeNote,
          travellers: counts(payload),
          applications: context.applications ?? [],
        },
      };
    case 'addon':
      return {
        ...NO_INHOUSE,
        addon: {
          product: product(payload),
          type: payload.type,
          pricingBasis: payload.pricingBasis,
          units: payload.units,
          startDate: payload.startDate,
          endDate: payload.endDate,
          countryCode: payload.countryCode,
          cityName: payload.cityName,
          travellers: counts(payload),
          requiredDetails: payload.requiredDetails,
          cancellationPolicy: payload.cancellationPolicy,
          linkedBooking:
            context.linkedBooking ??
            (payload.linkedBookingId && payload.linkedReference
              ? { id: payload.linkedBookingId, reference: payload.linkedReference }
              : null),
        },
      };
    case 'membership':
      return {
        ...NO_INHOUSE,
        membership: {
          product: product(payload),
          summary: payload.summary,
          period: payload.period,
          benefits: {
            memberFares: payload.benefits.markupShareBps > 0,
            waivedFeeCodes: payload.benefits.waivedFeeCodes,
            prioritySupport: payload.benefits.prioritySupport,
          },
          term: context.membershipTerm
            ? {
                startsAt: context.membershipTerm.startsAt.toISOString(),
                endsAt: context.membershipTerm.endsAt.toISOString(),
              }
            : null,
        },
      };
    case 'bus':
      return {
        ...NO_INHOUSE,
        bus: {
          product: product(payload),
          operatorName: payload.operatorName,
          tripId: payload.tripId,
          origin: payload.origin,
          destination: payload.destination,
          timeZone: payload.timeZone,
          departsAtLocal: payload.departsAtLocal,
          departsAt: payload.departsAtUtc,
          arrivesAt: payload.arrivesAtUtc,
          seats: payload.seats,
          amenities: payload.amenities,
          travellers: counts(payload),
          cancellationPolicy: payload.cancellationPolicy,
          holdExpiresAt: payload.holdExpiresAt,
        },
      };
    case 'ride':
      return {
        ...NO_INHOUSE,
        ride: {
          product: product(payload),
          category: payload.category,
          cityName: payload.cityName,
          pickup: payload.pickup,
          dropoff: payload.dropoff,
          scheduledFor: payload.scheduledFor,
          distanceMetres: payload.distanceMetres,
          durationSeconds: payload.durationSeconds,
          polyline: payload.polyline,
          estimate: payload.estimate,
          fare: {
            base: toWire(payload.fare.base),
            distance: toWire(payload.fare.distance),
            time: toWire(payload.fare.time),
            surge: toWire(payload.fare.surge),
            minimumTopUp: toWire(payload.fare.minimumTopUp),
            bookingFee: toWire(payload.fare.bookingFee),
            total: toWire(payload.fare.total),
          },
          cancellation: {
            fee: toWire(money(payload.rule.cancellationFeeMinor, payload.rule.currency)),
            freeCancelSeconds: payload.rule.freeCancelSeconds,
            waitGraceSeconds: payload.rule.waitGraceSeconds,
          },
          rideId: context.rideId ?? null,
        },
      };
    case 'rental':
      return {
        ...NO_INHOUSE,
        rental: {
          product: product(payload),
          vehicle: payload.vehicle,
          branch: payload.branch,
          cityName: payload.cityName,
          timeZone: payload.timeZone,
          pickupAtLocal: payload.pickupAtLocal,
          returnAtLocal: payload.returnAtLocal,
          days: payload.days,
          chauffeur: payload.chauffeur,
          delivery: payload.delivery,
          charge: {
            vehicle: toWire(payload.charge.vehicle),
            chauffeur: toWire(payload.charge.chauffeur),
            delivery: toWire(payload.charge.delivery),
            deposit: toWire(payload.charge.deposit),
          },
          mileage: {
            kmPerDay: payload.mileage.kmPerDay,
            excessKm: payload.mileage.excessKm ? toWire(payload.mileage.excessKm) : null,
          },
          fuelPolicy: payload.fuelPolicy as 'full_to_full' | 'same_to_same',
          insuranceSummary: payload.insuranceSummary,
          reservation: context.rental ?? null,
        },
      };
    case 'flight':
    case 'hotel':
      return NO_INHOUSE;
  }
}

/** One line for emails and push messages: "Lagos city tour, Sat, 12 Dec 2026 09:00". */
export function inhouseSummary(payload: InhouseItemPayload): string {
  switch (payload.kind) {
    case 'package':
    case 'addon':
      return `${payload.title}, ${documentDateTime(payload.startDate)} to ${documentDateTime(payload.endDate)}`;
    case 'tour':
      return `${payload.title}, ${documentDateTime(payload.startsAtLocal)}`;
    case 'visa':
      return `${payload.title}, travelling ${documentDateTime(payload.travelDate)}`;
    case 'membership':
      return `${payload.title} (${payload.period === 'year' ? 'yearly' : 'monthly'} membership)`;
    case 'bus':
      return `${payload.title}, ${documentDateTime(payload.departsAtLocal)}, seats ${payload.seats.join(', ')}`;
    case 'rental':
      return `${payload.title}, ${documentDateTime(payload.pickupAtLocal)} to ${documentDateTime(payload.returnAtLocal)}`;
    case 'ride':
      return `${payload.title}${payload.scheduledFor ? `, ${documentDateTime(utcToLocal(new Date(payload.scheduledFor), payload.timeZone))}` : ''}`;
  }
}
