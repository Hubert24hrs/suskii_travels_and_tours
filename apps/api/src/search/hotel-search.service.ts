import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { z } from 'zod';

import {
  compare,
  daysBetween,
  equals,
  localDate,
  multiplyRatio,
  subtract,
  toWire,
  type HotelSearchRequest,
  type Money,
} from '@suskii/shared';

import { CatalogService } from '../catalog/catalog.service';
import { toJsonValue } from '../common/json';
import { APP_CONFIG, type AppConfig } from '../config/config';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../infra/prisma.service';
import { FxService, type Converter } from '../pricing/fx.service';
import type { PricingContext } from '../pricing/pricing-engine';
import { toPriceDto } from '../pricing/pricing.schemas';
import { PricingService, type Pricer } from '../pricing/pricing.service';
import { OfferUnavailableError } from '../suppliers/supplier.errors';
import type {
  HotelSearchQuery,
  HotelSupplier,
  SupplierHotel,
  SupplierHotelRate,
} from '../suppliers/supplier.types';
import { HOTEL_SUPPLIERS } from '../suppliers/suppliers.module';

import type { ClientContext } from './client-context';
import {
  filterHotels,
  hotelFacets,
  paginate,
  sortHotels,
  type HotelFilters,
  type HotelSort,
  type PricedHotel,
  type PricedRate,
} from './results';
import {
  invalidSearch,
  offerUnavailable,
  searchExpired,
  searchUnavailable,
  supplierUnavailable,
} from './search.errors';
import type {
  hotelDetailSchema,
  hotelQuoteSchema,
  hotelRateSchema,
  hotelSearchResultSchema,
} from './search.schemas';
import { SearchLogService } from './search-log.service';
import { queryHash, SearchStore, type SearchMeta } from './search-store';
import { SupplierRunner } from './supplier-runner';

type HotelSearchResultDto = z.infer<typeof hotelSearchResultSchema>;
type HotelDetailDto = z.infer<typeof hotelDetailSchema>;
type HotelRateDto = z.infer<typeof hotelRateSchema>;
type HotelQuoteDto = z.infer<typeof hotelQuoteSchema>;

interface StoredHotel {
  id: string;
  hotel: SupplierHotel;
}

export interface HotelListOptions extends HotelFilters {
  sort: HotelSort;
  currency: string;
  cursor?: string | undefined;
  limit: number;
}

const FIRST_PAGE = 20;

export function hotelPricingContext(
  hotel: SupplierHotel,
  request: HotelSearchRequest,
  client: ClientContext,
  now: Date,
): PricingContext {
  return {
    vertical: 'hotels',
    supplier: hotel.supplier,
    channel: client.channel,
    userTier: client.userTier,
    destinationCountry: hotel.countryCode,
    // Per-passenger fees apply per guest.
    passengers: request.rooms.reduce((acc, room) => acc + room.adults + room.childAges.length, 0),
    now,
  };
}

const nightsOf = (request: HotelSearchRequest): number =>
  daysBetween(request.checkIn, request.checkOut);

function priceHotel(
  item: StoredHotel,
  request: HotelSearchRequest,
  pricer: Pricer,
  client: ClientContext,
  now: Date,
): PricedHotel | null {
  const context = hotelPricingContext(item.hotel, request, client, now);
  const rates: PricedRate[] = item.hotel.rates
    .map((rate, index) => ({
      id: `${item.id}.r${index.toString(36)}`,
      rate,
      price: pricer(rate.price, context).breakdown,
    }))
    .filter(({ rate }) => Date.parse(rate.expiresAt) > now.getTime());
  const cheapest = rates.reduce<PricedRate | undefined>(
    (best, rate) => (best && best.price.total.minor <= rate.price.total.minor ? best : rate),
    undefined,
  );
  return cheapest ? { id: item.id, hotel: item.hotel, rates, cheapest } : null;
}

