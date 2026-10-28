import { Injectable } from '@nestjs/common';

import {
  cancellationPolicySchema,
  fromWire,
  itinerarySchema,
  meetingPointSchema,
  perPersonPricesSchema,
  textListSchema,
  localDate,
  addonDetailFieldsSchema,
  money,
  multiply,
  rentalCharge,
  moneyWireSchema,
  primePriceSchema,
  primeTermEnd,
  resolvePlanPrice,
  type CancellationTier,
  type PrimePrice,
  type Money,
  type PerPersonPrices,
} from '@suskii/shared';

import type {
  Addon,
  City,
  PackageDeparture,
  PrimePlan,
  Tour,
  TourDeparture,
  TravelPackage,
  VisaProduct,
} from '../generated/prisma/client';
import { SALES_CLOSE_MINUTES } from '../buses/bus-holds.service';
import { PrismaService } from '../infra/prisma.service';
import { storedBenefits } from '../prime/prime-status';
import { OfferUnavailableError } from '../suppliers/supplier.errors';

import {
  addonUnitsFor,
  INHOUSE_SUPPLIER,
  MEMBERSHIP_TRAVELLERS,
  type AddonItemPayload,
  type InhouseItemPayload,
  type InhouseQuoteRequest,
  type MembershipItemPayload,
  type PackageItemPayload,
  type TourItemPayload,
  type VisaItemPayload,
} from './inhouse-items';

/** Parsed stored JSON (validated on write by the admin routes; parsing again keeps reads honest). */
export const storedPrices = (value: unknown): PerPersonPrices => {
  const prices = perPersonPricesSchema.parse(value);
  return {
    adult: fromWire(prices.adult),
    child: prices.child ? fromWire(prices.child) : null,
    infant: prices.infant ? fromWire(prices.infant) : null,
  };
};
export const storedMoney = (value: unknown): Money => fromWire(moneyWireSchema.parse(value));
export const storedPolicy = (value: unknown): CancellationTier[] =>
  cancellationPolicySchema.parse(value);
export const storedTexts = (value: unknown): string[] => textListSchema.parse(value);
export const storedItinerary = (value: unknown) => itinerarySchema.parse(value);
export const storedMeetingPoint = (value: unknown) => meetingPointSchema.parse(value);
export const storedDetails = (value: unknown) => addonDetailFieldsSchema.parse(value);
/** A plan's price entries; entries saved before ADR-082 have no country. */
export const storedPlanPrices = (value: unknown): PrimePrice[] =>
  primePriceSchema.array().parse(value);

/**
 * A plan's price for a currency in a country (ADR-082), with the country of the entry that
 * applied (null: the currency's price for everywhere); null when it is not sold there.
 */
export function planPrice(
  plan: Pick<PrimePlan, 'prices'>,
  currency: string,
  country: string | null,
): { price: Money; country: string | null } | null {
  const entry = resolvePlanPrice(storedPlanPrices(plan.prices), currency, country);
  return entry ? { price: money(entry.amountMinor, entry.currency), country: entry.country } : null;
}

const isoDate = (date: Date): string => date.toISOString().slice(0, 10);

const unavailable = (reason: string): OfferUnavailableError =>
  new OfferUnavailableError(INHOUSE_SUPPLIER, reason);

type PackageRow = PackageDeparture & { package: TravelPackage & { city: City } };
type TourRow = TourDeparture & { tour: Tour & { city: City } };

/**
 * Reads in-house products for quotes and for the price re-check before payment (ADR-025). Only
 * published products with open, future departures can be sold; anything else is "unavailable",
 * which the booking flow answers like a sold-out supplier offer (410).
 */
@Injectable()
export class InhouseCatalog {
  constructor(private readonly prisma: PrismaService) {}

  async packageDeparture(departureId: string, now = new Date()): Promise<PackageRow> {
    const row = await this.prisma.packageDeparture.findUnique({
      where: { id: departureId },
      include: { package: { include: { city: true } } },
    });
    if (row?.package.status !== 'published' || row.status !== 'open')
      throw unavailable('Package departure is not on sale');
    // Departures are sold until the day before they start (in UTC; packages are date-only).
    if (isoDate(row.startDate) <= isoDate(now)) throw unavailable('Package departure has started');
    return row;
  }

  async tourDeparture(departureId: string, now = new Date()): Promise<TourRow> {
    const row = await this.prisma.tourDeparture.findUnique({
      where: { id: departureId },
      include: { tour: { include: { city: true } } },
    });
    if (row?.tour.status !== 'published' || row.status !== 'open')
      throw unavailable('Tour departure is not on sale');
    if (row.startsAtUtc <= now) throw unavailable('Tour departure has started');
    return row;
  }

  async visaProduct(productId: string): Promise<VisaProduct> {
    const row = await this.prisma.visaProduct.findUnique({ where: { id: productId } });
    if (row?.status !== 'published') throw unavailable('Visa product is not on sale');
    return row;
  }

