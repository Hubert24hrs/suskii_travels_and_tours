import { Injectable, type OnModuleInit } from '@nestjs/common';
import { z } from 'zod';

import {
  haversineMetres,
  iataCodeSchema,
  type AgentCard,
  type AgentName,
  type GeoPoint,
} from '@suskii/shared';

import { CatalogService } from '../../catalog/catalog.service';
import { LocationService, type MeasuredLeg } from '../../location/location.service';
import { PLACE_KINDS, PLACE_PRICE_LEVELS, type PlaceResult } from '../../location/places';
import { HotelSearchService } from '../../search/hotel-search.service';
import type { AgentGrant } from '../agent-grants';
import { agentTool, AgentToolRegistry } from '../agent-tool';

import { AgentPlaceRefs, PLACE_REF } from './place-refs';
import {
  cardsOut,
  distanceText,
  durationText,
  note,
  placeText,
  problemsSchema,
  supplierText,
} from './tool-support';

/** The agents a traveller asks about where things are: stays, whole trips and general help. */
const LOCATION_AGENTS: readonly AgentName[] = ['concierge', 'hotels', 'trip_builder'];

/** How far around a hotel or a place the nearest airports are looked for. */
const AIRPORT_RADIUS_KM = 150;

const count = (min: number, max: number, fallback: number) =>
  z.number().int().min(min).max(max).default(fallback);

const hotelRef = z
  .string()
  .trim()
  .min(8)
  .max(200)
  .meta({ description: 'The rateId of a hotel from hotels.search, as returned.' });
const airportRef = iataCodeSchema.meta({ description: 'An airport code from catalog.places.' });
const placeRef = z
  .string()
  .regex(PLACE_REF)
  .meta({ description: 'A place id from places.find or places.nearby, such as place_2.' });

const placeOut = z.object({
  /** Handed to the other places tools; never shown to the traveller. */
  place: z.string(),
  name: z.string(),
  address: z.string().nullable(),
  type: z.string().nullable(),
  /** The provider's average rating out of 5, and how many ratings it is made of. */
  rating: z.number().nullable(),
  ratings: z.number().int().nullable(),
  priceLevel: z.enum(PLACE_PRICE_LEVELS).nullable(),
  /** In a straight line from what the places were looked for around. */
  distance: z.string().nullable(),
  sample: z.boolean(),
});

const legOut = {
  distance: z.string().nullable(),
  distanceMetres: z.number().int().nullable(),
  /** Null when the distance is a straight line: nothing says how long the road takes. */
  drivingTime: z.string().nullable(),
  measured: z.enum(['by_road', 'straight_line', 'position_unknown']),
};

interface Anchor {
  point: GeoPoint;
  /** "Eko Hotel" or "Lagos (LOS)"; null for a place, whose name is not kept. */
  label: string | null;
  sample: boolean;
}

interface AnchorInput {
  hotel?: string | undefined;
  airport?: string | undefined;
  place?: string | undefined;
  cityId?: string | undefined;
}

const legFacts = (leg: MeasuredLeg) => ({
  distance: distanceText(leg.distanceMetres),
  distanceMetres: leg.distanceMetres,
  drivingTime: leg.durationSeconds === null ? null : durationText(leg.durationSeconds / 60),
  measured: leg.basis === 'routed' ? ('by_road' as const) : ('straight_line' as const),
});

/** The notes measured legs must be read with: a straight line, or a time without traffic. */
const legNotes = (legs: readonly MeasuredLeg[]): AgentCard[] => [
  ...(legs.some((leg) => leg.basis === 'straight_line') ? note('distance_straight') : []),
  ...(legs.some((leg) => leg.durationSeconds !== null) ? note('driving_estimate') : []),
];

