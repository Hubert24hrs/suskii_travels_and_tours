import {
  localToUtc,
  money,
  multiplyRatio,
  utcToLocal,
  type CabinClass,
  type Money,
} from '@suskii/shared';

import type { AirportInfo } from '../../catalog/catalog.service';
import { buildSlice } from '../itinerary';
import { OfferUnavailableError, SupplierUnavailableError } from '../supplier.errors';
import {
  FlightSupplier,
  type AirportPoint,
  type FlightBookingRequest,
  type FlightBookingResult,
  type FlightSearchQuery,
  type FlightSegment,
  type FlightSlice,
  type SupplierFlightOffer,
} from '../supplier.types';

import {
  AFRICAN_COUNTRIES,
  FALLBACK_CARRIER,
  MOCK_CARRIERS,
  MOCK_HUBS,
  type MockCarrier,
} from './carriers';
import { SeededRandom, stableCode, stableId } from './random';

/** Airport facts the mock needs (implemented by CatalogService). */
export interface AirportDirectory {
  airportInfo(codes: readonly string[]): Promise<Map<string, AirportInfo>>;
}

const EARTH_RADIUS_KM = 6371;
const MINUTE_MS = 60_000;
const OFFER_TTL_MS = 30 * MINUTE_MS;
const MAX_OFFERS = 120;
const MAX_CONNECTING_ROUTES = 6;

