import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';

import { toWire } from '@suskii/shared';

import { itemPayload } from '../bookings/booking-presenter';
import { BookingsService, type BookingCaller } from '../bookings/bookings.service';
import { tripFacts } from '../bookings/trip-facts';
import { APP_CONFIG, type AppConfig } from '../config/config';
import type { BookingStatus } from '../generated/prisma/client';
import { FxService, type Converter } from '../pricing/fx.service';
import type { ClientContext } from '../search/client-context';

import { ActivityPartner, type ActivityProduct } from './activity-partner';
import { PartnerLinks } from './partner-links';
import { PARTNER_PROGRAMS, type OfferTrip, type PartnerProgram } from './partner-programs';
import type { PartnerOffersDto, PartnerOffersQuery } from './partners.schemas';

/** Activities shown per place: a short, scannable row. */
const ACTIVITY_LIMIT = 6;
/** Trips that are going ahead; cancelled, failed or refunded ones get no cross-sell. */
const LIVE: readonly BookingStatus[] = ['HELD', 'PARTIALLY_PAID', 'PAID', 'TICKETING', 'CONFIRMED'];

type Offer = PartnerOffersDto['offers'][number];

/** On when set to true; unset means on outside production and off in production (ADR-070). */
export function partnerOffersEnabled(config: AppConfig): boolean {
  return config.PARTNER_OFFERS_ENABLED ?? config.NODE_ENV !== 'production';
}

/**
 * Affiliate offers for a place (ADR-069): partner pages for car rental, transfers, eSIMs and
 * insurance, and priced activities from the activity partner. Every link is sealed (ADR-070), so
 * the click can be credited; nothing here books or charges anything.
 */
@Injectable()
export class PartnerOffersService {
  private readonly logger = new Logger(PartnerOffersService.name);

  constructor(
    private readonly links: PartnerLinks,
    private readonly activities: ActivityPartner,
    private readonly fx: FxService,
    private readonly bookings: BookingsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Throws 404 while partner offers are off, as if the routes did not exist. */
  requireEnabled(): void {
    if (!partnerOffersEnabled(this.config)) throw new NotFoundException();
  }

  async forPlace(query: PartnerOffersQuery, client: ClientContext): Promise<PartnerOffersDto> {
    const trip: OfferTrip = {
      countryCode: query.countryCode,
      cityName: query.cityName ?? null,
      startDate: query.startDate ?? null,
      endDate: query.endDate ?? null,
    };
    return this.offers(trip, query.currency, client, null, query.categories);
  }

  /** Cross-sell for a booked trip: its destination and dates, never its travellers' details. */
  async forBooking(
    bookingId: string,
    currency: string,
    caller: Pick<BookingCaller, 'client' | 'token'>,
    now = new Date(),
  ): Promise<PartnerOffersDto> {
    const booking = await this.bookings.load(bookingId, caller);
    const item = booking.items[0];
    const facts = item && LIVE.includes(booking.status) ? tripFacts(itemPayload(item)) : null;
    if (!facts?.countryCode || facts.endDate < now.toISOString().slice(0, 10)) {
      return {
        trip: {
          countryCode: facts?.countryCode ?? '',
          cityName: facts?.cityName ?? null,
          startDate: facts?.startDate ?? null,
          endDate: facts?.endDate ?? null,
        },
        offers: [],
        partial: false,
      };
    }
    const trip: OfferTrip = {
      countryCode: facts.countryCode,
      cityName: facts.cityName,
      startDate: facts.startDate,
      endDate: facts.endDate,
    };
    return this.offers(trip, currency, caller.client, booking.id);
  }

  private async offers(
    trip: OfferTrip,
    currency: string,
    client: ClientContext,
    bookingId: string | null,
    categories?: readonly string[],
  ): Promise<PartnerOffersDto> {
    const wanted = (program: PartnerProgram) =>
      !categories || categories.includes(program.category);
    const viewer = { userId: client.userId, channel: client.channel, bookingId };
    const offers: Offer[] = [];
    let partial = false;

    for (const program of PARTNER_PROGRAMS) {
      if (program.category === 'activity' || !wanted(program)) continue;
      offers.push({
        id: program.id,
        programId: program.id,
        category: program.category,
        partnerName: program.name,
        title: null,
        imageUrl: null,
        rating: null,
        durationMinutes: null,
        fromPrice: null,
        href: this.links.href({
          ...viewer,
          programId: program.id,
          url: program.landing(trip),
          campaign: null,
        }),
        sample: false,
      });
    }

    const activities = PARTNER_PROGRAMS.find((program) => program.category === 'activity');
    if (activities && wanted(activities)) {
      try {
        const [products, fx] = await Promise.all([
          this.activities.search(
            trip,
            ACTIVITY_LIMIT,
            AbortSignal.timeout(this.config.PARTNER_TIMEOUT_MS),
          ),
          this.fx.converter(),
        ]);
        for (const product of products) {
          offers.push(this.activityOffer(activities, product, currency, fx, viewer));
        }
      } catch (error) {
        partial = true;
        this.logger.warn(
          { partner: this.activities.name, err: (error as Error).name },
          'activity partner unavailable',
        );
      }
    }

    return {
      trip: {
        countryCode: trip.countryCode,
        cityName: trip.cityName,
        startDate: trip.startDate,
        endDate: trip.endDate,
      },
      offers,
      partial,
    };
  }

  private activityOffer(
    program: PartnerProgram,
    product: ActivityProduct,
    currency: string,
    fx: Converter,
    viewer: { userId: string | null; channel: ClientContext['channel']; bookingId: string | null },
  ): Offer {
    let fromPrice: Offer['fromPrice'] = null;
    if (product.fromPrice) {
      try {
        fromPrice = toWire(fx.convert(product.fromPrice, currency, 'ceil'));
      } catch {
        // No rate for the display currency: show the offer without a price.
      }
    }
    return {
      id: `${program.id}:${product.code}`,
      programId: program.id,
      category: program.category,
      partnerName: program.name,
      title: product.title,
      imageUrl: product.imageUrl,
      rating: product.rating,
      durationMinutes: product.durationMinutes,
      fromPrice,
      href: this.links.href({
        ...viewer,
        programId: program.id,
        url: product.url,
        campaign: this.activities.campaign,
      }),
      sample: this.activities.sample,
    };
  }
}
