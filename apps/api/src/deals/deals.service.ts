import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { z } from 'zod';

import {
  addDays,
  citySlug,
  compare,
  localDate,
  money,
  toWire,
  type FlightSearchRequest,
  type Money,
} from '@suskii/shared';

import { APP_CONFIG, type AppConfig } from '../config/config';
import type { Airport, City, DealRoute, DealSnapshot, RouteFare } from '../generated/prisma/client';
import { PrismaService } from '../infra/prisma.service';
import { FxService } from '../pricing/fx.service';
import { PricingService } from '../pricing/pricing.service';
import type { ClientContext } from '../search/client-context';
import { FlightSearchService } from '../search/flight-search.service';
import { searchUnavailable } from '../search/search.errors';
import type { SupplierFlightOffer } from '../suppliers/supplier.types';

import type {
  dealAirlineSchema,
  dealAirlinesSchema,
  dealCitiesSchema,
  dealCitySchema,
  dealRouteSchema,
  dealRoutesSchema,
  flightDealSchema,
  flightDealsSchema,
  RefreshResult,
  routeFactsSchema,
} from './deals.schemas';
import { daysBefore, TYPICAL_DAYS } from './route-facts';
import { RouteFactsService } from './route-facts.service';

type FlightDealDto = z.infer<typeof flightDealSchema>;
type RouteFactsDto = z.infer<typeof routeFactsSchema>;
type AirportWithCity = Airport & { city: City | null };
type RouteWithAirports = DealRoute & { origin: AirportWithCity; destination: AirportWithCity };

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const MOCK_SUPPLIER = 'mock';

const placeOf = (airport: AirportWithCity) => ({
  code: airport.iataCode,
  cityName: airport.city?.name ?? airport.municipality ?? airport.name,
  countryCode: airport.countryCode,
});

const isoDate = (value: Date): string => value.toISOString().slice(0, 10);
const calendarDate = (value: string): Date => new Date(`${value.slice(0, 10)}T00:00:00Z`);

const routeInclude = {
  origin: { include: { city: true } },
  destination: { include: { city: true } },
} as const;

/**
 * Flight deals (ADR-011): the worker asks for one route at a time to be refreshed; each refresh
 * searches a few departure dates through the normal search orchestration and stores the cheapest
 * fare as a snapshot. Public reads price the latest fresh snapshot with the current rules.
 */
@Injectable()
export class DealsService {
  private readonly logger = new Logger(DealsService.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly fx: FxService,
    private readonly flightSearch: FlightSearchService,
    private readonly routeFacts: RouteFactsService,
  ) {}

