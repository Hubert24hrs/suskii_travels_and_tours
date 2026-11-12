import { Injectable, type OnModuleInit } from '@nestjs/common';
import { z } from 'zod';

import {
  ASSISTED_QUOTE_PRODUCTS,
  CUSTOMER_AGENTS,
  PRICE_PRODUCTS,
  assistedQuoteInputSchema,
  isoDateSchema,
  type AgentCard,
} from '@suskii/shared';

import type { AssistedQuoteDto } from '../../assisted-quotes/assisted-quotes.schemas';
import { AssistedQuotesService } from '../../assisted-quotes/assisted-quotes.service';
import { priceQuerySchema, type PriceObservationDto } from '../../price-intel/price-intel.schemas';
import { PriceIntelService } from '../../price-intel/price-intel.service';
import { PriceSourcesService } from '../../price-intel/price-sources.service';
import { AgentFlags } from '../agent-flags';
import { agentTool, AgentToolRegistry } from '../agent-tool';

import {
  AgentToolCallers,
  card,
  cardsOut,
  issueCodes,
  moneyOut,
  problemCodes,
  problemsSchema,
  supplierText,
  utcTime,
} from './tool-support';

/** Sites asked for one question, and prices shown from them: reading costs money (ADR-102). */
const SOURCES_PER_QUESTION = 2;
const PRICES_SHOWN = 5;

const quoteOut = z.object({
  quoteId: z.uuid(),
  what: z.string(),
  product: z.string(),
  startDate: z.string(),
  endDate: z.string().nullable(),
  adults: z.number().int(),
  children: z.number().int(),
  /** `waiting_for_a_person`, `on_offer`, `became_a_booking`, or how it closed. */
  quoteState: z.string(),
  whyItClosed: z.string().nullable(),
  /** What the traveller would pay, all in: only while on offer. */
  offeredTotal: moneyOut.nullable(),
  offerCanBeBookedUntil: z.string().nullable(),
  bookingId: z.uuid().nullable(),
  answerExpectedBy: z.string(),
});

const STATES: Readonly<Record<AssistedQuoteDto['status'], string>> = {
  requested: 'waiting_for_a_person',
  offered: 'on_offer',
  // Not a confirmation: the booking's own status says where it stands.
  booked: 'became_a_booking',
  unavailable: 'could_not_be_had',
  expired: 'ran_out_of_time',
  withdrawn: 'withdrawn_by_the_traveller',
};

const quoteOf = (quote: AssistedQuoteDto): z.infer<typeof quoteOut> => ({
  quoteId: quote.id,
  what: supplierText(quote.title, 160),
  product: quote.product,
  startDate: quote.request.startDate,
  endDate: quote.request.endDate,
  adults: quote.request.adults,
  children: quote.request.children,
  quoteState: STATES[quote.status],
  whyItClosed: quote.closedReason,
  offeredTotal: quote.offer?.total ?? null,
  offerCanBeBookedUntil: quote.offer ? utcTime(quote.offer.expiresAt) : null,
  bookingId: quote.bookingId,
  answerExpectedBy: utcTime(quote.answerBy),
});

const quoteCard = (quote: AssistedQuoteDto): AgentCard[] =>
  card(
    'price',
    supplierText(quote.title, 120),
    [
      quote.request.endDate
        ? `${quote.request.startDate} \u2192 ${quote.request.endDate}`
        : quote.request.startDate,
    ],
    {
      ...(quote.offer ? { price: quote.offer.total } : {}),
      href: `/quotes/${quote.id}`,
    },
  );

/**
 * Prices seen on other websites, and the request to have one confirmed (ADR-102, ADR-104).
 * A price read from a site is an observation, never an offer: it is returned as `indicative`,
 * with where and when it was seen, on a card the clients mark so. It is sold only through an
 * assisted quote, which a person verifies; the assistant can ask for one for the signed-in
 * traveller and read its answer, and decides nothing about it.
 */
