import { Injectable, NotFoundException } from '@nestjs/common';
import type { z } from 'zod';

import {
  addDays,
  localDate,
  perPersonTotal,
  seatsFor,
  toWire,
  zero,
  type Money,
  type PerPersonPrices,
  type TravellerCounts,
} from '@suskii/shared';

import {
  storedDetails,
  storedItinerary,
  storedMeetingPoint,
  storedMoney,
  storedPolicy,
  storedPrices,
  storedTexts,
} from '../bookings/inhouse-catalog';
import { INHOUSE_SUPPLIER } from '../bookings/inhouse-items';
import type { Prisma, Vertical } from '../generated/prisma/client';
import { PrismaService } from '../infra/prisma.service';
import type { Pricer } from '../pricing/pricing.service';
import { PricingService } from '../pricing/pricing.service';
import type { ClientContext } from '../search/client-context';

import type {
  addonCardSchema,
  addonListQuerySchema,
  packageCardSchema,
  packageDetailSchema,
  PackageListQuery,
  perPersonPriceSchema,
  tourCardSchema,
  tourDetailSchema,
  TourListQuery,
} from './inhouse.schemas';

type PackageCard = z.infer<typeof packageCardSchema>;
type PackageDetail = z.infer<typeof packageDetailSchema>;
type TourCard = z.infer<typeof tourCardSchema>;
type TourDetail = z.infer<typeof tourDetailSchema>;
type AddonCard = z.infer<typeof addonCardSchema>;
type PerPersonPriceDto = z.infer<typeof perPersonPriceSchema>;

const MAX_SCAN = 200;

interface Seats {
  capacity: number;
  seatsReserved: number;
  seatsSold: number;
}

const seatsLeft = (departure: Seats): number =>
  Math.max(0, departure.capacity - departure.seatsReserved - departure.seatsSold);

const isoDate = (date: Date): string => date.toISOString().slice(0, 10);

/** Whether this group fits and may book (children or infants can be barred per departure). */
function bookable(prices: PerPersonPrices, departure: Seats, travellers: TravellerCounts): boolean {
  return (
    seatsLeft(departure) >= seatsFor(travellers) && 'total' in perPersonTotal(prices, travellers)
  );
}

function travellersOf(query: {
  adults: number;
  children: number;
  infants: number;
}): TravellerCounts {
  return { adults: query.adults, children: query.children, infants: query.infants };
}

/**
 * Public reads of the in-house catalog (ADR-025): only published products with open, future
 * departures. Prices go through the pricing engine for the caller, like supplier fares, so the
 * stored base price never leaves the API.
 */
