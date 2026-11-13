import { Injectable, NotFoundException, type OnModuleInit } from '@nestjs/common';
import { z } from 'zod';

import {
  MAX_SEATS_PER_HOLD,
  RENTAL_DRIVER_AGE_MAX,
  RENTAL_DRIVER_AGE_MIN,
  VISA_PURPOSES,
  countryCodeSchema,
  isoDateSchema,
  type AddonProductType,
  type AgentCard,
} from '@suskii/shared';

import type { quoteSchema } from '../../bookings/bookings.schemas';
import { BusesService } from '../../buses/buses.service';
import { CarsFlags } from '../../ground/cars-flags';
import { inhouseQuoteRequestSchema } from '../../inhouse/inhouse.schemas';
import { InhouseQuotesService } from '../../inhouse/inhouse-quotes.service';
import { localDateTimeSchema } from '../../rentals/rentals.schemas';
import { FlightSearchService } from '../../search/flight-search.service';
import { HotelSearchService } from '../../search/hotel-search.service';
import type { AgentGrant } from '../agent-grants';
import { agentTool, AgentToolError, AgentToolRegistry } from '../agent-tool';

import { AgentPreparedParts, type PreparedPart } from './prepared-parts';

import {
  AgentToolCallers,
  card,
  cardsOut,
  issueCodes,
  moneyOut,
  note,
  placeText,
  problemCodes,
  problemsSchema,
  supplierText,
  utcTime,
  wallTime,
} from './tool-support';

type Quote = z.infer<typeof quoteSchema>;

/** What else a trip usually needs, as codes a model may offer and a client can word. */
const OTHER_SERVICES = ['hotel', 'car', 'airport_transfer', 'travel_insurance'] as const;

/**
 * What every "prepare a booking" tool answers with. `bookingStatus` is always `not_booked`: a
 * prepared booking is a priced offer waiting on the booking page, and the answer guard lets
 * nobody call it booked, paid or confirmed.
 */
const preparedOut = z.object({
  problems: problemsSchema,
  bookingStatus: z.literal('not_booked'),
  prepared: z.boolean(),
  what: z.string().nullable(),
  totalToPay: moneyOut.nullable(),
  priceChangedSinceSearch: z.boolean(),
  priceBeforeTheChange: moneyOut.nullable(),
  offerValidUntil: z.string().nullable(),
  /** After a flight: what the traveller may also want there, and for which dates. */
  alsoOffer: z.array(z.enum(OTHER_SERVICES)),
  stay: z
    .object({
      city: z.string().nullable(),
      country: z.string(),
      arrive: z.string(),
      leave: z.string().nullable(),
    })
    .nullable(),
  cards: cardsOut,
});
type Prepared = z.infer<typeof preparedOut>;

const notPrepared = (problems: string[]): Prepared => ({
  problems,
  bookingStatus: 'not_booked',
  prepared: false,
  what: null,
  totalToPay: null,
  priceChangedSinceSearch: false,
  priceBeforeTheChange: null,
  offerValidUntil: null,
  alsoOffer: [],
  stay: null,
  cards: [],
});

/**
 * Why nothing was prepared, as codes. A search the store no longer holds (its results last 30
 * minutes) is the same to a traveller as an option that sold out: search again.
 */
const refusal = (error: unknown): string[] | null =>
  error instanceof NotFoundException ? ['offer-unavailable'] : problemCodes(error);

/** Who travels, as every in-house quote counts them: the same numbers the search used. */
const travellersIn = {
  adults: z.number().int().min(1).max(9).meta({ description: 'As in the search.' }),
  children: z.number().int().min(0).max(8).default(0),
  infants: z.number().int().min(0).max(8).default(0),
};
const travellersOf = (input: { adults: number; children: number; infants: number }) => ({
  adults: input.adults,
  children: input.children,
  infants: input.infants,
});

/** The part of a trip, or the product, an add-on quote is. */
const ADDON_PARTS: Readonly<Record<AddonProductType, PreparedPart>> = {
  airport_transfer: 'transfer',
  insurance: 'insurance',
  esim: 'esim',
  lounge: 'lounge',
};

