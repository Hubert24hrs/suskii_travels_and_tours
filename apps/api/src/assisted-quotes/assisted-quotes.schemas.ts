import { z } from 'zod';

import {
  ASSISTED_BOOKING_FAILURES,
  ASSISTED_QUOTE_CLOSE_REASONS,
  ASSISTED_QUOTE_PRODUCTS,
  ASSISTED_QUOTE_STATUSES,
  assistedOfferDetailsSchema,
  assistedQuoteInputSchema,
  assistedQuoteRequestSchema,
  BOOKING_STATUSES,
} from '@suskii/shared';

import { named } from '../contract/contract';
import { moneySchema } from '../pricing/pricing.schemas';

const timestamp = z.iso.datetime();
const uuid = z.uuid();

export const assistedQuoteParamsSchema = z.object({ assistedQuoteId: uuid });

export const assistedQuoteBodySchema = named('AssistedQuoteInput', assistedQuoteInputSchema);

/** What the traveller sees of a request, and of the offer made from it. */
export const assistedQuoteSchema = named(
  'AssistedQuote',
  z.object({
    id: uuid,
    reference: z.string().meta({ description: '`Q-` and six characters.' }),
    product: z.enum(ASSISTED_QUOTE_PRODUCTS),
    title: z.string(),
    request: assistedQuoteRequestSchema,
    currency: z.string().length(3),
    status: z.enum(ASSISTED_QUOTE_STATUSES).meta({
      description:
        '`requested` waits for a person; `offered` can be booked until `offer.expiresAt`; `booked` became the booking in `bookingId`; `unavailable` (with `closedReason`), `expired` and `withdrawn` are closed.',
    }),
    closedReason: z.string().nullable().meta({
      description:
        'Why it closed, as a code: one of the close reasons, `unanswered` or `offer_lapsed`.',
    }),
    indicative: z
      .object({ price: moneySchema, source: z.string(), seenAt: timestamp })
      .nullable()
      .meta({
        description:
          'The price seen on another website that the request came from (ADR-104): a reference only, never the price of the offer.',
      }),
    offer: z
      .object({
        quoteId: uuid.meta({
          description:
            'Book it as any quote: `GET /v1/quotes/{quoteId}`, then `POST /v1/bookings` with it.',
        }),
        total: moneySchema.meta({ description: 'What the traveller pays, all in.' }),
        details: assistedOfferDetailsSchema,
        expiresAt: timestamp,
      })
      .nullable(),
    bookingId: uuid.nullable(),
    answerBy: timestamp.meta({
      description: 'A request nobody answered by then closes as `expired`.',
    }),
    createdAt: timestamp,
  }),
);
export type AssistedQuoteDto = z.infer<typeof assistedQuoteSchema>;

export const assistedQuoteListSchema = named(
  'AssistedQuoteList',
  z.object({ quotes: z.array(assistedQuoteSchema) }),
);

// --- Staff -------------------------------------------------------------------------------

const httpsUrl = z
  .url({ protocol: /^https$/ })
  .max(500)
  .meta({ description: 'Where the proof is kept (a file store, a ticket): https only.' });

export const adminAssistedQuoteQuerySchema = z.object({
  queue: z.enum(['to_verify', 'to_book', 'all']).default('to_verify').meta({
    description:
      '`to_verify`: requests waiting for a price. `to_book`: paid bookings waiting to be booked with the supplier. `all`: the latest of everything.',
  }),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const adminAssistedQuoteSchema = named(
  'AdminAssistedQuote',
  assistedQuoteSchema.extend({
    userId: uuid,
    /** Internal: who sells it to Suskii, what they charge and where the proof is. */
    supplierName: z.string().nullable(),
    supplierPrice: moneySchema.nullable(),
    evidenceUrl: z.string().nullable(),
    verifiedBy: uuid.nullable(),
    verifiedAt: timestamp.nullable(),
    booking: z
      .object({
        id: uuid,
        reference: z.string(),
        status: z.enum(BOOKING_STATUSES),
        /** Paid, and waiting for a person to book it with the supplier. */
        waitsToBeBooked: z.boolean(),
        supplierReference: z.string().nullable(),
        evidenceUrl: z.string().nullable(),
      })
      .nullable(),
  }),
);
export type AdminAssistedQuoteDto = z.infer<typeof adminAssistedQuoteSchema>;

export const adminAssistedQuoteListSchema = named(
  'AdminAssistedQuoteList',
  z.object({ quotes: z.array(adminAssistedQuoteSchema) }),
);

export const offerAssistedQuoteSchema = named(
  'OfferAssistedQuote',
  z.object({
    supplierName: z.string().trim().min(2).max(120),
    supplierPrice: moneySchema.meta({
      description:
        "The supplier's live price for all of it, in the supplier's currency. The traveller's price is this plus the fees and taxes of the `assisted` vertical, converted to the quote's currency.",
    }),
    evidenceUrl: httpsUrl,
    details: assistedOfferDetailsSchema,
  }),
);
export type OfferAssistedQuoteInput = z.infer<typeof offerAssistedQuoteSchema>;

export const closeAssistedQuoteSchema = named(
  'CloseAssistedQuote',
  z.object({ reason: z.enum(ASSISTED_QUOTE_CLOSE_REASONS) }),
);

export const bookedAssistedQuoteSchema = named(
  'BookedAssistedQuote',
  z.object({
    supplierReference: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9][A-Za-z0-9/_-]{2,39}$/)
      .meta({ description: "The supplier's confirmation of the booking, as they wrote it." }),
    evidenceUrl: httpsUrl,
  }),
);

export const unbookableAssistedQuoteSchema = named(
  'UnbookableAssistedQuote',
  z.object({ reason: z.enum(ASSISTED_BOOKING_FAILURES) }),
);