  async addon(addonId: string): Promise<Addon> {
    const row = await this.prisma.addon.findUnique({ where: { id: addonId } });
    if (row?.status !== 'published') throw unavailable('Add-on is not on sale');
    return row;
  }

  /**
   * A published Prime plan sold in `currency`, with its price for `country` (ADR-030, ADR-082)
   * and the country of the entry that applied.
   */
  async primePlan(
    planId: string,
    currency: string,
    country: string | null,
  ): Promise<{ plan: PrimePlan; price: Money; priceCountry: string | null }> {
    const plan = await this.prisma.primePlan.findUnique({ where: { id: planId } });
    if (plan?.status !== 'published') throw unavailable('Prime plan is not on sale');
    const resolved = planPrice(plan, currency, country);
    if (!resolved) throw unavailable('Prime plan is not sold in this currency');
    return { plan, price: resolved.price, priceCountry: resolved.country };
  }

  // -------------------------------------------------------------------------
  // Snapshots
  // -------------------------------------------------------------------------

  packagePayload(
    row: PackageRow,
    request: Extract<InhouseQuoteRequest, { kind: 'package' }>,
  ): PackageItemPayload {
    const pkg = row.package;
    return {
      kind: 'package',
      productId: pkg.id,
      slug: pkg.slug,
      title: pkg.title,
      sample: pkg.sample,
      artKey: pkg.artKey,
      travellers: request.travellers,
      departureId: row.id,
      cityName: pkg.city.name,
      countryCode: pkg.countryCode,
      timeZone: pkg.city.timezone ?? 'UTC',
      nights: pkg.nights,
      startDate: isoDate(row.startDate),
      endDate: isoDate(row.endDate),
      passportRequired: pkg.passportRequired,
      inclusions: storedTexts(pkg.inclusions),
      prices: storedPrices(row.prices),
      cancellationPolicy: storedPolicy(pkg.cancellationPolicy),
      request,
    };
  }

  tourPayload(
    row: TourRow,
    request: Extract<InhouseQuoteRequest, { kind: 'tour' }>,
  ): TourItemPayload {
    const tour = row.tour;
    return {
      kind: 'tour',
      productId: tour.id,
      slug: tour.slug,
      title: tour.title,
      sample: tour.sample,
      artKey: tour.artKey,
      travellers: request.travellers,
      departureId: row.id,
      cityName: tour.city.name,
      countryCode: tour.countryCode,
      timeZone: tour.timeZone,
      startsAtLocal: row.startsAtLocal,
      startsAtUtc: row.startsAtUtc.toISOString(),
      durationMinutes: tour.durationMinutes,
      meetingPoint: storedMeetingPoint(tour.meetingPoint),
      inclusions: storedTexts(tour.inclusions),
      prices: storedPrices(row.prices),
      cancellationPolicy: storedPolicy(tour.cancellationPolicy),
      request,
    };
  }

  visaPayload(
    product: VisaProduct,
    request: Extract<InhouseQuoteRequest, { kind: 'visa' }>,
  ): VisaItemPayload {
    return {
      kind: 'visa',
      productId: product.id,
      slug: product.slug,
      title: product.title,
      sample: product.sample,
      artKey: null,
      travellers: request.travellers,
      destination: product.destination,
      purpose: request.purpose,
      nationality: request.nationality,
      travelDate: request.travelDate,
      processingDaysMin: product.processingDaysMin,
      processingDaysMax: product.processingDaysMax,
      governmentFeeNote: product.governmentFeeNote,
      unitPrice: storedMoney(product.price),
      request,
    };
  }

  addonPayload(
    addon: Addon,
    request: Extract<InhouseQuoteRequest, { kind: 'addon' }>,
    trip: {
      countryCode: string | null;
      cityName: string | null;
      timeZone: string | null;
      linkedBookingId: string | null;
      linkedReference: string | null;
    },
  ): AddonItemPayload {
    return {
      kind: 'addon',
      productId: addon.id,
      slug: addon.slug,
      title: addon.title,
      sample: addon.sample,
      artKey: null,
      travellers: request.travellers,
      type: addon.type,
      pricingBasis: addon.pricingBasis,
      unitPrice: storedMoney(addon.price),
      units: addonUnitsFor(
        addon.pricingBasis,
        request.travellers,
        request.startDate,
        request.endDate,
      ),
      startDate: request.startDate,
      endDate: request.endDate,
      countryCode: trip.countryCode,
      cityName: trip.cityName,
      timeZone: trip.timeZone ?? 'UTC',
      linkedBookingId: trip.linkedBookingId,
      linkedReference: trip.linkedReference,
      requiredDetails: storedDetails(addon.requiredDetails),
      cancellationPolicy: storedPolicy(addon.cancellationPolicy),
      request,
    };
  }