/**
 * Ask Suskii's location tools (ADR-122): places around a hotel, an airport or a place found by
 * name, how far hotels are from a place or an airport, and the nearest airports. Each takes a
 * reference the platform already holds (a hotel of a search, an airport code, a place a tool
 * returned), so a model never invents a location or a distance. Places come from the places
 * provider (Google's, with its attribution), airports from our own catalog, distances from the
 * router or, when none may be used, the straight line, said as such. Nothing is booked or held.
 */
@Injectable()
export class LocationTools implements OnModuleInit {
  constructor(
    private readonly registry: AgentToolRegistry,
    private readonly location: LocationService,
    private readonly refs: AgentPlaceRefs,
    private readonly hotels: HotelSearchService,
    private readonly catalog: CatalogService,
  ) {}

  onModuleInit(): void {
    this.registry.register(
      agentTool({
        name: 'places.find',
        description:
          'Find a public place by name: a landmark, a district, a venue, an office or a beach the traveller wants to be near ("Eko Atlantic, Lagos"). Returns place ids (place_1...) for places.nearby, places.compare_proximity and places.airports_near; never show a place id. Never look for a person or a private home address.',
        tier: 'read',
        scope: 'catalog',
        agents: LOCATION_AGENTS,
        input: z.object({
          query: z
            .string()
            .trim()
            .min(2)
            .max(100)
            .meta({ description: 'The name of the place with its city or country.' }),
          nearHotel: hotelRef.optional(),
          nearAirport: airportRef.optional(),
          nearCityId: z.uuid().optional().meta({ description: 'A city id from catalog.places.' }),
          limit: count(1, 5, 3),
        }),
        output: z.object({ problems: problemsSchema, places: z.array(placeOut), cards: cardsOut }),
        run: async (input, { grant, signal }) => {
          const nearInput = input.nearHotel
            ? { hotel: input.nearHotel }
            : input.nearAirport
              ? { airport: input.nearAirport }
              : input.nearCityId
                ? { cityId: input.nearCityId }
                : null;
          // A "near" that cannot be read only loses the preference; the search still runs.
          const near = nearInput ? await this.anchor(nearInput, grant) : null;
          const answer = await this.location.find(
            input.query,
            typeof near === 'object' && near !== null ? near.point : null,
            input.limit,
            grant.locale,
            signal,
          );
          if (!answer.ok) return { problems: [answer.problem], places: [], cards: [] };
          const sample = answer.provider === 'mock';
          return {
            problems: answer.places.length === 0 ? ['nothing_found'] : [],
            places: await this.placesOut(grant, answer.places, sample, null),
            cards: answer.provider === 'google' ? note('places_google') : [],
          };
        },
      }),
    );

    this.registry.register(
      agentTool({
        name: 'places.nearby',
        description:
          'What is around a hotel from hotels.search, an airport, or a place from places.find: restaurants, attractions (museums, parks, galleries, sights) or shopping, the most popular first, each with its distance in a straight line. Give exactly one of hotel, airport or place.',
        tier: 'read',
        scope: 'catalog',
        agents: LOCATION_AGENTS,
        input: z.object({
          hotel: hotelRef.optional(),
          airport: airportRef.optional(),
          place: placeRef.optional(),
          kind: z.enum(PLACE_KINDS),
          limit: count(1, 6, 5),
        }),
        output: z.object({
          problems: problemsSchema,
          around: z.string().nullable(),
          places: z.array(placeOut),
          cards: cardsOut,
        }),
        run: async (input, { grant, signal }) => {
          const nothing = (problem: string) => ({
            problems: [problem],
            around: null,
            places: [],
            cards: [],
          });
          const anchor = await this.anchor(input, grant);
          if (typeof anchor === 'string') return nothing(anchor);
          const answer = await this.location.nearby(
            anchor.point,
            input.kind,
            input.limit,
            grant.locale,
            signal,
          );
          if (!answer.ok) return nothing(answer.problem);
          const sample = answer.provider === 'mock' || anchor.sample;
          return {
            problems: answer.places.length === 0 ? ['nothing_found'] : [],
            around: anchor.label,
            places: await this.placesOut(grant, answer.places, sample, anchor.point),
            cards: [
              ...(answer.provider === 'google' ? note('places_google') : []),
              ...(answer.places.length > 0 ? note('distance_straight') : []),
            ],
          };
        },
      }),
    );

    this.registry.register(
      agentTool({
        name: 'places.compare_proximity',
        description:
          'How far each hotel from hotels.search is from an airport or from a place found with places.find, nearest first: by road with the driving time when a router answers, otherwise in a straight line. Use it when the traveller wants to stay close to somewhere. Give exactly one of airport or place.',
        tier: 'read',
        scope: 'search',
        agents: LOCATION_AGENTS,
        input: z.object({
          hotels: z
            .array(hotelRef)
            .min(1)
            .max(8)
            .meta({ description: 'The rateIds of the hotels to compare, from hotels.search.' }),
          airport: airportRef.optional(),
          place: placeRef.optional(),
        }),
        output: z.object({
          problems: problemsSchema,
          to: z.string().nullable(),
          hotels: z.array(
            z.object({
              rateId: z.string(),
              name: z.string(),
              sample: z.boolean(),
              ...legOut,
            }),
          ),
          sampleFigures: z.boolean(),
          cards: cardsOut,
        }),
        run: async (input, { grant, signal }) => {
          const nothing = (problem: string) => ({
            problems: [problem],
            to: null,
            hotels: [],
            sampleFigures: false,
            cards: [],
          });
          const target = await this.anchor({ airport: input.airport, place: input.place }, grant);
          if (typeof target === 'string') return nothing(target);
          const positions = await this.hotels.positions(input.hotels);
          if (positions.size === 0) return nothing('search_expired');
          const located = [...positions.values()].filter(
            (hotel): hotel is typeof hotel & { point: GeoPoint } => hotel.point !== null,
          );
          const measured = await this.location.measure(
            located.map((hotel) => hotel.point),
            [target.point],
            signal,
          );
          const legs = measured.legs.flatMap((row) => (row[0] ? [row[0]] : []));
          const rows = located
            .map((hotel, index) => {
              const leg = measured.legs[index]?.[0];
              return {
                rateId: hotel.rateId,
                name: supplierText(hotel.name),
                sample: hotel.sample,
                ...(leg
                  ? legFacts(leg)
                  : {
                      distance: null,
                      distanceMetres: null,
                      drivingTime: null,
                      measured: 'position_unknown' as const,
                    }),
              };
            })
            .sort((a, b) => (a.distanceMetres ?? Infinity) - (b.distanceMetres ?? Infinity));
          const unknown = [...positions.values()]
            .filter((hotel) => hotel.point === null)
            .map((hotel) => ({
              rateId: hotel.rateId,
              name: supplierText(hotel.name),
              sample: hotel.sample,
              distance: null,
              distanceMetres: null,
              drivingTime: null,
              measured: 'position_unknown' as const,
            }));
          return {
            problems: positions.size < new Set(input.hotels).size ? ['search_expired'] : [],
            to: target.label,
            hotels: [...rows, ...unknown],
            sampleFigures: measured.sample || target.sample,
            cards: legNotes(legs),
          };
        },
      }),
    );

    this.registry.register(
      agentTool({
        name: 'places.airports_near',
        description:
          'The nearest airports with scheduled flights to a hotel from hotels.search or a place from places.find, from Suskii’s own airport list, with the distance and, when a router answers, the driving time. Give exactly one of hotel or place.',
        tier: 'read',
        scope: 'catalog',
        agents: LOCATION_AGENTS,
        input: z.object({
          hotel: hotelRef.optional(),
          place: placeRef.optional(),
          limit: count(1, 4, 3),
        }),
        output: z.object({
          problems: problemsSchema,
          around: z.string().nullable(),
          airports: z.array(
            z.object({
              code: z.string(),
              name: z.string(),
              city: z.string().nullable(),
              ...legOut,
            }),
          ),
          sampleFigures: z.boolean(),
          cards: cardsOut,
        }),
        run: async (input, { grant, signal }) => {
          const nothing = (problem: string) => ({
            problems: [problem],
            around: null,
            airports: [],
            sampleFigures: false,
            cards: [],
          });
          const anchor = await this.anchor({ hotel: input.hotel, place: input.place }, grant);
          if (typeof anchor === 'string') return nothing(anchor);
          const airports = await this.catalog.airportsAround(
            anchor.point,
            AIRPORT_RADIUS_KM,
            input.limit,
          );
          if (airports.length === 0) return { ...nothing('nothing_found'), around: anchor.label };
          const measured = await this.location.measure(
            [anchor.point],
            airports.map((airport) => airport.point),
            signal,
          );
          const legs = measured.legs[0] ?? [];
          const rows = airports
            .map((airport, index) => {
              const leg = legs[index];
              return {
                code: airport.code,
                name: airport.name,
                city: airport.cityName,
                ...(leg
                  ? legFacts(leg)
                  : {
                      distance: distanceText(airport.distanceMetres),
                      distanceMetres: airport.distanceMetres,
                      drivingTime: null,
                      measured: 'straight_line' as const,
                    }),
              };
            })
            .sort((a, b) => (a.distanceMetres ?? 0) - (b.distanceMetres ?? 0));
          return {
            problems: [],
            around: anchor.label,
            airports: rows,
            sampleFigures: measured.sample || anchor.sample,
            cards: legNotes(legs),
          };
        },
      }),
    );
  }