@Injectable()
export class QuoteTools implements OnModuleInit {
  constructor(
    private readonly registry: AgentToolRegistry,
    private readonly callers: AgentToolCallers,
    private readonly flags: AgentFlags,
    private readonly intel: PriceIntelService,
    private readonly sources: PriceSourcesService,
    private readonly quotes: AssistedQuotesService,
  ) {}

  onModuleInit(): void {
    const shoppers = ['flights', 'hotels', 'cars', 'tours', 'trip_builder', 'concierge'] as const;

    this.registry.register(
      agentTool({
        name: 'prices.indicative',
        description:
          "Prices seen on other websites for a flight (origin and destination as IATA codes), a hotel, a car, a transfer or a tour (place by name), on given dates. These are NOT Suskii's prices and cannot be booked: each was seen on the site named, at the time given, and may have changed. Always say so, and that a person confirms the live price before anything is paid. Never call one confirmed or available. Use it only when the ordinary search has nothing suitable or the traveller asks what it costs elsewhere; quotes.request asks for one to be confirmed.",
        tier: 'read',
        scope: 'search',
        agents: shoppers,
        input: z.object({
          product: z.enum(PRICE_PRODUCTS),
          origin: z
            .string()
            .regex(/^[A-Z]{3}$/)
            .optional(),
          destination: z
            .string()
            .regex(/^[A-Z]{3}$/)
            .optional(),
          place: z.string().trim().min(2).max(60).optional(),
          from: isoDateSchema,
          to: isoDateSchema.optional(),
          adults: z.number().int().min(1).max(9).default(1),
          children: z.number().int().min(0).max(8).default(0),
        }),
        output: z.object({
          problems: problemsSchema,
          found: z.number().int(),
          prices: z
            .array(
              z.object({
                observationId: z.uuid(),
                what: z.string(),
                soldThereBy: z.string().nullable(),
                indicativePrice: moneyOut,
                taxesIncluded: z.boolean().nullable(),
                seenOn: z.string(),
                seenAt: z.string(),
                olderThanItShouldBe: z.boolean(),
                indicative: z.literal(true),
              }),
            )
            .max(PRICES_SHOWN),
          cards: cardsOut,
        }),
        run: async (input, { signal }) => {
          const nothing = (problems: string[]) => ({ problems, found: 0, prices: [], cards: [] });
          if (!this.flags.priceIntel()) return nothing(['not_offered']);
          const { product, ...asked } = input;
          const query = priceQuerySchema.safeParse(asked);
          if (!query.success) return nothing(issueCodes(query.error));
          // Only sites a person approved are read (the mock stands in for one still in review,
          // outside production); the service decides that, not this tool.
          const sites = (await this.sources.list())
            .filter(
              (site) =>
                site.products.includes(product) &&
                (site.readable === 'yes' || site.readable === 'review_mock_only'),
            )
            .slice(0, SOURCES_PER_QUESTION);
          if (sites.length === 0) return nothing(['no_source']);

          const seen: { row: PriceObservationDto; site: string }[] = [];
          const problems = new Set<string>();
          for (const site of sites) {
            try {
              const read = await this.intel.read(
                site.id,
                { product, query: query.data },
                'agent',
                signal,
              );
              if (read.observations.length === 0) problems.add(`read_${read.state}`);
              for (const row of read.observations) seen.push({ row, site: site.name });
            } catch (error) {
              // A site that cannot answer this question says so in a code; the others go on.
              for (const code of problemCodes(error) ?? ['read_failed']) problems.add(code);
            }
          }
          const shown = seen
            .filter(({ row }) => row.status !== 'rejected')
            .sort((a, b) => a.row.price.amountMinor - b.row.price.amountMinor)
            .slice(0, PRICES_SHOWN);
          return {
            problems: shown.length > 0 ? [] : [...problems].slice(0, 8),
            found: shown.length,
            prices: shown.map(({ row, site }) => ({
              observationId: row.id,
              what: supplierText(String(row.item.title ?? product), 120),
              soldThereBy: row.item.brand ? supplierText(String(row.item.brand), 60) : null,
              indicativePrice: row.price,
              taxesIncluded: row.taxesIncluded,
              seenOn: supplierText(site, 60),
              seenAt: utcTime(row.observedAt),
              olderThanItShouldBe: row.stale,
              indicative: true as const,
            })),
            cards: shown.flatMap(({ row, site }) =>
              card(
                'price',
                supplierText(String(row.item.title ?? product), 120),
                [`${supplierText(site, 60)}, ${utcTime(row.observedAt)}`],
                { price: row.price, indicative: true },
              ),
            ),
          };
        },
      }),
    );

    this.registry.register(
      agentTool({
        name: 'quotes.request',
        description:
          'Asks the support team to confirm a live price for the signed-in traveller: for an indicative price (give its observationId) or for something the ordinary search does not sell. It books and promises nothing: a person checks with the supplier and answers with an offer the traveller can book, or says it cannot be had. Give what is wanted in a few words (no names, no contact details), the place, the dates and how many travel. Tell the traveller it is a request, and when an answer is expected.',
        tier: 'propose',
        scope: 'quotes',
        agents: shoppers,
        input: z.object({
          product: z.enum(ASSISTED_QUOTE_PRODUCTS),
          what: z.string().trim().min(2).max(160),
          origin: z.string().trim().min(2).max(80).optional(),
          destination: z.string().trim().min(2).max(80),
          startDate: isoDateSchema,
          endDate: isoDateSchema.optional(),
          adults: z.number().int().min(1).max(9).default(1),
          children: z.number().int().min(0).max(8).default(0),
          observationId: z.uuid().optional(),
        }),
        output: z.object({
          problems: problemsSchema,
          requested: z.boolean(),
          needsToSignIn: z.boolean(),
          quote: quoteOut.nullable(),
          cards: cardsOut,
        }),
        run: async (input, { grant }) => {
          const no = (problems: string[], needsToSignIn = false) => ({
            problems,
            requested: false,
            needsToSignIn,
            quote: null,
            cards: [],
          });
          if (!this.quotes.enabled()) return no(['not_offered']);
          // A quote is answered to an account: a guest signs in first.
          if (!grant.userId) return no([], true);
          const parsed = assistedQuoteInputSchema.safeParse({
            product: input.product,
            title: input.what,
            request: {
              origin: input.origin ?? null,
              destination: input.destination,
              startDate: input.startDate,
              endDate: input.endDate ?? null,
              adults: input.adults,
              children: input.children,
            },
            currency: this.callers.currency(grant),
            observationId: input.observationId ?? null,
          });
          if (!parsed.success) return no(issueCodes(parsed.error));
          try {
            const quote = await this.quotes.request(grant.userId, parsed.data);
            return {
              problems: [],
              requested: true,
              needsToSignIn: false,
              quote: quoteOf(quote),
              cards: quoteCard(quote),
            };
          } catch (error) {
            // Too many waiting, or a reference that is gone: said in a code.
            const problems = problemCodes(error);
            if (!problems) throw error;
            return no(problems);
          }
        },
      }),
    );

    this.registry.register(
      agentTool({
        name: 'quotes.list',
        description:
          "The signed-in traveller's own requests to have a price confirmed, newest first: what was asked, whether a person has answered, the price on offer and until when it can be booked, or why it closed. 'became_a_booking' is not a confirmation: read the booking for where it stands. The traveller books an offer on its page; you cannot book it.",
        tier: 'read',
        scope: 'account',
        agents: [...CUSTOMER_AGENTS],
        input: z.object({}),
        output: z.object({
          found: z.number().int(),
          quotes: z.array(quoteOut).max(10),
          cards: cardsOut,
        }),
        run: async (_input, { grant }) => {
          if (!this.quotes.enabled()) return { found: 0, quotes: [], cards: [] };
          const rows = await this.quotes.list(this.callers.userId(grant));
          return {
            found: rows.length,
            quotes: rows.slice(0, 10).map(quoteOf),
            cards: rows.slice(0, 6).flatMap(quoteCard),
          };
        },
      }),
    );
  }
}
