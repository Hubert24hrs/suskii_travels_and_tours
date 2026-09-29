import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { z } from 'zod';

import {
  compare,
  equals,
  localDate,
  subtract,
  toWire,
  type FlightSearchRequest,
  type Money,
} from '@suskii/shared';

import { CatalogService } from '../catalog/catalog.service';
import { toJsonValue } from '../common/json';
import { APP_CONFIG, type AppConfig } from '../config/config';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../infra/prisma.service';
import { FxService, type Converter } from '../pricing/fx.service';
import type { PriceBreakdown, PricingContext } from '../pricing/pricing-engine';
import { toPriceDto } from '../pricing/pricing.schemas';
import { PricingService } from '../pricing/pricing.service';
import { itineraryKey } from '../suppliers/itinerary';
import { OfferUnavailableError } from '../suppliers/supplier.errors';
import type {
  FlightSearchQuery,
  FlightSupplier,
  SupplierFlightOffer,
} from '../suppliers/supplier.types';
import { FLIGHT_SUPPLIERS } from '../suppliers/suppliers.module';

import type { ClientContext } from './client-context';
import {
  filterFlights,
  flightFacets,
  paginate,
  sortFlights,
  type FlightFilters,
  type FlightSort,
  type PricedFlight,
} from './results';
import {
  invalidSearch,
  offerUnavailable,
  searchExpired,
  searchUnavailable,
  supplierUnavailable,
} from './search.errors';
import type {
  flightOfferSchema,
  flightQuoteSchema,
  flightSearchResultSchema,
} from './search.schemas';
import { SearchLogService } from './search-log.service';
import { queryHash, SearchStore, type SearchMeta } from './search-store';
import { SupplierRunner } from './supplier-runner';

type FlightOfferDto = z.infer<typeof flightOfferSchema>;
type FlightSearchResultDto = z.infer<typeof flightSearchResultSchema>;
type FlightQuoteDto = z.infer<typeof flightQuoteSchema>;

interface StoredOffer {
  id: string;
  offer: SupplierFlightOffer;
}

export interface FlightListOptions extends FlightFilters {
  sort: FlightSort;
  currency: string;
  cursor?: string | undefined;
  limit: number;
}

const FIRST_PAGE = 20;

/** Supplier total (base + taxes) converted for comparisons across suppliers and currencies. */
function supplierTotalIn(fx: Converter, offer: SupplierFlightOffer, currency: string): Money {
  return fx.convert(
    {
      minor: offer.price.base.minor + offer.price.taxes.minor,
      currency: offer.price.base.currency,
    },
    currency,
  );
}

export function flightPricingContext(
  offer: SupplierFlightOffer,
  client: ClientContext,
  now: Date,
): PricingContext {
  const first = offer.slices[0];
  return {
    vertical: 'flights',
    supplier: offer.supplier,
    channel: client.channel,
    userTier: client.userTier,
    originCode: first?.origin.code ?? null,
    destinationCode: first?.destination.code ?? null,
    originCountry: first?.origin.countryCode ?? null,
    destinationCountry: first?.destination.countryCode ?? null,
    carrierCode: offer.owner.code,
    cabinClass: offer.cabinClass,
    // Per-passenger fees apply to travellers with a seat (lap infants are excluded).
    passengers: offer.passengers.adults + offer.passengers.children,
    now,
  };
}

export function toFlightOfferDto(
  id: string,
  offer: SupplierFlightOffer,
  price: PriceBreakdown,
  fx: Converter,
): FlightOfferDto {
  const display = (amount: Money | null) =>
    amount ? toWire(fx.convert(amount, price.currency)) : null;
  return {
    id,
    supplier: offer.supplier,
    owner: offer.owner,
    slices: offer.slices,
    baggage: offer.baggage,
    conditions: {
      refundable: offer.conditions.refundable,
      refundPenalty: display(offer.conditions.refundPenalty),
      changeable: offer.conditions.changeable,
      changePenalty: display(offer.conditions.changePenalty),
    },
    cabinClass: offer.cabinClass,
    passengers: offer.passengers,
    price: toPriceDto(price),
    expiresAt: offer.expiresAt,
    hold: offer.hold,
  };
}

