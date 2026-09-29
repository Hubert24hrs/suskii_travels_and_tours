import type { MetadataRoute } from 'next';

import { publicEnv } from '../lib/env';

/** Search result pages stay crawlable but carry noindex; email-link pages are private. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/newsletter/'] }],
    sitemap: `${publicEnv.siteUrl}/sitemap.xml`,
    host: publicEnv.siteUrl,
  };
}
