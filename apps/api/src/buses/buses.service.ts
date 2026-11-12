import { Inject, Injectable } from '@nestjs/common';
import type { z } from 'zod';

import {
  layoutSeats,
  money,
  toWire,
  zero,
  type BusSeatLayout,
  type BusSeatState,
  type Money,
} from '@suskii/shared';

import { storedPolicy } from '../bookings/inhouse-catalog';
import { INHOUSE_SUPPLIER, vatOn, type BusItemPayload } from '../bookings/inhouse-items';
import { APP_CONFIG, type AppConfig } from '../config/config';
import type { BusSeatHold, Prisma } from '../generated/prisma/client';
import { PrismaService } from '../infra/prisma.service';
import type { Pricer } from '../pricing/pricing.service';
import { PricingService } from '../pricing/pricing.service';
import type { ClientContext } from '../search/client-context';

import { BusHoldsService, SALES_CLOSE_MINUTES } from './bus-holds.service';
import type {
  busCitiesSchema,
  busTripCardSchema,
  busTripDetailSchema,
  BusSearchQuery,
} from './buses.schemas';

type TripCard = z.infer<typeof busTripCardSchema>;

const TRIP_INCLUDE = {
  layout: true,
  route: { include: { operator: true, origin: true, destination: true } },
} satisfies Prisma.BusTripInclude;

type TripRow = Prisma.BusTripGetPayload<{ include: typeof TRIP_INCLUDE }>;

const stop = (terminal: TripRow['route']['origin']) => ({
  terminalId: terminal.id,
  name: terminal.name,
  cityName: terminal.cityName,
  address: terminal.address,
});