/**
 * Flight search orchestration: validation, cache lookup by normalised query, parallel supplier
 * calls with timeouts and circuit breakers, merge and de-duplication, pricing, facets, filters,
 * pagination, offer detail and re-pricing into persisted quotes.
 */
@Injectable()
export class FlightSearchService {
  private readonly inflight = new Map<string, Promise<string>>();

  constructor(
    @Inject(FLIGHT_SUPPLIERS) private readonly suppliers: FlightSupplier[],
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly runner: SupplierRunner,
    private readonly store: SearchStore,
    private readonly catalog: CatalogService,
    private readonly pricing: PricingService,
    private readonly fx: FxService,
    private readonly prisma: PrismaService,
    private readonly searchLog: SearchLogService,
  ) {}

  async search(
    request: FlightSearchRequest,
    currency: string,
    client: ClientContext,
  ): Promise<FlightSearchResultDto> {
    const started = performance.now();
    await this.validate(request);
    const { meta, items, cacheHit } = await this.resolve(request);
    const result = await this.view(
      meta,
      items,
      { sort: 'best', currency, limit: FIRST_PAGE },
      client,
    );
    const [first] = request.slices;
    const last = request.slices[request.slices.length - 1];
    this.searchLog.record({
      vertical: 'flights',
      origin: first?.origin ?? null,
      destination: first?.destination ?? null,
      departureDate: first?.departureDate ?? null,
      returnDate: request.slices.length > 1 ? (last?.departureDate ?? null) : null,
      sliceCount: request.slices.length,
      travellers:
        request.passengers.adults + request.passengers.children + request.passengers.infants,
      cabinClass: request.cabinClass,
      channel: client.channel,
      cacheHit,
      partial: meta.partial,
      resultCount: meta.resultCount,
      durationMs: performance.now() - started,
      supplierOutcomes: meta.suppliers,
    });
    return result;
  }

  /**
   * The cheapest current offer for a request, compared on the supplier total in USD. Used by the
   * deals refresh (ADR-011); shares the cache and single-flight with customer searches.
   */
  async cheapestOffer(request: FlightSearchRequest): Promise<SupplierFlightOffer | null> {
    await this.validate(request);
    const { items } = await this.resolve(request);
    const fx = await this.fx.converter();
    const now = Date.now();
    let best: { offer: SupplierFlightOffer; usd: Money } | null = null;
    for (const { offer } of items.values()) {
      if (Date.parse(offer.expiresAt) <= now) continue;
      const usd = supplierTotalIn(fx, offer, 'USD');
      if (!best || compare(usd, best.usd) < 0) best = { offer, usd };
    }
    return best?.offer ?? null;
  }

  async list(
    searchId: string,
    options: FlightListOptions,
    client: ClientContext,
  ): Promise<FlightSearchResultDto> {
    const meta = await this.store.meta<FlightSearchRequest>('flights', searchId);
    if (!meta) throw new NotFoundException();
    const items = await this.store.items<StoredOffer>('flights', searchId);
    if (!items && (meta.resultCount > 0 || Date.parse(meta.resultsExpireAt) <= Date.now()))
      throw searchExpired(meta.request);
    return this.view(meta, items ?? new Map(), options, client);
  }

  async offer(offerId: string, currency: string, client: ClientContext): Promise<FlightOfferDto> {
    const { item } = await this.load(offerId);
    const [pricer, fx] = await Promise.all([
      this.pricing.pricer('flights', currency),
      this.fx.converter(),
    ]);
    const { breakdown } = pricer(
      item.offer.price,
      flightPricingContext(item.offer, client, new Date()),
    );
    return toFlightOfferDto(item.id, item.offer, breakdown, fx);
  }

