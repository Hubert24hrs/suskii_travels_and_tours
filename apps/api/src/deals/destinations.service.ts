import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { z } from 'zod';

import {
  addDays,
  daysBetween,
  localDate,
  money,
  roundDiv,
  toWire,
  type HotelSearchRequest,
} from '@suskii/shared';

import { APP_CONFIG, type AppConfig } from '../config/config';
import type {
  City,
  Country,
  DestinationContent,
  DestinationHotelSnapshot,
} from '../generated/prisma/client';
import { PrismaService } from '../infra/prisma.service';
import { PricingService } from '../pricing/pricing.service';
import type { ClientContext } from '../search/client-context';
import { HotelSearchService } from '../search/hotel-search.service';

import type {
  hotelDestinationSchema,
  hotelDestinationsSchema,
  RefreshResult,
} from './deals.schemas';

type HotelDestinationDto = z.infer<typeof hotelDestinationSchema>;
type DestinationWithCity = DestinationContent & {
  city: City & { country: Country };
  hotelSnapshots: DestinationHotelSnapshot[];
};

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
/** Stay behind the "from" nightly price: two nights, one room, two adults. */
const STAY_NIGHTS = 2;
const STAY_ADULTS = 2;

const isoDate = (value: Date): string => value.toISOString().slice(0, 10);
const calendarDate = (value: string): Date => new Date(`${value}T00:00:00Z`);

/**
 * Hotel destinations (ADR-011): CMS content (`DestinationContent`) plus the hotel count and
 * cheapest nightly rate from the latest fresh hotel search snapshot, priced on read.
 */
@Injectable()
export class DestinationsService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly hotelSearch: HotelSearchService,
  ) {}

  async featured(
    currency: string,
    client: ClientContext,
  ): Promise<z.infer<typeof hotelDestinationsSchema>> {
    const now = new Date();
    const destinations = await this.prisma.destinationContent.findMany({
      where: { featured: true, publishedAt: { lte: now } },
      orderBy: [{ sortOrder: 'asc' }, { slug: 'asc' }],
      include: this.include(now),
    });
    const present = await this.presenter(currency, client, now);
    return { currency, destinations: destinations.map(present) };
  }

  async bySlug(
    slug: string,
    currency: string,
    client: ClientContext,
  ): Promise<HotelDestinationDto> {
    const now = new Date();
    const destination = await this.prisma.destinationContent.findFirst({
      where: { slug, publishedAt: { lte: now } },
      include: this.include(now),
    });
    if (!destination) throw new NotFoundException();
    return (await this.presenter(currency, client, now))(destination);
  }

  async published(): Promise<{ id: string; slug: string }[]> {
    return this.prisma.destinationContent.findMany({
      where: { publishedAt: { lte: new Date() } },
      orderBy: [{ sortOrder: 'asc' }, { slug: 'asc' }],
      select: { id: true, slug: true },
    });
  }

  /** Runs the reference hotel search and stores the hotel count and cheapest rate. */
  async refresh(destinationId: string, now = new Date()): Promise<RefreshResult> {
    const destination = await this.prisma.destinationContent.findUnique({
      where: { id: destinationId },
      include: { city: true },
    });
    if (!destination) throw new NotFoundException();
    if (!destination.publishedAt) return { status: 'inactive', snapshotId: null, fetchedAt: null };

    const checkIn = addDays(
      localDate(now, destination.city.timezone ?? 'UTC'),
      this.config.DESTINATIONS_CHECK_IN_OFFSET_DAYS,
    );
    const request: HotelSearchRequest = {
      destination: { type: 'city', cityId: destination.cityId },
      checkIn,
      checkOut: addDays(checkIn, STAY_NIGHTS),
      rooms: [{ adults: STAY_ADULTS, childAges: [] }],
      freeCancellationOnly: false,
    };
    const { hotelCount, cheapest } = await this.hotelSearch.stayAvailability(request);
    if (!cheapest) return { status: 'no_results', snapshotId: null, fetchedAt: null };
    const snapshot = await this.prisma.destinationHotelSnapshot.create({
      data: {
        destinationId: destination.id,
        supplier: cheapest.hotel.supplier,
        checkIn: calendarDate(request.checkIn),
        checkOut: calendarDate(request.checkOut),
        hotelCount,
        baseMinor: cheapest.rate.price.base.minor,
        taxesMinor: cheapest.rate.price.taxes.minor,
        currency: cheapest.rate.price.base.currency,
        countryCode: cheapest.hotel.countryCode,
      },
    });
    return {
      status: 'refreshed',
      snapshotId: snapshot.id,
      fetchedAt: snapshot.fetchedAt.toISOString(),
    };
  }

  async prune(now = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - this.config.SNAPSHOT_RETENTION_DAYS * DAY_MS);
    const { count } = await this.prisma.destinationHotelSnapshot.deleteMany({
      where: { fetchedAt: { lt: cutoff } },
    });
    return count;
  }

  private include(now: Date) {
    return {
      city: { include: { country: true } },
      hotelSnapshots: {
        where: {
          fetchedAt: { gte: new Date(now.getTime() - this.config.DEALS_MAX_AGE_HOURS * HOUR_MS) },
        },
        orderBy: { fetchedAt: 'desc' as const },
        take: 1,
      },
    };
  }

  private async presenter(
    currency: string,
    client: ClientContext,
    now: Date,
  ): Promise<(destination: DestinationWithCity) => HotelDestinationDto> {
    const pricer = await this.pricing.pricer('hotels', currency);
    return (destination) => {
      const [snapshot] = destination.hotelSnapshots;
      let fromPricePerNight: HotelDestinationDto['fromPricePerNight'] = null;
      if (snapshot) {
        const { breakdown } = pricer(
          {
            base: money(snapshot.baseMinor, snapshot.currency),
            taxes: money(snapshot.taxesMinor, snapshot.currency),
          },
          {
            vertical: 'hotels',
            supplier: snapshot.supplier,
            channel: client.channel,
            userTier: client.userTier,
            destinationCountry: snapshot.countryCode,
            passengers: STAY_ADULTS,
            now,
          },
        );
        const nights = Math.max(
          daysBetween(isoDate(snapshot.checkIn), isoDate(snapshot.checkOut)),
          1,
        );
        // Round up: a "from" price must never be below what a night actually costs.
        fromPricePerNight = toWire({
          minor: roundDiv(breakdown.total.minor, BigInt(nights), 'ceil'),
          currency: breakdown.total.currency,
        });
      }
      return {
        id: destination.id,
        slug: destination.slug,
        city: { id: destination.city.id, name: destination.city.name },
        country: { code: destination.city.country.code, name: destination.city.country.name },
        imageUrl: destination.imageUrl,
        hotelCount: snapshot?.hotelCount ?? null,
        fromPricePerNight,
        sample: snapshot ? snapshot.supplier === 'mock' : null,
        updatedAt: snapshot?.fetchedAt.toISOString() ?? null,
      };
    };
  }
}