  membershipPayload(
    plan: PrimePlan,
    price: Money,
    priceCountry: string | null,
    now = new Date(),
  ): MembershipItemPayload {
    const startDate = isoDate(now);
    return {
      kind: 'membership',
      productId: plan.id,
      slug: plan.slug,
      title: plan.name,
      sample: plan.sample,
      artKey: null,
      travellers: MEMBERSHIP_TRAVELLERS,
      summary: plan.summary,
      period: plan.period,
      unitPrice: price,
      priceCountry,
      benefits: storedBenefits(plan.benefits),
      startDate,
      endDate: isoDate(primeTermEnd(now, plan.period)),
      request: { kind: 'membership', planSlug: plan.slug, currency: price.currency },
    };
  }

  /**
   * The item at today's catalog price (the re-check before payment). Everything the traveller
   * chose, and booking-specific fields such as encrypted add-on details, stay as they were.
   */
  async reprice(payload: InhouseItemPayload, now = new Date()): Promise<InhouseItemPayload> {
    switch (payload.kind) {
      case 'package': {
        const row = await this.packageDeparture(payload.departureId, now);
        return { ...payload, prices: storedPrices(row.prices) };
      }
      case 'tour': {
        const row = await this.tourDeparture(payload.departureId, now);
        return { ...payload, prices: storedPrices(row.prices) };
      }
      case 'visa': {
        const product = await this.visaProduct(payload.productId);
        if (payload.travelDate < localDate(now, 'UTC')) throw unavailable('Travel date has passed');
        return { ...payload, unitPrice: storedMoney(product.price) };
      }
      case 'addon': {
        const addon = await this.addon(payload.productId);
        if (payload.startDate < localDate(now, 'UTC')) throw unavailable('Start date has passed');
        return { ...payload, unitPrice: storedMoney(addon.price) };
      }
      case 'membership': {
        // Price and benefits as the plan stands now, for the country the quote was priced for
        // (ADR-082); the term is fixed at confirmation.
        const { plan, price, priceCountry } = await this.primePlan(
          payload.productId,
          payload.unitPrice.currency,
          payload.priceCountry ?? null,
        );
        return {
          ...payload,
          unitPrice: price,
          priceCountry,
          benefits: storedBenefits(plan.benefits),
        };
      }
      case 'bus': {
        // The seats are already the booking's (ADR-051); only the trip and its fare can change.
        const trip = await this.prisma.busTrip.findUnique({ where: { id: payload.tripId } });
        // Sales close before departure, as for searches and holds.
        if (
          trip?.status !== 'scheduled' ||
          trip.departsAt.getTime() <= now.getTime() + SALES_CLOSE_MINUTES * 60_000
        ) {
          throw unavailable('The departure is no longer on sale');
        }
        return { ...payload, unitPrice: money(trip.fareMinor, trip.currency) };
      }
      case 'ride': {
        // The upfront fare stands for the quote's life (ADR-051); only a withdrawn fare stops it.
        const rule = await this.prisma.rideFareRule.findUnique({ where: { id: payload.rule.id } });
        if (!rule?.active) throw unavailable('Rides are not available here right now');
        if (payload.scheduledFor && Date.parse(payload.scheduledFor) <= now.getTime()) {
          throw unavailable('The pickup time has passed');
        }
        return payload;
      }
      case 'rental': {
        // The car is already the booking's (reservation row); today's rates apply to the period.
        const vehicle = await this.prisma.rentalVehicle.findUnique({
          where: { id: payload.vehicleId },
        });
        if (vehicle?.status !== 'published') throw unavailable('This car is no longer offered');
        if (Date.parse(payload.pickupAtUtc) <= now.getTime()) {
          throw unavailable('The pickup time has passed');
        }
        const charge = rentalCharge(
          {
            daily: money(vehicle.dailyMinor, vehicle.currency),
            chauffeurDaily:
              vehicle.chauffeurDailyMinor === null
                ? null
                : money(vehicle.chauffeurDailyMinor, vehicle.currency),
            deposit: money(vehicle.depositMinor, vehicle.currency),
          },
          new Date(payload.pickupAtUtc),
          new Date(payload.returnAtUtc),
          payload.chauffeur,
        );
        if (!charge) throw unavailable('A chauffeur is no longer offered with this car');
        const delivery =
          payload.delivery && vehicle.deliveryPerKmMinor !== null
            ? multiply(money(vehicle.deliveryPerKmMinor, vehicle.currency), payload.delivery.km)
            : payload.charge.delivery;
        if (payload.delivery && vehicle.deliveryPerKmMinor === null) {
          throw unavailable('Delivery is no longer offered with this car');
        }
        return {
          ...payload,
          charge: {
            vehicle: charge.vehicle,
            chauffeur: charge.chauffeur,
            delivery,
            deposit: charge.deposit,
          },
        };
      }
    }
  }
}

export type { PackageRow, TourRow };
