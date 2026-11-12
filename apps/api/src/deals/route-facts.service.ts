import { Inject, Injectable, Logger } from '@nestjs/common';

import type { Money } from '@suskii/shared';

import { uuidv7 } from '../common/uuid';
import { APP_CONFIG, type AppConfig } from '../config/config';
import type { RouteFare } from '../generated/prisma/client';
import { PrismaService } from '../infra/prisma.service';
import type { SupplierFlightOffer } from '../suppliers/supplier.types';

import { daysBefore, MONTH_DAYS, summariseFares, type FareSummary } from './route-facts';

const calendarDate = (value: string): Date => new Date(`${value.slice(0, 10)}T00:00:00Z`);

/**
 * Fare history for route facts (ADR-080). Every deal refresh records the cheapest fare it found
 * per departure date; the same day keeps the cheaper of two finds. Reads return raw supplier
 * rows for `DealsService` to price: nothing here leaves the API unpriced.
 */
@Injectable()
export class RouteFactsService {
  private readonly logger = new Logger(RouteFactsService.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
  ) {}

  /** Records each offer a refresh found; never fails the refresh (facts are secondary). */
  async record(
    routeId: string,
    offers: readonly SupplierFlightOffer[],
    usd: (offer: SupplierFlightOffer) => Money,
    now: Date,
  ): Promise<void> {
    const observedOn = calendarDate(now.toISOString());
    for (const offer of offers) {
      const [outbound, inbound] = offer.slices;
      if (!outbound) continue;
      try {
        // The unique key is route, day and departure date; a later find replaces the row only
        // when it is cheaper, compared in US cents at the time it was found.
        await this.prisma.$executeRaw`
          INSERT INTO route_fares (id, route_id, observed_on, departure_date, return_date, supplier,
            carrier_code, carrier_name, stops, duration_minutes, base_minor, taxes_minor, currency,
            usd_minor, updated_at)
          VALUES (${uuidv7()}::uuid, ${routeId}::uuid, ${observedOn}::date,
            ${calendarDate(outbound.departureLocal)}::date,
            ${inbound ? calendarDate(inbound.departureLocal) : null}::date, ${offer.supplier},
            ${offer.owner.code}, ${offer.owner.name}, ${outbound.stops}, ${outbound.durationMinutes},
            ${offer.price.base.minor}, ${offer.price.taxes.minor}, ${offer.price.base.currency},
            ${usd(offer).minor}, ${now})
          ON CONFLICT (route_id, observed_on, departure_date) DO UPDATE SET
            return_date = EXCLUDED.return_date, supplier = EXCLUDED.supplier,
            carrier_code = EXCLUDED.carrier_code, carrier_name = EXCLUDED.carrier_name,
            stops = EXCLUDED.stops, duration_minutes = EXCLUDED.duration_minutes,
            base_minor = EXCLUDED.base_minor, taxes_minor = EXCLUDED.taxes_minor,
            currency = EXCLUDED.currency, usd_minor = EXCLUDED.usd_minor,
            updated_at = EXCLUDED.updated_at
          WHERE route_fares.usd_minor > EXCLUDED.usd_minor`;
      } catch (error) {
        this.logger.warn(
          { routeId, reason: error instanceof Error ? error.name : 'unknown' },
          'Route fare not recorded',
        );
      }
    }
  }

  /** The last year of fares per route, for the facts rules. */
  async faresFor(routeIds: readonly string[], now: Date): Promise<Map<string, RouteFare[]>> {
    const byRoute = new Map<string, RouteFare[]>(routeIds.map((id) => [id, []]));
    if (routeIds.length === 0) return byRoute;
    const rows = await this.prisma.routeFare.findMany({
      where: {
        routeId: { in: [...routeIds] },
        observedOn: { gte: daysBefore(now, MONTH_DAYS - 1) },
      },
      orderBy: [{ observedOn: 'asc' }, { departureDate: 'asc' }],
    });
    for (const row of rows) byRoute.get(row.routeId)?.push(row);
    return byRoute;
  }

  /** Names from the airlines table (synced from Duffel), which beat the fare's own label. */
  async airlineNames(codes: readonly string[]): Promise<Map<string, string>> {
    if (codes.length === 0) return new Map();
    const airlines = await this.prisma.airline.findMany({
      where: { iataCode: { in: [...new Set(codes)] }, active: true },
      select: { iataCode: true, name: true },
    });
    return new Map(airlines.map((airline) => [airline.iataCode, airline.name]));
  }

  summarise(
    rows: readonly RouteFare[],
    now: Date,
    names: ReadonlyMap<string, string>,
  ): FareSummary<RouteFare> | null {
    return summariseFares(rows, now, this.config.ROUTE_FACTS_MIN_DAYS, names);
  }

  /** Deletes fare history past `ROUTE_FARE_RETENTION_DAYS`. */
  async prune(now = new Date()): Promise<number> {
    const { count } = await this.prisma.routeFare.deleteMany({
      where: { observedOn: { lt: daysBefore(now, this.config.ROUTE_FARE_RETENTION_DAYS) } },
    });
    return count;
  }
}