@Injectable()
export class InhouseCatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
  ) {}

  /** One person's price for the traveller (markup, fees, FX), per traveller type. */
  private personPrice(
    pricer: Pricer,
    vertical: Vertical,
    base: Money,
    client: ClientContext,
    destinationCountry: string | null,
    now: Date,
  ): Money {
    return pricer(
      { base, taxes: zero(base.currency) },
      {
        vertical,
        supplier: INHOUSE_SUPPLIER,
        channel: client.channel,
        userTier: client.userTier,
        destinationCountry,
        passengers: 1,
        now,
      },
    ).breakdown.total;
  }

  private perPerson(
    pricer: Pricer,
    vertical: Vertical,
    prices: PerPersonPrices,
    client: ClientContext,
    country: string,
    now: Date,
  ): PerPersonPriceDto {
    const price = (base: Money | null) =>
      base ? toWire(this.personPrice(pricer, vertical, base, client, country, now)) : null;
    return {
      adult: toWire(this.personPrice(pricer, vertical, prices.adult, client, country, now)),
      child: price(prices.child),
      infant: price(prices.infant),
    };
  }

  // -------------------------------------------------------------------------
  // Packages
  // -------------------------------------------------------------------------

  async listPackages(query: PackageListQuery, client: ClientContext): Promise<PackageCard[]> {
    const now = new Date();
    const today = localDate(now, 'UTC');
    let from = query.from;
    let to = query.to;
    if (query.month) {
      from = `${query.month}-01`;
      // The day before the first of the next month (the 1st plus 31 days is always next month).
      to = addDays(`${addDays(from, 31).slice(0, 7)}-01`, -1);
    }
    const departureWhere: Prisma.PackageDepartureWhereInput = {
      status: 'open',
      startDate: {
        gt: new Date(`${today}T00:00:00.000Z`),
        ...(from ? { gte: new Date(`${from}T00:00:00.000Z`) } : {}),
        ...(to ? { lte: new Date(`${to}T00:00:00.000Z`) } : {}),
      },
    };
    const rows = await this.prisma.travelPackage.findMany({
      where: {
        status: 'published',
        ...(query.cityId ? { cityId: query.cityId } : {}),
        ...(query.countryCode ? { countryCode: query.countryCode } : {}),
        ...(query.featured !== undefined ? { featured: query.featured } : {}),
        departures: { some: departureWhere },
      },
      include: {
        city: true,
        departures: { where: departureWhere, orderBy: { startDate: 'asc' } },
      },
      orderBy: [{ featured: 'desc' }, { updatedAt: 'desc' }],
      take: MAX_SCAN,
    });
    const pricer = await this.pricing.pricer('packages', query.currency);
    const travellers = travellersOf(query);
    const cards: PackageCard[] = [];
    for (const row of rows) {
      const open = row.departures
        .map((departure) => ({ departure, prices: storedPrices(departure.prices) }))
        .filter(({ departure, prices }) => bookable(prices, departure, travellers));
      const first = open[0];
      if (!first) continue;
      const adultPrices = open.map(({ prices }) =>
        this.personPrice(pricer, 'packages', prices.adult, client, row.countryCode, now),
      );
      const fromPrice = adultPrices.reduce((min, price) => (price.minor < min.minor ? price : min));
      if (query.budgetMin !== undefined && fromPrice.minor < BigInt(query.budgetMin)) continue;
      if (query.budgetMax !== undefined && fromPrice.minor > BigInt(query.budgetMax)) continue;
      cards.push({
        id: row.id,
        slug: row.slug,
        title: row.title,
        summary: row.summary,
        artKey: row.artKey,
        sample: row.sample,
        featured: row.featured,
        cityName: row.city.name,
        countryCode: row.countryCode,
        nights: row.nights,
        fromPrice: toWire(fromPrice),
        nextDeparture: isoDate(first.departure.startDate),
        departures: open.length,
      });
      if (cards.length >= query.limit) break;
    }
    return cards;
  }

  async packageDetail(
    slug: string,
    query: { currency: string; adults: number; children: number; infants: number },
    client: ClientContext,
  ): Promise<PackageDetail> {
    const now = new Date();
    const row = await this.prisma.travelPackage.findUnique({
      where: { slug },
      include: {
        city: true,
        departures: {
          where: {
            status: 'open',
            startDate: { gt: new Date(`${localDate(now, 'UTC')}T00:00:00.000Z`) },
          },
          orderBy: { startDate: 'asc' },
          take: 60,
        },
      },
    });
    if (row?.status !== 'published') throw new NotFoundException();
    const pricer = await this.pricing.pricer('packages', query.currency);
    const travellers = travellersOf(query);
    return {
      id: row.id,
      slug: row.slug,
      title: row.title,
      summary: row.summary,
      artKey: row.artKey,
      sample: row.sample,
      featured: row.featured,
      cityId: row.cityId,
      cityName: row.city.name,
      countryCode: row.countryCode,
      nights: row.nights,
      passportRequired: row.passportRequired,
      highlights: storedTexts(row.highlights),
      itinerary: storedItinerary(row.itinerary),
      inclusions: storedTexts(row.inclusions),
      exclusions: storedTexts(row.exclusions),
      cancellationPolicy: storedPolicy(row.cancellationPolicy),
      departures: row.departures.map((departure) => {
        const prices = storedPrices(departure.prices);
        return {
          id: departure.id,
          startDate: isoDate(departure.startDate),
          endDate: isoDate(departure.endDate),
          seatsLeft: seatsLeft(departure),
          prices: this.perPerson(pricer, 'packages', prices, client, row.countryCode, now),
          bookable: bookable(prices, departure, travellers),
        };
      }),
    };
  }

  // -------------------------------------------------------------------------
  // Tours
  // -------------------------------------------------------------------------

  async listTours(query: TourListQuery, client: ClientContext): Promise<TourCard[]> {
    const now = new Date();
    const departureWhere: Prisma.TourDepartureWhereInput = {
      status: 'open',
      startsAtUtc: { gt: now },
      ...(query.date ? { startsAtLocal: { startsWith: query.date } } : {}),
    };
    const rows = await this.prisma.tour.findMany({
      where: {
        status: 'published',
        ...(query.cityId ? { cityId: query.cityId } : {}),
        ...(query.q
          ? {
              OR: [
                { title: { contains: query.q, mode: 'insensitive' } },
                { city: { name: { contains: query.q, mode: 'insensitive' } } },
                { city: { country: { name: { contains: query.q, mode: 'insensitive' } } } },
              ],
            }
          : {}),
        departures: { some: departureWhere },
      },
      include: {
        city: true,
        departures: { where: departureWhere, orderBy: { startsAtUtc: 'asc' } },
      },
      orderBy: [{ featured: 'desc' }, { updatedAt: 'desc' }],
      take: MAX_SCAN,
    });
    const pricer = await this.pricing.pricer('tours', query.currency);
    const travellers = travellersOf(query);
    const cards: TourCard[] = [];
    for (const row of rows) {
      const open = row.departures
        .map((departure) => ({ departure, prices: storedPrices(departure.prices) }))
        .filter(({ departure, prices }) => bookable(prices, departure, travellers));
      const first = open[0];
      if (!first) continue;
      const fromPrice = open
        .map(({ prices }) =>
          this.personPrice(pricer, 'tours', prices.adult, client, row.countryCode, now),
        )
        .reduce((min, price) => (price.minor < min.minor ? price : min));
      cards.push({
        id: row.id,
        slug: row.slug,
        title: row.title,
        summary: row.summary,
        artKey: row.artKey,
        sample: row.sample,
        featured: row.featured,
        cityName: row.city.name,
        countryCode: row.countryCode,
        durationMinutes: row.durationMinutes,
        category: row.category,
        fromPrice: toWire(fromPrice),
        nextDeparture: first.departure.startsAtLocal,
        departures: open.length,
      });
      if (cards.length >= query.limit) break;
    }
    return cards;
  }

  async tourDetail(
    slug: string,
    query: { currency: string; adults: number; children: number; infants: number },
    client: ClientContext,
  ): Promise<TourDetail> {
    const now = new Date();
    const row = await this.prisma.tour.findUnique({
      where: { slug },
      include: {
        city: true,
        departures: {
          where: { status: 'open', startsAtUtc: { gt: now } },
          orderBy: { startsAtUtc: 'asc' },
          take: 90,
        },
      },
    });
    if (row?.status !== 'published') throw new NotFoundException();
    const pricer = await this.pricing.pricer('tours', query.currency);
    const travellers = travellersOf(query);
    return {
      id: row.id,
      slug: row.slug,
      title: row.title,
      summary: row.summary,
      artKey: row.artKey,
      sample: row.sample,
      featured: row.featured,
      cityId: row.cityId,
      cityName: row.city.name,
      countryCode: row.countryCode,
      timeZone: row.timeZone,
      durationMinutes: row.durationMinutes,
      category: row.category,
      meetingPoint: storedMeetingPoint(row.meetingPoint),
      highlights: storedTexts(row.highlights),
      inclusions: storedTexts(row.inclusions),
      exclusions: storedTexts(row.exclusions),
      cancellationPolicy: storedPolicy(row.cancellationPolicy),
      departures: row.departures.map((departure) => {
        const prices = storedPrices(departure.prices);
        return {
          id: departure.id,
          startsAtLocal: departure.startsAtLocal,
          startsAt: departure.startsAtUtc.toISOString(),
          seatsLeft: seatsLeft(departure),
          prices: this.perPerson(pricer, 'tours', prices, client, row.countryCode, now),
          bookable: bookable(prices, departure, travellers),
        };
      }),
    };
  }

  // -------------------------------------------------------------------------
  // Add-ons
  // -------------------------------------------------------------------------

  async listAddons(
    query: z.output<typeof addonListQuerySchema>,
    client: ClientContext,
  ): Promise<AddonCard[]> {
    let country = query.countryCode ?? null;
    if (!country && query.cityId) {
      const city = await this.prisma.city.findUnique({
        where: { id: query.cityId },
        select: { countryCode: true },
      });
      country = city?.countryCode ?? null;
    }
    const rows = await this.prisma.addon.findMany({
      where: {
        status: 'published',
        ...(query.type ? { type: query.type } : {}),
        ...(country
          ? { OR: [{ countryCodes: { has: country } }, { countryCodes: { isEmpty: true } }] }
          : {}),
      },
      orderBy: [{ type: 'asc' }, { priceMinor: 'asc' }],
      take: MAX_SCAN,
    });
    const pricer = await this.pricing.pricer('travel_addons', query.currency);
    const now = new Date();
    return rows.map((row) => this.addonCard(row, pricer, client, country, now));
  }

  async addonDetail(slug: string, currency: string, client: ClientContext): Promise<AddonCard> {
    const row = await this.prisma.addon.findUnique({ where: { slug } });
    if (row?.status !== 'published') throw new NotFoundException();
    const pricer = await this.pricing.pricer('travel_addons', currency);
    return this.addonCard(row, pricer, client, null, new Date());
  }

  private addonCard(
    row: Prisma.AddonGetPayload<object>,
    pricer: Pricer,
    client: ClientContext,
    country: string | null,
    now: Date,
  ): AddonCard {
    return {
      id: row.id,
      slug: row.slug,
      title: row.title,
      summary: row.summary,
      artKey: null,
      sample: row.sample,
      type: row.type,
      description: row.description,
      countryCodes: row.countryCodes,
      pricingBasis: row.pricingBasis,
      unitPrice: toWire(
        this.personPrice(pricer, 'travel_addons', storedMoney(row.price), client, country, now),
      ),
      maxTravellers: row.maxTravellers,
      requiredDetails: storedDetails(row.requiredDetails),
      cancellationPolicy: storedPolicy(row.cancellationPolicy),
    };
  }
}
