import type { Schemas } from '@suskii/api-client';

import { readJson, secureCache, writeJson } from './cache';
import { secureStorage } from './secure-storage';

export type Booking = Schemas['Booking'];
export type BookingSummary = Schemas['BookingSummary'];

const DEVICE_TRIPS = 'trips.device';
const ACCOUNT_TRIPS = 'trips.account';
const bookingKey = (id: string): string => `booking.${id}`;

export interface CachedBooking {
  booking: Booking;
  /** When this copy was fetched (ISO), shown when the app is offline. */
  savedAt: string;
}

/**
 * Trips kept on the device (ADR-020): guest bookings made here (their access token lives in the
 * secure store), the account's trip list, and a copy of each opened booking for offline use.
 */
export const tripStore = {
  deviceTripIds(): string[] {
    return readJson<string[]>(secureCache(), DEVICE_TRIPS) ?? [];
  },

  async addGuestTrip(bookingId: string, token: string): Promise<void> {
    await secureStorage.saveBookingToken(bookingId, token);
    const ids = tripStore.deviceTripIds();
    if (!ids.includes(bookingId)) writeJson(secureCache(), DEVICE_TRIPS, [bookingId, ...ids]);
  },

  /** Removes a trip and everything kept for it on this device (not the booking itself). */
  async forget(bookingId: string): Promise<void> {
    writeJson(
      secureCache(),
      DEVICE_TRIPS,
      tripStore.deviceTripIds().filter((id) => id !== bookingId),
    );
    secureCache().remove(bookingKey(bookingId));
    await secureStorage.removeBookingToken(bookingId);
  },

  bookingHeaders: async (bookingId: string): Promise<Record<string, string>> => {
    const token = await secureStorage.bookingToken(bookingId);
    return token ? { 'X-Booking-Token': token } : {};
  },

  cachedBooking(bookingId: string): CachedBooking | null {
    return readJson<CachedBooking>(secureCache(), bookingKey(bookingId));
  },

  saveBooking(booking: Booking, now = new Date()): void {
    writeJson(secureCache(), bookingKey(booking.id), {
      booking,
      savedAt: now.toISOString(),
    } satisfies CachedBooking);
  },

  accountTrips(): BookingSummary[] {
    return readJson<BookingSummary[]>(secureCache(), ACCOUNT_TRIPS) ?? [];
  },

  saveAccountTrips(trips: BookingSummary[]): void {
    writeJson(secureCache(), ACCOUNT_TRIPS, trips);
  },

  /** On sign-out: the account's list and the copies of its bookings go; guest trips stay. */
  forgetAccount(): void {
    const guest = new Set(tripStore.deviceTripIds());
    for (const trip of tripStore.accountTrips()) {
      if (!guest.has(trip.id)) secureCache().remove(bookingKey(trip.id));
    }
    secureCache().remove(ACCOUNT_TRIPS);
  },
};

/** A summary for a guest booking known only by its full record. */
export function summaryOf(booking: Booking): BookingSummary {
  const flight = booking.flight;
  const first = flight?.slices[0];
  const last = flight?.slices.at(-1);
  const roundTrip =
    flight?.slices.length === 2 &&
    flight.slices[1]?.origin.code === first?.destination.code &&
    flight.slices[1]?.destination.code === first?.origin.code;
  return {
    id: booking.id,
    reference: booking.reference,
    status: booking.status,
    vertical: booking.vertical,
    createdAt: booking.createdAt,
    total: booking.price.total,
    startsOn: first ? first.departureLocal.slice(0, 10) : (booking.hotel?.checkIn ?? ''),
    endsOn:
      flight && flight.slices.length > 1 && last
        ? last.departureLocal.slice(0, 10)
        : (booking.hotel?.checkOut ?? null),
    flight:
      flight && first && last
        ? {
            tripType:
              flight.slices.length === 1 ? 'one_way' : roundTrip ? 'round_trip' : 'multi_city',
            origin: { code: first.origin.code, cityName: first.origin.cityName ?? null },
            destination: roundTrip
              ? { code: first.destination.code, cityName: first.destination.cityName ?? null }
              : { code: last.destination.code, cityName: last.destination.cityName ?? null },
            airline: flight.owner.name,
          }
        : null,
    hotel: booking.hotel ? { name: booking.hotel.name, cityName: booking.hotel.cityName } : null,
  };
}
