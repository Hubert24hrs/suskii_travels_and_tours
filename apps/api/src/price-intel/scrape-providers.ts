import type { ScrapeVendor } from '@suskii/shared';

import type { ScrapeProvider } from './scrape-provider';

/** DI token for the vendors enabled by `PRICE_INTEL_VENDORS`. */
export const SCRAPE_PROVIDERS = Symbol('SCRAPE_PROVIDERS');

/** The enabled vendors by name. A vendor that is not here is never called. */
export type ScrapeProviders = ReadonlyMap<ScrapeVendor, ScrapeProvider>;
