import { Injectable, type OnModuleInit } from '@nestjs/common';
import { z } from 'zod';

import {
  CABIN_CLASSES,
  MAX_HOTEL_ROOMS,
  flightRequestToParams,
  flightSearchRequestSchema,
  hotelFormToParams,
  hotelSearchRequestSchema,
  iataCodeSchema,
  isoDateSchema,
  type AgentCard,
} from '@suskii/shared';

import { FlightSearchService } from '../../search/flight-search.service';
import { HotelSearchService } from '../../search/hotel-search.service';
import type { flightOfferSchema, hotelSummarySchema } from '../../search/search.schemas';
import { agentTool, AgentToolRegistry } from '../agent-tool';

import {
  AgentToolCallers,
  card,
  cardsOut,
  durationText,
  issueCodes,
  moneyOut,
  problemCodes,
  problemsSchema,
  utcTime,
  wallTime,
} from './tool-support';

type FlightOffer = z.infer<typeof flightOfferSchema>;
type HotelSummary = z.infer<typeof hotelSummarySchema>;

const count = (min: number, max: number, fallback: number) =>
  z.number().int().min(min).max(max).default(fallback);

const legOut = z.object({
  from: z.string(),
  fromCity: z.string().nullable(),
  to: z.string(),
  toCity: z.string().nullable(),
  departs: z.string(),
  arrives: z.string(),
  duration: z.string(),
  stops: z.number().int(),
  via: z.array(z.string()),
  flights: z.array(z.string()),
});

const flightOut = z.object({
  option: z.number().int(),
  airline: z.string(),
  sample: z.boolean(),
  legs: z.array(legOut),
  cabin: z.enum(CABIN_CLASSES),
  checkedBags: z.number().int(),
  carryOnBags: z.number().int(),
  refundable: z.boolean(),
  changeable: z.boolean(),
  canReserveAndPayLater: z.boolean(),
  total: moneyOut,
});

const hotelOut = z.object({
  option: z.number().int(),
  name: z.string(),
  sample: z.boolean(),
  stars: z.number().int(),
  area: z.string().nullable(),
  propertyType: z.string().nullable(),
  guestScore: z.number().nullable(),
  guestReviews: z.number().int(),
  room: z.string(),
  board: z.string(),
  refundable: z.boolean(),
  freeCancellationUntil: z.string().nullable(),
  perNight: moneyOut,
  total: moneyOut,
  payAtHotel: moneyOut.nullable(),
  percentBelowUsualPrice: z.number().int().nullable(),
});

const legOf = (slice: FlightOffer['slices'][number]): z.infer<typeof legOut> => ({
  from: slice.origin.code,
  fromCity: slice.origin.cityName,
  to: slice.destination.code,
  toCity: slice.destination.cityName,
  departs: wallTime(slice.departureLocal),
  arrives: wallTime(slice.arrivalLocal),
  duration: durationText(slice.durationMinutes),
  stops: slice.stops,
  via: slice.layovers.map((layover) => layover.airport.code),
  flights: slice.segments.map(
    (segment) => `${segment.marketingCarrier.code} ${segment.flightNumber}`,
  ),
});

/** "LOS \u2192 CDG \u2192 LHR  2026-12-10 07:15 \u2192 14:05": a leg without a word of any language. */
const legLine = (leg: z.infer<typeof legOut>): string =>
  `${[leg.from, ...leg.via, leg.to].join(' \u2192 ')}  ${leg.departs} \u2192 ${
    leg.arrives.slice(0, 10) === leg.departs.slice(0, 10) ? leg.arrives.slice(11) : leg.arrives
  }`;

/**
 * `flights.search` and `hotels.search`: the ordinary searches, run for the grant's caller, with
 * the prices that person would see on the results page (ADR-101). They quote nothing and hold
 * nothing: each card opens the same search on the website or in the app, where the traveller
 * chooses and books. A fare of the demo supplier is marked `sample`.
 */