  /** Re-prices with the supplier, persists a quote and reports any price change explicitly. */
  async quote(offerId: string, currency: string, client: ClientContext): Promise<FlightQuoteDto> {
    const { meta, item } = await this.load(offerId);
    const supplier = this.suppliers.find((candidate) => candidate.name === item.offer.supplier);
    if (!supplier) throw offerUnavailable(meta.request);
    let fresh: SupplierFlightOffer;
    try {
      fresh = await this.runner.call('flights', supplier.name, 'reprice', (signal) =>
        supplier.reprice(item.offer, signal),
      );
    } catch (error) {
      if (error instanceof OfferUnavailableError) throw offerUnavailable(meta.request);
      throw supplierUnavailable();
    }
    const [pricer, fx] = await Promise.all([
      this.pricing.pricer('flights', currency),
      this.fx.converter(),
    ]);
    const now = new Date();
    const previous = pricer(
      item.offer.price,
      flightPricingContext(item.offer, client, now),
    ).breakdown;
    const current = pricer(fresh.price, flightPricingContext(fresh, client, now)).breakdown;
    const quote = await this.prisma.offer.create({
      data: {
        vertical: 'flights',
        supplier: supplier.name,
        supplierOfferId: fresh.supplierOfferId,
        payload: toJsonValue({ kind: 'flight', offer: fresh }) as Prisma.InputJsonValue,
        supplierTotalMinor: current.supplierTotal.minor,
        supplierCurrency: current.supplierTotal.currency,
        price: toPriceDto(current),
        totalMinor: current.total.minor,
        currency,
        searchId: meta.searchId,
        userId: client.userId,
        expiresAt: new Date(fresh.expiresAt),
      },
    });
    return {
      quoteId: quote.id,
      offer: toFlightOfferDto(item.id, fresh, current, fx),
      priceChange: equals(previous.total, current.total)
        ? null
        : {
            previous: toWire(previous.total),
            current: toWire(current.total),
            difference: toWire(subtract(current.total, previous.total)),
          },
      expiresAt: fresh.expiresAt,
    };
  }

  private async load(
    offerId: string,
  ): Promise<{ meta: SearchMeta<FlightSearchRequest>; item: StoredOffer }> {
    const searchId = offerId.split('.')[0] ?? '';
    const meta = await this.store.meta<FlightSearchRequest>('flights', searchId);
    if (!meta) throw new NotFoundException();
    const item = await this.store.item<StoredOffer>('flights', searchId, offerId);
    if (!item || Date.parse(item.offer.expiresAt) <= Date.now())
      throw offerUnavailable(meta.request);
    return { meta, item };
  }

  /** Airports must exist and departures may not be before today in the origin's local date. */
  private async validate(request: FlightSearchRequest): Promise<void> {
    const codes = request.slices.flatMap((slice) => [slice.origin, slice.destination]);
    const airports = await this.catalog.airportInfo(codes);
    const now = new Date();
    const issues = request.slices.flatMap((slice, index) => {
      const found: { location: 'body'; path: string; code: string; message: string }[] = [];
      for (const field of ['origin', 'destination'] as const) {
        if (!airports.has(slice[field])) {
          found.push({
            location: 'body',
            path: `slices.${index}.${field}`,
            code: 'unknown_airport',
            message: 'Unknown airport code',
          });
        }
      }
      const origin = airports.get(slice.origin);
      if (origin && slice.departureDate < localDate(now, origin.timeZone)) {
        found.push({
          location: 'body',
          path: `slices.${index}.departureDate`,
          code: 'date_in_past',
          message: 'date_in_past',
        });
      }
      return found;
    });
    if (issues.length > 0) throw invalidSearch(issues);
  }

  /** The cached result set for the normalised query, or a fresh supplier fetch. */
  private async resolve(request: FlightSearchRequest): Promise<{
    meta: SearchMeta<FlightSearchRequest>;
    items: Map<string, StoredOffer>;
    cacheHit: boolean;
  }> {
    const query: FlightSearchQuery = {
      slices: request.slices,
      passengers: request.passengers,
      cabinClass: request.cabinClass,
      maxConnections: request.directOnly ? 0 : null,
    };
    const hash = queryHash({ version: 1, query });

    const cachedId = await this.store.cachedSearchId('flights', hash);
    let meta = cachedId ? await this.store.meta<FlightSearchRequest>('flights', cachedId) : null;
    let items = meta ? await this.store.items<StoredOffer>('flights', meta.searchId) : null;
    const cacheHit = Boolean(meta && (items !== null || meta.resultCount === 0));
    if (!cacheHit) {
      const searchId = await this.fetchOnce(hash, query, request);
      meta = await this.store.meta<FlightSearchRequest>('flights', searchId);
      items = await this.store.items<StoredOffer>('flights', searchId);
    }
    if (!meta) throw searchUnavailable();
    return { meta, items: items ?? new Map<string, StoredOffer>(), cacheHit };
  }

