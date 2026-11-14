import { Injectable, NotFoundException, type OnModuleInit } from '@nestjs/common';
import { z } from 'zod';

import {
  ADDON_PRODUCT_TYPES,
  MAX_SEATS_PER_HOLD,
  RENTAL_CATEGORIES,
  RENTAL_DRIVER_AGE_MAX,
  RENTAL_DRIVER_AGE_MIN,
  TRANSMISSIONS,
  VISA_PURPOSES,
  countryCodeSchema,
  isoDateSchema,
  type AgentCard,
} from '@suskii/shared';

import { BusesService } from '../../buses/buses.service';
import { CarsFlags } from '../../ground/cars-flags';
import { InhouseCatalogService } from '../../inhouse/inhouse-catalog.service';
import { RentalsCatalogService } from '../../rentals/rentals-catalog.service';
import { localDateTimeSchema } from '../../rentals/rentals.schemas';
import { VisaService } from '../../visa/visa.service';
import { agentTool, AgentToolRegistry } from '../agent-tool';

import {
  AgentToolCallers,
  card,
  cardsOut,
  durationText,
  moneyOut,
  note,
  problemCodes,
  problemsSchema,
  wallTime,
} from './tool-support';

const SUMMARY_MAX = 300;
const brief = (text: string): string =>
  text.length > SUMMARY_MAX ? `${text.slice(0, SUMMARY_MAX - 1)}\u2026` : text;

const count = (min: number, max: number, fallback: number) =>
  z.number().int().min(min).max(max).default(fallback);
const limit = count(1, 6, 4);

/** Departures listed per package or tour: enough to choose a date, small enough for a model. */
const DEPARTURES_SHOWN = 4;

/** A detail read that lost a race with an unpublish lists no departures, never an error. */
const unlessGone = <T>(read: Promise<T>): Promise<T | null> =>
  read.catch((error: unknown) => {
    if (error instanceof NotFoundException) return null;
    throw error;
  });

/** `not_offered`: the product is switched off here, as its routes answer 404 (ADR-049). */
const NOT_OFFERED = ['not_offered'];

/**
 * What Suskii sells from its own catalog and fleet, read for the grant's caller: rental cars,
 * intercity buses, packages, tours, visa assistance and travel add-ons. Each tool reads the
 * same lists the website shows and links to the same pages; none of them quotes or holds
 * anything. Demo inventory is marked `sample`.
 */
@Injectable()
export class ProductTools implements OnModuleInit {
  constructor(
    private readonly registry: AgentToolRegistry,
    private readonly callers: AgentToolCallers,
    private readonly flags: CarsFlags,
    private readonly rentals: RentalsCatalogService,
    private readonly buses: BusesService,
    private readonly inhouse: InhouseCatalogService,
    private readonly visa: VisaService,
  ) {}

