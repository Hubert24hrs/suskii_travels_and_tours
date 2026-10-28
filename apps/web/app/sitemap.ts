import type { MetadataRoute } from 'next';
import { connection } from 'next/server';

import { api } from '../lib/api';
import { absoluteUrl } from '../lib/seo';

/**
 * Landing pages plus the programmatic route, flight hub, airline and city pages, packages, tours
 * and published CMS pages. Rendered on request (the API is not reachable at build time); the API reads come from
 * the data cache.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  await connection();
  const [routes, cities, airlines, destinations, site, packages, tours, cars] = await Promise.all([
    api.dealRoutes(),
    api.dealCities(),
    api.dealAirlines(),
    api.hotelDestinations('NGN'),
    api.site('en-NG'),
    api.packages({ currency: 'NGN', limit: '50' }),
    api.tours({ currency: 'NGN', limit: '50' }),
    api.carsFeatures(),
  ]);
  const staticPaths = [
    '/',
    '/flights',
    '/hotels',
    '/packages',
    '/tours',
    '/visa',
    '/travel-add-ons',
    '/deals',
    '/prime',
    '/support',
    // Cars landing pages, while their product is switched on (ADR-049).
    ...(cars && (cars.buses || cars.rides || cars.rentals) ? ['/cars'] : []),
    ...(cars?.buses ? ['/buses'] : []),
    ...(cars?.rides ? ['/rides'] : []),
    ...(cars?.rentals ? ['/rentals'] : []),
  ];
  return [
    ...staticPaths.map((path) => ({
      url: absoluteUrl(path),
      changeFrequency: 'daily' as const,
      priority: path === '/' ? 1 : 0.8,
    })),
    ...(routes?.routes ?? []).map((route) => ({
      url: absoluteUrl(`/flights/${route.slug}`),
      changeFrequency: 'daily' as const,
      priority: 0.7,
    })),
    // City hubs and airline pages (ADR-080), only where they have routes.
    ...(cities?.cities ?? [])
      .flatMap((city) => [
        ...(city.departures > 0 ? [`/flights/from/${city.slug}`] : []),
        ...(city.arrivals > 0 ? [`/flights/to/${city.slug}`] : []),
      ])
      .map((path) => ({
        url: absoluteUrl(path),
        changeFrequency: 'daily' as const,
        priority: 0.6,
      })),
    ...(airlines?.airlines ?? []).map((airline) => ({
      url: absoluteUrl(`/airlines/${airline.code.toLowerCase()}`),
      changeFrequency: 'weekly' as const,
      priority: 0.5,
    })),
    ...(destinations?.destinations ?? []).map((destination) => ({
      url: absoluteUrl(`/hotels/${destination.slug}`),
      changeFrequency: 'daily' as const,
      priority: 0.7,
    })),
    // Sample (demo) products are noindex, so they stay out of the sitemap too.
    ...(packages?.packages ?? [])
      .filter((item) => !item.sample)
      .map((item) => ({
        url: absoluteUrl(`/packages/${item.slug}`),
        changeFrequency: 'weekly' as const,
        priority: 0.6,
      })),
    ...(tours?.tours ?? [])
      .filter((item) => !item.sample)
      .map((item) => ({
        url: absoluteUrl(`/tours/${item.slug}`),
        changeFrequency: 'weekly' as const,
        priority: 0.6,
      })),
    ...(site?.pages ?? []).map((page) => ({
      url: absoluteUrl(`/info/${page.slug}`),
      changeFrequency: 'monthly' as const,
      priority: 0.3,
    })),
  ];
}
