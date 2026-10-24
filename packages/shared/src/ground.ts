import { add, minOf, money, multiply, multiplyRatio, sum, zero, type Money } from './money';

/**
 * Cars: interstate buses, intrastate rides and car rental (ADR-049 to ADR-053). Zod-free, so
 * client code can use it through `lite`. Coordinates are measurements, not money: they are plain
 * numbers (degrees), checked against a bounding box at the boundary.
 */

export const CARS_PRODUCTS = ['buses', 'rides', 'rentals'] as const;
export type CarsProduct = (typeof CARS_PRODUCTS)[number];

// ---------------------------------------------------------------------------
// Geography (ADR-053)
// ---------------------------------------------------------------------------

export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface GeoBounds {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

/** Nigeria with a small margin (Badagry to Lake Chad, the Niger Delta to the Sahel). */
export const NIGERIA_BOUNDS: GeoBounds = { minLat: 4.0, maxLat: 14.0, minLng: 2.6, maxLng: 14.8 };

/** ECOWAS member states and their islands, for `CARS_WEST_AFRICA_ENABLED`. */
export const WEST_AFRICA_BOUNDS: GeoBounds = {
  minLat: 4.0,
  maxLat: 25.0,
  minLng: -25.5,
  maxLng: 16.0,
};

export const withinBounds = (point: GeoPoint, bounds: GeoBounds): boolean =>
  Number.isFinite(point.lat) &&
  Number.isFinite(point.lng) &&
  point.lat >= bounds.minLat &&
  point.lat <= bounds.maxLat &&
  point.lng >= bounds.minLng &&
  point.lng <= bounds.maxLng;

const EARTH_RADIUS_METRES = 6_371_008.8;
const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

/** Great-circle distance in metres (haversine; about 0.5% from the ellipsoid). */
export function haversineMetres(a: GeoPoint, b: GeoPoint): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(a.lat)) * Math.cos(toRadians(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METRES * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Shortest distance in metres from `point` to a route, on a local equirectangular projection
 * centred on the point: accurate to well under a metre at city scale (ADR-053). An empty route is
 * infinitely far; a single point is a distance to that point.
 */
export function distanceToRouteMetres(point: GeoPoint, route: readonly GeoPoint[]): number {
  const first = route[0];
  if (!first) return Number.POSITIVE_INFINITY;
  if (route.length === 1) return haversineMetres(point, first);
  const cosLat = Math.cos(toRadians(point.lat));
  const project = (p: GeoPoint): { x: number; y: number } => ({
    x: toRadians(p.lng - point.lng) * cosLat * EARTH_RADIUS_METRES,
    y: toRadians(p.lat - point.lat) * EARTH_RADIUS_METRES,
  });
  let best = Number.POSITIVE_INFINITY;
  for (let index = 1; index < route.length; index += 1) {
    const a = project(route[index - 1] ?? first);
    const b = project(route[index] ?? first);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSquared = dx * dx + dy * dy;
    // Projection of the origin (the point) on the segment, clamped to its ends.
    const t =
      lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, -(a.x * dx + a.y * dy) / lengthSquared));
    best = Math.min(best, Math.hypot(a.x + t * dx, a.y + t * dy));
  }
  return best;
}

/** A position rounded to `decimals` places: 3 is about 110 m, what non-staff viewers get. */
export function roundPoint(point: GeoPoint, decimals = 3): GeoPoint {
  const factor = 10 ** decimals;
  return {
    lat: Math.round(point.lat * factor) / factor,
    lng: Math.round(point.lng * factor) / factor,
  };
}

/** Encodes a route with the polyline algorithm (precision 5, about 1 m). */
export function encodePolyline(points: readonly GeoPoint[]): string {
  let lastLat = 0;
  let lastLng = 0;
  let out = '';
  const encode = (value: number): string => {
    let v = value < 0 ? ~(value << 1) : value << 1;
    let chunk = '';
    while (v >= 0x20) {
      chunk += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
      v >>= 5;
    }
    return chunk + String.fromCharCode(v + 63);
  };
  for (const point of points) {
    const lat = Math.round(point.lat * 1e5);
    const lng = Math.round(point.lng * 1e5);
    out += encode(lat - lastLat) + encode(lng - lastLng);
    lastLat = lat;
    lastLng = lng;
  }
  return out;
}

