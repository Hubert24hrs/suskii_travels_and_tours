import { Injectable, NotFoundException, type OnModuleInit } from '@nestjs/common';
import { z } from 'zod';

import { RENTAL_DRIVER_AGE_MAX, RENTAL_DRIVER_AGE_MIN, type AgentCard } from '@suskii/shared';

import { CarsFlags } from '../../ground/cars-flags';
import { inhouseQuoteRequestSchema } from '../../inhouse/inhouse.schemas';
import { InhouseQuotesService } from '../../inhouse/inhouse-quotes.service';
import { localDateTimeSchema } from '../../rentals/rentals.schemas';
import { FlightSearchService } from '../../search/flight-search.service';
import { HotelSearchService } from '../../search/hotel-search.service';
import { agentTool, AgentToolError, AgentToolRegistry } from '../agent-tool';

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
  ) {}

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
  }
}