export function toHotelRateDto(rate: PricedRate, nights: number, fx: Converter): HotelRateDto {
  return {
    id: rate.id,
    roomName: rate.rate.roomName,
    board: rate.rate.board,
    refundable: rate.rate.refundable,
    freeCancellationUntil: rate.rate.freeCancellationUntil,
    price: toPriceDto(rate.price),
    pricePerNight: toWire(multiplyRatio(rate.price.total, 1, Math.max(nights, 1), 'half-up')),
    payAtProperty: rate.rate.payAtProperty
      ? toWire(fx.convert(rate.rate.payAtProperty, rate.price.currency))
      : null,
    expiresAt: rate.rate.expiresAt,
  };
}

const hotelBase = (hotel: SupplierHotel, id: string) => ({
  id,
  supplier: hotel.supplier,
  name: hotel.name,
  stars: hotel.stars,
  reviewScore: hotel.reviewScore,
  reviewCount: hotel.reviewCount,
  latitude: hotel.latitude,
  longitude: hotel.longitude,
  area: hotel.area,
  cityName: hotel.cityName,
  countryCode: hotel.countryCode,
  amenities: hotel.amenities,
});

/** Hotel search orchestration, mirroring flights: cache, parallel suppliers, pricing, filters, quotes. */
@Injectable()
export class HotelSearchService {
  private readonly inflight = new Map<string, Promise<string>>();

