import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { z } from 'zod';

import {
  add,
  haversineMetres,
  localToUtc,
  money,
  multiply,
  RENTAL_MAX_DAYS,
  rentalCharge,
  rentalDays,
  toWire,
  withinBounds,
  zero,
  type Money,
} from '@suskii/shared';

import { storedPolicy } from '../bookings/inhouse-catalog';
import type { RentalItemPayload, RideStop } from '../bookings/inhouse-items';
import { APP_CONFIG, type AppConfig } from '../config/config';
import type { RentalVehicle } from '../generated/prisma/client';
import { CarsFlags } from '../ground/cars-flags';
import { RoutingService } from '../ground/maps';
import { PrismaService } from '../infra/prisma.service';

import { rentalQuoteInvalid } from './rental-errors';
import {
  RENTAL_QUOTE_ISSUES,
  type availabilitySchema,
  type RentalSearchQuery,
  type rentalSearchResultSchema,
  type rentalVehicleSchema,
} from './rentals.schemas';

export interface RentalQuoteInput {
  vehicleId: string;
  pickupAtLocal: string;
  returnAtLocal: string;
  chauffeur: boolean;
  delivery: RideStop | null;
  currency: string;
}

interface Period {
  pickupAt: Date;
  returnAt: Date;
  days: number;
}

const rates = (vehicle: RentalVehicle) => ({
  daily: money(vehicle.dailyMinor, vehicle.currency),
  chauffeurDaily:
    vehicle.chauffeurDailyMinor === null
      ? null
      : money(vehicle.chauffeurDailyMinor, vehicle.currency),
  deposit: money(vehicle.depositMinor, vehicle.currency),
});

/**
 * The rental fleet as customers see it (ADR-051): published cars free for a period, a car's
 * blocked periods (no booking data), and the priced snapshot a quote stores. Availability here is
 * advisory; the exclusion constraint decides when the booking is written.
 */
