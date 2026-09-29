import type { CabinClass, Money, TravellerCounts } from '@suskii/shared';

import type { SupplierPrice } from '../pricing/pricing-engine';

// Domain shapes owned by Suskii. Adapters translate vendor payloads into these; nothing outside
// `src/suppliers/<vendor>` ever sees a vendor type (PROJECT_SPEC.json#/architecture/key_principles).

export interface AirportPoint {
  code: string;
  name: string | null;
  cityName: string | null;
  countryCode: string | null;
  timeZone: string;
}

export interface Carrier {
  code: string;
  name: string;
}

export interface FlightSegment {
  marketingCarrier: Carrier;
  operatingCarrier: Carrier;
  flightNumber: string;
  origin: AirportPoint;
  destination: AirportPoint;
  /** Local wall time at the origin, "2026-10-01T08:30". */
  departureLocal: string;
  departureUtc: string;
  arrivalLocal: string;
  arrivalUtc: string;
  durationMinutes: number;
  aircraft: string | null;
  cabinClass: CabinClass;
}

export const LAYOVER_WARNINGS = [
  'short_connection',
  'airport_change',
  'overnight',
  'long_layover',
] as const;
export type LayoverWarning = (typeof LAYOVER_WARNINGS)[number];

export interface Layover {
  airport: AirportPoint;
  durationMinutes: number;
  warnings: LayoverWarning[];
}

export interface FlightSlice {
  origin: AirportPoint;
  destination: AirportPoint;
  departureLocal: string;
  departureUtc: string;
  arrivalLocal: string;
  arrivalUtc: string;
  durationMinutes: number;
  stops: number;
  /** Calendar days between local departure and local arrival (+1 overnight arrivals). */
  arrivalDayOffset: number;
  fareBrand: string | null;
  segments: FlightSegment[];
  layovers: Layover[];
}

export interface FareConditions {
  refundable: boolean;
  refundPenalty: Money | null;
  changeable: boolean;
  changePenalty: Money | null;
}

export interface FlightSearchQuery {
  slices: { origin: string; destination: string; departureDate: string }[];
  passengers: TravellerCounts;
  cabinClass: CabinClass;
  /** 0 for direct flights only; null for no limit. */
  maxConnections: number | null;
}

export interface SupplierFlightOffer {
  supplier: string;
  supplierOfferId: string;
  /** The validating carrier. */
  owner: Carrier;
  slices: FlightSlice[];
  /** Per adult, lowest across slices. */
  baggage: { carryOn: number; checked: number };
  conditions: FareConditions;
  cabinClass: CabinClass;
  passengers: TravellerCounts;
  /** Total for all passengers, in the supplier's currency. */
  price: SupplierPrice;
  expiresAt: string;
  hold: { available: boolean; paymentRequiredBy: string | null };
}

export interface HotelSearchQuery {
  city: {
    id: string;
    name: string;
    countryCode: string;
    latitude: number | null;
    longitude: number | null;
    timeZone: string | null;
  };
  checkIn: string;
  checkOut: string;
  rooms: { adults: number; childAges: number[] }[];
  freeCancellationOnly: boolean;
}

export type BoardType = 'room_only' | 'breakfast_included' | 'half_board' | 'full_board';

export interface SupplierHotelRate {
  supplierRateId: string;
  roomName: string;
  board: BoardType;
  refundable: boolean;
  /** Free cancellation until this instant (UTC), when refundable. */
  freeCancellationUntil: string | null;
  /** Total for the whole stay and every room, in the supplier's currency. */
  price: SupplierPrice;
  /** Charged by the property on arrival, not included in the price (e.g. city tax). */
  payAtProperty: Money | null;
  expiresAt: string;
}

export interface SupplierHotel {
  supplier: string;
  supplierHotelId: string;
  name: string;
  stars: number;
  reviewScore: number | null;
  reviewCount: number;
  latitude: number;
  longitude: number;
  area: string | null;
  cityName: string;
  countryCode: string;
  amenities: string[];
  rates: SupplierHotelRate[];
}

/**
 * Flight supplier adapter (Mock, Duffel; Amadeus or a GDS/consolidator can plug in later).
 * Implementations must honour `signal` and throw `SupplierError` subclasses.
 */
export abstract class FlightSupplier {
  abstract readonly name: string;
  abstract search(query: FlightSearchQuery, signal: AbortSignal): Promise<SupplierFlightOffer[]>;
  /** Confirms the current price and availability of an offer this supplier returned. */
  abstract reprice(offer: SupplierFlightOffer, signal: AbortSignal): Promise<SupplierFlightOffer>;
}

export abstract class HotelSupplier {
  abstract readonly name: string;
  abstract search(query: HotelSearchQuery, signal: AbortSignal): Promise<SupplierHotel[]>;
  abstract reprice(
    hotel: SupplierHotel,
    rate: SupplierHotelRate,
    query: HotelSearchQuery,
    signal: AbortSignal,
  ): Promise<SupplierHotelRate>;
}
