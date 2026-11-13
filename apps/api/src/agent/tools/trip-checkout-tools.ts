import { HttpException, Injectable, NotFoundException, type OnModuleInit } from '@nestjs/common';
import { z } from 'zod';

import {
  add,
  money,
  toWire,
  TRIP_MAX_ADULTS,
  TRIP_MAX_CHILDREN,
  tripPlanSchema,
  zero,
  type AgentCard,
  type AgentCardNote,
  type Money,
  type TripComponent,
  type TripPlan,
} from '@suskii/shared';

import type { quoteSchema } from '../../bookings/bookings.schemas';
import { QuotesService } from '../../bookings/quotes.service';
import { CatalogService } from '../../catalog/catalog.service';
import type { TripDto, TripPreparedPart } from '../../trips/trips.schemas';
import { TripsService } from '../../trips/trips.service';
import type { AgentGrant } from '../agent-grants';
import { agentTool, AgentToolRegistry } from '../agent-tool';

import { AgentPreparedParts, PREPARED_PARTS, type PreparedPart } from './prepared-parts';
import {
  AGENT_REQUEST_CONTEXT,
  AgentToolCallers,
  card,
  cardsOut,
  moneyOut,
  note,
  placeText,
  problemCodes,
  problemsSchema,
  supplierText,
} from './tool-support';

type Quote = z.infer<typeof quoteSchema>;
type MoneyWire = z.infer<typeof moneyOut>;

/** The parts a combined trip takes (ADR-099), as the conversation names them. */
const TRIP_PARTS: Readonly<Partial<Record<PreparedPart, TripComponent>>> = {
  flight: 'flight',
  hotel: 'hotel',
  car: 'car',
  transfer: 'transfer',
  insurance: 'insurance',
};

/** One prepared part, read again as the caller: what it is, its price and its quote. */
interface Loaded {
  part: PreparedPart;
  component: TripComponent | null;
  what: string;
  price: MoneyWire;
  quote: Quote;
}

const MAX_CARDS = 6;

/** How a part's own card is drawn. */
const CARD_KINDS: Readonly<Record<PreparedPart, AgentCard['kind']>> = {
  flight: 'flight',
  hotel: 'hotel',
  car: 'car',
  transfer: 'transfer',
  insurance: 'link',
  package: 'package',
  tour: 'tour',
  visa: 'visa',
  esim: 'link',
  lounge: 'link',
};

/** What a quote sells, in a few words, and the price it was quoted at. */
function describe(quote: Quote): { what: string; price: MoneyWire } | null {
  const { flight, hotel } = quote;
  if (flight) {
    const slices = flight.offer.slices;
    const first = slices[0];
    if (!first) return null;
    return {
      what: `${placeText(first.origin)} → ${placeText(first.destination)}, ${supplierText(flight.offer.owner.name)}`,
      price: flight.offer.price.total,
    };
  }
  if (hotel) {
    return {
      what: `${supplierText(hotel.name)}, ${hotel.cityName}`,
      price: hotel.rate.price.total,
    };
  }
  const product =
    quote.rental?.product ??
    quote.package?.product ??
    quote.tour?.product ??
    quote.visa?.product ??
    quote.addon?.product;
  if (!product || !quote.price) return null;
  return { what: supplierText(product.title), price: quote.price.total };
}

const toMoney = (wire: MoneyWire): Money => money(BigInt(wire.amountMinor), wire.currency);

/**
 * The checkout of a whole trip, put together by the assistant (ADR-117). Every prepare tool
 * remembers the quote it made for the conversation (`AgentPreparedParts`); this tool reads
 * those quotes again as the caller and answers with each part's price and one total. For a
 * signed-in traveller the flight, the stay, the car, the transfer and the insurance go on one
 * combined trip (ADR-099), whose page takes each part's details at its ordinary checkout and
 * then one payment; what a trip does not take keeps its own booking page.
 *
 * Nothing here books, holds or takes money, and the model passes no ids: only the parts to
 * leave out. Prices are the quotes' own, added up per currency by the API.
 */
@Injectable()
export class TripCheckoutTools implements OnModuleInit {
  constructor(
    private readonly registry: AgentToolRegistry,
    private readonly callers: AgentToolCallers,
    private readonly prepared: AgentPreparedParts,
    private readonly quotes: QuotesService,
    private readonly trips: TripsService,
    private readonly catalog: CatalogService,
  ) {}