  onModuleInit(): void {
    this.registry.register(
      agentTool({
        name: 'cars.rentals',
        description:
          'Find rental cars that are free in a city for a pick-up and a return time, with the price of the period and the refundable deposit. Times are local to the branch. Cars marked sample are demo inventory. When the traveller chooses a car, hand its carId and the same times to cars.prepare_booking; never show a carId to the traveller.',
        tier: 'read',
        scope: 'search',
        agents: ['cars', 'trip_builder'],
        input: z.object({
          city: z.string().trim().min(2).max(80).meta({ description: 'City name, e.g. Lagos.' }),
          pickupAt: localDateTimeSchema.meta({ description: 'YYYY-MM-DDTHH:mm, local time.' }),
          returnAt: localDateTimeSchema.meta({ description: 'YYYY-MM-DDTHH:mm, local time.' }),
          category: z.enum(RENTAL_CATEGORIES).optional(),
          transmission: z.enum(TRANSMISSIONS).optional(),
          atAirport: z.boolean().default(false),
          withChauffeur: z.boolean().default(false),
          driverAge: z
            .number()
            .int()
            .min(RENTAL_DRIVER_AGE_MIN)
            .max(RENTAL_DRIVER_AGE_MAX)
            .optional()
            .meta({ description: 'Only when the traveller said it; never guess an age.' }),
          limit,
        }),
        output: z.object({
          problems: problemsSchema,
          found: z.number().int(),
          days: z.number().int(),
          cars: z.array(
            z.object({
              option: z.number().int(),
              /** Handed to cars.prepare_booking when the traveller chooses this car. */
              carId: z.string(),
              car: z.string(),
              sample: z.boolean(),
              category: z.enum(RENTAL_CATEGORIES),
              transmission: z.enum(TRANSMISSIONS),
              seats: z.number().int(),
              branch: z.string(),
              airport: z.string().nullable(),
              perDay: moneyOut,
              rentalForThePeriod: moneyOut,
              refundableDeposit: moneyOut,
              youngestDriver: z.number().int(),
              chauffeurPerDay: moneyOut.nullable(),
              kilometresPerDay: z.number().int().nullable(),
              fuelPolicy: z.string(),
            }),
          ),
          cards: cardsOut,
        }),
        run: async (input) => {
          const nothing = (problems: string[]) => ({
            problems,
            found: 0,
            days: 0,
            cars: [],
            cards: [],
          });
          if (!this.flags.enabled('rentals')) return nothing(NOT_OFFERED);
          try {
            const result = await this.rentals.search({
              city: input.city,
              pickupAt: input.pickupAt,
              returnAt: input.returnAt,
              category: input.category,
              transmission: input.transmission,
              airport: input.atAirport,
              driverAge: input.driverAge,
              chauffeur: input.withChauffeur,
            });
            const period = `?pickupAt=${encodeURIComponent(input.pickupAt)}&returnAt=${encodeURIComponent(input.returnAt)}${input.withChauffeur ? '&chauffeur=true' : ''}`;
            const shown = result.vehicles.slice(0, input.limit);
            return {
              problems: [],
              found: result.vehicles.length,
              days: result.days,
              cars: shown.map((vehicle, index) => ({
                option: index + 1,
                carId: vehicle.id,
                car: `${vehicle.make} ${vehicle.model} ${vehicle.year}`,
                sample: vehicle.sample,
                category: vehicle.category,
                transmission: vehicle.transmission,
                seats: vehicle.seats,
                branch: vehicle.branch.name,
                airport: vehicle.branch.airportCode,
                perDay: vehicle.daily,
                rentalForThePeriod: vehicle.estimate.rental,
                refundableDeposit: vehicle.estimate.deposit,
                youngestDriver: vehicle.minDriverAge,
                chauffeurPerDay: vehicle.chauffeurDaily,
                kilometresPerDay: vehicle.mileage.kmPerDay,
                fuelPolicy: vehicle.fuelPolicy,
              })),
              cards: shown.flatMap((vehicle): AgentCard[] =>
                card(
                  'car',
                  `${vehicle.make} ${vehicle.model}`,
                  [
                    vehicle.branch.name,
                    `${wallTime(input.pickupAt)} \u2192 ${wallTime(input.returnAt)}`,
                  ],
                  { price: vehicle.estimate.rental, href: `/rentals/${vehicle.slug}${period}` },
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

    this.registry.register(
      agentTool({
        name: 'cars.buses',
        description:
          'Find intercity bus departures between two cities on a date, with the price per seat and the seats left. When nothing is found, the cities buses run between are listed so you can check the names. Trips marked sample are demo inventory. When the traveller chooses a trip, hand its tripId and the number of seats to buses.prepare_booking; never show a tripId to the traveller.',
        tier: 'read',
        scope: 'search',
        agents: ['cars'],
        input: z.object({
          from: z.string().trim().min(2).max(80).meta({ description: 'Origin city name.' }),
          to: z.string().trim().min(2).max(80).meta({ description: 'Destination city name.' }),
          date: isoDateSchema.meta({ description: 'YYYY-MM-DD, local to the origin.' }),
          seats: count(1, MAX_SEATS_PER_HOLD, 1),
          limit,
        }),
        output: z.object({
          problems: problemsSchema,
          found: z.number().int(),
          trips: z.array(
            z.object({
              option: z.number().int(),
              /** Handed to buses.prepare_booking when the traveller chooses this trip. */
              tripId: z.string(),
              operator: z.string(),
              sample: z.boolean(),
              from: z.string(),
              to: z.string(),
              departs: z.string(),
              duration: z.string(),
              coach: z.string(),
              seatsLeft: z.number().int(),
              perSeat: moneyOut,
            }),
          ),
          citiesWithBuses: z.array(z.string()).max(40),
          cards: cardsOut,
        }),
        run: async (input, { grant }) => {
          if (!this.flags.enabled('buses')) {
            return { problems: NOT_OFFERED, found: 0, trips: [], citiesWithBuses: [], cards: [] };
          }
          const client = await this.callers.client(grant);
          const trips = await this.buses.search(
            {
              currency: this.callers.currency(grant),
              from: input.from,
              to: input.to,
              date: input.date,
              seats: input.seats,
            },
            client,
          );
          const shown = trips.slice(0, input.limit);
          const cities =
            trips.length === 0
              ? (await this.buses.cities()).cities.map((city) => city.name).slice(0, 40)
              : [];
          return {
            problems: [],
            found: trips.length,
            trips: shown.map((trip, index) => ({
              option: index + 1,
              tripId: trip.id,
              operator: trip.operator.name,
              sample: trip.sample,
              from: `${trip.origin.name}, ${trip.origin.cityName}`,
              to: `${trip.destination.name}, ${trip.destination.cityName}`,
              departs: wallTime(trip.departsAtLocal),
              duration: durationText(trip.durationMinutes),
              coach: trip.coach,
              seatsLeft: trip.seatsLeft,
              perSeat: trip.pricePerSeat,
            })),
            citiesWithBuses: cities,
            cards: shown.flatMap((trip): AgentCard[] =>
              card(
                'transfer',
                trip.operator.name,
                [
                  `${trip.origin.cityName} \u2192 ${trip.destination.cityName}`,
                  wallTime(trip.departsAtLocal),
                ],
                { price: trip.pricePerSeat, href: `/buses/trips/${trip.id}` },
              ),
            ),
          };
        },
      }),
    );

    this.registry.register(
      agentTool({
        name: 'packages.search',
        description:
          'List holiday packages (flight, stay and extras sold together by Suskii) for a city, a country or a month, with the lowest price per adult and the next departures that have room for the travellers. Packages marked sample are demo inventory. When the traveller chooses a departure, hand its departureId and the same travellers to packages.prepare_booking; never show a departureId to the traveller.',
        tier: 'read',
        scope: 'search',
        agents: ['tours', 'trip_builder'],
        input: z.object({
          cityId: z.uuid().optional().meta({ description: 'A city id from catalog.places.' }),
          countryCode: countryCodeSchema.optional(),
          month: z
            .string()
            .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
            .optional()
            .meta({ description: 'YYYY-MM: departures starting in that month.' }),
          adults: count(1, 9, 2),
          children: count(0, 8, 0),
          limit,
        }),
        output: z.object({
          found: z.number().int(),
          packages: z.array(
            z.object({
              option: z.number().int(),
              title: z.string(),
              sample: z.boolean(),
              summary: z.string(),
              city: z.string(),
              countryCode: z.string(),
              nights: z.number().int(),
              fromPerAdult: moneyOut,
              nextDeparture: z.string(),
              departuresWithRoom: z.number().int(),
              departures: z.array(
                z.object({
                  /** Handed to packages.prepare_booking when the traveller chooses it. */
                  departureId: z.string(),
                  starts: z.string(),
                  ends: z.string(),
                  seatsLeft: z.number().int(),
                  perAdult: moneyOut,
                }),
              ),
            }),
          ),
          cards: cardsOut,
        }),
        run: async (input, { grant }) => {
          const client = await this.callers.client(grant);
          const travellers = { adults: input.adults, children: input.children, infants: 0 };
          const packages = await this.inhouse.listPackages(
            {
              currency: this.callers.currency(grant),
              adults: input.adults,
              children: input.children,
              infants: 0,
              cityId: input.cityId,
              countryCode: input.countryCode,
              month: input.month,
              limit: 24,
            },
            client,
          );
          const shown = packages.slice(0, input.limit);
          // The departures each one has for these travellers, priced as its page prices them.
          const details = await Promise.all(
            shown.map((item) =>
              unlessGone(
                this.inhouse.packageDetail(
                  item.slug,
                  { currency: this.callers.currency(grant), ...travellers },
                  client,
                ),
              ),
            ),
          );
          return {
            found: packages.length,
            packages: shown.map((item, index) => ({
              option: index + 1,
              title: item.title,
              sample: item.sample,
              summary: brief(item.summary),
              city: item.cityName,
              countryCode: item.countryCode,
              nights: item.nights,
              fromPerAdult: item.fromPrice,
              nextDeparture: item.nextDeparture,
              departuresWithRoom: item.departures,
              departures: (details[index]?.departures ?? [])
                .filter(
                  (departure) =>
                    departure.bookable &&
                    (!input.month || departure.startDate.startsWith(input.month)),
                )
                .slice(0, DEPARTURES_SHOWN)
                .map((departure) => ({
                  departureId: departure.id,
                  starts: departure.startDate,
                  ends: departure.endDate,
                  seatsLeft: departure.seatsLeft,
                  perAdult: departure.prices.adult,
                })),
            })),
            cards: shown.flatMap((item): AgentCard[] =>
              card('package', item.title, [item.cityName, item.nextDeparture], {
                price: item.fromPrice,
                href: `/packages/${item.slug}`,
              }),
            ),
          };
        },
      }),
    );

    this.registry.register(
      agentTool({
        name: 'tours.search',
        description:
          'List tours and activities run by Suskii, by name, city or date, with the lowest price and the next departures that have room for the travellers (local time at the meeting point). Tours marked sample are demo inventory. When the traveller chooses a departure, hand its departureId and the same travellers to tours.prepare_booking; never show a departureId to the traveller.',
        tier: 'read',
        scope: 'search',
        agents: ['tours'],
        input: z.object({
          query: z
            .string()
            .trim()
            .min(2)
            .max(64)
            .optional()
            .meta({ description: 'A tour, a city or a country.' }),
          cityId: z.uuid().optional().meta({ description: 'A city id from catalog.places.' }),
          date: isoDateSchema.optional().meta({ description: 'Departures on this local date.' }),
          adults: count(1, 9, 2),
          children: count(0, 8, 0),
          limit,
        }),
        output: z.object({
          found: z.number().int(),
          tours: z.array(
            z.object({
              option: z.number().int(),
              title: z.string(),
              sample: z.boolean(),
              summary: z.string(),
              city: z.string(),
              countryCode: z.string(),
              duration: z.string(),
              category: z.string().nullable(),
              fromPrice: moneyOut,
              nextDeparture: z.string(),
              departuresWithRoom: z.number().int(),
              departures: z.array(
                z.object({
                  /** Handed to tours.prepare_booking when the traveller chooses it. */
                  departureId: z.string(),
                  starts: z.string(),
                  seatsLeft: z.number().int(),
                  perAdult: moneyOut,
                }),
              ),
            }),
          ),
          cards: cardsOut,
        }),
        run: async (input, { grant }) => {
          const client = await this.callers.client(grant);
          const travellers = { adults: input.adults, children: input.children, infants: 0 };
          const tours = await this.inhouse.listTours(
            {
              currency: this.callers.currency(grant),
              adults: input.adults,
              children: input.children,
              infants: 0,
              q: input.query,
              cityId: input.cityId,
              date: input.date,
              limit: 24,
            },
            client,
          );
          const shown = tours.slice(0, input.limit);
          const details = await Promise.all(
            shown.map((item) =>
              unlessGone(
                this.inhouse.tourDetail(
                  item.slug,
                  { currency: this.callers.currency(grant), ...travellers },
                  client,
                ),
              ),
            ),
          );
          return {
            found: tours.length,
            tours: shown.map((item, index) => ({
              option: index + 1,
              title: item.title,
              sample: item.sample,
              summary: brief(item.summary),
              city: item.cityName,
              countryCode: item.countryCode,
              duration: durationText(item.durationMinutes),
              category: item.category,
              fromPrice: item.fromPrice,
              nextDeparture: wallTime(item.nextDeparture),
              departuresWithRoom: item.departures,
              departures: (details[index]?.departures ?? [])
                .filter(
                  (departure) =>
                    departure.bookable &&
                    (!input.date || departure.startsAtLocal.startsWith(input.date)),
                )
                .slice(0, DEPARTURES_SHOWN)
                .map((departure) => ({
                  departureId: departure.id,
                  starts: wallTime(departure.startsAtLocal),
                  seatsLeft: departure.seatsLeft,
                  perAdult: departure.prices.adult,
                })),
            })),
            cards: shown.flatMap((item): AgentCard[] =>
              card('tour', item.title, [item.cityName, wallTime(item.nextDeparture)], {
                price: item.fromPrice,
                href: `/tours/${item.slug}`,
              }),
            ),
          };
        },
      }),
    );

    this.registry.register(
      agentTool({
        name: 'visa.requirements',
        description:
          "Whether a traveller of one nationality needs a visa for a country, from Suskii's own rules, and the visa assistance Suskii sells for it. When the requirement is unknown there is no rule on file: say so and never guess. Always pass on the disclaimer. Use ISO 3166 two-letter country codes. When the traveller wants the assistance, hand its productId with the same nationality and purpose to visa.prepare_booking; never show a productId to the traveller.",
        tier: 'read',
        scope: 'catalog',
        agents: ['tours', 'flights', 'concierge'],
        input: z
          .object({
            nationality: countryCodeSchema.meta({ description: "The passport's country." }),
            destination: countryCodeSchema,
            purpose: z.enum(VISA_PURPOSES).default('tourism'),
          })
          .refine((value) => value.nationality !== value.destination, {
            path: ['destination'],
            message: 'same_nationality_destination',
          }),
        output: z.object({
          requirement: z.string(),
          sample: z.boolean(),
          longestStayDays: z.number().int().nullable(),
          notes: z.string().nullable(),
          ruleCheckedOn: z.string().nullable(),
          disclaimer: z.string(),
          assistance: z.array(
            z.object({
              option: z.number().int(),
              /** Handed to visa.prepare_booking when the traveller wants this assistance. */
              productId: z.string(),
              title: z.string(),
              sample: z.boolean(),
              summary: z.string(),
              processingDays: z.string(),
              serviceFeePerApplicant: moneyOut,
              governmentFeeNote: z.string().nullable(),
            }),
          ),
          cards: cardsOut,
        }),
        run: async (input, { grant }) => {
          const client = await this.callers.client(grant);
          const answer = await this.visa.eligibility(
            { ...input, currency: this.callers.currency(grant) },
            client,
          );
          const shown = answer.products.slice(0, 4);
          return {
            requirement: answer.requirement,
            sample: answer.sample,
            longestStayDays: answer.maxStayDays,
            notes: answer.notes ? brief(answer.notes) : null,
            ruleCheckedOn: answer.verifiedAt,
            disclaimer: answer.disclaimer,
            assistance: shown.map((product, index) => ({
              option: index + 1,
              productId: product.id,
              title: product.title,
              sample: product.sample,
              summary: brief(product.summary),
              processingDays: `${product.processingDaysMin} to ${product.processingDaysMax}`,
              serviceFeePerApplicant: product.price,
              governmentFeeNote: product.governmentFeeNote,
            })),
            cards: [
              ...shown.flatMap((product): AgentCard[] =>
                card('visa', product.title, [product.destination], {
                  price: product.price,
                  href: `/visa/${product.slug}`,
                }),
              ),
              // A rule on file is guidance, never a guarantee: said whatever the model wrote.
              ...note('visa_guidance'),
            ],
          };
        },
      }),
    );

    this.registry.register(
      agentTool({
        name: 'addons.search',
        description:
          'List travel add-ons Suskii sells: travel insurance, airport transfers, eSIMs and lounge access, with the unit price and what it is charged per. Add-ons marked sample are demo inventory. When the traveller chooses one, hand its addonId, the dates and the travellers to addons.prepare_booking; never show an addonId to the traveller.',
        tier: 'read',
        scope: 'search',
        agents: ['tours', 'cars', 'trip_builder', 'flights', 'hotels'],
        input: z.object({
          type: z.enum(ADDON_PRODUCT_TYPES).optional(),
          countryCode: countryCodeSchema
            .optional()
            .meta({ description: 'Only add-ons that apply in this country.' }),
          limit,
        }),
        output: z.object({
          found: z.number().int(),
          addons: z.array(
            z.object({
              option: z.number().int(),
              /** Handed to addons.prepare_booking when the traveller chooses this add-on. */
              addonId: z.string(),
              title: z.string(),
              sample: z.boolean(),
              type: z.enum(ADDON_PRODUCT_TYPES),
              summary: z.string(),
              price: moneyOut,
              chargedPer: z.string(),
              mostTravellers: z.number().int(),
            }),
          ),
          cards: cardsOut,
        }),
        run: async (input, { grant }) => {
          const client = await this.callers.client(grant);
          const addons = await this.inhouse.listAddons(
            {
              currency: this.callers.currency(grant),
              type: input.type,
              countryCode: input.countryCode,
            },
            client,
          );
          const shown = addons.slice(0, input.limit);
          return {
            found: addons.length,
            addons: shown.map((item, index) => ({
              option: index + 1,
              addonId: item.id,
              title: item.title,
              sample: item.sample,
              type: item.type,
              summary: brief(item.summary),
              price: item.unitPrice,
              chargedPer: item.pricingBasis.replace(/^per_/, ''),
              mostTravellers: item.maxTravellers,
            })),
            cards: shown.flatMap((item): AgentCard[] =>
              card('link', item.title, [], {
                price: item.unitPrice,
                href: `/travel-add-ons?type=${item.type}`,
              }),
            ),
          };
        },
      }),
    );
  }
}