  constructor(
    @Inject(HOTEL_SUPPLIERS) private readonly suppliers: HotelSupplier[],
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
    request: HotelSearchRequest,
    currency: string,
    client: ClientContext,
  ): Promise<HotelSearchResultDto> {
    const started = performance.now();
    const { meta, items, cacheHit } = await this.resolve(request);
    const result = await this.view(
      meta,
      items,
      { sort: 'recommended', currency, limit: FIRST_PAGE },
      client,
    );
    this.searchLog.record({
      vertical: 'hotels',
      origin: null,
      destination: request.destination.cityId,
      departureDate: request.checkIn,
      returnDate: request.checkOut,
      sliceCount: null,
      travellers: request.rooms.reduce((acc, room) => acc + room.adults + room.childAges.length, 0),
      cabinClass: null,
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
   * Hotel count and the cheapest bookable rate for a stay, compared on the supplier total in USD.
   * Used by the hotel destinations refresh (ADR-011); shares the customer search cache.
   */
  async stayAvailability(request: HotelSearchRequest): Promise<{
    hotelCount: number;
    cheapest: { hotel: SupplierHotel; rate: SupplierHotelRate } | null;
  }> {
    const { items } = await this.resolve(request);
    const fx = await this.fx.converter();
    const now = Date.now();
    let best: { hotel: SupplierHotel; rate: SupplierHotelRate; usd: Money } | null = null;
    for (const { hotel } of items.values()) {
      for (const rate of hotel.rates) {
        if (Date.parse(rate.expiresAt) <= now) continue;
        const usd = fx.convert(
          {
            minor: rate.price.base.minor + rate.price.taxes.minor,
            currency: rate.price.base.currency,
          },
          'USD',
        );
        if (!best || compare(usd, best.usd) < 0) best = { hotel, rate, usd };
      }
    }
    return {
      hotelCount: items.size,
      cheapest: best ? { hotel: best.hotel, rate: best.rate } : null,
    };
  }

  async list(
    searchId: string,
    options: HotelListOptions,
    client: ClientContext,
  ): Promise<HotelSearchResultDto> {
    const meta = await this.store.meta<HotelSearchRequest>('hotels', searchId);
    if (!meta) throw new NotFoundException();
    const items = await this.store.items<StoredHotel>('hotels', searchId);
    if (!items && (meta.resultCount > 0 || Date.parse(meta.resultsExpireAt) <= Date.now()))
      throw searchExpired(meta.request);
    return this.view(meta, items ?? new Map(), options, client);
  }

  async hotel(hotelId: string, currency: string, client: ClientContext): Promise<HotelDetailDto> {
    const { meta, item } = await this.load(hotelId);
    const [pricer, fx] = await Promise.all([
      this.pricing.pricer('hotels', currency),
      this.fx.converter(),
    ]);
    const priced = priceHotel(item, meta.request, pricer, client, new Date());
    if (!priced) throw offerUnavailable(meta.request);
    const nights = nightsOf(meta.request);
    return {
      ...hotelBase(item.hotel, item.id),
      nights,
      rates: [...priced.rates]
        .sort((a, b) => Number(a.price.total.minor - b.price.total.minor))
        .map((rate) => toHotelRateDto(rate, nights, fx)),
    };
  }

  async quote(rateId: string, currency: string, client: ClientContext): Promise<HotelQuoteDto> {
    const hotelId = rateId.slice(0, rateId.lastIndexOf('.r'));
    const index = Number.parseInt(rateId.slice(rateId.lastIndexOf('.r') + 2), 36);
    const { meta, item } = await this.load(hotelId);
    const rate = item.hotel.rates[index];
    if (!rate || Date.parse(rate.expiresAt) <= Date.now()) throw offerUnavailable(meta.request);
    const supplier = this.suppliers.find((candidate) => candidate.name === item.hotel.supplier);
    if (!supplier) throw offerUnavailable(meta.request);
    const query = await this.supplierQuery(meta.request, false);
    let fresh: SupplierHotelRate;
    try {
      fresh = await this.runner.call('hotels', supplier.name, 'reprice', (signal) =>
        supplier.reprice(item.hotel, rate, query, signal),
      );
    } catch (error) {
      if (error instanceof OfferUnavailableError) throw offerUnavailable(meta.request);
      throw supplierUnavailable();
    }
    const [pricer, fx] = await Promise.all([
      this.pricing.pricer('hotels', currency),
      this.fx.converter(),
    ]);
    const context = hotelPricingContext(item.hotel, meta.request, client, new Date());
    const previous = pricer(rate.price, context).breakdown;
    const current = pricer(fresh.price, context).breakdown;
    const hotel = { ...item.hotel, rates: [fresh] };
    const quote = await this.prisma.offer.create({
      data: {
        vertical: 'hotels',
        supplier: supplier.name,
        supplierOfferId: fresh.supplierRateId,
        payload: toJsonValue({
          kind: 'hotel',
          hotel,
          request: meta.request,
          query,
        }) as Prisma.InputJsonValue,
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
    const nights = nightsOf(meta.request);
    return {
      quoteId: quote.id,
      hotel: {
        id: item.id,
        name: item.hotel.name,
        stars: item.hotel.stars,
        cityName: item.hotel.cityName,
      },
      rate: toHotelRateDto({ id: rateId, rate: fresh, price: current }, nights, fx),
      nights,
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
    hotelId: string,
  ): Promise<{ meta: SearchMeta<HotelSearchRequest>; item: StoredHotel }> {
    const searchId = hotelId.split('.')[0] ?? '';
    const meta = await this.store.meta<HotelSearchRequest>('hotels', searchId);
    if (!meta) throw new NotFoundException();
    const item = await this.store.item<StoredHotel>('hotels', searchId, hotelId);
    if (!item) throw offerUnavailable(meta.request);
    return { meta, item };
  }

  /** The cached result set for the normalised query, or a fresh supplier fetch. */
  private async resolve(request: HotelSearchRequest): Promise<{
    meta: SearchMeta<HotelSearchRequest>;
    items: Map<string, StoredHotel>;
    cacheHit: boolean;
  }> {
    const query = await this.supplierQuery(request, true);
    const hash = queryHash({ version: 1, query });

    const cachedId = await this.store.cachedSearchId('hotels', hash);
    let meta = cachedId ? await this.store.meta<HotelSearchRequest>('hotels', cachedId) : null;
    let items = meta ? await this.store.items<StoredHotel>('hotels', meta.searchId) : null;
    const cacheHit = Boolean(meta && (items !== null || meta.resultCount === 0));
    if (!cacheHit) {
      const searchId = await this.fetchOnce(hash, query, request);
      meta = await this.store.meta<HotelSearchRequest>('hotels', searchId);
      items = await this.store.items<StoredHotel>('hotels', searchId);
    }
    if (!meta) throw searchUnavailable();
    return { meta, items: items ?? new Map<string, StoredHotel>(), cacheHit };
  }

  /** Resolves the city; on a new search, check-in may not be before today in the city's zone. */
  private async supplierQuery(
    request: HotelSearchRequest,
    validate: boolean,
  ): Promise<HotelSearchQuery> {
    const city = await this.catalog.city(request.destination.cityId);
    if (!city) {
      throw invalidSearch([
        {
          location: 'body',
          path: 'destination.cityId',
          code: 'unknown_city',
          message: 'Unknown city',
        },
      ]);
    }
    if (validate && request.checkIn < localDate(new Date(), city.timeZone ?? 'UTC')) {
      throw invalidSearch([
        { location: 'body', path: 'checkIn', code: 'date_in_past', message: 'date_in_past' },
      ]);
    }
    return {
      city,
      checkIn: request.checkIn,
      checkOut: request.checkOut,
      rooms: request.rooms,
      freeCancellationOnly: request.freeCancellationOnly,
    };
  }

  private fetchOnce(
    hash: string,
    query: HotelSearchQuery,
    request: HotelSearchRequest,
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
    query: HotelSearchQuery,
    request: HotelSearchRequest,
  ): Promise<string> {
    const { results, outcomes } = await this.runner.searchAll(
      'hotels',
      this.suppliers,
      (supplier, signal) => supplier.search(query, signal),
    );
    if (results.length === 0) throw searchUnavailable();
    const now = Date.now();
    const searchId = this.store.newSearchId('hotels');
    const items = new Map<string, StoredHotel>();
    results
      .flatMap((result) => result.items)
      .filter((hotel) => hotel.rates.some((rate) => Date.parse(rate.expiresAt) > now))
      .forEach((hotel, index) => {
        const id = `${searchId}.h${index.toString(36)}`;
        items.set(id, { id, hotel });
      });
    const meta: SearchMeta<HotelSearchRequest> = {
      searchId,
      vertical: 'hotels',
      request,
      suppliers: outcomes,
      partial: outcomes.some((outcome) => outcome.status !== 'ok'),
      resultCount: items.size,
      createdAt: new Date(now).toISOString(),
      resultsExpireAt: this.store.resultsExpireAt(now),
    };
    await this.store.save('hotels', hash, meta, items, this.config.SEARCH_CACHE_TTL_SECONDS);
    return searchId;
  }

  private async view(
    meta: SearchMeta<HotelSearchRequest>,
    items: ReadonlyMap<string, StoredHotel>,
    options: HotelListOptions,
    client: ClientContext,
  ): Promise<HotelSearchResultDto> {
    const [pricer, fx] = await Promise.all([
      this.pricing.pricer('hotels', options.currency),
      this.fx.converter(),
    ]);
    const now = new Date();
    const nights = nightsOf(meta.request);
    const priced = [...items.values()]
      .map((item) => priceHotel(item, meta.request, pricer, client, now))
      .filter((item): item is PricedHotel => item !== null);
    const facets = hotelFacets(priced);
    const filtered = sortHotels(filterHotels(priced, options), options.sort);
    const { page, nextCursor } = paginate(filtered, options.cursor, options.limit);
    return {
      searchId: meta.searchId,
      status: meta.partial ? 'partial' : 'complete',
      request: meta.request,
      currency: options.currency,
      nights,
      suppliers: meta.suppliers,
      resultsExpireAt: meta.resultsExpireAt,
      total: filtered.length,
      nextCursor,
      hotels: page.map((item) => ({
        ...hotelBase(item.hotel, item.id),
        cheapestRate: toHotelRateDto(item.cheapest, nights, fx),
        freeCancellationAvailable: item.rates.some(({ rate }) => rate.refundable),
      })),
      facets: {
        ...facets,
        stars: facets.stars.map((entry) => ({ ...entry, minPrice: toWire(entry.minPrice) })),
        price: facets.price
          ? { min: toWire(facets.price.min), max: toWire(facets.price.max) }
          : null,
      },
    };
  }
}
