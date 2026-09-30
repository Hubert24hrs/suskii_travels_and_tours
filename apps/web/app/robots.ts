import type { MetadataRoute } from 'next';

import { publicEnv } from '../lib/env';

/**
 * Search result pages stay crawlable but carry noindex; email-link pages, checkout, payment and
 * booking pages and the app's payment return are private (they also carry noindex).
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/newsletter/', '/checkout/', '/bookings/', '/mobile/'],
      },
    ],
    sitemap: `${publicEnv.siteUrl}/sitemap.xml`,
    host: publicEnv.siteUrl,
  };
}
