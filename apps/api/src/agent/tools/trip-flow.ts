import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { z } from 'zod';

import {
  MAX_HOTEL_ROOMS,
  hotelFormToParams,
  hotelSearchRequestSchema,
  type AddonProductType,
  type AgentCard,
} from '@suskii/shared';

import { CatalogService } from '../../catalog/catalog.service';
import { CarsFlags } from '../../ground/cars-flags';
import { InhouseCatalogService } from '../../inhouse/inhouse-catalog.service';
import { REDIS } from '../../infra/redis';
import { RentalsCatalogService } from '../../rentals/rentals-catalog.service';
import { rentalSearchQuerySchema } from '../../rentals/rentals.schemas';
import { HotelSearchService } from '../../search/hotel-search.service';
import type { flightQuoteSchema } from '../../search/search.schemas';
import { ErrorReporter } from '../../telemetry/error-reporter';
import type { AgentGrant } from '../agent-grants';

import { AgentOptions } from './agent-options';
import { AgentPreparedParts } from './prepared-parts';
import {
  AgentToolCallers,
  card,
  moneyOut,
  problemCodes,
  supplierText,
  wallTime,
} from './tool-support';
import { TripCheckoutTools, tripSummaryOut } from './trip-checkout-tools';

type FlightQuote = z.infer<typeof flightQuoteSchema>;

/** The parts chosen after the flight, in the order the traveller is shown them (ADR-123). */
export const TRIP_FLOW_PARTS = ['hotel', 'car', 'transfer', 'insurance'] as const;
export type TripFlowPart = (typeof TRIP_FLOW_PARTS)[number];

/** How many options of each part the traveller is shown. */
export const TRIP_FLOW_OPTIONS = 4;

/** What a trip planned part by part is: read from the prepared flight, never from a model. */
export interface TripFlowFacts {
  cityId: string | null;
  cityName: string | null;
  countryCode: string | null;
  /** The destination airport. */
  airport: string;
  /** Local dates and wall times: the flight out leaves, lands, and the flight back leaves. */
  departDate: string;
  arriveAt: string;
  leaveAt: string;
  adults: number;
  children: number;
  infants: number;
}

const flowOptionOut = z.object({
  /** The number the traveller chooses it by; the tool that prepares it takes this number. */
  option: z.number().int(),
  title: z.string(),
  details: z.array(z.string()),
  price: moneyOut.nullable(),
  /** What the price is for: null for the whole stay or rental, else per traveller or per day. */
  chargedPer: z.string().nullable(),
  sample: z.boolean(),
});
export type TripFlowOption = z.infer<typeof flowOptionOut>;

/**
 * The next step of a trip planned part by part: the part to choose now with its options, or
 * the checkout once every part is chosen or skipped. Parts nothing was offered for are passed
 * over and named. `ask` is what the traveller must say or do before options can be shown or
 * chosen (the children's ages for a stay, signing in for a car).
 */
export const tripFlowNextOut = z.object({
  /** `flight`: no flight is chosen yet, and the trip starts from one. */
  part: z.enum(['flight', ...TRIP_FLOW_PARTS, 'checkout']),
  ask: z.enum(['child_ages', 'sign_in']).nullable(),
  options: z.array(flowOptionOut),
  noneOffered: z.array(z.enum(TRIP_FLOW_PARTS)),
  checkout: tripSummaryOut.omit({ cards: true }).nullable(),
});
export type TripFlowNext = z.infer<typeof tripFlowNextOut> & {
  problems: string[];
  cards: AgentCard[];
};

/** One part's options as the step shows them, and the cards the clients draw. */
interface PartOptions {
  options: TripFlowOption[];
  cards: AgentCard[];
  ask: TripFlowNext['ask'];
  problems: string[];
}

/** As long as a conversation about one trip lasts, like the prepared parts it goes with. */
const TTL_SECONDS = 6 * 60 * 60;
const key = (conversationId: string): string => `agent:tripflow:${conversationId}`;
const PLANNING = 'planning';
const DONE = 'done';

