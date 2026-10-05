import type { Schemas } from '@suskii/api-client';

import { apiInternalUrl, CLIENT_ID } from './env';
import { warn } from './log';

interface GetOptions {
  /** Seconds the response may be served from the Next.js data cache. */
  revalidate: number;
  tags?: string[];
  query?: Record<string, string | undefined>;
}

/**
 * Server-side API read with data caching (ADR-010: pages render per request for the nonce CSP,
 * data is cached). Returns `null` when the resource is missing or the API is unavailable, so a
 * section degrades instead of failing the whole page.
 */
async function apiGet<T>(path: string, options: GetOptions): Promise<T | null> {
  const url = new URL(path, apiInternalUrl());
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, value);
  }
  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json', 'X-Suskii-Client': CLIENT_ID },
      next: { revalidate: options.revalidate, ...(options.tags ? { tags: options.tags } : {}) },
    });
    if (response.status === 404) return null;
    if (!response.ok) {
      warn(`[api] GET ${url.pathname} answered ${response.status}`);
      return null;
    }
    return (await response.json()) as T;
  } catch {
    warn(`[api] GET ${url.pathname} failed: API unreachable`);
    return null;
  }
}

const ONE_MINUTE = 60;
const FIVE_MINUTES = 300;
const ONE_HOUR = 3600;
const ONE_DAY = 86_400;

export const api = {
  site: (locale: string) =>
    apiGet<Schemas['SiteContent']>('/v1/content/site', {
      revalidate: FIVE_MINUTES,
      tags: ['content'],
      query: { locale },
    }),
  home: (locale: string) =>
    apiGet<Schemas['HomeContent']>('/v1/content/home', {
      revalidate: FIVE_MINUTES,
      tags: ['content'],
      query: { locale },
    }),
  page: (slug: string, locale: string) =>
    apiGet<Schemas['ContentPage']>(`/v1/content/pages/${encodeURIComponent(slug)}`, {
      revalidate: FIVE_MINUTES,
      tags: ['content'],
      query: { locale },
    }),
  deals: (currency: string, origin?: string) =>
    apiGet<Schemas['FlightDeals']>('/v1/deals/flights', {
      revalidate: FIVE_MINUTES,
      tags: ['deals'],
      query: { currency, origin, limit: '24' },
    }),
  dealRoutes: () =>
    apiGet<Schemas['DealRoutes']>('/v1/deals/routes', { revalidate: ONE_HOUR, tags: ['deals'] }),
  dealRoute: (slug: string, currency: string) =>
    apiGet<Schemas['DealRouteDetail']>(`/v1/deals/routes/${encodeURIComponent(slug)}`, {
      revalidate: FIVE_MINUTES,
      tags: ['deals'],
      query: { currency },
    }),
  hotelDestinations: (currency: string) =>
    apiGet<Schemas['HotelDestinations']>('/v1/destinations/hotels', {
      revalidate: FIVE_MINUTES,
      tags: ['destinations'],
      query: { currency },
    }),
  hotelDestination: (slug: string, currency: string) =>
    apiGet<Schemas['HotelDestination']>(`/v1/destinations/hotels/${encodeURIComponent(slug)}`, {
      revalidate: FIVE_MINUTES,
      tags: ['destinations'],
      query: { currency },
    }),
  city: (cityId: string) =>
    apiGet<Schemas['City']>(`/v1/catalog/cities/${encodeURIComponent(cityId)}`, {
      revalidate: ONE_DAY,
    }),
  countries: () =>
    apiGet<Schemas['Countries']>('/v1/catalog/countries', {
      revalidate: ONE_DAY,
      tags: ['catalog'],
    }),
  // In-house catalog (ADR-025). Seats move with every booking, so details are cached briefly;
  // the quote re-checks availability and price against the database anyway.
  packages: (query: Record<string, string | undefined>) =>
    apiGet<Schemas['PackageList']>('/v1/packages', {
      revalidate: ONE_MINUTE,
      tags: ['inhouse'],
      query,
    }),
  package: (slug: string, query: Record<string, string | undefined>) =>
    apiGet<Schemas['PackageDetail']>(`/v1/packages/${encodeURIComponent(slug)}`, {
      revalidate: ONE_MINUTE,
      tags: ['inhouse'],
      query,
    }),
  tours: (query: Record<string, string | undefined>) =>
    apiGet<Schemas['TourList']>('/v1/tours', { revalidate: ONE_MINUTE, tags: ['inhouse'], query }),
  tour: (slug: string, query: Record<string, string | undefined>) =>
    apiGet<Schemas['TourDetail']>(`/v1/tours/${encodeURIComponent(slug)}`, {
      revalidate: ONE_MINUTE,
      tags: ['inhouse'],
      query,
    }),
  addons: (query: Record<string, string | undefined>) =>
    apiGet<Schemas['AddonList']>('/v1/addons', {
      revalidate: FIVE_MINUTES,
      tags: ['inhouse'],
      query,
    }),
  visaEligibility: (query: Record<string, string | undefined>) =>
    apiGet<Schemas['VisaEligibility']>('/v1/visa/eligibility', {
      revalidate: FIVE_MINUTES,
      tags: ['inhouse'],
      query,
    }),
  visaProducts: (query: Record<string, string | undefined>) =>
    apiGet<Schemas['VisaProductList']>('/v1/visa/products', {
      revalidate: FIVE_MINUTES,
      tags: ['inhouse'],
      query,
    }),
  visaProduct: (slug: string, currency: string) =>
    apiGet<Schemas['VisaProductDetail']>(`/v1/visa/products/${encodeURIComponent(slug)}`, {
      revalidate: FIVE_MINUTES,
      tags: ['inhouse'],
      query: { currency },
    }),
  airport: (code: string) =>
    apiGet<Schemas['Airport']>(`/v1/catalog/airports/${encodeURIComponent(code)}`, {
      revalidate: ONE_DAY,
    }),
  // Plans are staff-managed data; the purchase quote re-reads the plan anyway (ADR-030).
  primePlans: (currency: string) =>
    apiGet<Schemas['PrimePlanList']>('/v1/prime/plans', {
      revalidate: ONE_MINUTE,
      tags: ['prime'],
      query: { currency },
    }),
};

export type SiteContent = Schemas['SiteContent'];
export type HomeContent = Schemas['HomeContent'];
export type FlightDeal = Schemas['FlightDeal'];
export type HotelDestination = Schemas['HotelDestination'];
export type PackageCard = Schemas['PackageCard'];
export type TourCard = Schemas['TourCard'];
