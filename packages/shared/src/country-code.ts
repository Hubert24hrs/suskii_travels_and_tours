import { z } from './zod-setup';

/** ISO 3166-1 alpha-2, upper case. */
export const countryCodeSchema = z.string().regex(/^[A-Z]{2}$/, 'Use a 2-letter country code');