/** "2026-12-10T07:15" plus `hours`, on the wall clock (a local time has no zone to shift). */
export function shiftWallTime(local: string, hours: number): string {
  const instant = new Date(`${local.slice(0, 16)}:00Z`);
  instant.setUTCHours(instant.getUTCHours() + hours);
  return instant.toISOString().slice(0, 16);
}

/**
 * When a car is collected and handed back: an hour after the flight lands, on the hour, and
 * three hours before the flight back leaves, on the hour. Null when that leaves no rental.
 */
export function rentalWindow(facts: TripFlowFacts): { pickupAt: string; returnAt: string } | null {
  const landed = shiftWallTime(facts.arriveAt, 1);
  const pickupAt = landed.endsWith(':00') ? landed : `${shiftWallTime(landed, 1).slice(0, 13)}:00`;
  const returnAt = `${shiftWallTime(facts.leaveAt, -3).slice(0, 13)}:00`;
  return returnAt > pickupAt ? { pickupAt, returnAt } : null;
}

/** The rooms for the adults of the trip: two to a room, as many rooms as that takes. */
export function roomsFor(adults: number): { adults: number; childAges: number[] }[] {
  const count = Math.min(Math.max(Math.ceil(adults / 2), 1), MAX_HOTEL_ROOMS);
  return Array.from({ length: count }, (_, index) => ({
    adults: Math.floor(adults / count) + (index < adults % count ? 1 : 0),
    childAges: [],
  }));
}

/**
 * The trip a prepared return flight makes: where it lands, when, and when the flight back
 * leaves. Null for anything but a return flight to one place, which a trip planned part by part
 * needs (the stay and the car end when the flight back leaves).
 */
export function tripFlowFacts(quote: FlightQuote, cityId: string | null): TripFlowFacts | null {
  const [out, back, ...rest] = quote.offer.slices;
  if (!out || !back || rest.length > 0) return null;
  if (back.origin.code !== out.destination.code || back.destination.code !== out.origin.code) {
    return null;
  }
  return {
    cityId,
    cityName: out.destination.cityName,
    countryCode: out.destination.countryCode,
    airport: out.destination.code,
    departDate: out.departureLocal.slice(0, 10),
    arriveAt: out.arrivalLocal.slice(0, 16),
    leaveAt: back.departureLocal.slice(0, 16),
    adults: quote.offer.passengers.adults,
    children: quote.offer.passengers.children,
    infants: quote.offer.passengers.infants,
  };
}

/** The days an add-on covers on this trip: a transfer the day of landing, cover the trip. */
export function addonDays(
  facts: TripFlowFacts,
  type: AddonProductType,
): { startDate: string; endDate: string } {
  const arrive = facts.arriveAt.slice(0, 10);
  const leave = facts.leaveAt.slice(0, 10);
  if (type === 'airport_transfer') return { startDate: arrive, endDate: arrive };
  if (type === 'lounge') return { startDate: facts.departDate, endDate: facts.departDate };
  return { startDate: facts.departDate, endDate: leave };
}

const ADDON_TYPES: Readonly<Record<'transfer' | 'insurance', AddonProductType>> = {
  transfer: 'airport_transfer',
  insurance: 'insurance',
};

const isFacts = (value: unknown): value is TripFlowFacts => {
  if (typeof value !== 'object' || value === null) return false;
  const facts = value as Record<string, unknown>;
  return (
    (typeof facts.countryCode === 'string' || facts.countryCode === null) &&
    typeof facts.airport === 'string' &&
    typeof facts.departDate === 'string' &&
    typeof facts.arriveAt === 'string' &&
    typeof facts.leaveAt === 'string' &&
    typeof facts.adults === 'number' &&
    typeof facts.children === 'number' &&
    typeof facts.infants === 'number'
  );
};

const isPart = (value: unknown): value is TripFlowPart =>
  (TRIP_FLOW_PARTS as readonly unknown[]).includes(value);