  async list(
    options: { origin?: string | undefined; currency: string; limit: number },
    client: ClientContext,
  ): Promise<z.infer<typeof flightDealsSchema>> {
    const now = new Date();
    const routes = await this.prisma.dealRoute.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: 'asc' }, { slug: 'asc' }],
      include: { ...routeInclude, snapshots: this.freshSnapshot(now) },
    });
    const withDeals = routes.filter((route) => route.snapshots.length > 0);
    const origins = new Map<string, { code: string; cityName: string }>();
    for (const route of withDeals) {
      const { code, cityName } = placeOf(route.origin);
      if (!origins.has(code)) origins.set(code, { code, cityName });
    }
    const price = await this.priceFor(options.currency, client, now);
    return {
      currency: options.currency,
      origins: [...origins.values()],
      deals: withDeals
        .filter((route) => !options.origin || route.originCode === options.origin)
        .slice(0, options.limit)
        .flatMap((route) => route.snapshots.map((snapshot) => price.deal(route, snapshot))),
    };
  }

  async routes(): Promise<z.infer<typeof dealRoutesSchema>> {
    const routes = await this.prisma.dealRoute.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: 'asc' }, { slug: 'asc' }],
      include: routeInclude,
    });
    return { routes: routes.map((route) => this.summary(route)) };
  }

  async route(
    slug: string,
    currency: string,
    client: ClientContext,
  ): Promise<z.infer<typeof dealRouteSchema>> {
    const now = new Date();
    const route = await this.prisma.dealRoute.findFirst({
      where: { slug, active: true },
      include: { ...routeInclude, snapshots: this.freshSnapshot(now) },
    });
    if (!route) throw new NotFoundException();
    const related = await this.prisma.dealRoute.findMany({
      where: { active: true, originCode: route.originCode, id: { not: route.id } },
      orderBy: [{ sortOrder: 'asc' }, { slug: 'asc' }],
      include: routeInclude,
    });
    const price = await this.priceFor(currency, client, now);
    const [snapshot] = route.snapshots;
    const fares = (await this.routeFacts.faresFor([route.id], now)).get(route.id) ?? [];
    const names = await this.routeFacts.airlineNames(fares.map((fare) => fare.carrierCode));
    const summary = this.routeFacts.summarise(fares, now, names);
    const facts: RouteFactsDto | null = summary && {
      cheapest: {
        price: toWire(price.fare(route, summary.cheapest)),
        departureDate: isoDate(summary.cheapest.departureDate),
        carrier: {
          code: summary.cheapest.carrierCode,
          name: names.get(summary.cheapest.carrierCode) ?? summary.cheapest.carrierName,
        },
      },
      typical: toWire(price.fare(route, summary.typical)),
      airlines: summary.airlines,
      direct: summary.direct,
      fastestMinutes: summary.fastestMinutes,
      cheapestMonth: summary.cheapestMonth,
      observedDays: summary.observedDays,
      sample: summary.sample,
      updatedAt: summary.updatedAt.toISOString(),
    };
    return {
      ...this.summary(route),
      cabinClass: route.cabinClass,
      stayNights: route.stayNights,
      currency,
      deal: snapshot ? price.deal(route, snapshot) : null,
      facts,
      relatedRoutes: related.map((entry) => this.summary(entry)),
    };
  }

  /** Cities with active routes, for hub pages and the sitemap (ADR-080). */
  async cities(): Promise<z.infer<typeof dealCitiesSchema>> {
    const routes = await this.prisma.dealRoute.findMany({
      where: { active: true },
      include: routeInclude,
    });
    const cities = new Map<
      string,
      { slug: string; name: string; countryCode: string; departures: number; arrivals: number }
    >();
    const count = (airport: AirportWithCity, side: 'departures' | 'arrivals') => {
      const place = placeOf(airport);
      const slug = citySlug(place.cityName);
      if (!slug) return;
      const city = cities.get(slug) ?? {
        slug,
        name: place.cityName,
        countryCode: place.countryCode,
        departures: 0,
        arrivals: 0,
      };
      city[side] += 1;
      cities.set(slug, city);
    };
    for (const route of routes) {
      count(route.origin, 'departures');
      count(route.destination, 'arrivals');
    }
    return { cities: [...cities.values()].sort((a, b) => a.name.localeCompare(b.name)) };
  }

  /** A city hub: active routes from and to the city, with the latest fare and typical price. */
  async city(
    slug: string,
    currency: string,
    client: ClientContext,
  ): Promise<z.infer<typeof dealCitySchema>> {
    const now = new Date();
    const routes = await this.prisma.dealRoute.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: 'asc' }, { slug: 'asc' }],
      include: { ...routeInclude, snapshots: this.freshSnapshot(now) },
    });
    const inCity = (airport: AirportWithCity) => citySlug(placeOf(airport).cityName) === slug;
    const departures = routes.filter((route) => inCity(route.origin));
    const arrivals = routes.filter((route) => inCity(route.destination));
    const anchor = departures[0]?.origin ?? arrivals[0]?.destination;
    if (!anchor) throw new NotFoundException();
    const price = await this.priceFor(currency, client, now);
    const fares = await this.routeFacts.faresFor(
      [...departures, ...arrivals].map((route) => route.id),
      now,
    );
    const card = (route: (typeof routes)[number]) => {
      const summary = this.routeFacts.summarise(fares.get(route.id) ?? [], now, new Map());
      const [snapshot] = route.snapshots;
      return {
        ...this.summary(route),
        deal: snapshot ? price.deal(route, snapshot) : null,
        typical: summary ? toWire(price.fare(route, summary.typical)) : null,
        direct: summary ? summary.direct : null,
      };
    };
    const place = placeOf(anchor);
    return {
      city: { slug, name: place.cityName, countryCode: place.countryCode },
      currency,
      departures: departures.map(card),
      arrivals: arrivals.map(card),
    };
  }

  /** Airlines seen on active routes in the last 90 days, for airline pages and the sitemap. */
  async airlines(): Promise<z.infer<typeof dealAirlinesSchema>> {
    const seen = await this.prisma.routeFare.groupBy({
      by: ['carrierCode', 'routeId'],
      where: {
        observedOn: { gte: daysBefore(new Date(), TYPICAL_DAYS - 1) },
        route: { active: true },
      },
      _max: { carrierName: true },
    });
    const byCarrier = new Map<string, { name: string; routes: number }>();
    for (const row of seen) {
      const entry = byCarrier.get(row.carrierCode) ?? {
        name: row._max.carrierName ?? row.carrierCode,
        routes: 0,
      };
      entry.routes += 1;
      byCarrier.set(row.carrierCode, entry);
    }
    const names = await this.routeFacts.airlineNames([...byCarrier.keys()]);
    return {
      airlines: [...byCarrier]
        .map(([code, entry]) => ({
          code,
          name: names.get(code) ?? entry.name,
          routes: entry.routes,
        }))
        .sort((a, b) => b.routes - a.routes || a.name.localeCompare(b.name)),
    };
  }

  /** An airline page: the active routes it was seen on in 90 days, with its own cheapest fare. */
  async airline(
    code: string,
    currency: string,
    client: ClientContext,
  ): Promise<z.infer<typeof dealAirlineSchema>> {
    const now = new Date();
    const rows = await this.prisma.routeFare.findMany({
      where: {
        carrierCode: code,
        observedOn: { gte: daysBefore(now, TYPICAL_DAYS - 1) },
        route: { active: true },
      },
      include: { route: { include: routeInclude } },
    });
    if (rows.length === 0) throw new NotFoundException();
    const [record] = await this.prisma.airline.findMany({
      where: { iataCode: code, active: true },
      take: 1,
    });
    const price = await this.priceFor(currency, client, now);
    const byRoute = new Map<string, typeof rows>();
    for (const row of rows) byRoute.set(row.routeId, [...(byRoute.get(row.routeId) ?? []), row]);
    const routes = [...byRoute.values()].flatMap((routeRows) => {
      const cheapest = routeRows.reduce((best, row) => (row.usdMinor < best.usdMinor ? row : best));
      return [
        {
          ...this.summary(cheapest.route),
          cheapest: {
            price: toWire(price.fare(cheapest.route, cheapest)),
            departureDate: isoDate(cheapest.departureDate),
          },
          direct: routeRows.some((row) => row.stops === 0),
          fastestMinutes: Math.min(...routeRows.map((row) => row.durationMinutes)),
          sample: routeRows.some((row) => row.supplier === MOCK_SUPPLIER),
        },
      ];
    });
    routes.sort((a, b) => a.slug.localeCompare(b.slug));
    const latest = rows.reduce((best, row) => (row.updatedAt > best.updatedAt ? row : best));
    return {
      airline: { code, name: record?.name ?? latest.carrierName, logoUrl: record?.logoUrl ?? null },
      currency,
      routes,
    };
  }

  async activeRoutes(): Promise<{ id: string; slug: string }[]> {
    return this.prisma.dealRoute.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: 'asc' }, { slug: 'asc' }],
      select: { id: true, slug: true },
    });
  }

  /**
   * Searches each configured departure date (return after the route's stay, one adult) and
   * stores the cheapest offer. Throws 503 when every search failed, so the worker retries.
   */
  async refresh(routeId: string, now = new Date()): Promise<RefreshResult> {
    const route = await this.prisma.dealRoute.findUnique({
      where: { id: routeId },
      include: routeInclude,
    });
    if (!route) throw new NotFoundException();
    if (!route.active) return { status: 'inactive', snapshotId: null, fetchedAt: null };

    const today = localDate(now, route.origin.timezone);
    const offers: SupplierFlightOffer[] = [];
    let failures = 0;
    for (const offset of this.config.DEALS_DEPARTURE_OFFSETS_DAYS) {
      const departureDate = addDays(today, offset);
      const request: FlightSearchRequest = {
        slices: [
          { origin: route.originCode, destination: route.destinationCode, departureDate },
          {
            origin: route.destinationCode,
            destination: route.originCode,
            departureDate: addDays(departureDate, route.stayNights),
          },
        ],
        passengers: { adults: 1, children: 0, infants: 0 },
        cabinClass: route.cabinClass,
        directOnly: false,
      };
      try {
        const offer = await this.flightSearch.cheapestOffer(request);
        if (offer) offers.push(offer);
      } catch {
        failures += 1;
        this.logger.warn({ routeId, offset }, 'deal search failed');
      }
    }
    if (offers.length === 0) {
      if (failures > 0) throw searchUnavailable();
      return { status: 'no_results', snapshotId: null, fetchedAt: null };
    }

    const fx = await this.fx.converter();
    const usd = (offer: SupplierFlightOffer): Money =>
      fx.convert(
        {
          minor: offer.price.base.minor + offer.price.taxes.minor,
          currency: offer.price.base.currency,
        },
        'USD',
      );
    await this.routeFacts.record(route.id, offers, usd, now);
    const cheapest = offers.reduce((best, offer) =>
      compare(usd(offer), usd(best)) < 0 ? offer : best,
    );
    const [outbound, inbound] = cheapest.slices;
    if (!outbound) return { status: 'no_results', snapshotId: null, fetchedAt: null };
    const snapshot = await this.prisma.dealSnapshot.create({
      data: {
        routeId: route.id,
        supplier: cheapest.supplier,
        departureDate: calendarDate(outbound.departureLocal),
        returnDate: inbound ? calendarDate(inbound.departureLocal) : null,
        carrierCode: cheapest.owner.code,
        carrierName: cheapest.owner.name,
        stops: outbound.stops,
        durationMinutes: outbound.durationMinutes,
        baseMinor: cheapest.price.base.minor,
        taxesMinor: cheapest.price.taxes.minor,
        currency: cheapest.price.base.currency,
        originCountry: outbound.origin.countryCode ?? route.origin.countryCode,
        destinationCountry: outbound.destination.countryCode ?? route.destination.countryCode,
      },
    });
    return {
      status: 'refreshed',
      snapshotId: snapshot.id,
      fetchedAt: snapshot.fetchedAt.toISOString(),
    };
  }

  /** Deletes snapshots past the retention window (price history is kept that long). */
  async prune(now = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - this.config.SNAPSHOT_RETENTION_DAYS * DAY_MS);
    const { count } = await this.prisma.dealSnapshot.deleteMany({
      where: { fetchedAt: { lt: cutoff } },
    });
    return count;
  }

  /** Latest snapshot newer than DEALS_MAX_AGE_HOURS; older ones are never shown. */
  private freshSnapshot(now: Date) {
    return {
      where: {
        fetchedAt: { gte: new Date(now.getTime() - this.config.DEALS_MAX_AGE_HOURS * HOUR_MS) },
      },
      orderBy: { fetchedAt: 'desc' as const },
      take: 1,
    };
  }

  private summary(route: RouteWithAirports) {
    return {
      slug: route.slug,
      origin: placeOf(route.origin),
      destination: placeOf(route.destination),
    };
  }

  /**
   * Prices snapshots and fare history per adult with the current rules, display currency and
   * sales channel. Supplier cost goes in; only the priced total comes out.
   */
  private async priceFor(
    currency: string,
    client: ClientContext,
    now: Date,
  ): Promise<{
    deal: (route: RouteWithAirports, snapshot: DealSnapshot) => FlightDealDto;
    fare: (route: RouteWithAirports, fare: RouteFare) => Money;
  }> {
    const pricer = await this.pricing.pricer('flights', currency);
    const total = (
      route: RouteWithAirports,
      source: {
        baseMinor: bigint;
        taxesMinor: bigint;
        currency: string;
        supplier: string;
        carrierCode: string;
      },
      countries: { originCountry: string; destinationCountry: string },
    ): Money =>
      pricer(
        {
          base: money(source.baseMinor, source.currency),
          taxes: money(source.taxesMinor, source.currency),
        },
        {
          vertical: 'flights',
          supplier: source.supplier,
          channel: client.channel,
          userTier: client.userTier,
          benefits: client.benefits,
          originCode: route.originCode,
          destinationCode: route.destinationCode,
          ...countries,
          carrierCode: source.carrierCode,
          cabinClass: route.cabinClass,
          passengers: 1,
          now,
        },
      ).breakdown.total;
    return {
      deal: (route, snapshot) => ({
        id: snapshot.id,
        routeSlug: route.slug,
        origin: placeOf(route.origin),
        destination: placeOf(route.destination),
        departureDate: isoDate(snapshot.departureDate),
        returnDate: snapshot.returnDate ? isoDate(snapshot.returnDate) : null,
        carrier: { code: snapshot.carrierCode, name: snapshot.carrierName },
        cabinClass: route.cabinClass,
        stops: snapshot.stops,
        durationMinutes: snapshot.durationMinutes,
        price: toWire(
          total(route, snapshot, {
            originCountry: snapshot.originCountry,
            destinationCountry: snapshot.destinationCountry,
          }),
        ),
        sample: snapshot.supplier === MOCK_SUPPLIER,
        updatedAt: snapshot.fetchedAt.toISOString(),
      }),
      fare: (route, fare) =>
        total(route, fare, {
          originCountry: route.origin.countryCode,
          destinationCountry: route.destination.countryCode,
        }),
    };
  }
}