  /** Identical concurrent searches share one supplier fetch (per process). */
  private fetchOnce(
    hash: string,
    query: FlightSearchQuery,
    request: FlightSearchRequest,
  ): Promise<string> {
    let pending = this.inflight.get(hash);
    if (!pending) {
      pending = this.fetch(hash, query, request).finally(() => this.inflight.delete(hash));
      this.inflight.set(hash, pending);
    }
    return pending;
  }

  private async fetch(
    hash: string,
    query: FlightSearchQuery,
    request: FlightSearchRequest,
  ): Promise<string> {
    const { results, outcomes } = await this.runner.searchAll(
      'flights',
      this.suppliers,
      (supplier, signal) => supplier.search(query, signal),
    );
    if (results.length === 0) throw searchUnavailable();

    const now = Date.now();
    const fx = await this.fx.converter();
    const toUsd = (offer: SupplierFlightOffer): Money => supplierTotalIn(fx, offer, 'USD');
    // The same itinerary from two suppliers: keep the cheaper one.
    const unique = new Map<string, SupplierFlightOffer>();
    for (const offer of results.flatMap((result) => result.items)) {
      if (
        Date.parse(offer.expiresAt) <= now ||
        Date.parse(offer.slices[0]?.departureUtc ?? '') <= now
      )
        continue;
      const key = itineraryKey(offer.slices, offer.slices[0]?.fareBrand ?? null, offer.cabinClass);
      const existing = unique.get(key);
      if (!existing || compare(toUsd(offer), toUsd(existing)) < 0) unique.set(key, offer);
    }

    const searchId = this.store.newSearchId('flights');
    const items = new Map<string, StoredOffer>();
    [...unique.values()].forEach((offer, index) => {
      const id = `${searchId}.${index.toString(36)}`;
      items.set(id, { id, offer });
    });
    const meta: SearchMeta<FlightSearchRequest> = {
      searchId,
      vertical: 'flights',
      request,
      suppliers: outcomes,
      partial: outcomes.some((outcome) => outcome.status !== 'ok'),
      resultCount: items.size,
      createdAt: new Date(now).toISOString(),
      resultsExpireAt: this.store.resultsExpireAt(now),
    };
    await this.store.save('flights', hash, meta, items, this.config.SEARCH_CACHE_TTL_SECONDS);
    return searchId;
  }

  private async view(
    meta: SearchMeta<FlightSearchRequest>,
    items: ReadonlyMap<string, StoredOffer>,
    options: FlightListOptions,
    client: ClientContext,
  ): Promise<FlightSearchResultDto> {
    const [pricer, fx] = await Promise.all([
      this.pricing.pricer('flights', options.currency),
      this.fx.converter(),
    ]);
    const now = new Date();
    const priced: PricedFlight[] = [...items.values()]
      .filter((item) => Date.parse(item.offer.expiresAt) > now.getTime())
      .map((item) => ({
        id: item.id,
        offer: item.offer,
        price: pricer(item.offer.price, flightPricingContext(item.offer, client, now)).breakdown,
      }));
    const facets = flightFacets(priced);
    const filtered = sortFlights(filterFlights(priced, options), options.sort);
    const { page, nextCursor } = paginate(filtered, options.cursor, options.limit);
    return {
      searchId: meta.searchId,
      status: meta.partial ? 'partial' : 'complete',
      request: meta.request,
      currency: options.currency,
      suppliers: meta.suppliers,
      resultsExpireAt: meta.resultsExpireAt,
      total: filtered.length,
      nextCursor,
      offers: page.map((item) => toFlightOfferDto(item.id, item.offer, item.price, fx)),
      facets: {
        ...facets,
        airlines: facets.airlines.map((entry) => ({ ...entry, minPrice: toWire(entry.minPrice) })),
        stops: facets.stops.map((entry) => ({ ...entry, minPrice: toWire(entry.minPrice) })),
        price: facets.price
          ? { min: toWire(facets.price.min), max: toWire(facets.price.max) }
          : null,
      },
    };
  }
}