  onModuleInit(): void {
    this.registry.register(
      agentTool({
        name: 'trips.prepare_checkout',
        description:
          "Put everything prepared in this conversation together as one summary: each part (a flight, a stay, a car, a transfer, insurance, and any package, tour, visa assistance, eSIM or lounge access) with its price, and one total. For a signed-in traveller with a prepared flight, the flight, stay, car, transfer and insurance go on one combined trip, whose page takes each part's details and then one payment; other products keep their own booking page. Call it when the traveller has what they want for the trip, or asks for the total or to check out; pass in leaveOut what they no longer want. Nothing is booked or paid by this: say what the total covers and that each part still needs the travellers' details before the payment. 'nothing_prepared' in problems means nothing is prepared yet; parts in expired must be prepared again.",
        tier: 'propose',
        scope: 'quotes',
        agents: ['flights', 'hotels', 'cars', 'tours', 'trip_builder', 'concierge', 'payments'],
        input: z.object({
          leaveOut: z
            .array(z.enum(PREPARED_PARTS))
            .max(PREPARED_PARTS.length)
            .default([])
            .meta({ description: 'Prepared parts the traveller no longer wants.' }),
        }),
        output: z.object({
          problems: problemsSchema,
          bookingStatus: z.literal('not_booked'),
          parts: z.array(
            z.object({
              part: z.enum(PREPARED_PARTS),
              what: z.string(),
              price: moneyOut,
              /** `trip`: paid with the trip's one payment; `own_page`: on its own booking page. */
              paidWith: z.enum(['trip', 'own_page']),
            }),
          ),
          expired: z.array(z.enum(PREPARED_PARTS)),
          total: moneyOut.nullable(),
          payOnce: z.boolean(),
          payOnceTotal: moneyOut.nullable(),
          cards: cardsOut,
        }),
        run: async (input, { grant }) => {
          if (input.leaveOut.length > 0) await this.prepared.forget(grant, input.leaveOut);
          const memory = await this.prepared.read(grant);
          const { loaded, expired, otherCurrency } = await this.load(grant, memory.parts);
          const problems = otherCurrency ? ['currency_changed'] : [];
          if (loaded.length === 0) {
            return {
              problems: [...problems, 'nothing_prepared'],
              bookingStatus: 'not_booked' as const,
              parts: [],
              expired,
              total: null,
              payOnce: false,
              payOnceTotal: null,
              cards: [],
            };
          }
          const total = loaded.reduce(
            (sum, part) => add(sum, toMoney(part.price)),
            zero(this.callers.currency(grant)),
          );
          const drop = input.leaveOut.flatMap((part) => TRIP_PARTS[part] ?? []);
          const trip = await this.tripFor(grant, memory.tripId, loaded, drop, problems);
          const onTrip = (part: Loaded): boolean => trip !== null && part.component !== null;
          return {
            problems,
            bookingStatus: 'not_booked' as const,
            parts: loaded.map((part) => ({
              part: part.part,
              what: part.what,
              price: part.price,
              paidWith: onTrip(part) ? ('trip' as const) : ('own_page' as const),
            })),
            expired,
            total: toWire(total),
            payOnce: trip !== null,
            payOnceTotal: trip ? (trip.totalWithPrepared ?? trip.total) : null,
            cards: this.cards(
              grant,
              trip,
              loaded.filter((part) => !onTrip(part)),
            ),
          };
        },
      }),
    );
  }

  /** The remembered quotes, read again as the caller; those that ran out are named. */
  private async load(
    grant: AgentGrant,
    parts: Partial<Record<PreparedPart, string>>,
  ): Promise<{ loaded: Loaded[]; expired: PreparedPart[]; otherCurrency: boolean }> {
    const client = await this.callers.client(grant);
    const currency = this.callers.currency(grant);
    const loaded: Loaded[] = [];
    const expired: PreparedPart[] = [];
    let otherCurrency = false;
    for (const part of PREPARED_PARTS) {
      const quoteId = parts[part];
      if (!quoteId) continue;
      let quote: Quote;
      try {
        quote = await this.quotes.get(quoteId, client);
      } catch (error) {
        // Gone (410) or no longer there: its price ran out, and the part is prepared again.
        if (
          error instanceof NotFoundException ||
          (error instanceof HttpException && error.getStatus() === 410)
        ) {
          expired.push(part);
          continue;
        }
        throw error;
      }
      const shown = describe(quote);
      if (!shown) continue;
      // Quoted before the traveller changed currency: one total cannot mix two.
      if (shown.price.currency !== currency) {
        otherCurrency = true;
        continue;
      }
      loaded.push({ part, component: TRIP_PARTS[part] ?? null, ...shown, quote });
    }
    return { loaded, expired, otherCurrency };
  }