/**
 * A combined trip planned part by part in the chat (ADR-123): the flight first, then a place
 * to stay, a car, an airport transfer and travel insurance, each skippable, then one checkout.
 * The order lives here, in code, and not in a model's instructions: when a part is prepared,
 * the tool that prepared it asks `next()`, which runs the next part's search for the trip's own
 * place, dates and travellers (read from the prepared flight) and answers with its options.
 * When nothing is offered for a part, it is passed over and named. After the last part comes
 * the summary of the whole trip with its checkout (`TripCheckoutTools.summarize`).
 *
 * What it keeps, per conversation in Redis for six hours: whether a trip is being planned, the
 * trip's facts (places, local times, head counts) and the parts the traveller passed over.
 * Nothing about a person. Searches run as the grant's caller, with the prices they would see.
 */
@Injectable()
export class AgentTripFlow {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly errors: ErrorReporter,
    private readonly callers: AgentToolCallers,
    private readonly options: AgentOptions,
    private readonly prepared: AgentPreparedParts,
    private readonly summary: TripCheckoutTools,
    private readonly hotels: HotelSearchService,
    private readonly rentals: RentalsCatalogService,
    private readonly inhouse: InhouseCatalogService,
    private readonly catalog: CatalogService,
    private readonly flags: CarsFlags,
  ) {}

  /**
   * A trip starts being planned (a flight search by the trip planner). The parts passed over
   * are asked about again; the facts stay until a flight is prepared, which compares them with
   * its own and forgets what was chosen for other days or another place.
   */
  async start(grant: AgentGrant): Promise<void> {
    if (!grant.conversationId) return;
    const name = key(grant.conversationId);
    try {
      await this.redis
        .multi()
        .hset(name, 'state', PLANNING)
        .hdel(name, 'skipped')
        .expire(name, TTL_SECONDS)
        .exec();
    } catch (error) {
      void this.errors.capture(error, { task: 'agent.trip_flow' });
    }
  }

  /** Whether this conversation is planning a trip part by part (for the run's context). */
  async planning(conversationId: string): Promise<boolean> {
    try {
      return (await this.redis.hget(key(conversationId), 'state')) === PLANNING;
    } catch {
      return false;
    }
  }

  async isPlanning(grant: AgentGrant): Promise<boolean> {
    return grant.conversationId ? this.planning(grant.conversationId) : false;
  }

  /**
   * The trip a prepared flight makes. A new flight for other days or another place forgets the
   * parts chosen for the old ones (and the parts passed over), so nothing of the old trip is
   * paid with the new one.
   */
  async setFlight(grant: AgentGrant, quote: FlightQuote): Promise<TripFlowFacts | null> {
    if (!grant.conversationId) return null;
    const destination = quote.offer.slices[0]?.destination.code;
    const airport = destination ? await this.catalog.airport(destination) : null;
    const facts = tripFlowFacts(quote, airport?.cityId ?? null);
    if (!facts) return null;
    const earlier = await this.facts(grant);
    const name = key(grant.conversationId);
    if (
      earlier &&
      (earlier.airport !== facts.airport ||
        earlier.arriveAt.slice(0, 10) !== facts.arriveAt.slice(0, 10) ||
        earlier.leaveAt.slice(0, 10) !== facts.leaveAt.slice(0, 10))
    ) {
      await this.prepared.forget(grant, TRIP_FLOW_PARTS);
      await this.redis.hdel(name, 'skipped');
    }
    await this.redis
      .multi()
      .hset(name, 'state', PLANNING, 'facts', JSON.stringify(facts))
      .expire(name, TTL_SECONDS)
      .exec();
    return facts;
  }

  async facts(grant: AgentGrant): Promise<TripFlowFacts | null> {
    if (!grant.conversationId) return null;
    const raw = await this.redis.hget(key(grant.conversationId), 'facts');
    if (!raw) return null;
    try {
      const parsed: unknown = JSON.parse(raw);
      return isFacts(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  /** The traveller passes over a part: it is not shown again for this trip. */
  async skip(grant: AgentGrant, part: TripFlowPart): Promise<void> {
    if (!grant.conversationId) return;
    const skipped = new Set(await this.skipped(grant));
    skipped.add(part);
    const name = key(grant.conversationId);
    await this.redis
      .multi()
      .hset(name, 'skipped', JSON.stringify([...skipped]))
      .expire(name, TTL_SECONDS)
      .exec();
  }

  private async skipped(grant: AgentGrant): Promise<TripFlowPart[]> {
    if (!grant.conversationId) return [];
    const raw = await this.redis.hget(key(grant.conversationId), 'skipped');
    if (!raw) return [];
    try {
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter(isPart) : [];
    } catch {
      return [];
    }
  }

  /**
   * The next part to choose, with its options, or the checkout. A part already prepared or
   * passed over is not shown again; a part nothing is offered for is passed over and named.
   */
  async next(grant: AgentGrant): Promise<TripFlowNext> {
    const facts = await this.facts(grant);
    const memory = await this.prepared.read(grant);
    if (!memory.parts.flight) {
      // A trip planned part by part starts from its flight.
      return {
        part: 'flight',
        ask: null,
        options: [],
        noneOffered: [],
        checkout: null,
        problems: [],
        cards: [],
      };
    }
    const skipped = new Set(await this.skipped(grant));
    const noneOffered: TripFlowPart[] = [];
    const problems: string[] = [];
    if (facts) {
      for (const part of TRIP_FLOW_PARTS) {
        if (memory.parts[part] || skipped.has(part)) continue;
        const shown = await this.optionsFor(grant, part, facts);
        problems.push(...shown.problems);
        if (shown.options.length === 0 && shown.ask === null) {
          noneOffered.push(part);
          await this.skip(grant, part);
          continue;
        }
        return {
          part,
          ask: shown.ask,
          options: shown.options,
          noneOffered,
          checkout: null,
          problems,
          cards: shown.cards,
        };
      }
    }
    // Every part is chosen or passed over (or the flight has no day back): the checkout.
    const summary = await this.summary.summarize(grant, []);
    if (grant.conversationId) {
      await this.redis.hset(key(grant.conversationId), 'state', DONE);
    }
    const { cards, ...checkout } = summary;
    return {
      part: 'checkout',
      ask: null,
      options: [],
      noneOffered,
      checkout,
      problems: [...problems, ...(facts ? [] : ['trip_needs_return_date'])],
      cards,
    };
  }

  private async optionsFor(
    grant: AgentGrant,
    part: TripFlowPart,
    facts: TripFlowFacts,
  ): Promise<PartOptions> {
    try {
      if (part === 'hotel') return await this.hotelOptions(grant, facts);
      if (part === 'car') return await this.carOptions(grant, facts);
      return await this.addonOptions(grant, part, facts);
    } catch (error) {
      // A search that refused or could not answer passes the part over, with its reason.
      const codes = problemCodes(error);
      if (!codes) throw error;
      return { options: [], cards: [], ask: null, problems: codes };
    }
  }

  private async hotelOptions(grant: AgentGrant, facts: TripFlowFacts): Promise<PartOptions> {
    // A child's age changes a stay's price and who counts as an adult: asked, never assumed.
    if (facts.children + facts.infants > 0) {
      return { options: [], cards: [], ask: 'child_ages', problems: [] };
    }
    const checkIn = facts.arriveAt.slice(0, 10);
    const checkOut = facts.leaveAt.slice(0, 10);
    if (!facts.cityId || checkOut <= checkIn) {
      return { options: [], cards: [], ask: null, problems: [] };
    }
    const request = hotelSearchRequestSchema.safeParse({
      destination: { type: 'city', cityId: facts.cityId },
      checkIn,
      checkOut,
      rooms: roomsFor(facts.adults),
      freeCancellationOnly: false,
    });
    if (!request.success) return { options: [], cards: [], ask: null, problems: [] };
    const client = await this.callers.client(grant);
    const result = await this.hotels.search(
      request.data,
      grant.currency,
      client,
      TRIP_FLOW_OPTIONS,
    );
    const shown = result.hotels.slice(0, TRIP_FLOW_OPTIONS);
    await this.options.remember(
      grant,
      'hotel',
      shown.map((hotel) => ({ id: hotel.cheapestRate.id })),
    );
    const href = `/hotels/search?${hotelFormToParams(request.data).toString()}`;
    const options = shown.map((hotel, index) => ({
      option: index + 1,
      title: supplierText(hotel.name),
      details: [
        [hotel.stars > 0 ? `${hotel.stars}★` : null, hotel.area && supplierText(hotel.area, 80)]
          .filter(Boolean)
          .join(' · '),
        supplierText(hotel.cheapestRate.roomName),
        `${checkIn} → ${checkOut}`,
      ].filter((line) => line.length > 0),
      price: hotel.cheapestRate.price.total,
      chargedPer: null,
      sample: hotel.supplier === 'mock',
    }));
    return {
      options,
      cards: options.flatMap((option) =>
        card('hotel', option.title, option.details, {
          price: option.price,
          href,
          choose: option.option,
        }),
      ),
      ask: null,
      problems: [],
    };
  }

  private async carOptions(grant: AgentGrant, facts: TripFlowFacts): Promise<PartOptions> {
    const window = rentalWindow(facts);
    if (!this.flags.enabled('rentals') || !facts.cityName || !window) {
      return { options: [], cards: [], ask: null, problems: [] };
    }
    const query = rentalSearchQuerySchema.safeParse({ city: facts.cityName, ...window });
    if (!query.success) return { options: [], cards: [], ask: null, problems: [] };
    const result = await this.rentals.search(query.data);
    const shown = result.vehicles.slice(0, TRIP_FLOW_OPTIONS);
    await this.options.remember(
      grant,
      'car',
      shown.map((vehicle) => ({ id: vehicle.id, extra: { ...window } })),
    );
    const period = `?pickupAt=${encodeURIComponent(window.pickupAt)}&returnAt=${encodeURIComponent(window.returnAt)}`;
    const options = shown.map((vehicle, index) => ({
      option: index + 1,
      title: `${vehicle.make} ${vehicle.model}`,
      details: [
        supplierText(vehicle.branch.name, 80),
        `${wallTime(window.pickupAt)} → ${wallTime(window.returnAt)}`,
      ],
      price: vehicle.estimate.rental,
      chargedPer: null,
      sample: vehicle.sample,
    }));
    return {
      options,
      cards: shown.flatMap((vehicle, index) => {
        const option = options[index];
        return option
          ? card('car', option.title, option.details, {
              price: option.price,
              href: `/rentals/${vehicle.slug}${period}`,
              choose: option.option,
            })
          : [];
      }),
      // A rental car is prepared for a signed-in traveller only (ADR-109).
      ask: options.length > 0 && !grant.userId ? 'sign_in' : null,
      problems: [],
    };
  }

  private async addonOptions(
    grant: AgentGrant,
    part: 'transfer' | 'insurance',
    facts: TripFlowFacts,
  ): Promise<PartOptions> {
    const type = ADDON_TYPES[part];
    const client = await this.callers.client(grant);
    const addons = await this.inhouse.listAddons(
      {
        currency: this.callers.currency(grant),
        type,
        countryCode: facts.countryCode ?? undefined,
      },
      client,
    );
    const shown = addons.slice(0, TRIP_FLOW_OPTIONS);
    await this.options.remember(
      grant,
      'addon',
      shown.map((addon) => ({ id: addon.id, extra: { type: addon.type } })),
    );
    const days = addonDays(facts, type);
    const options = shown.map((addon, index) => ({
      option: index + 1,
      title: supplierText(addon.title),
      details: [
        days.startDate === days.endDate ? days.startDate : `${days.startDate} → ${days.endDate}`,
      ],
      price: addon.unitPrice,
      chargedPer: addon.pricingBasis.replace(/^per_/, ''),
      sample: addon.sample,
    }));
    return {
      options,
      cards: options.flatMap((option) =>
        card(part === 'transfer' ? 'transfer' : 'link', option.title, option.details, {
          price: option.price ?? undefined,
          href: `/travel-add-ons?type=${type}`,
          choose: option.option,
        }),
      ),
      ask: null,
      problems: [],
    };
  }
}