/** What a prepared in-house quote is shown as: the card's kind, its title and its lines. */
interface Shown {
  kind: AgentCard['kind'];
  what: string;
  lines: string[];
}

/** Ids of search results: opaque to a model, issued by the search tools, gone after 30 minutes. */
const resultId = z
  .string()
  .trim()
  .min(8)
  .max(200)
  .regex(/^[A-Za-z0-9_.:-]+$/);

/**
 * Preparing a booking for the traveller (ADR-109): the assistant has searched, the traveller
 * has chosen, and these tools do what a tap on that result does on the website or in the app.
 * They ask the supplier for the price as it is now, keep it as an ordinary quote and hand back
 * a card that opens the booking page for it.
 *
 * That is where the assistant's part ends. The traveller's names, documents and contact
 * details are entered on the booking page, never in the chat; the payment is the ordinary
 * hosted one; and the booking, its price check before payment, its fulfilment and any refund
 * are the ordinary pipeline's. Nothing here creates a booking, holds a seat or takes money, so
 * the tier is `propose`: a draft a person then acts on.
 */
@Injectable()
export class CheckoutTools implements OnModuleInit {
  constructor(
    private readonly registry: AgentToolRegistry,
    private readonly callers: AgentToolCallers,
    private readonly flights: FlightSearchService,
    private readonly hotels: HotelSearchService,
    private readonly inhouse: InhouseQuotesService,
    private readonly flags: CarsFlags,
    private readonly buses: BusesService,
    private readonly prepared: AgentPreparedParts,
  ) {}

  /**
   * Quotes one of Suskii's own products for the grant's caller, as a tap on its page does
   * (`InhouseQuotesService.create`), and hands its checkout. The conversation remembers the
   * quote as `part` for the trip summary (ADR-117).
   */
  private async prepareInhouse(
    grant: AgentGrant,
    part: PreparedPart | ((quote: Quote) => PreparedPart | null),
    request: unknown,
    show: (quote: Quote) => Shown | null,
  ): Promise<Prepared> {
    const parsed = inhouseQuoteRequestSchema.safeParse(request);
    if (!parsed.success) return notPrepared(issueCodes(parsed.error));
    const client = await this.callers.client(grant);
    try {
      const quote = await this.inhouse.create(parsed.data, client);
      const shown = show(quote);
      const kind = typeof part === 'function' ? part(quote) : part;
      if (!shown || !quote.price || !kind) throw new AgentToolError('failed');
      await this.prepared.remember(grant, kind, quote.quoteId);
      return {
        problems: [],
        bookingStatus: 'not_booked' as const,
        prepared: true,
        what: shown.what,
        totalToPay: quote.price.total,
        priceChangedSinceSearch: false,
        priceBeforeTheChange: null,
        offerValidUntil: utcTime(quote.expiresAt),
        alsoOffer: [],
        stay: null,
        cards: [
          ...card(shown.kind, shown.what, shown.lines, {
            price: quote.price.total,
            href: `/checkout/${quote.quoteId}`,
          }),
          ...note('booking_handoff'),
        ],
      };
    } catch (error) {
      const problems = refusal(error);
      if (!problems) throw error;
      return notPrepared(problems);
    }
  }