/** Decodes a polyline; throws `RangeError` on a malformed string. */
export function decodePolyline(encoded: string): GeoPoint[] {
  const points: GeoPoint[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  const next = (): number => {
    let result = 0;
    let shift = 0;
    for (;;) {
      if (index >= encoded.length) throw new RangeError('Truncated polyline');
      const byte = encoded.charCodeAt(index) - 63;
      index += 1;
      if (byte < 0 || byte > 0x3f) throw new RangeError('Invalid polyline character');
      result |= (byte & 0x1f) << shift;
      shift += 5;
      if (byte < 0x20) break;
      if (shift > 30) throw new RangeError('Polyline value too large');
    }
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (index < encoded.length) {
    lat += next();
    lng += next();
    points.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return points;
}

// ---------------------------------------------------------------------------
// Buses (ADR-051)
// ---------------------------------------------------------------------------

export const BUS_TRIP_STATUSES = ['scheduled', 'boarding', 'departed', 'cancelled'] as const;
export type BusTripStatus = (typeof BUS_TRIP_STATUSES)[number];

export const BUS_SEAT_STATES = ['available', 'held', 'sold', 'blocked'] as const;
export type BusSeatState = (typeof BUS_SEAT_STATES)[number];

export const BUS_TICKET_STATUSES = ['valid', 'boarded', 'void'] as const;
export type BusTicketStatus = (typeof BUS_TICKET_STATUSES)[number];

/** Most seats one hold (and so one booking) can take. */
export const MAX_SEATS_PER_HOLD = 6;

/** Seat numbers: a row number and a letter, `1A` to `99F`. */
export const SEAT_NUMBER_PATTERN = /^[1-9]\d?[A-F]$/;

/**
 * A coach's seat map, front to back: each row lists cells left to right, a seat number or `null`
 * for the aisle or an empty space (the driver's position, the door).
 */
export interface BusSeatLayout {
  rows: (string | null)[][];
}

export const layoutSeats = (layout: BusSeatLayout): string[] =>
  layout.rows.flatMap((row) => row.filter((cell): cell is string => cell !== null));

/** Seats a request asks for: distinct, known to the layout and within the per-hold limit. */
export function seatSelectionIssue(
  layout: BusSeatLayout,
  seats: readonly string[],
): 'none_selected' | 'too_many' | 'duplicate' | 'unknown_seat' | null {
  if (seats.length === 0) return 'none_selected';
  if (seats.length > MAX_SEATS_PER_HOLD) return 'too_many';
  if (new Set(seats).size !== seats.length) return 'duplicate';
  const known = new Set(layoutSeats(layout));
  return seats.every((seat) => known.has(seat)) ? null : 'unknown_seat';
}

/**
 * The window a ticket's QR code is valid for boarding: from `beforeMinutes` before departure to
 * `afterMinutes` after it (a late coach still boards).
 */
export function boardingWindow(
  departsAt: Date,
  beforeMinutes = 180,
  afterMinutes = 360,
): { notBefore: Date; notAfter: Date } {
  return {
    notBefore: new Date(departsAt.getTime() - beforeMinutes * 60_000),
    notAfter: new Date(departsAt.getTime() + afterMinutes * 60_000),
  };
}

/** Prefix of a signed bus ticket QR payload (ADR-050): `SUSKII-T1.<payload>.<signature>`. */
export const TICKET_QR_PREFIX = 'SUSKII-T1';

/** What a ticket QR code signs: ids and the boarding window, never personal data. */
export interface TicketClaims {
  /** Ticket id. */
  tid: string;
  /** Trip id. */
  trp: string;
  /** Seat number. */
  st: string;
  /** Valid from and until, Unix seconds. */
  nbf: number;
  exp: number;
}

// ---------------------------------------------------------------------------
// Rides (ADR-051, ADR-052)
// ---------------------------------------------------------------------------

export const RIDE_CATEGORIES = ['standard', 'comfort', 'xl'] as const;
export type RideCategory = (typeof RIDE_CATEGORIES)[number];

/** Passengers each category seats (the rider included). */
export const RIDE_CATEGORY_SEATS: Readonly<Record<RideCategory, number>> = {
  standard: 4,
  comfort: 4,
  xl: 6,
};

export const RIDE_STATUSES = [
  'scheduled',
  'searching',
  'assigned',
  'arrived',
  'in_progress',
  'completed',
  'cancelled',
  'no_driver',
] as const;
export type RideStatus = (typeof RIDE_STATUSES)[number];

export const RIDE_EVENTS = [
  'dispatch',
  'accept',
  'driver_cancel',
  'arrive',
  'start',
  'complete',
  'rider_cancel',
  'staff_cancel',
  'timeout',
] as const;
export type RideEvent = (typeof RIDE_EVENTS)[number];

const ACTIVE_RIDE: readonly RideStatus[] = ['scheduled', 'searching', 'assigned', 'arrived'];

/**
 * The only allowed ride moves. A driver who cancels sends the ride back to matching; a rider can
 * cancel until the trip starts; staff can stop a ride at any point before it completes (safety).
 */
const RIDE_TRANSITIONS: Readonly<
  Record<RideEvent, { from: readonly RideStatus[]; to: RideStatus }>
> = {
  dispatch: { from: ['scheduled'], to: 'searching' },
  accept: { from: ['searching'], to: 'assigned' },
  driver_cancel: { from: ['assigned', 'arrived'], to: 'searching' },
  arrive: { from: ['assigned'], to: 'arrived' },
  start: { from: ['arrived'], to: 'in_progress' },
  complete: { from: ['in_progress'], to: 'completed' },
  rider_cancel: { from: ACTIVE_RIDE, to: 'cancelled' },
  staff_cancel: { from: [...ACTIVE_RIDE, 'in_progress'], to: 'cancelled' },
  timeout: { from: ['searching'], to: 'no_driver' },
};

export const canRideTransition = (from: RideStatus, event: RideEvent): boolean =>
  RIDE_TRANSITIONS[event].from.includes(from);

/** The status `event` leads to, or null when it is not allowed from `from`. */
export const nextRideStatus = (from: RideStatus, event: RideEvent): RideStatus | null =>
  canRideTransition(from, event) ? RIDE_TRANSITIONS[event].to : null;

export const isRideFinished = (status: RideStatus): boolean =>
  status === 'completed' || status === 'cancelled' || status === 'no_driver';

/** Statuses in which the rider and driver can see each other's live positions. */
export const RIDE_LIVE_STATUSES: readonly RideStatus[] = ['assigned', 'arrived', 'in_progress'];

/** A fare table row (data, not code): amounts in the rule's currency, minor units. */
export interface RideFareRule {
  currency: string;
  baseMinor: bigint;
  perKmMinor: bigint;
  perMinuteMinor: bigint;
  bookingFeeMinor: bigint;
  minimumMinor: bigint;
  /** Kept when a rider cancels after the free window, or does not show (ADR-051). */
  cancellationFeeMinor: bigint;
  /** Seconds after a driver accepts during which the rider cancels for free. */
  freeCancelSeconds: number;
  /** Seconds a driver waits at pickup before a no-show fee applies. */
  waitGraceSeconds: number;
  /** The driver's share of the fare (10000 = all of it); the rest is commission. */
  driverShareBps: number;
}

export interface RideFareBreakdown {
  base: Money;
  distance: Money;
  time: Money;
  /** Added by demand pricing, already capped. */
  surge: Money;
  /** Brings a short trip up to the minimum fare. */
  minimumTopUp: Money;
  bookingFee: Money;
  total: Money;
}

/**
 * The upfront fare (ADR-051): base + distance + time, plus surge (capped at `surgeCapBps`), topped
 * up to the minimum, plus the booking fee. Per-km and per-minute parts are rounded up to the minor
 * unit once each, so the fare is reproducible from the breakdown.
 */
export function rideFare(
  rule: RideFareRule,
  distanceMetres: number,
  durationSeconds: number,
  surgeBps: number,
  surgeCapBps: number,
): RideFareBreakdown {
  const { currency } = rule;
  const base = money(rule.baseMinor, currency);
  const distance = multiplyRatio(
    money(rule.perKmMinor, currency),
    BigInt(Math.max(0, Math.round(distanceMetres))),
    1000n,
    'ceil',
  );
  const time = multiplyRatio(
    money(rule.perMinuteMinor, currency),
    BigInt(Math.max(0, Math.round(durationSeconds))),
    60n,
    'ceil',
  );
  const metered = sum(currency, [base, distance, time]);
  const appliedSurge = Math.max(0, Math.min(surgeBps, surgeCapBps));
  const surge =
    appliedSurge === 0 ? zero(currency) : multiplyRatio(metered, appliedSurge, 10_000, 'ceil');
  const beforeMinimum = add(metered, surge);
  const minimumTopUp =
    beforeMinimum.minor < rule.minimumMinor
      ? money(rule.minimumMinor - beforeMinimum.minor, currency)
      : zero(currency);
  const bookingFee = money(rule.bookingFeeMinor, currency);
  return {
    base,
    distance,
    time,
    surge,
    minimumTopUp,
    bookingFee,
    total: sum(currency, [beforeMinimum, minimumTopUp, bookingFee]),
  };
}

/**
 * What cancelling a ride costs the rider (ADR-051): nothing before a driver accepts or within the
 * free window after; after that, the cancellation fee (never more than was paid). The fee is in
 * the fare rule's currency; `toPaidCurrency` converts it when the ride was paid in another one
 * (mixing currencies throws).
 */
export function rideCancellationFee(
  rule: Pick<RideFareRule, 'cancellationFeeMinor' | 'freeCancelSeconds' | 'currency'>,
  status: RideStatus,
  assignedAt: Date | null,
  paid: Money,
  now: Date,
  toPaidCurrency: (fee: Money) => Money = (fee) => fee,
): Money {
  if (status !== 'assigned' && status !== 'arrived') return zero(paid.currency);
  if (!assignedAt) return zero(paid.currency);
  if (now.getTime() - assignedAt.getTime() <= rule.freeCancelSeconds * 1000) {
    return zero(paid.currency);
  }
  return minOf(toPaidCurrency(money(rule.cancellationFeeMinor, rule.currency)), paid);
}

/** A driver's share of an amount, rounded down; the platform keeps the remainder. */
export function driverShare(amount: Money, driverShareBps: number): Money {
  return multiplyRatio(amount, Math.max(0, Math.min(driverShareBps, 10_000)), 10_000, 'floor');
}

/** Ride PINs are four digits, shown to the rider and typed by the driver to start the trip. */
export const RIDE_PIN_LENGTH = 4;
export const RIDE_PIN_PATTERN = /^\d{4}$/;
/** Wrong PINs before the ride locks and an incident is raised (ADR-050). */
export const RIDE_PIN_MAX_ATTEMPTS = 5;

export const DRIVER_STATUSES = ['pending', 'approved', 'rejected', 'suspended'] as const;
export type DriverStatus = (typeof DRIVER_STATUSES)[number];

export const DRIVER_DOCUMENT_KINDS = [
  'licence',
  'vehicle_registration',
  'insurance',
  'roadworthiness',
  'selfie',
] as const;
export type DriverDocumentKind = (typeof DRIVER_DOCUMENT_KINDS)[number];

/** Documents a driver needs on file, scanned clean and approved, before going online. */
export const REQUIRED_DRIVER_DOCUMENTS: readonly DriverDocumentKind[] = DRIVER_DOCUMENT_KINDS;

export const DRIVER_DOCUMENT_STATUSES = ['pending', 'clean', 'approved', 'rejected'] as const;
export type DriverDocumentStatus = (typeof DRIVER_DOCUMENT_STATUSES)[number];

export const INCIDENT_KINDS = ['sos', 'route_deviation', 'pin_lockout', 'long_stop'] as const;
export type IncidentKind = (typeof INCIDENT_KINDS)[number];

export const INCIDENT_STATUSES = ['open', 'acknowledged', 'resolved'] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

/** Ratings are whole stars; one to five. */
export const RATING_MIN = 1;
export const RATING_MAX = 5;

// ---------------------------------------------------------------------------
// Rentals (ADR-051)
// ---------------------------------------------------------------------------

export const RENTAL_CATEGORIES = ['economy', 'compact', 'suv', 'luxury', 'van'] as const;
export type RentalCategory = (typeof RENTAL_CATEGORIES)[number];

export const TRANSMISSIONS = ['automatic', 'manual'] as const;
export type Transmission = (typeof TRANSMISSIONS)[number];

export const RENTAL_STATUSES = ['reserved', 'checked_out', 'returned', 'cancelled'] as const;
export type RentalStatus = (typeof RENTAL_STATUSES)[number];

export const HANDOVER_KINDS = ['check_out', 'check_in'] as const;
export type HandoverKind = (typeof HANDOVER_KINDS)[number];

/** Longest single rental. */
export const RENTAL_MAX_DAYS = 30;

const DAY_MS = 86_400_000;

/** Rental days charged: started 24-hour periods, at least one. */
export function rentalDays(pickupAt: Date, returnAt: Date): number {
  const span = returnAt.getTime() - pickupAt.getTime();
  return Math.max(1, Math.ceil(span / DAY_MS));
}

export interface RentalRates {
  daily: Money;
  /** Null when the vehicle is not offered with a chauffeur. */
  chauffeurDaily: Money | null;
  deposit: Money;
}

export interface RentalCharge {
  days: number;
  vehicle: Money;
  chauffeur: Money;
  /** Refundable; never marked up, discounted or counted as revenue (ADR-051). */
  deposit: Money;
}

/** The rental's parts, or null when a chauffeur was asked for but is not offered. */
export function rentalCharge(
  rates: RentalRates,
  pickupAt: Date,
  returnAt: Date,
  chauffeur: boolean,
): RentalCharge | null {
  if (chauffeur && !rates.chauffeurDaily) return null;
  const days = rentalDays(pickupAt, returnAt);
  return {
    days,
    vehicle: multiply(rates.daily, days),
    chauffeur:
      chauffeur && rates.chauffeurDaily
        ? multiply(rates.chauffeurDaily, days)
        : zero(rates.daily.currency),
    // A chauffeured rental is never driven by the customer, so no damage deposit is taken.
    deposit: chauffeur ? zero(rates.deposit.currency) : rates.deposit,
  };
}

/** Fuel level in eighths of a tank, as handover forms record it. */
export const FUEL_EIGHTHS_MAX = 8;
