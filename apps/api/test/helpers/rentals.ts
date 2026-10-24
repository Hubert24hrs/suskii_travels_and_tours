import { utcToLocal } from '@suskii/shared';

import { book, nextKey, payInFull } from './cars';
import type { TestContext } from './test-app';

/** Helpers for the rental suite (ADR-051). */

export const LAGOS_ZONE = 'Africa/Lagos';
export const IKEJA_BRANCH = { lat: 6.6018, lng: 3.3515 };

/** Branch local time `hours` from now, on a whole minute. */
export const localIn = (hours: number): string =>
  utcToLocal(new Date(Date.now() + hours * 3_600_000), LAGOS_ZONE);

export const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('CONDITION-PHOTO'),
]);

export interface VehicleOptions {
  chauffeurDailyMinor?: number | null;
  depositMinor?: number;
  deliveryPerKmMinor?: number | null;
}

/** A published car at the Ikeja branch, through the admin API. */
export async function rentalVehicle(
  ctx: TestContext,
  staff: Record<string, string>,
  options: VehicleOptions = {},
): Promise<{ id: string; slug: string }> {
  const slug = nextKey('corolla').toLowerCase();
  const created = await ctx
    .http()
    .post('/v1/admin/rentals/vehicles')
    .set(staff)
    .send({
      slug,
      make: 'Toyota',
      model: 'Corolla',
      year: 2021,
      category: 'economy',
      transmission: 'automatic',
      seats: 5,
      plate: `LND-${slug
        .slice(-3)
        .replace(/[^a-z0-9]/g, '1')
        .toUpperCase()}-${String(Date.now()).slice(-2)}`,
      features: ['air_conditioning'],
      cityName: 'Lagos',
      branchName: 'Ikeja branch',
      branchAddress: '1 Obafemi Awolowo Way, Ikeja',
      lat: IKEJA_BRANCH.lat,
      lng: IKEJA_BRANCH.lng,
      timeZone: LAGOS_ZONE,
      currency: 'NGN',
      dailyMinor: 4_500_000,
      chauffeurDailyMinor:
        options.chauffeurDailyMinor === undefined ? 1_500_000 : options.chauffeurDailyMinor,
      depositMinor: options.depositMinor ?? 10_000_000,
      deliveryPerKmMinor:
        options.deliveryPerKmMinor === undefined ? 50_000 : options.deliveryPerKmMinor,
      deliveryMaxKm: 25,
      mileageKmPerDay: 200,
      excessKmMinor: 15_000,
      fuelPolicy: 'full_to_full',
      insuranceSummary: 'Third party and theft.',
      cancellationPolicy: [
        { daysBefore: 3, refundBps: 10_000 },
        { daysBefore: 1, refundBps: 5_000 },
        { daysBefore: 0, refundBps: 0 },
      ],
    })
    .expect(201);
  const id = created.body.id as string;
  await ctx
    .http()
    .patch(`/v1/admin/rentals/vehicles/${id}`)
    .set(staff)
    .send({ status: 'published' })
    .expect(204);
  return { id, slug };
}

export function rentalQuote(
  ctx: TestContext,
  renter: Record<string, string>,
  body: {
    vehicleId: string;
    pickupAtLocal: string;
    returnAtLocal: string;
    chauffeur?: boolean;
    delivery?: unknown;
    currency?: string;
  },
) {
  return ctx
    .http()
    .post('/v1/inhouse-quotes')
    .set(renter)
    .send({ kind: 'rental', chauffeur: false, delivery: null, ...body });
}

export function bookRental(ctx: TestContext, renter: Record<string, string>, quoteId: string) {
  return book(ctx, { quoteId, guests: [{ givenNames: 'Ngozi', surname: 'Eze' }] }, renter);
}

/** Quotes, books and pays a rental; returns the booking and its reservation. */
export async function paidRental(
  ctx: TestContext,
  renter: Record<string, string>,
  body: Parameters<typeof rentalQuote>[2],
): Promise<{ bookingId: string; reservationId: string; booking: Record<string, unknown> }> {
  const quote = await rentalQuote(ctx, renter, body).expect(201);
  const created = await bookRental(ctx, renter, quote.body.quoteId as string).expect(201);
  const bookingId = created.body.booking.id as string;
  const booking = await payInFull(ctx, bookingId, renter);
  const rental = booking.rental as { reservation: { id: string } | null } | null;
  if (!rental?.reservation) throw new Error(`booking ${bookingId} has no reservation`);
  return { bookingId, reservationId: rental.reservation.id, booking };
}
