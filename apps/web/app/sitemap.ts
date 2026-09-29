import type { MetadataRoute } from 'next';

import { api } from '../lib/api';
import { absoluteUrl } from '../lib/seo';

export const revalidate = 3600;

/** Landing pages plus the programmatic route and city pages and published CMS pages. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [routes, destinations, site] = await Promise.all([
    api.dealRoutes(),
    api.hotelDestinations('NGN'),
    api.site('en-NG'),
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
    ...(destinations?.destinations ?? []).map((destination) => ({
      url: absoluteUrl(`/hotels/${destination.slug}`),
      changeFrequency: 'daily' as const,
      priority: 0.7,
    })),
    ...(site?.pages ?? []).map((page) => ({
      url: absoluteUrl(`/info/${page.slug}`),
      changeFrequency: 'monthly' as const,
      priority: 0.3,
    })),
  ];
}
