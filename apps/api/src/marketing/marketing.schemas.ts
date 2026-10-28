import { z } from 'zod';

import { named } from '../contract/contract';

/** What one sweep of server-side ad conversions did (ADR-079). */
export const adConversionRunSchema = named(
  'AdConversionRun',
  z.object({
    sent: z.number().int().nonnegative(),
    retried: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    withdrawn: z.number().int().nonnegative(),
  }),
);
