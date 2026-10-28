import { z } from 'zod';

/**
 * The parts of Expedia Rapid responses the adapter reads (ADR-086), from the official Rapid
 * Java SDK 5.4.1 models. Everything else is ignored; amounts stay decimal strings until they are
 * parsed to minor units.
 */

const amount = z.object({ value: z.string(), currency: z.string().length(3) });
const charge = z.object({
  billable_currency: amount.optional(),
  request_currency: amount.optional(),
});

const link = z.object({
  method: z.string().optional(),
  href: z.string().min(1),
  expires: z.string().optional(),
});

export const expediaPricingSchema = z.object({
  totals: z
    .object({
      inclusive: charge.optional(),
      exclusive: charge.optional(),
      property_fees: charge.optional(),
    })
    .optional(),
});
export type ExpediaPricing = z.infer<typeof expediaPricingSchema>;

export const expediaCancelPenaltySchema = z.object({
  start: z.string().optional(),
  end: z.string().optional(),
  amount: z.string().optional(),
  nights: z.string().optional(),
  percent: z.string().optional(),
  currency: z.string().optional(),
});

export const expediaRateSchema = z.object({
  id: z.string(),
  status: z.string().optional(),
  refundable: z.boolean().optional(),
  merchant_of_record: z.string().optional(),
  amenities: z.record(z.string(), z.object({ name: z.string().optional() })).optional(),
  bed_groups: z
    .record(
      z.string(),
      z.object({
        id: z.string().optional(),
        description: z.string().optional(),
        links: z.object({ price_check: link }).optional(),
      }),
    )
    .optional(),
  cancel_penalties: z.array(expediaCancelPenaltySchema).optional(),
  occupancy_pricing: z.record(z.string(), expediaPricingSchema).optional(),
});
export type ExpediaRate = z.infer<typeof expediaRateSchema>;

export const expediaPropertySchema = z.object({
  property_id: z.string(),
  status: z.string().optional(),
  rooms: z
    .array(
      z.object({
        id: z.string().optional(),
        room_name: z.string().optional(),
        rates: z.array(z.unknown()).optional(),
      }),
    )
    .optional(),
});
export type ExpediaProperty = z.infer<typeof expediaPropertySchema>;

export const expediaAvailabilitySchema = z.array(z.unknown());

export const expediaGeographySchema = z.record(z.string(), z.unknown());

export const expediaContentSchema = z.object({
  property_id: z.string().optional(),
  name: z.string().min(1),
  address: z
    .object({
      line_1: z.string().optional(),
      city: z.string().optional(),
      country_code: z.string().optional(),
    })
    .optional(),
  ratings: z
    .object({
      property: z.object({ rating: z.string().optional() }).optional(),
      guest: z.object({ overall: z.string().optional(), count: z.number().optional() }).optional(),
    })
    .optional(),
  location: z
    .object({
      coordinates: z.object({ latitude: z.number(), longitude: z.number() }).optional(),
    })
    .optional(),
});
export type ExpediaContent = z.infer<typeof expediaContentSchema>;

export const expediaContentMapSchema = z.record(z.string(), z.unknown());

export const expediaPriceCheckSchema = z.object({
  status: z.string(),
  occupancy_pricing: z.record(z.string(), expediaPricingSchema).optional(),
  links: z.object({ book: link.optional() }).optional(),
});
export type ExpediaPriceCheck = z.infer<typeof expediaPriceCheckSchema>;

export const expediaItinerarySchema = z.object({ itinerary_id: z.string().min(1) });

export const expediaErrorSchema = z.object({
  type: z.string().optional(),
  message: z.string().optional(),
});