  /**
   * The combined trip the parts go on, for a signed-in traveller: the one this conversation
   * built while it is still the same trip, or a new one from the prepared flight. Null for a
   * guest, without a part a trip takes, or without a plan (`trip_needs_flight`).
   */
  private async tripFor(
    grant: AgentGrant,
    rememberedTrip: string | null,
    loaded: readonly Loaded[],
    drop: readonly TripComponent[],
    problems: string[],
  ): Promise<TripDto | null> {
    const parts = loaded.filter(
      (part): part is Loaded & { component: TripComponent } => part.component !== null,
    );
    if (!grant.userId || parts.length === 0) return null;
    const prepared: TripPreparedPart[] = parts.map((part) => ({
      component: part.component,
      quoteId: part.quote.quoteId,
      title: part.what.slice(0, 200),
      price: part.price,
      expiresAt: part.quote.expiresAt,
    }));
    const plan = await this.planFrom(loaded);
    try {
      const trip = await this.trips.prepare(
        grant.userId,
        { tripId: rememberedTrip, plan, currency: this.callers.currency(grant), prepared, drop },
        AGENT_REQUEST_CONTEXT,
      );
      if (!trip) {
        problems.push('trip_needs_flight');
        return null;
      }
      await this.prepared.rememberTrip(grant, trip.id);
      return trip;
    } catch (error) {
      // Too many open trips, mostly: the parts keep their own booking pages.
      const codes = problemCodes(error);
      if (!codes) throw error;
      problems.push(...codes);
      return null;
    }
  }

  /**
   * The plan the prepared flight makes: its airports and days, back on the return flight or
   * else on the day the stay, the car or the cover ends. Null without a flight or a day back.
   */
  private async planFrom(loaded: readonly Loaded[]): Promise<TripPlan | null> {
    const flight = loaded.find((part) => part.quote.flight)?.quote.flight;
    const first = flight?.request.slices[0];
    const last = flight?.request.slices.at(-1);
    if (!flight || !first || !last) return null;
    const back =
      flight.request.slices.length > 1 && last.destination === first.origin
        ? last.departureDate
        : null;
    const ends = loaded
      .flatMap(({ quote }) => [
        quote.hotel?.request.checkOut,
        quote.rental?.returnAtLocal.slice(0, 10),
        quote.addon?.endDate,
      ])
      .filter((day): day is string => typeof day === 'string')
      .sort();
    const returnDate = back ?? ends.at(-1) ?? null;
    if (!returnDate) return null;
    const [origin, destination] = await Promise.all([
      this.catalog.airport(first.origin),
      this.catalog.airport(first.destination),
    ]);
    if (!origin || !destination) return null;
    const plan = tripPlanSchema.safeParse({
      origin: {
        code: origin.code,
        name: origin.name,
        cityName: origin.municipality,
        countryCode: origin.countryCode,
      },
      destination: {
        code: destination.code,
        name: destination.name,
        cityName: destination.municipality,
        countryCode: destination.countryCode,
        cityId: destination.cityId,
      },
      departDate: first.departureDate,
      returnDate,
      adults: Math.min(Math.max(flight.request.passengers.adults, 1), TRIP_MAX_ADULTS),
      children: Math.min(flight.request.passengers.children, TRIP_MAX_CHILDREN),
      components: ['flight'],
    });
    return plan.success ? plan.data : null;
  }

  /**
   * The trip's card with the total the trip page shows, then a card for each part that keeps
   * its own booking page, and the notes the summary must be read with.
   */
  private cards(grant: AgentGrant, trip: TripDto | null, ownPage: readonly Loaded[]): AgentCard[] {
    const notes: AgentCardNote[] = trip
      ? ['trip_handoff', ...(ownPage.length > 0 ? (['trip_separate'] as const) : [])]
      : [grant.userId ? 'booking_handoff' : 'trip_sign_in'];
    const tripCards = trip
      ? card(
          'trip',
          `${trip.plan.origin.cityName ?? trip.plan.origin.code} → ${trip.plan.destination.cityName ?? trip.plan.destination.code}`,
          [`${trip.plan.departDate} → ${trip.plan.returnDate}`],
          {
            price: trip.totalWithPrepared ?? trip.total,
            href: `/trips/${trip.id}`,
            ref: { type: 'trip', id: trip.id },
          },
        )
      : [];
    const room = MAX_CARDS - notes.length - tripCards.length;
    const partCards = ownPage.slice(0, Math.max(room, 0)).flatMap((part) =>
      card(CARD_KINDS[part.part], part.what, [], {
        price: part.price,
        href: `/checkout/${part.quote.quoteId}`,
      }),
    );
    return [...tripCards, ...partCards, ...notes.flatMap((code) => note(code))];
  }
}
