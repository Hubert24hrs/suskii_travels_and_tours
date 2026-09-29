import type {
  CabinClass,
  Gender,
  Money,
  PassengerTitle,
  PassengerType,
  TravellerCounts,
} from '@suskii/shared';

import type { SupplierPrice } from '../pricing/pricing-engine';

import { SupplierRequestError } from './supplier.errors';

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

/** An extra the supplier sells with the offer, e.g. a checked bag for the whole trip. */
export interface FlightService {
  id: string;
  type: 'checked_bag';
  weightKg: number;
  /** Per passenger (infants cannot take extra bags). */
  maxQuantity: number;
  /** Per unit, in the supplier's currency. */
  price: Money;
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
  /**
   * Whether the airline can reserve this offer unpaid (Duffel `pay_later`), until when, and until
   * when it guarantees the price of the held order (ADR-018).
   */
  hold: {
    available: boolean;
    paymentRequiredBy: string | null;
    priceGuaranteedUntil: string | null;
  };
  /** Extras bookable with this offer; empty when the supplier returns none. */
  services: FlightService[];
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

export interface SupplierPassenger {
  type: PassengerType;
  title: PassengerTitle;
  gender: Gender;
  /** Passport (machine-readable) form. */
  givenNames: string;
  surname: string;
  dateOfBirth: string;
  nationality: string;
  document: { number: string; issuingCountry: string; expiryDate: string } | null;
}

export interface SupplierContact {
  email: string;
  phone: string;
}

export interface FlightBookingRequest {
  offer: SupplierFlightOffer;
  /** In the offer's order: adults, then children, then infants. */
  passengers: SupplierPassenger[];
  contact: SupplierContact;
  services: { serviceId: string; passengerIndex: number; quantity: number }[];
  /** Stable per booking item: repeating a request with it never books twice. */
  idempotencyKey: string;
}

export interface FlightBookingResult {
  /** Airline booking reference (PNR). */
  supplierReference: string;
  tickets: { passengerIndex: number; number: string }[];
}

export interface FlightHoldRequest {
  offer: SupplierFlightOffer;
  passengers: SupplierPassenger[];
  contact: SupplierContact;
  /** Stable per booking item: repeating a request with it never holds twice. */
  idempotencyKey: string;
}

/** An unpaid order the airline keeps until `paymentRequiredBy` (ADR-018). */
export interface FlightHold {
  orderId: string;
  /** Airline booking reference (PNR), known once the space is held. */
  supplierReference: string;
  paymentRequiredBy: string;
  priceGuaranteedUntil: string | null;
  /** Total of the held order, in the supplier's currency. */
  price: SupplierPrice;
}

export interface HeldOrder {
  awaitingPayment: boolean;
  paymentRequiredBy: string | null;
  priceGuaranteedUntil: string | null;
  /** Current total: may differ from the held price once the guarantee has lapsed. */
  price: SupplierPrice;
}

export interface PayHeldRequest {
  orderId: string;
  /** The supplier total the traveller paid for; a different current total is refused. */
  price: SupplierPrice;
  /** Idempotency key (the booking item id). */
  idempotencyKey: string;
}

export interface HotelBookingRequest {
  hotel: SupplierHotel;
  rate: SupplierHotelRate;
  query: HotelSearchQuery;
  /** Lead guest per room. */
  guests: { givenNames: string; surname: string }[];
  contact: SupplierContact;
  idempotencyKey: string;
}

export interface HotelBookingResult {
  confirmationNumber: string;
}

/**
 * Flight supplier adapter (Mock, Duffel; Amadeus or a GDS/consolidator can plug in later).
 * Implementations must honour `signal` and throw `SupplierError` subclasses.
 */
export abstract class FlightSupplier {
  abstract readonly name: string;
  /**
   * Whether repeating `book()` with the same idempotency key is safe after an ambiguous failure
   * (timeout). When false, such failures go to manual review instead of an automatic retry.
   */
  abstract readonly idempotentBooking: boolean;
  abstract search(query: FlightSearchQuery, signal: AbortSignal): Promise<SupplierFlightOffer[]>;
  /** Confirms the current price and availability of an offer this supplier returned. */
  abstract reprice(offer: SupplierFlightOffer, signal: AbortSignal): Promise<SupplierFlightOffer>;
  /** Books and tickets a paid offer. Must be idempotent by `request.idempotencyKey`. */
  abstract book(request: FlightBookingRequest, signal: AbortSignal): Promise<FlightBookingResult>;

  /** Reserves an offer unpaid (only when `offer.hold.available`). */
  hold(_request: FlightHoldRequest, _signal: AbortSignal): Promise<FlightHold> {
    return Promise.reject(new SupplierRequestError(this.name, 'Holds are not supported'));
  }

  /** The current state of a held order, including its latest price. */
  heldOrder(_orderId: string, _signal: AbortSignal): Promise<HeldOrder> {
    return Promise.reject(new SupplierRequestError(this.name, 'Holds are not supported'));
  }

  /** Pays a held order and tickets it. Must be idempotent by `request.idempotencyKey`. */
  payHeld(_request: PayHeldRequest, _signal: AbortSignal): Promise<FlightBookingResult> {
    return Promise.reject(new SupplierRequestError(this.name, 'Holds are not supported'));
  }

  /** Releases a held order (unpaid holds cancel free of charge). */
  cancelHold(_orderId: string, _signal: AbortSignal): Promise<void> {
    return Promise.reject(new SupplierRequestError(this.name, 'Holds are not supported'));
  }
}

export abstract class HotelSupplier {
  abstract readonly name: string;
  /** See `FlightSupplier.idempotentBooking`. */
  abstract readonly idempotentBooking: boolean;
  abstract search(query: HotelSearchQuery, signal: AbortSignal): Promise<SupplierHotel[]>;
  abstract reprice(
    hotel: SupplierHotel,
    rate: SupplierHotelRate,
    query: HotelSearchQuery,
    signal: AbortSignal,
  ): Promise<SupplierHotelRate>;
  /** Confirms a paid stay. Must be idempotent by `request.idempotencyKey`. */
  abstract book(request: HotelBookingRequest, signal: AbortSignal): Promise<HotelBookingResult>;
}
