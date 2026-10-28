import { z } from './zod-setup';

/**
 * Meta's `_fbp` and `_fbc` values: `fb.<subdomain index>.<creation time in ms>.<random or fbclid>`
 * (newer tags may append a short suffix to the last part).
 */
const metaClickId = z
  .string()
  .max(600)
  .regex(/^fb\.\d\.\d{10,16}\.[A-Za-z0-9_.-]{1,500}$/);

/** TikTok's `_ttp` cookie and `ttclid` parameter: opaque URL-safe tokens. */
const tiktokClickId = z
  .string()
  .max(500)
  .regex(/^[A-Za-z0-9_.-]{8,500}$/);

/**
 * What the website sends with a booking when its consent cookie allows marketing (ADR-079). The
 * API keeps it only when the recorded choice for `consentId` says so; the browser's word alone is
 * never enough.
 */
export const marketingAttributionSchema = z
  .object({
    consentId: z.uuid(),
    fbp: metaClickId.optional(),
    fbc: metaClickId.optional(),
    ttp: tiktokClickId.optional(),
    ttclid: tiktokClickId.optional(),
  })
  .strict();
export type MarketingAttribution = z.infer<typeof marketingAttributionSchema>;