export function distanceKm(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

interface Leg {
  from: AirportInfo;
  to: AirportInfo;
  km: number;
}

interface Route {
  carrier: MockCarrier;
  legs: Leg[];
}

interface SliceOption {
  carrier: MockCarrier;
  segments: FlightSegment[];
  km: number;
}

interface Brand {
  name: string;
  factor: number;
  carryOn: number;
  checked: number;
  refundable: boolean;
  /** Penalties in [USD, NGN]; null means free. */
  refundPenalty: [number, number] | null;
  changeable: boolean;
  changePenalty: [number, number] | null;
}

const BRANDS: Record<CabinClass, (international: boolean) => Brand[]> = {
  economy: (international) => [
    {
      name: 'Economy Light',
      factor: 1,
      carryOn: 1,
      checked: 0,
      refundable: false,
      refundPenalty: null,
      changeable: true,
      changePenalty: [60, 25_000],
    },
    {
      name: 'Economy Standard',
      factor: 1.18,
      carryOn: 1,
      checked: 1,
      refundable: true,
      refundPenalty: [120, 40_000],
      changeable: true,
      changePenalty: [40, 15_000],
    },
    ...(international
      ? [
          {
            name: 'Economy Flex',
            factor: 1.55,
            carryOn: 1,
            checked: 2,
            refundable: true,
            refundPenalty: [0, 0] as [number, number],
            changeable: true,
            changePenalty: null,
          },
        ]
      : []),
  ],
  premium_economy: () => [
    {
      name: 'Premium Standard',
      factor: 1,
      carryOn: 1,
      checked: 2,
      refundable: true,
      refundPenalty: [150, 50_000],
      changeable: true,
      changePenalty: [50, 20_000],
    },
    {
      name: 'Premium Flex',
      factor: 1.3,
      carryOn: 1,
      checked: 2,
      refundable: true,
      refundPenalty: [0, 0],
      changeable: true,
      changePenalty: null,
    },
  ],
  business: () => [
    {
      name: 'Business Saver',
      factor: 1,
      carryOn: 2,
      checked: 2,
      refundable: true,
      refundPenalty: [200, 60_000],
      changeable: true,
      changePenalty: [75, 25_000],
    },
    {
      name: 'Business Flex',
      factor: 1.35,
      carryOn: 2,
      checked: 3,
      refundable: true,
      refundPenalty: [0, 0],
      changeable: true,
      changePenalty: null,
    },
  ],
  first: () => [
    {
      name: 'First',
      factor: 1,
      carryOn: 2,
      checked: 3,
      refundable: true,
      refundPenalty: [0, 0],
      changeable: true,
      changePenalty: null,
    },
  ],
};

const CABIN_FACTOR: Record<CabinClass, number> = {
  economy: 1,
  premium_economy: 1.7,
  business: 3.1,
  first: 5,
};

function aircraftFor(km: number, random: SeededRandom): string {
  if (km < 1500) return random.pick(['Embraer 175', 'Boeing 737-800', 'De Havilland Dash 8-400']);
  if (km < 4500) return random.pick(['Airbus A320neo', 'Boeing 737 MAX 8', 'Airbus A321neo']);
  return random.pick(['Boeing 787-9', 'Airbus A350-900', 'Boeing 777-300ER', 'Airbus A330-300']);
}

const point = (airport: AirportInfo): AirportPoint => ({
  code: airport.code,
  name: airport.name,
  cityName: airport.cityName,
  countryCode: airport.countryCode,
  timeZone: airport.timeZone,
});

const REPRICE_MARK = '~r';

const isAfrican = (airport: AirportInfo): boolean => AFRICAN_COUNTRIES.has(airport.countryCode);

function servesLeg(carrier: MockCarrier, from: AirportInfo, to: AirportInfo, km: number): boolean {
  if (km > carrier.maxRangeKm || from.code === to.code) return false;
  const touchesHub = carrier.hubs.includes(from.code) || carrier.hubs.includes(to.code);
  if (carrier.scope === 'domestic') {
    return touchesHub && from.countryCode === carrier.country && to.countryCode === carrier.country;
  }
  if (carrier.scope === 'regional') return touchesHub && isAfrican(from) && isAfrican(to);
  return touchesHub;
}

/**
 * MOCK flight supplier with deterministic, geographically plausible results: real airports,
 * coordinates and time zones; real carrier hubs; direct and one-stop itineraries; fare brands with
 * baggage and conditions. Nigerian domestic fares are in NGN, everything else in USD. The same
 * query always yields the same schedule and prices (seeded), so caching and tests are stable.
 */
export class MockFlightSupplier extends FlightSupplier {
  readonly name = 'mock';
  readonly idempotentBooking = true;
  /** Test hook: basis points applied to prices on re-pricing (simulates a fare change). */
  repriceDriftBps = 0;
  /** Test hook: this many upcoming `book()` calls fail as if the airline were unavailable. */
  failNextBookings = 0;

  /**
   * @param repriceRules basis points added per outbound route ("LOS-DXB"), from
   *   MOCK_REPRICE_RULES, so end-to-end tests can walk through a price change. A rule applies once,
   *   on an offer's second re-price: the quote is the first, the check right before payment the
   *   second, so the change surfaces at payment and a consented price then stays put.
   */
  constructor(
    private readonly airports: AirportDirectory,
    private readonly now: () => Date = () => new Date(),
    private readonly repriceRules: ReadonlyMap<string, number> = new Map(),
  ) {
    super();
  }

  async search(query: FlightSearchQuery, signal: AbortSignal): Promise<SupplierFlightOffer[]> {
    const codes = query.slices.flatMap((slice) => [slice.origin, slice.destination]);
    const directory = await this.airports.airportInfo([...codes, ...MOCK_HUBS]);
    signal.throwIfAborted();
    if (codes.some((code) => !directory.has(code))) return [];

    const querySeed = JSON.stringify(query);
    const perSlice = query.slices.map((slice, index) => {
      const from = directory.get(slice.origin);
      const to = directory.get(slice.destination);
      if (!from || !to) return [];
      return this.sliceOptions(
        from,
        to,
        slice.departureDate,
        query,
        directory,
        `${querySeed}#${index}`,
      );
    });

    // An offer is one carrier across every slice (no interlining in the mock).
    const carriers = [
      ...new Set(perSlice.flatMap((options) => options.map((option) => option.carrier.code))),
    ].filter((code) =>
      perSlice.every((options) => options.some((option) => option.carrier.code === code)),
    );
    const international = query.slices.some(
      (slice) =>
        directory.get(slice.origin)?.countryCode !== directory.get(slice.destination)?.countryCode,
    );
    const offers: SupplierFlightOffer[] = [];
    for (const code of carriers) {
      const choices = perSlice.map((options) =>
        options
          .filter((option) => option.carrier.code === code)
          .slice(0, query.slices.length > 2 ? 2 : 3),
      );
      for (const combination of cartesian(choices)) {
        for (const brand of BRANDS[query.cabinClass](international)) {
          offers.push(this.offer(combination, brand, query, querySeed));
        }
      }
    }
    return offers
      .sort((a, b) =>
        Number(
          a.price.base.minor + a.price.taxes.minor - (b.price.base.minor + b.price.taxes.minor),
        ),
      )
      .slice(0, MAX_OFFERS);
  }

  reprice(offer: SupplierFlightOffer, signal: AbortSignal): Promise<SupplierFlightOffer> {
    signal.throwIfAborted();
    const now = this.now().getTime();
    const firstDeparture = offer.slices[0]?.departureUtc;
    if (
      Date.parse(offer.expiresAt) <= now ||
      (firstDeparture && Date.parse(firstDeparture) <= now)
    ) {
      return Promise.reject(new OfferUnavailableError(this.name, 'Offer is no longer available'));
    }
    const outbound = offer.slices[0];
    // Re-priced offers carry a round counter ("<id>~r2"); service ids keep the base id.
    const [baseId = offer.supplierOfferId, round = '0'] = offer.supplierOfferId.split(REPRICE_MARK);
    const nextRound = Number.parseInt(round, 10) + 1;
    const ruleBps =
      outbound && nextRound === 2
        ? (this.repriceRules.get(`${outbound.origin.code}-${outbound.destination.code}`) ?? 0)
        : 0;
    const bps = this.repriceDriftBps + ruleBps;
    const drift = (amount: Money): Money => multiplyRatio(amount, 10_000 + bps, 10_000, 'half-up');
    return Promise.resolve({
      ...offer,
      supplierOfferId: `${baseId}${REPRICE_MARK}${nextRound}`,
      price: { base: drift(offer.price.base), taxes: offer.price.taxes },
      expiresAt: new Date(now + OFFER_TTL_MS).toISOString(),
    });
  }
  /**
   * Issues deterministic references from the idempotency key, so retrying a booking returns the
   * same PNR and ticket numbers instead of booking twice.
   */
  book(request: FlightBookingRequest, signal: AbortSignal): Promise<FlightBookingResult> {
    signal.throwIfAborted();
    if (this.failNextBookings > 0) {
      this.failNextBookings -= 1;
      return Promise.reject(new SupplierUnavailableError(this.name, 'Mock ticketing is down'));
    }
    const firstDeparture = request.offer.slices[0]?.departureUtc;
    if (firstDeparture && Date.parse(firstDeparture) <= this.now().getTime()) {
      return Promise.reject(new OfferUnavailableError(this.name, 'The flight has departed'));
    }
    const seed = `mock-booking|${request.idempotencyKey}`;
    return Promise.resolve({
      supplierReference: stableCode(seed, 6, 'ABCDEFGHJKLMNPQRSTUVWXYZ'),
      tickets: request.passengers.map((_, passengerIndex) => ({
        passengerIndex,
        // Airline ticket numbers: a 3-digit accounting code and 10 digits.
        number: `${stableCode(`${seed}|airline`, 3, '0123456789')}${stableCode(
          `${seed}|${passengerIndex}`,
          10,
          '0123456789',
        )}`,
      })),
    });
  }

  private routes(
    from: AirportInfo,
    to: AirportInfo,
    directory: Map<string, AirportInfo>,
    directOnly: boolean,
  ): Route[] {
    const km = distanceKm(from, to);
    const direct: Route[] = MOCK_CARRIERS.filter((carrier) => servesLeg(carrier, from, to, km)).map(
      (carrier) => ({
        carrier,
        legs: [{ from, to, km }],
      }),
    );
    const connecting: { route: Route; detour: number }[] = [];
    if (!directOnly) {
      for (const carrier of MOCK_CARRIERS) {
        if (direct.some((route) => route.carrier.code === carrier.code)) continue;
        for (const hubCode of carrier.hubs) {
          const hub = directory.get(hubCode);
          if (!hub || hub.code === from.code || hub.code === to.code) continue;
          const first = distanceKm(from, hub);
          const second = distanceKm(hub, to);
          const detour = (first + second) / Math.max(km, 1);
          const allowedDetour = km < 800 ? 2.2 : 1.6;
          if (detour > allowedDetour) continue;
          if (!servesLeg(carrier, from, hub, first) || !servesLeg(carrier, hub, to, second))
            continue;
          connecting.push({
            route: {
              carrier,
              legs: [
                { from, to: hub, km: first },
                { from: hub, to, km: second },
              ],
            },
            detour,
          });
        }
      }
    }
    const routes = [
      ...direct,
      ...connecting
        .sort((a, b) => a.detour - b.detour)
        .slice(0, MAX_CONNECTING_ROUTES)
        .map((entry) => entry.route),
    ];
    return routes.length > 0 ? routes : [{ carrier: FALLBACK_CARRIER, legs: [{ from, to, km }] }];
  }

  private sliceOptions(
    from: AirportInfo,
    to: AirportInfo,
    date: string,
    query: FlightSearchQuery,
    directory: Map<string, AirportInfo>,
    seed: string,
  ): SliceOption[] {
    const now = this.now().getTime();
    const options: SliceOption[] = [];
    for (const route of this.routes(from, to, directory, query.maxConnections === 0)) {
      const random = new SeededRandom(
        `${seed}|${route.carrier.code}|${route.legs.map((leg) => leg.to.code).join('-')}`,
      );
      const totalKm = route.legs.reduce((acc, leg) => acc + leg.km, 0);
      const departures = totalKm < 1500 ? 3 : totalKm < 4500 ? 2 : 1;
      for (let index = 0; index < departures; index += 1) {
        const earliest = totalKm < 4500 ? 6 * 60 : 9 * 60;
        const slot = Math.round(random.between(earliest, 23 * 60 + 30) / 5) * 5;
        let departureUtc = localToUtc(
          `${date}T${pad(Math.floor(slot / 60))}:${pad(slot % 60)}`,
          from.timeZone,
        ).getTime();
        if (departureUtc <= now + 2 * 60 * MINUTE_MS) continue;
        const segments: FlightSegment[] = [];
        for (const leg of route.legs) {
          const duration = Math.round(((leg.km / 820) * 60 + 25) / 5) * 5;
          const arrivalUtc = departureUtc + duration * MINUTE_MS;
          segments.push({
            marketingCarrier: { code: route.carrier.code, name: route.carrier.name },
            operatingCarrier: { code: route.carrier.code, name: route.carrier.name },
            flightNumber: String(random.int(100, 1999)),
            origin: point(leg.from),
            destination: point(leg.to),
            departureLocal: utcToLocal(new Date(departureUtc), leg.from.timeZone),
            departureUtc: new Date(departureUtc).toISOString(),
            arrivalLocal: utcToLocal(new Date(arrivalUtc), leg.to.timeZone),
            arrivalUtc: new Date(arrivalUtc).toISOString(),
            durationMinutes: duration,
            aircraft: aircraftFor(leg.km, random),
            cabinClass: query.cabinClass,
          });
          departureUtc = arrivalUtc + Math.round(random.between(75, 300) / 5) * 5 * MINUTE_MS;
        }
        options.push({ carrier: route.carrier, segments, km: totalKm });
      }
    }
    return options.sort(
      (a, b) =>
        Date.parse(a.segments[0]?.departureUtc ?? '') -
        Date.parse(b.segments[0]?.departureUtc ?? ''),
    );
  }

  private offer(
    options: SliceOption[],
    brand: Brand,
    query: FlightSearchQuery,
    seed: string,
  ): SupplierFlightOffer {
    const carrier = options[0]?.carrier ?? FALLBACK_CARRIER;
    const slices: FlightSlice[] = options.map((option) => buildSlice(option.segments, brand.name));
    const domestic = slices.every(
      (slice) => slice.origin.countryCode === 'NG' && slice.destination.countryCode === 'NG',
    );
    const currency = domestic ? 'NGN' : 'USD';
    const random = new SeededRandom(
      `${seed}|price|${carrier.code}|${slices.map((s) => s.departureUtc).join()}`,
    );
    const now = this.now().getTime();
    const daysAhead = Math.max(
      0,
      (Date.parse(slices[0]?.departureUtc ?? '') - now) / (24 * 60 * MINUTE_MS),
    );
    const advance = daysAhead < 7 ? 1.35 : daysAhead < 21 ? 1.15 : 1;

    let adultBase = 0;
    let adultTaxes = 0;
    for (const option of options) {
      const stops = option.segments.length - 1;
      const base = domestic ? 38_000 + 95 * option.km : 45 + 0.085 * option.km;
      adultBase +=
        base *
        CABIN_FACTOR[query.cabinClass] *
        (1 - 0.1 * stops) *
        brand.factor *
        advance *
        random.between(0.85, 1.25);
      adultTaxes += domestic
        ? 9_000 + 0.06 * base
        : 18 + 0.02 * option.km + 12 * option.segments.length;
    }
    if (options.length > 1) adultBase *= 0.95;
    // Whole currency units per adult, like published fares.
    const baseUnit = money(BigInt(Math.round(adultBase)) * 100n, currency);
    const taxUnit = money(BigInt(Math.round(adultTaxes)) * 100n, currency);
    const { adults, children, infants } = query.passengers;
    const total = (unit: Money, childPct: number, infantPct: number): Money =>
      money(
        unit.minor * BigInt(adults) +
          multiplyRatio(unit, childPct * children, 100, 'half-up').minor +
          multiplyRatio(unit, infantPct * infants, 100, 'half-up').minor,
        currency,
      );
    const penalty = (value: [number, number] | null): Money | null =>
      value === null ? null : money(BigInt(domestic ? value[1] : value[0]) * 100n, currency);

    const firstDeparture = Date.parse(slices[0]?.departureUtc ?? '');
    const holdable = daysAhead >= 7 && random.chance(0.6);
    const supplierOfferId = stableId(
      'mockoff',
      seed,
      carrier.code,
      brand.name,
      ...slices.flatMap((s) => s.segments.map((g) => `${g.flightNumber}@${g.departureUtc}`)),
    );
    return {
      supplier: this.name,
      supplierOfferId,
      owner: { code: carrier.code, name: carrier.name },
      slices,
      baggage: { carryOn: brand.carryOn, checked: brand.checked },
      conditions: {
        refundable: brand.refundable,
        refundPenalty: brand.refundable ? penalty(brand.refundPenalty) : null,
        changeable: brand.changeable,
        changePenalty: penalty(brand.changePenalty),
      },
      cabinClass: query.cabinClass,
      passengers: query.passengers,
      price: { base: total(baseUnit, 75, 10), taxes: total(taxUnit, 100, 10) },
      expiresAt: new Date(now + OFFER_TTL_MS).toISOString(),
      hold: {
        available: holdable,
        paymentRequiredBy: holdable
          ? new Date(
              Math.min(now + 48 * 60 * MINUTE_MS, firstDeparture - 72 * 60 * MINUTE_MS),
            ).toISOString()
          : null,
      },
      // One extra 23 kg bag per passenger (two at most) for the whole trip.
      services: [
        {
          id: `${supplierOfferId}.bag23`,
          type: 'checked_bag',
          weightKg: 23,
          maxQuantity: 2,
          price: money(domestic ? 1_500_000n : 6_000n, currency),
        },
      ],
    };
  }
}

const pad = (value: number): string => String(value).padStart(2, '0');

function cartesian<T>(lists: T[][]): T[][] {
  return lists.reduce<T[][]>(
    (acc, list) => acc.flatMap((prefix) => list.map((item) => [...prefix, item])),
    [[]],
  );
}
