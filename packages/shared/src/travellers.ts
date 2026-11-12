import { z } from './zod-setup';

import { MAX_TRAVELLERS, MIN_ADULTS, TRAVELLER_ISSUES, totalTravellers } from './traveller-rules';

export {
  DEFAULT_TRAVELLERS,
  MAX_TRAVELLERS,
  MIN_ADULTS,
  TRAVELLER_AGE_BANDS,
  TRAVELLER_ISSUES,
  TRAVELLER_TYPES,
  canDecrement,
  canIncrement,
  stepTravellers,
  totalTravellers,
  type TravellerCounts,
  type TravellerType,
} from './traveller-rules';

export const travellerCountsSchema = z
  .object({
    adults: z.number().int().min(MIN_ADULTS).max(MAX_TRAVELLERS),
    children: z
      .number()
      .int()
      .min(0)
      .max(MAX_TRAVELLERS - MIN_ADULTS),
    infants: z
      .number()
      .int()
      .min(0)
      .max(MAX_TRAVELLERS - MIN_ADULTS),
  })
  .superRefine((counts, ctx) => {
    if (counts.infants > counts.adults) {
      ctx.addIssue({
        code: 'custom',
        path: ['infants'],
        message: TRAVELLER_ISSUES.infantsExceedAdults,
      });
    }
    if (totalTravellers(counts) > MAX_TRAVELLERS) {
      ctx.addIssue({ code: 'custom', path: [], message: TRAVELLER_ISSUES.tooManyTravellers });
    }
  });