@Injectable()
export class RentalsCatalogService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly routing: RoutingService,
    private readonly flags: CarsFlags,
  ) {}

  async search(
    query: RentalSearchQuery,
    now = new Date(),
  ): Promise<z.infer<typeof rentalSearchResultSchema>> {
    const vehicles = await this.prisma.rentalVehicle.findMany({
      where: {
        status: 'published',
        cityName: { equals: query.city, mode: 'insensitive' },
        ...(query.category ? { category: query.category } : {}),
        ...(query.chauffeur ? { chauffeurDailyMinor: { not: null } } : {}),
      },
      orderBy: [{ dailyMinor: 'asc' }, { id: 'asc' }],
      take: 100,
    });
    if (vehicles.length === 0) return { days: 0, vehicles: [] };
    // Every car in a city shares its branch's zone in practice; each is checked in its own.
    const results: z.infer<typeof rentalSearchResultSchema>['vehicles'] = [];
    let days = 0;
    for (const vehicle of vehicles) {
      const period = this.period(query.pickupAt, query.returnAt, vehicle.timeZone, now);
      days = period.days;
      if (await this.taken(vehicle.id, period)) continue;
      const charge = rentalCharge(
        rates(vehicle),
        period.pickupAt,
        period.returnAt,
        query.chauffeur,
      );
      if (!charge) continue;
      results.push({
        ...this.card(vehicle),
        estimate: {
          rental: toWire(add(charge.vehicle, charge.chauffeur)),
          deposit: toWire(charge.deposit),
        },
      });
    }
    return { days, vehicles: results };
  }

  async detail(slug: string): Promise<z.infer<typeof rentalVehicleSchema>> {
    const vehicle = await this.prisma.rentalVehicle.findUnique({ where: { slug } });
    if (vehicle?.status !== 'published') throw new NotFoundException();
    return {
      ...this.card(vehicle),
      cancellationPolicy: storedPolicy(vehicle.cancellationPolicy),
      timeZone: vehicle.timeZone,
    };
  }

  /** Periods other rentals block on a published car between two dates (branch time). */
  async availability(
    vehicleId: string,
    from: string,
    to: string,
  ): Promise<z.infer<typeof availabilitySchema>> {
    const vehicle = await this.prisma.rentalVehicle.findUnique({ where: { id: vehicleId } });
    if (vehicle?.status !== 'published') throw new NotFoundException();
    const start = localToUtc(`${from}T00:00`, vehicle.timeZone);
    const end = localToUtc(`${to}T23:59`, vehicle.timeZone);
    if (end <= start || end.getTime() - start.getTime() > 400 * 86_400_000) {
      throw rentalQuoteInvalid(RENTAL_QUOTE_ISSUES.periodInvalid);
    }
    const rows = await this.prisma.rentalReservation.findMany({
      where: { vehicleId, active: true, pickupAt: { lt: end }, blockedUntil: { gt: start } },
      select: { pickupAt: true, blockedUntil: true },
      orderBy: { pickupAt: 'asc' },
    });
    return {
      vehicleId,
      timeZone: vehicle.timeZone,
      blocked: rows.map((row) => ({
        from: row.pickupAt.toISOString(),
        until: row.blockedUntil.toISOString(),
      })),
    };
  }

  /** The priced snapshot of a rental selection; refuses what could not be booked. */
  async payload(input: RentalQuoteInput, now = new Date()): Promise<RentalItemPayload> {
    const vehicle = await this.prisma.rentalVehicle.findUnique({ where: { id: input.vehicleId } });
    if (vehicle?.status !== 'published') throw new NotFoundException();
    if (input.currency !== vehicle.currency) {
      // The deposit is refunded at face value, so it is never converted (ADR-051).
      throw rentalQuoteInvalid(RENTAL_QUOTE_ISSUES.currencyUnavailable);
    }
    const period = this.period(input.pickupAtLocal, input.returnAtLocal, vehicle.timeZone, now);
    const charge = rentalCharge(rates(vehicle), period.pickupAt, period.returnAt, input.chauffeur);
    if (!charge) throw rentalQuoteInvalid(RENTAL_QUOTE_ISSUES.chauffeurUnavailable);
    if (await this.taken(vehicle.id, period))
      throw rentalQuoteInvalid(RENTAL_QUOTE_ISSUES.notAvailable);

    let delivery: RentalItemPayload['delivery'] = null;
    let deliveryCharge: Money = zero(vehicle.currency);
    if (input.delivery) {
      if (vehicle.deliveryPerKmMinor === null || vehicle.deliveryMaxKm === null) {
        throw rentalQuoteInvalid(RENTAL_QUOTE_ISSUES.deliveryUnavailable);
      }
      const branch = { lat: vehicle.lat, lng: vehicle.lng };
      if (
        !withinBounds(input.delivery, this.flags.serviceArea) ||
        haversineMetres(branch, input.delivery) > vehicle.deliveryMaxKm * 1000
      ) {
        throw rentalQuoteInvalid(RENTAL_QUOTE_ISSUES.deliveryTooFar);
      }
      const route = await this.routing.route(branch, input.delivery);
      const km = Math.max(1, Math.ceil(route.distanceMetres / 1000));
      delivery = { ...input.delivery, km };
      deliveryCharge = multiply(money(vehicle.deliveryPerKmMinor, vehicle.currency), km);
    }

    const policy = storedPolicy(vehicle.cancellationPolicy);
    return {
      kind: 'rental',
      productId: vehicle.id,
      slug: vehicle.slug,
      title: `${vehicle.make} ${vehicle.model}${input.chauffeur ? ' with chauffeur' : ''}`,
      sample: vehicle.sample,
      artKey: vehicle.artKey,
      travellers: { adults: 1, children: 0, infants: 0 },
      vehicleId: vehicle.id,
      vehicle: {
        make: vehicle.make,
        model: vehicle.model,
        year: vehicle.year,
        category: vehicle.category,
        transmission: vehicle.transmission,
        seats: vehicle.seats,
        features: vehicle.features,
        photoUrls: vehicle.photoUrls,
      },
      branch: {
        name: vehicle.branchName,
        address: vehicle.branchAddress,
        lat: vehicle.lat,
        lng: vehicle.lng,
      },
      cityName: vehicle.cityName,
      countryCode: 'NG',
      timeZone: vehicle.timeZone,
      pickupAtLocal: input.pickupAtLocal,
      returnAtLocal: input.returnAtLocal,
      pickupAtUtc: period.pickupAt.toISOString(),
      returnAtUtc: period.returnAt.toISOString(),
      days: period.days,
      chauffeur: input.chauffeur,
      delivery,
      charge: {
        vehicle: charge.vehicle,
        chauffeur: charge.chauffeur,
        delivery: deliveryCharge,
        deposit: charge.deposit,
      },
      mileage: {
        kmPerDay: vehicle.mileageKmPerDay,
        excessKm:
          vehicle.excessKmMinor === null ? null : money(vehicle.excessKmMinor, vehicle.currency),
      },
      fuelPolicy: vehicle.fuelPolicy,
      insuranceSummary: vehicle.insuranceSummary,
      vatBps: this.config.CARS_VAT_BPS,
      cancellationPolicy: policy,
      request: {
        kind: 'rental',
        vehicleId: vehicle.id,
        pickupAtLocal: input.pickupAtLocal,
        returnAtLocal: input.returnAtLocal,
        chauffeur: input.chauffeur,
        delivery: input.delivery,
        currency: input.currency,
      },
    };
  }

  /** Validates a period in the branch's zone: lead time, horizon and the longest rental. */
  private period(pickupLocal: string, returnLocal: string, timeZone: string, now: Date): Period {
    let pickupAt: Date;
    let returnAt: Date;
    try {
      pickupAt = localToUtc(pickupLocal, timeZone);
      returnAt = localToUtc(returnLocal, timeZone);
    } catch {
      throw rentalQuoteInvalid(RENTAL_QUOTE_ISSUES.periodInvalid);
    }
    const earliest = now.getTime() + this.config.RENTAL_MIN_LEAD_HOURS * 3_600_000;
    const latest = now.getTime() + this.config.RENTAL_MAX_ADVANCE_DAYS * 86_400_000;
    if (returnAt <= pickupAt || pickupAt.getTime() < earliest || pickupAt.getTime() > latest) {
      throw rentalQuoteInvalid(RENTAL_QUOTE_ISSUES.periodInvalid);
    }
    const days = rentalDays(pickupAt, returnAt);
    if (days > RENTAL_MAX_DAYS) throw rentalQuoteInvalid(RENTAL_QUOTE_ISSUES.tooLong);
    return { pickupAt, returnAt, days };
  }

  /** Another active rental overlaps the period plus turnaround. */
  private async taken(vehicleId: string, period: Period): Promise<boolean> {
    const blockedUntil = new Date(
      period.returnAt.getTime() + this.config.RENTAL_TURNAROUND_HOURS * 3_600_000,
    );
    const clash = await this.prisma.rentalReservation.findFirst({
      where: {
        vehicleId,
        active: true,
        pickupAt: { lt: blockedUntil },
        blockedUntil: { gt: period.pickupAt },
      },
      select: { id: true },
    });
    return clash !== null;
  }

  private card(vehicle: RentalVehicle) {
    return {
      id: vehicle.id,
      slug: vehicle.slug,
      make: vehicle.make,
      model: vehicle.model,
      year: vehicle.year,
      category: vehicle.category,
      transmission: vehicle.transmission,
      seats: vehicle.seats,
      features: vehicle.features,
      photoUrls: vehicle.photoUrls,
      artKey: vehicle.artKey,
      sample: vehicle.sample,
      cityName: vehicle.cityName,
      branch: {
        name: vehicle.branchName,
        address: vehicle.branchAddress,
        lat: vehicle.lat,
        lng: vehicle.lng,
      },
      daily: toWire(money(vehicle.dailyMinor, vehicle.currency)),
      chauffeurDaily:
        vehicle.chauffeurDailyMinor === null
          ? null
          : toWire(money(vehicle.chauffeurDailyMinor, vehicle.currency)),
      deposit: toWire(money(vehicle.depositMinor, vehicle.currency)),
      delivery:
        vehicle.deliveryPerKmMinor !== null && vehicle.deliveryMaxKm !== null
          ? {
              perKm: toWire(money(vehicle.deliveryPerKmMinor, vehicle.currency)),
              maxKm: vehicle.deliveryMaxKm,
            }
          : null,
      mileage: {
        kmPerDay: vehicle.mileageKmPerDay,
        excessKm:
          vehicle.excessKmMinor === null
            ? null
            : toWire(money(vehicle.excessKmMinor, vehicle.currency)),
      },
      fuelPolicy: vehicle.fuelPolicy as 'full_to_full' | 'same_to_same',
      insuranceSummary: vehicle.insuranceSummary,
    };
  }
}
