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
  moneyWireSchema,
  type CancellationTier,
  type Money,
  type PerPersonPrices,
} from '@suskii/shared';

import type {
  Addon,
  City,
  PackageDeparture,
  Tour,
  TourDeparture,
  TravelPackage,
  VisaProduct,
} from '../generated/prisma/client';
import { PrismaService } from '../infra/prisma.service';
import { OfferUnavailableError } from '../suppliers/supplier.errors';

import {
  addonUnitsFor,
  INHOUSE_SUPPLIER,
  type AddonItemPayload,
  type InhouseItemPayload,
  type InhouseQuoteRequest,
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
    }
  }
}

export type { PackageRow, TourRow };
