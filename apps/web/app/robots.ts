import type { MetadataRoute } from 'next';

import { publicEnv } from '../lib/env';

/**
 * Search result pages stay crawlable but carry noindex; email-link pages, checkout, payment and
 * booking pages, the account area, company invitations, live rides, shared live trips and the app's payment return are
 * private (they also carry noindex, as do the sign-in pages).
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        // Live rides and shared live-trip links are personal (ADR-050).
        disallow: [
          '/newsletter/',
          '/checkout/',
          // Metasearch landings quote with the supplier on every visit (ADR-081).
          '/flights/go/',
          '/bookings/',
          '/mobile/',
          '/account',
          '/company/',
          '/rides/',
          '/trip/',
          // Support conversations are private; the help page itself (/support) is not (ADR-083).
          '/support/',
        ],
      },
    ],
    sitemap: `${publicEnv.siteUrl}/sitemap.xml`,
    host: publicEnv.siteUrl,
  };
}