/** Searching, seat maps and quote payloads for interstate buses (ADR-049, ADR-051). */
@Injectable()
export class BusesService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly holds: BusHoldsService,
  ) {}

  async cities(): Promise<z.infer<typeof busCitiesSchema>> {
    const terminals = await this.prisma.busTerminal.findMany({
      where: {
        active: true,
        OR: [
          { departures: { some: { active: true, operator: { status: 'published' } } } },
          { arrivals: { some: { active: true, operator: { status: 'published' } } } },
        ],
      },
      orderBy: [{ cityName: 'asc' }, { name: 'asc' }],
    });
    const cities = new Map<string, z.infer<typeof busCitiesSchema>['cities'][number]>();
    for (const terminal of terminals) {
      const city = cities.get(terminal.cityName) ?? {
        name: terminal.cityName,
        stateName: terminal.stateName,
        terminals: [],
      };
      city.terminals.push({ id: terminal.id, name: terminal.name, address: terminal.address });
      cities.set(terminal.cityName, city);
    }
    return { cities: [...cities.values()] };
  }

  async search(
    query: BusSearchQuery,
    client: ClientContext,
    now = new Date(),
  ): Promise<TripCard[]> {
    const trips = await this.prisma.busTrip.findMany({
      where: {
        status: 'scheduled',
        departsAtLocal: { startsWith: query.date },
        departsAt: { gt: new Date(now.getTime() + SALES_CLOSE_MINUTES * 60_000) },
        route: {
          active: true,
          operator: { status: 'published' },
          origin: { cityName: { equals: query.from, mode: 'insensitive' }, active: true },
          destination: { cityName: { equals: query.to, mode: 'insensitive' }, active: true },
        },
      },
      include: TRIP_INCLUDE,
      orderBy: { departsAt: 'asc' },
      take: 100,
    });
    if (trips.length === 0) return [];
    const ids = trips.map((trip) => trip.id);
    // Seats left from the database: sold seats plus live hold rows (written with each hold).
    const [sold, held] = await Promise.all([
      this.prisma.busSeatAssignment.groupBy({
        by: ['tripId'],
        where: { tripId: { in: ids }, active: true },
        _count: { _all: true },
      }),
      this.prisma.busSeatHold.findMany({
        where: {
          tripId: { in: ids },
          expiresAt: { gt: now },
          releasedAt: null,
          bookingItemId: null,
        },
        select: { tripId: true, seats: true },
      }),
    ]);
    const soldBy = new Map(sold.map((row) => [row.tripId, row._count._all]));
    const heldBy = new Map<string, number>();
    for (const hold of held)
      heldBy.set(hold.tripId, (heldBy.get(hold.tripId) ?? 0) + hold.seats.length);
    const pricer = await this.pricing.pricer('buses', query.currency);
    return trips
      .map((trip) => {
        const left =
          trip.layout.seatCount -
          trip.blockedSeats.length -
          (soldBy.get(trip.id) ?? 0) -
          (heldBy.get(trip.id) ?? 0);
        return this.card(trip, Math.max(0, left), pricer, client, now);
      })
      .filter((card) => card.seatsLeft >= query.seats);
  }

  async detail(
    tripId: string,
    currency: string,
    client: ClientContext,
    now = new Date(),
  ): Promise<z.infer<typeof busTripDetailSchema>> {
    const trip = await this.holds.sellableTrip(tripId, now);
    const layout = trip.layout.layout as unknown as BusSeatLayout;
    const seats = layoutSeats(layout);
    const [sold, held] = await Promise.all([
      this.prisma.busSeatAssignment.findMany({
        where: { tripId, active: true },
        select: { seatNumber: true },
      }),
      this.holds.heldSeats(tripId, seats),
    ]);
    const soldSeats = new Set(sold.map((row) => row.seatNumber));
    const state = (seat: string): BusSeatState =>
      trip.blockedSeats.includes(seat)
        ? 'blocked'
        : soldSeats.has(seat)
          ? 'sold'
          : held.has(seat)
            ? 'held'
            : 'available';
    const available = seats.filter((seat) => state(seat) === 'available').length;
    const pricer = await this.pricing.pricer('buses', currency);
    return {
      ...this.card(trip, available, pricer, client, now),
      status: trip.status,
      seatMap: {
        rows: layout.rows.map((row) =>
          row.map((cell) => (cell === null ? null : { seatNumber: cell, state: state(cell) })),
        ),
      },
      cancellationPolicy: storedPolicy(trip.route.operator.cancellationPolicy),
    };
  }

  /** The quote snapshot for a live hold (ADR-049): trip, seats, fare and policy. */
  async payload(hold: BusSeatHold, now = new Date()): Promise<BusItemPayload> {
    const trip = await this.holds.sellableTrip(hold.tripId, now);
    const { route } = trip;
    return {
      kind: 'bus',
      productId: trip.id,
      slug: route.operator.slug,
      title: `${route.origin.cityName} to ${route.destination.cityName}`,
      sample: trip.sample || route.operator.sample,
      artKey: null,
      travellers: { adults: hold.seats.length, children: 0, infants: 0 },
      tripId: trip.id,
      holdId: hold.id,
      holdExpiresAt: hold.expiresAt.toISOString(),
      operatorName: route.operator.name,
      origin: stop(route.origin),
      destination: stop(route.destination),
      cityName: route.destination.cityName,
      countryCode: route.destination.countryCode,
      timeZone: route.origin.timeZone,
      departsAtLocal: trip.departsAtLocal,
      departsAtUtc: trip.departsAt.toISOString(),
      arrivesAtUtc: trip.arrivesAt.toISOString(),
      seats: [...hold.seats].sort((a, b) => a.localeCompare(b, 'en', { numeric: true })),
      amenities: trip.layout.amenities,
      unitPrice: money(trip.fareMinor, trip.currency),
      vatBps: this.config.CARS_VAT_BPS,
      cancellationPolicy: storedPolicy(route.operator.cancellationPolicy),
      request: { kind: 'bus', tripId: trip.id, holdId: hold.id },
    };
  }

  private card(
    trip: TripRow,
    seatsLeft: number,
    pricer: Pricer,
    client: ClientContext,
    now: Date,
  ): TripCard {
    const { route } = trip;
    const fare = money(trip.fareMinor, trip.currency);
    return {
      id: trip.id,
      operator: { id: route.operator.id, name: route.operator.name, slug: route.operator.slug },
      sample: trip.sample || route.operator.sample,
      origin: stop(route.origin),
      destination: stop(route.destination),
      timeZone: route.origin.timeZone,
      departsAtLocal: trip.departsAtLocal,
      departsAt: trip.departsAt.toISOString(),
      arrivesAt: trip.arrivesAt.toISOString(),
      durationMinutes: Math.round((trip.arrivesAt.getTime() - trip.departsAt.getTime()) / 60_000),
      coach: trip.layout.name,
      amenities: trip.layout.amenities,
      seatsLeft,
      pricePerSeat: toWire(
        this.seatPrice(pricer, fare, route.destination.countryCode, client, now),
      ),
    };
  }

  /** One seat through the pricing engine, VAT included, like the quote prices each seat. */
  private seatPrice(
    pricer: Pricer,
    fare: Money,
    country: string,
    client: ClientContext,
    now: Date,
  ): Money {
    return pricer(
      { base: fare, taxes: vatOn(fare, this.config.CARS_VAT_BPS) ?? zero(fare.currency) },
      {
        vertical: 'buses',
        supplier: INHOUSE_SUPPLIER,
        channel: client.channel,
        userTier: client.userTier,
        benefits: client.benefits,
        destinationCountry: country,
        passengers: 1,
        now,
      },
    ).breakdown.total;
  }
}