  /**
   * What a tool measures from or around, read from the platform's own records: a hotel of a
   * search the traveller ran, an airport of the catalog, a place a tool of this conversation
   * returned, or a city. Exactly one must be given; anything else is a problem code.
   */
  private async anchor(input: AnchorInput, grant: AgentGrant): Promise<Anchor | string> {
    const given = [input.hotel, input.airport, input.place, input.cityId].filter(
      (value) => value !== undefined,
    );
    if (given.length !== 1) return 'anchor_required';
    if (input.hotel !== undefined) {
      const position = (await this.hotels.positions([input.hotel])).get(input.hotel);
      if (!position) return 'search_expired';
      if (!position.point) return 'position_unknown';
      return { point: position.point, label: supplierText(position.name), sample: position.sample };
    }
    if (input.airport !== undefined) {
      const airport = await this.catalog.airport(input.airport);
      if (!airport) return 'unknown_airport';
      return {
        point: { lat: airport.latitude, lng: airport.longitude },
        label: placeText({ code: airport.code, cityName: airport.municipality }),
        sample: false,
      };
    }
    if (input.place !== undefined) {
      const found = await this.refs.point(grant, input.place);
      return found ? { point: found.point, label: null, sample: found.sample } : 'place_unknown';
    }
    const city = input.cityId ? await this.catalog.city(input.cityId) : null;
    if (typeof city?.latitude !== 'number' || typeof city.longitude !== 'number') {
      return 'unknown_city';
    }
    return { point: { lat: city.latitude, lng: city.longitude }, label: city.name, sample: false };
  }

  private async placesOut(
    grant: AgentGrant,
    places: readonly PlaceResult[],
    sample: boolean,
    from: GeoPoint | null,
  ): Promise<z.infer<typeof placeOut>[]> {
    const refs = await this.refs.remember(grant, places, sample);
    return places.map((place, index) => ({
      place: refs[index] ?? '',
      name: supplierText(place.name),
      address: place.address === null ? null : supplierText(place.address, 160),
      type: place.type,
      rating: place.rating,
      ratings: place.ratingCount,
      priceLevel: place.priceLevel,
      distance: from ? distanceText(haversineMetres(from, place.point)) : null,
      sample,
    }));
  }
}