  onModuleInit(): void {
    this.registry.register(
      agentTool({
        name: 'flights.prepare_booking',
        description:
          "Prepare the booking of one flight option the traveller chose from flights.search: checks the price with the airline now and gives the traveller a card that opens the booking page, where they enter the travellers' details and pay. Call it only after they said which option they want. Nothing is booked or paid by this: say the booking is prepared and waits for their details and payment. If the price changed, say so. 'offer-expired' or 'offer-unavailable' in problems means search again.",
        tier: 'propose',
        scope: 'quotes',
        agents: ['flights', 'trip_builder', 'disruption'],
        input: z.object({
          offerId: resultId.meta({ description: 'The offerId of the chosen option, as returned.' }),
        }),
        output: preparedOut,
        run: async (input, { grant }) => {
          const client = await this.callers.client(grant);
          try {
            const quote = await this.flights.quote(input.offerId, grant.currency, client);
            const slices = quote.offer.slices;
            const first = slices[0];
            const last = slices.at(-1);
            if (!first || !last) throw new AgentToolError('failed');
            // A return trip stays at the first destination until the flight back leaves.
            const roundTrip =
              slices.length === 2 &&
              last.destination.code === first.origin.code &&
              last.origin.code === first.destination.code;
            const place = roundTrip ? first.destination : last.destination;
            const arrives = (roundTrip ? first : last).arrivalLocal.slice(0, 10);
            const what = `${placeText(first.origin)} → ${placeText(place)}, ${quote.offer.owner.name}`;
            await this.prepared.remember(grant, 'flight', quote.quoteId);
            return {
              problems: [],
              bookingStatus: 'not_booked' as const,
              prepared: true,
              what,
              totalToPay: quote.offer.price.total,
              priceChangedSinceSearch: quote.priceChange !== null,
              priceBeforeTheChange: quote.priceChange?.previous ?? null,
              offerValidUntil: utcTime(quote.expiresAt),
              alsoOffer: [...OTHER_SERVICES],
              stay: {
                city: place.cityName,
                country: place.countryCode,
                arrive: arrives,
                leave: roundTrip ? last.departureLocal.slice(0, 10) : null,
              },
              cards: [
                ...card(
                  'flight',
                  what,
                  slices.map(
                    (slice) =>
                      `${slice.origin.code} → ${slice.destination.code}  ${wallTime(slice.departureLocal)}`,
                  ),
                  { price: quote.offer.price.total, href: `/checkout/${quote.quoteId}` },
                ),
                ...note('booking_handoff'),
                ...note('other_services'),
              ],
            };
          } catch (error) {
            const problems = refusal(error);
            if (!problems) throw error;
            return notPrepared(problems);
          }
        },
      }),
    );

    this.registry.register(
      agentTool({
        name: 'hotels.prepare_booking',
        description:
          "Prepare the booking of one stay the traveller chose from hotels.search: checks the rate with the hotel's supplier now and gives the traveller a card that opens the booking page, where they enter the guests' details and pay. Call it only after they said which option they want. Nothing is booked or paid by this: say the booking is prepared and waits for their details and payment. If the price changed, say so. 'offer-expired' or 'offer-unavailable' in problems means search again.",
        tier: 'propose',
        scope: 'quotes',
        agents: ['hotels', 'trip_builder'],
        input: z.object({
          rateId: resultId.meta({ description: 'The rateId of the chosen option, as returned.' }),
        }),
        output: preparedOut,
        run: async (input, { grant }) => {
          const client = await this.callers.client(grant);
          try {
            const quote = await this.hotels.quote(input.rateId, grant.currency, client);
            const what = `${supplierText(quote.hotel.name)}, ${quote.hotel.cityName}`;
            await this.prepared.remember(grant, 'hotel', quote.quoteId);
            return {
              problems: [],
              bookingStatus: 'not_booked' as const,
              prepared: true,
              what,
              totalToPay: quote.rate.price.total,
              priceChangedSinceSearch: quote.priceChange !== null,
              priceBeforeTheChange: quote.priceChange?.previous ?? null,
              offerValidUntil: utcTime(quote.expiresAt),
              alsoOffer: [],
              stay: null,
              cards: [
                ...card('hotel', what, [supplierText(quote.rate.roomName)], {
                  price: quote.rate.price.total,
                  href: `/checkout/${quote.quoteId}`,
                }),
                ...note('booking_handoff'),
              ],
            };
          } catch (error) {
            const problems = refusal(error);
            if (!problems) throw error;
            return notPrepared(problems);
          }
        },
      }),
    );

    this.registry.register(
      agentTool({
        name: 'cars.prepare_booking',
        description:
          "Prepare the booking of one rental car the signed-in traveller chose from cars.rentals, for the same pick-up and return times: prices the period now and gives the traveller a card that opens the booking page, where they enter their details and pay. Call it only after they said which car they want. Nothing is booked or paid by this, and the car is not held: say the booking is prepared and waits for their details and payment. 'authentication-required' in problems means they must sign in first. Extras, another return branch and cross-border cover are chosen on the car's own page: point there when they ask for one.",
        tier: 'propose',
        scope: 'quotes',
        agents: ['cars', 'trip_builder'],
        input: z.object({
          carId: z.uuid().meta({ description: 'The carId of the chosen car, as returned.' }),
          pickupAt: localDateTimeSchema.meta({ description: 'YYYY-MM-DDTHH:mm, branch time.' }),
          returnAt: localDateTimeSchema.meta({ description: 'YYYY-MM-DDTHH:mm, branch time.' }),
          withChauffeur: z.boolean().default(false),
          driverAge: z
            .number()
            .int()
            .min(RENTAL_DRIVER_AGE_MIN)
            .max(RENTAL_DRIVER_AGE_MAX)
            .optional()
            .meta({ description: 'Only when the traveller said it; never guess an age.' }),
        }),
        output: preparedOut,
        run: async (input, { grant }) => {
          if (!this.flags.enabled('rentals')) return notPrepared(['not_offered']);
          const request = inhouseQuoteRequestSchema.safeParse({
            kind: 'rental',
            vehicleId: input.carId,
            pickupAtLocal: input.pickupAt,
            returnAtLocal: input.returnAt,
            chauffeur: input.withChauffeur,
            driverAge: input.driverAge ?? null,
            currency: grant.currency,
          });
          if (!request.success) return notPrepared(issueCodes(request.error));
          const client = await this.callers.client(grant);
          try {
            const quote = await this.inhouse.create(request.data, client);
            const rental = quote.rental;
            if (!rental || !quote.price) throw new AgentToolError('failed');
            const what = supplierText(rental.product.title);
            await this.prepared.remember(grant, 'car', quote.quoteId);
            return {
              problems: [],
              bookingStatus: 'not_booked' as const,
              prepared: true,
              what,
              totalToPay: quote.price.total,
              priceChangedSinceSearch: false,
              priceBeforeTheChange: null,
              offerValidUntil: utcTime(quote.expiresAt),
              alsoOffer: [],
              stay: null,
              cards: [
                ...card(
                  'car',
                  what,
                  [`${wallTime(input.pickupAt)} → ${wallTime(input.returnAt)}`],
                  { price: quote.price.total, href: `/checkout/${quote.quoteId}` },
                ),
                ...note('booking_handoff'),
              ] satisfies AgentCard[],
            };
          } catch (error) {
            const problems = refusal(error);
            if (!problems) throw error;
            return notPrepared(problems);
          }
        },
      }),
    );

    this.registry.register(
      agentTool({
        name: 'packages.prepare_booking',
        description:
          "Prepare the booking of one package departure the traveller chose from packages.search, for the same travellers: prices it now and gives the traveller a card that opens the booking page, where they enter the travellers' details and pay. Call it only after they said which departure they want. Nothing is booked or paid by this, and no room is held: say the booking is prepared and waits for their details and payment. 'sold-out' or 'offer-unavailable' in problems means that departure can no longer be had: offer the other departures.",
        tier: 'propose',
        scope: 'quotes',
        agents: ['tours', 'trip_builder'],
        input: z.object({
          departureId: z.uuid().meta({ description: 'The departureId chosen, as returned.' }),
          ...travellersIn,
        }),
        output: preparedOut,
        run: (input, { grant }) =>
          this.prepareInhouse(
            grant,
            'package',
            {
              kind: 'package',
              departureId: input.departureId,
              travellers: travellersOf(input),
              currency: grant.currency,
            },
            ({ package: item }) =>
              item && {
                kind: 'package',
                what: supplierText(item.product.title),
                lines: [item.cityName, `${item.startDate} \u2192 ${item.endDate}`],
              },
          ),
      }),
    );

    this.registry.register(
      agentTool({
        name: 'tours.prepare_booking',
        description:
          "Prepare the booking of one tour departure the traveller chose from tours.search, for the same travellers: prices it now and gives the traveller a card that opens the booking page, where they enter the travellers' details and pay. Call it only after they said which departure they want. Nothing is booked or paid by this, and no place is held: say the booking is prepared and waits for their details and payment. 'sold-out' or 'offer-unavailable' in problems means that departure can no longer be had: offer the other departures.",
        tier: 'propose',
        scope: 'quotes',
        agents: ['tours'],
        input: z.object({
          departureId: z.uuid().meta({ description: 'The departureId chosen, as returned.' }),
          ...travellersIn,
        }),
        output: preparedOut,
        run: (input, { grant }) =>
          this.prepareInhouse(
            grant,
            'tour',
            {
              kind: 'tour',
              departureId: input.departureId,
              travellers: travellersOf(input),
              currency: grant.currency,
            },
            ({ tour }) =>
              tour && {
                kind: 'tour',
                what: supplierText(tour.product.title),
                lines: [
                  tour.cityName,
                  wallTime(tour.startsAtLocal),
                  supplierText(tour.meetingPoint.name),
                ],
              },
          ),
      }),
    );

    this.registry.register(
      agentTool({
        name: 'addons.prepare_booking',
        description:
          "Prepare one travel add-on the traveller chose from addons.search (an airport transfer, travel insurance, an eSIM or lounge access) for their dates and travellers: prices it now and gives a card that opens the booking page, where they enter the details it needs and pay. For a transfer or a lounge visit the start and end are the same day; insurance and an eSIM cover the days of the trip. Pass the destination's cityId from catalog.places when you have it: a lounge or a local eSIM needs it. Call it only after they said which one they want. Nothing is booked or paid by this: say it is prepared and waits for their details and payment. 'not_available_there' in problems means it is not sold for that place.",
        tier: 'propose',
        scope: 'quotes',
        agents: ['tours', 'cars', 'trip_builder', 'flights', 'hotels'],
        input: z.object({
          addonId: z.uuid().meta({ description: 'The addonId chosen, as returned.' }),
          startDate: isoDateSchema.meta({ description: 'YYYY-MM-DD: the first day.' }),
          endDate: isoDateSchema.meta({ description: 'YYYY-MM-DD: the last day covered.' }),
          cityId: z.uuid().optional().meta({ description: 'A city id from catalog.places.' }),
          ...travellersIn,
        }),
        output: preparedOut,
        run: (input, { grant }) =>
          this.prepareInhouse(
            grant,
            (quote) => (quote.addon ? ADDON_PARTS[quote.addon.type] : null),
            {
              kind: 'addon',
              addonId: input.addonId,
              startDate: input.startDate,
              endDate: input.endDate,
              cityId: input.cityId ?? null,
              linkToken: null,
              travellers: travellersOf(input),
              currency: grant.currency,
            },
            ({ addon }) =>
              addon && {
                kind: addon.type === 'airport_transfer' ? 'transfer' : 'link',
                what: supplierText(addon.product.title),
                lines: [
                  ...(addon.cityName ? [addon.cityName] : []),
                  addon.startDate === addon.endDate
                    ? addon.startDate
                    : `${addon.startDate} \u2192 ${addon.endDate}`,
                ],
              },
          ),
      }),
    );

    this.registry.register(
      agentTool({
        name: 'visa.prepare_booking',
        description:
          "Prepare the visa assistance the traveller chose from visa.requirements, for their nationality, the purpose, the day they travel and how many apply: prices Suskii's service now and gives a card that opens the booking page, where they enter the applicants' details and pay; documents are uploaded after booking. Call it only after they said they want it. Nothing is booked, paid or applied for by this, and Suskii never promises a visa: say the assistance is prepared and waits for their details and payment. 'purpose_not_offered' or 'dates_invalid' in problems means that product does not fit: say so.",
        tier: 'propose',
        scope: 'quotes',
        agents: ['tours', 'flights', 'concierge'],
        input: z.object({
          productId: z.uuid().meta({ description: 'The productId chosen, as returned.' }),
          nationality: countryCodeSchema.meta({ description: "The passport's country." }),
          purpose: z.enum(VISA_PURPOSES).default('tourism'),
          travelDate: isoDateSchema.meta({ description: 'YYYY-MM-DD: the day they travel.' }),
          ...travellersIn,
        }),
        output: preparedOut,
        run: async (input, { grant }) => {
          const prepared = await this.prepareInhouse(
            grant,
            'visa',
            {
              kind: 'visa',
              productId: input.productId,
              purpose: input.purpose,
              nationality: input.nationality,
              travelDate: input.travelDate,
              travellers: travellersOf(input),
              currency: grant.currency,
            },
            ({ visa }) =>
              visa && {
                kind: 'visa',
                what: supplierText(visa.product.title),
                lines: [visa.travelDate],
              },
          );
          // Help with an application is never a visa: said whatever the model wrote.
          return prepared.prepared
            ? { ...prepared, cards: [...prepared.cards, ...note('visa_guidance')] }
            : prepared;
        },
      }),
    );

    this.registry.register(
      agentTool({
        name: 'buses.prepare_booking',
        description:
          "Hand over one bus trip the traveller chose from cars.buses, for the number of seats they need: checks the trip is still on sale with that many seats and gives a card that opens its seat map, where they choose the seats, enter the travellers' details and pay. Call it only after they said which trip they want. Nothing is booked, held or paid by this and no seat is chosen: say the seats are chosen on the seat map. 'not_enough_seats', 'trip-closed' or 'offer-unavailable' in problems means the trip no longer has room for them: offer another.",
        tier: 'propose',
        scope: 'quotes',
        agents: ['cars'],
        input: z.object({
          tripId: z.uuid().meta({ description: 'The tripId chosen, as returned.' }),
          seats: z.number().int().min(1).max(MAX_SEATS_PER_HOLD).default(1),
        }),
        output: z.object({
          problems: problemsSchema,
          bookingStatus: z.literal('not_booked'),
          seatMapReady: z.boolean(),
          what: z.string().nullable(),
          departs: z.string().nullable(),
          seatsLeft: z.number().int(),
          perSeat: moneyOut.nullable(),
          cards: cardsOut,
        }),
        run: async (input, { grant }) => {
          const nothing = (problems: string[], seatsLeft = 0) => ({
            problems,
            bookingStatus: 'not_booked' as const,
            seatMapReady: false,
            what: null,
            departs: null,
            seatsLeft,
            perSeat: null,
            cards: [],
          });
          if (!this.flags.enabled('buses')) return nothing(['not_offered']);
          const client = await this.callers.client(grant);
          try {
            const trip = await this.buses.detail(
              input.tripId,
              this.callers.currency(grant),
              client,
            );
            if (trip.seatsLeft < input.seats) return nothing(['not_enough_seats'], trip.seatsLeft);
            const what = `${trip.operator.name}, ${trip.origin.cityName} \u2192 ${trip.destination.cityName}`;
            return {
              problems: [],
              bookingStatus: 'not_booked' as const,
              seatMapReady: true,
              what,
              departs: wallTime(trip.departsAtLocal),
              seatsLeft: trip.seatsLeft,
              perSeat: trip.pricePerSeat,
              cards: [
                ...card(
                  'transfer',
                  trip.operator.name,
                  [
                    `${trip.origin.cityName} \u2192 ${trip.destination.cityName}`,
                    wallTime(trip.departsAtLocal),
                  ],
                  { price: trip.pricePerSeat, href: `/buses/trips/${trip.id}` },
                ),
                // The seats are the traveller's to choose: the assistant holds none (ADR-109).
                ...note('choose_seats'),
              ],
            };
          } catch (error) {
            const problems = refusal(error);
            if (!problems) throw error;
            return nothing(problems);
          }
        },
      }),
    );
  }
}
