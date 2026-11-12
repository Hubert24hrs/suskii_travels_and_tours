import { META_CLICK_ID, TIKTOK_CLICK_ID, type MarketingAttribution } from './ad-tracking';
import { z } from './zod-setup';

const metaClickId = z.string().max(600).regex(META_CLICK_ID);
const tiktokClickId = z.string().max(500).regex(TIKTOK_CLICK_ID);

/**
 * The booking's `marketing` field (ADR-079). The API keeps it only when the recorded choice for
 * `consentId` says so; the browser's word alone is never enough.
 */
export const marketingAttributionSchema = z
  .object({
    consentId: z.uuid(),
    fbp: metaClickId.optional(),
    fbc: metaClickId.optional(),
    ttp: tiktokClickId.optional(),
    ttclid: tiktokClickId.optional(),
  })
  .strict() satisfies z.ZodType<MarketingAttribution>;