@Injectable()
export class SearchTools implements OnModuleInit {
  constructor(
    private readonly registry: AgentToolRegistry,
    private readonly callers: AgentToolCallers,
    private readonly flights: FlightSearchService,
    private readonly hotels: HotelSearchService,
  ) {}

  onModuleInit(): void {
    this.registry.register(
      agentTool({
        name: 'flights.search',
        description:
          'Search flights for given airports, dates and travellers, with the price the traveller would pay now. Use IATA codes from catalog.places. Leave returnDate out for a one-way trip. Prices are for every traveller together, taxes and fees included. Offers marked sample are demo fares, not real ones.',
        tier: 'read',
        scope: 'search',
        agents: ['flights', 'trip_builder', 'disruption'],
        input: z.object({
          origin: iataCodeSchema.meta({ description: 'IATA code of the departure airport.' }),
          destination: iataCodeSchema.meta({ description: 'IATA code of the arrival airport.' }),
          departDate: isoDateSchema.meta({ description: 'YYYY-MM-DD, local to the origin.' }),
          returnDate: isoDateSchema.optional().meta({ description: 'YYYY-MM-DD; a return trip.' }),
          adults: count(1, 9, 1),
          children: count(0, 8, 0).meta({ description: 'Aged 2 to 11.' }),
          infants: count(0, 4, 0).meta({ description: 'Under 2, on a lap.' }),
          cabinClass: z.enum(CABIN_CLASSES).default('economy'),
          directOnly: z.boolean().default(false),
          sort: z.enum(['best', 'cheapest', 'fastest', 'earliest']).default('best'),
          limit: count(1, 6, 4),
        }),
        output: z.object({
          problems: problemsSchema,
          found: z.number().int(),
          someSuppliersDidNotAnswer: z.boolean(),
          offers: z.array(flightOut),
          cards: cardsOut,
        }),
        run: async (input, { grant }) => {
          const nothing = (problems: string[]) => ({
            problems,
            found: 0,
            someSuppliersDidNotAnswer: false,
            offers: [],
            cards: [],
          });
          const outbound = {
            origin: input.origin,
            destination: input.destination,
            departureDate: input.departDate,
          };
          const request = flightSearchRequestSchema.safeParse({
            slices: input.returnDate
              ? [
                  outbound,
                  {
                    origin: input.destination,
                    destination: input.origin,
                    departureDate: input.returnDate,
                  },
                ]
              : [outbound],
            passengers: { adults: input.adults, children: input.children, infants: input.infants },
            cabinClass: input.cabinClass,
            directOnly: input.directOnly,
          });
          if (!request.success) return nothing(issueCodes(request.error));

          const client = await this.callers.client(grant);
          try {
            let result = await this.flights.search(
              request.data,
              grant.currency,
              client,
              input.limit,
            );
            if (input.sort !== 'best' && result.total > 0) {
              result = await this.flights.list(
                result.searchId,
                { sort: input.sort, currency: grant.currency, limit: input.limit },
                client,
              );
            }
            const href = `/flights/search?${flightRequestToParams(request.data).toString()}`;
            const offers = result.offers.slice(0, input.limit).map((offer, index) => ({
              option: index + 1,
              airline: offer.owner.name,
              sample: offer.supplier === 'mock',
              legs: offer.slices.map(legOf),
              cabin: offer.cabinClass,
              checkedBags: offer.baggage.checked,
              carryOnBags: offer.baggage.carryOn,
              refundable: offer.conditions.refundable,
              changeable: offer.conditions.changeable,
              canReserveAndPayLater: offer.hold.available,
              total: offer.price.total,
            }));
            return {
              problems: [],
              found: result.total,
              someSuppliersDidNotAnswer: result.status === 'partial',
              offers,
              cards: offers.flatMap((offer): AgentCard[] =>
                card('flight', offer.airline, offer.legs.map(legLine), {
                  price: offer.total,
                  href,
                }),
              ),
            };
          } catch (error) {
            const problems = problemCodes(error);
            if (!problems) throw error;
            return nothing(problems);
          }
        },
      }),
    );

    this.registry.register(
      agentTool({
        name: 'hotels.search',
        description:
          'Search places to stay in a city for given dates and guests, with the price the traveller would pay now for the whole stay. Use a city id from catalog.places. Stays marked sample are demo inventory, not real hotels.',
        tier: 'read',
        scope: 'search',
        agents: ['hotels', 'trip_builder'],
        input: z.object({
          cityId: z.uuid().meta({ description: 'A city id from catalog.places.' }),
          checkIn: isoDateSchema,
          checkOut: isoDateSchema,
          rooms: z
            .array(
              z.object({
                adults: z.number().int().min(1).max(6),
                childAges: z.array(z.number().int().min(0).max(17)).max(4).default([]),
              }),
            )
            .min(1)
            .max(MAX_HOTEL_ROOMS)
            .default([{ adults: 2, childAges: [] }])
            .meta({ description: 'One entry per room.' }),
          freeCancellationOnly: z.boolean().default(false),
          sort: z.enum(['recommended', 'price', 'rating', 'stars']).default('recommended'),
          limit: count(1, 6, 4),
        }),
        output: z.object({
          problems: problemsSchema,
          found: z.number().int(),
          nights: z.number().int(),
          someSuppliersDidNotAnswer: z.boolean(),
          hotels: z.array(hotelOut),
          cards: cardsOut,
        }),
        run: async (input, { grant }) => {
          const nothing = (problems: string[]) => ({
            problems,
            found: 0,
            nights: 0,
            someSuppliersDidNotAnswer: false,
            hotels: [],
            cards: [],
          });
          const request = hotelSearchRequestSchema.safeParse({
            destination: { type: 'city', cityId: input.cityId },
            checkIn: input.checkIn,
            checkOut: input.checkOut,
            rooms: input.rooms,
            freeCancellationOnly: input.freeCancellationOnly,
          });
          if (!request.success) return nothing(issueCodes(request.error));

          const client = await this.callers.client(grant);
          try {
            let result = await this.hotels.search(
              request.data,
              grant.currency,
              client,
              input.limit,
            );
            if (input.sort !== 'recommended' && result.total > 0) {
              result = await this.hotels.list(
                result.searchId,
                { sort: input.sort, currency: grant.currency, limit: input.limit },
                client,
              );
            }
            const href = `/hotels/search?${hotelFormToParams(request.data).toString()}`;
            const hotels = result.hotels
              .slice(0, input.limit)
              .map((hotel: HotelSummary, index) => ({
                option: index + 1,
                name: hotel.name,
                sample: hotel.supplier === 'mock',
                stars: hotel.stars,
                area: hotel.area,
                propertyType: hotel.propertyType,
                guestScore: hotel.reviewScore,
                guestReviews: hotel.reviewCount,
                room: hotel.cheapestRate.roomName,
                board: hotel.cheapestRate.board,
                refundable: hotel.cheapestRate.refundable,
                freeCancellationUntil: hotel.cheapestRate.freeCancellationUntil
                  ? utcTime(hotel.cheapestRate.freeCancellationUntil)
                  : null,
                perNight: hotel.cheapestRate.pricePerNight,
                total: hotel.cheapestRate.price.total,
                payAtHotel: hotel.cheapestRate.payAtProperty,
                percentBelowUsualPrice: hotel.deal?.percentBelow ?? null,
              }));
            return {
              problems: [],
              found: result.total,
              nights: result.nights,
              someSuppliersDidNotAnswer: result.status === 'partial',
              hotels,
              cards: hotels.flatMap((hotel): AgentCard[] =>
                card(
                  'hotel',
                  hotel.name,
                  [
                    [hotel.stars > 0 ? `${hotel.stars}\u2605` : null, hotel.area]
                      .filter(Boolean)
                      .join(' \u00b7 '),
                    `${input.checkIn} \u2192 ${input.checkOut}`,
                  ],
                  { price: hotel.total, href },
                ),
              ),
            };
          } catch (error) {
            const problems = problemCodes(error);
            if (!problems) throw error;
            return nothing(problems);
          }
        },
      }),
    );
  }
}
