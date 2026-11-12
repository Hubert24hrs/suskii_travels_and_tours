import { Logger } from '@nestjs/common';
import { z } from 'zod';

import { parseMoney, type Money } from '@suskii/shared';

import { ActivityPartner, type ActivityProduct } from '../activity-partner';
import { countryName, type OfferTrip } from '../partner-programs';

/** Viator does not price in naira; prices come in dollars and are converted for display. */
const SEARCH_CURRENCY = 'USD';
const PRODUCT_HOSTS = ['www.viator.com', 'viator.com'];
/** Wide enough for a card on a phone without fetching the largest image. */
const IMAGE_WIDTH = 480;

export interface ViatorOptions {
  baseUrl: string;
  apiKey: string;
  campaign: string;
  fetch?: typeof fetch;
}

// The subset of the Partner API v2 freetext search we read. Products are validated one by one,
// so an odd product is skipped rather than failing the list.
const productSchema = z.looseObject({
  productCode: z.string().min(1).max(64),
  title: z.string().min(1).max(300),
  productUrl: z.string().min(1),
  images: z
    .array(
      z.looseObject({
        variants: z
          .array(z.looseObject({ url: z.string(), width: z.number().optional() }))
          .optional(),
      }),
    )
    .optional(),
  reviews: z
    .looseObject({
      totalReviews: z.number().int().nonnegative().optional(),
      combinedAverageRating: z.number().min(0).max(5).optional(),
    })
    .optional(),
  duration: z
    .looseObject({
      fixedDurationInMinutes: z.number().int().positive().optional(),
      variableDurationFromMinutes: z.number().int().positive().optional(),
    })
    .optional(),
  pricing: z
    .looseObject({
      summary: z.looseObject({ fromPrice: z.number().nonnegative().optional() }).optional(),
      currency: z.string().optional(),
    })
    .optional(),
});
const searchSchema = z.looseObject({
  products: z.looseObject({ results: z.array(z.unknown()).optional() }).optional(),
});

function placeTerm(trip: OfferTrip): string | null {
  const country = countryName(trip.countryCode);
  if (trip.cityName && country) return `${trip.cityName}, ${country}`;
  return trip.cityName ?? country;
}

function image(product: z.infer<typeof productSchema>): string | null {
  const variants = product.images?.[0]?.variants ?? [];
  const sorted = [...variants]
    .filter((variant) => variant.url.startsWith('https://'))
    .sort(
      (a, b) => Math.abs((a.width ?? 0) - IMAGE_WIDTH) - Math.abs((b.width ?? 0) - IMAGE_WIDTH),
    );
  return sorted[0]?.url ?? null;
}

function price(product: z.infer<typeof productSchema>): Money | null {
  const value = product.pricing?.summary?.fromPrice;
  const currency = product.pricing?.currency ?? SEARCH_CURRENCY;
  if (value === undefined || !/^[A-Z]{3}$/.test(currency)) return null;
  try {
    return parseMoney(value.toFixed(6), currency, 'half-up');
  } catch {
    return null;
  }
}

function productPage(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && PRODUCT_HOSTS.includes(parsed.hostname) ? url : null;
  } catch {
    return null;
  }
}

/**
 * Viator Partner API v2, Basic Access (ADR-069): freetext product search for the trip's place.
 * Returned product URLs already carry Suskii's affiliate id and the campaign value; they are used
 * as they are.
 */
export class ViatorActivityPartner extends ActivityPartner {
  readonly name = 'viator' as const;
  readonly sample = false;
  private readonly logger = new Logger(ViatorActivityPartner.name);
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: ViatorOptions) {
    super();
    this.fetchImpl = options.fetch ?? globalThis.fetch;
  }

  get campaign(): string {
    return this.options.campaign;
  }

  async search(trip: OfferTrip, limit: number, signal: AbortSignal): Promise<ActivityProduct[]> {
    const term = placeTerm(trip);
    if (!term) return [];
    const url = new URL(`${this.options.baseUrl}/search/freetext`);
    url.searchParams.set('campaign-value', this.options.campaign);
    const dateRange =
      trip.startDate && trip.endDate
        ? { dateRange: { from: trip.startDate, to: trip.endDate } }
        : {};
    const response = await this.fetchImpl(url, {
      method: 'POST',
      redirect: 'error',
      signal,
      headers: {
        'exp-api-key': this.options.apiKey,
        Accept: 'application/json;version=2.0',
        'Accept-Language': 'en-US',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        searchTerm: term,
        searchTypes: [{ searchType: 'PRODUCTS', pagination: { start: 1, count: limit } }],
        currency: SEARCH_CURRENCY,
        productFiltering: dateRange,
      }),
    });
    if (!response.ok) {
      // The key never appears in logs or errors.
      throw new Error(`Viator search failed with HTTP ${response.status}`);
    }
    const parsed = searchSchema.safeParse(await response.json());
    if (!parsed.success) throw new Error('Viator search returned an unexpected body');
    const products: ActivityProduct[] = [];
    for (const raw of parsed.data.products?.results ?? []) {
      const result = productSchema.safeParse(raw);
      if (!result.success) continue;
      const product = result.data;
      const page = productPage(product.productUrl);
      if (!page) {
        this.logger.warn(
          { code: product.productCode },
          'Viator product link on an unexpected host',
        );
        continue;
      }
      const { reviews, duration } = product;
      products.push({
        code: product.productCode,
        title: product.title,
        url: page,
        imageUrl: image(product),
        rating:
          reviews?.combinedAverageRating !== undefined && reviews.totalReviews
            ? { average: reviews.combinedAverageRating, count: reviews.totalReviews }
            : null,
        durationMinutes:
          duration?.fixedDurationInMinutes ?? duration?.variableDurationFromMinutes ?? null,
        fromPrice: price(product),
      });
      if (products.length >= limit) break;
    }
    return products;
  }
}
