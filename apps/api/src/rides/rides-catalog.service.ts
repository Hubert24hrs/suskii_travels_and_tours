import { Inject, Injectable } from '@nestjs/common';
import type { z } from 'zod';

import {
  haversineMetres,
  localDate,
  rideFare,
  withinBounds,
  type GeoPoint,
  type RideCategory,
  type RideFareRule,
} from '@suskii/shared';

import type { RideItemPayload, RideStop } from '../bookings/inhouse-items';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { CarsFlags } from '../ground/cars-flags';
import { RouteTooLongError, RoutingService } from '../ground/maps';
import type { RideFareRule as FareRuleRow } from '../generated/prisma/client';
import { PrismaService } from '../infra/prisma.service';

import { rideQuoteInvalid } from './ride-errors';
import { RIDE_QUOTE_ISSUES, type ridePlacesSchema } from './rides.schemas';

/** A ride must start and end within this distance of one of the city's curated places. */
const CITY_RADIUS_METRES = 60_000;
/** Pickup and drop-off closer than this are refused (walk instead). */
const MIN_TRIP_METRES = 300;
const RIDE_TIME_ZONE = 'Africa/Lagos';

export const toFareRule = (row: FareRuleRow): RideFareRule & { id: string } => ({
  id: row.id,
  currency: row.currency,
  baseMinor: row.baseMinor,
  perKmMinor: row.perKmMinor,
  perMinuteMinor: row.perMinuteMinor,
  bookingFeeMinor: row.bookingFeeMinor,
  minimumMinor: row.minimumMinor,
  cancellationFeeMinor: row.cancellationFeeMinor,
  freeCancelSeconds: row.freeCancelSeconds,
  waitGraceSeconds: row.waitGraceSeconds,
  driverShareBps: row.driverShareBps,
});

export interface RideQuoteInput {
  category: RideCategory;
  pickup: RideStop;
  dropoff: RideStop;
  scheduledFor: string | null;
  currency: string;
}

/**
 * Where rides run and what they cost (ADR-051, ADR-053): curated places per city, the city a
 * trip belongs to, and the upfront fare from the route and the city's fare rule. The quote keeps
 * the rule's terms so a later change never alters a booked ride.
 */
@Injectable()
export class RidesCatalogService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly routing: RoutingService,
    private readonly flags: CarsFlags,
  ) {}

  async places(city?: string): Promise<z.infer<typeof ridePlacesSchema>> {
    const rows = await this.prisma.ridePlace.findMany({
      where: { active: true, ...(city ? { cityName: { equals: city, mode: 'insensitive' } } : {}) },
      orderBy: [{ cityName: 'asc' }, { kind: 'asc' }, { name: 'asc' }],
    });
    return {
      places: rows.map((row) => ({
        id: row.id,
        name: row.name,
        kind: row.kind as 'airport' | 'terminal' | 'landmark',
        cityName: row.cityName,
        lat: row.lat,
        lng: row.lng,
        sample: row.sample,
      })),
    };
  }

  /** The quote snapshot, or 422 `quote-invalid` with the reason. */
  async payload(input: RideQuoteInput, now = new Date()): Promise<RideItemPayload> {
    const area = this.flags.serviceArea;
    if (!withinBounds(input.pickup, area) || !withinBounds(input.dropoff, area)) {
      throw rideQuoteInvalid(RIDE_QUOTE_ISSUES.outsideServiceArea);
    }
    if (haversineMetres(input.pickup, input.dropoff) < MIN_TRIP_METRES) {
      throw rideQuoteInvalid(RIDE_QUOTE_ISSUES.tooShort);
    }
    if (input.scheduledFor !== null) {
      const at = Date.parse(input.scheduledFor);
      const earliest = now.getTime() + this.config.RIDE_SCHEDULE_LEAD_MINUTES * 60_000;
      const latest = now.getTime() + this.config.RIDE_SCHEDULE_MAX_DAYS * 86_400_000;
      if (!Number.isFinite(at) || at < earliest || at > latest) {
        throw rideQuoteInvalid(RIDE_QUOTE_ISSUES.pickupTimeInvalid);
      }
    }
    const city = await this.cityOf(input.pickup, input.dropoff);
    if (!city) throw rideQuoteInvalid(RIDE_QUOTE_ISSUES.outsideServiceArea);
    const ruleRow = await this.prisma.rideFareRule.findUnique({
      where: { cityName_category: { cityName: city, category: input.category } },
    });
    if (!ruleRow?.active) throw rideQuoteInvalid(RIDE_QUOTE_ISSUES.categoryUnavailable);

    let route;
    try {
      route = await this.routing.route(input.pickup, input.dropoff);
    } catch (error) {
      if (error instanceof RouteTooLongError) throw rideQuoteInvalid(RIDE_QUOTE_ISSUES.tooLong);
      throw error;
    }
    const rule = toFareRule(ruleRow);
    const fare = rideFare(
      rule,
      route.distanceMetres,
      route.durationSeconds,
      ruleRow.surgeBps,
      this.config.RIDE_SURGE_CAP_BPS,
    );
    const when = input.scheduledFor ? new Date(input.scheduledFor) : now;
    return {
      kind: 'ride',
      productId: ruleRow.id,
      slug: `${city.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${input.category}`,
      title: `${input.pickup.label} to ${input.dropoff.label}`,
      sample: false,
      artKey: null,
      travellers: { adults: 1, children: 0, infants: 0 },
      category: input.category,
      cityName: city,
      countryCode: 'NG',
      timeZone: RIDE_TIME_ZONE,
      pickup: input.pickup,
      dropoff: input.dropoff,
      scheduledFor: input.scheduledFor ? when.toISOString() : null,
      startDate: localDate(when, RIDE_TIME_ZONE),
      distanceMetres: route.distanceMetres,
      durationSeconds: route.durationSeconds,
      polyline: route.polyline,
      estimate: route.estimate,
      fare,
      rule,
      vatBps: this.config.CARS_VAT_BPS,
      request: {
        kind: 'ride',
        category: input.category,
        pickup: input.pickup,
        dropoff: input.dropoff,
        scheduledFor: input.scheduledFor,
        currency: input.currency,
      },
    };
  }

  /** The city whose curated places both ends are near, or null outside every city. */
  private async cityOf(pickup: GeoPoint, dropoff: GeoPoint): Promise<string | null> {
    const places = await this.prisma.ridePlace.findMany({
      where: { active: true },
      select: { cityName: true, lat: true, lng: true },
    });
    const near = (point: GeoPoint) =>
      new Set(
        places
          .filter((place) => haversineMetres(point, place) <= CITY_RADIUS_METRES)
          .map((place) => place.cityName),
      );
    const from = near(pickup);
    const to = near(dropoff);
    return [...from].find((city) => to.has(city)) ?? null;
  }
}
