import { Injectable, NotFoundException } from '@nestjs/common';
import type { z } from 'zod';

import { BOOKING_TERMS_VERSION, daysBetween } from '@suskii/shared';

import { fromJsonValue } from '../common/json';
import { PrismaService } from '../infra/prisma.service';
import { FxService } from '../pricing/fx.service';
import { toPriceDto } from '../pricing/pricing.schemas';
import { PricingService } from '../pricing/pricing.service';
import type { ClientContext } from '../search/client-context';
import { flightPricingContext, toFlightOfferDto } from '../search/flight-search.service';
import { hotelPricingContext, toHotelRateDto } from '../search/hotel-search.service';
import { offerUnavailable } from '../search/search.errors';

import { bookedRate, type ItemPayload } from './booking-pricing';
import type { quoteSchema } from './bookings.schemas';

/** A quote as the checkout page shows it, priced for the current caller. */
@Injectable()
export class QuotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly fx: FxService,
  ) {}

  async get(quoteId: string, client: ClientContext): Promise<z.infer<typeof quoteSchema>> {
    const quote = await this.prisma.offer.findUnique({ where: { id: quoteId } });
    if (!quote) throw new NotFoundException();
    const payload = fromJsonValue<ItemPayload>(quote.payload);
    if (quote.expiresAt.getTime() <= Date.now()) throw offerUnavailable(payload.request);

    const [pricer, fx] = await Promise.all([
      this.pricing.pricer(quote.vertical, quote.currency),
      this.fx.converter(),
    ]);
    const now = new Date();
    const base = {
      quoteId: quote.id,
      currency: quote.currency,
      expiresAt: quote.expiresAt.toISOString(),
      termsVersion: BOOKING_TERMS_VERSION,
    };
    if (payload.kind === 'flight') {
      const { breakdown } = pricer(
        payload.offer.price,
        flightPricingContext(payload.offer, client, now),
      );
      return {
        ...base,
        vertical: 'flights',
        flight: {
          offer: toFlightOfferDto(quote.id, payload.offer, toPriceDto(breakdown), fx),
          request: payload.request,
        },
        hotel: null,
      };
    }
    const rate = bookedRate(payload);
    const { breakdown } = pricer(
      rate.price,
      hotelPricingContext(payload.hotel, payload.request, client, now),
    );
    const nights = daysBetween(payload.request.checkIn, payload.request.checkOut);
    return {
      ...base,
      vertical: 'hotels',
      flight: null,
      hotel: {
        name: payload.hotel.name,
        stars: payload.hotel.stars,
        area: payload.hotel.area,
        cityName: payload.hotel.cityName,
        countryCode: payload.hotel.countryCode,
        amenities: payload.hotel.amenities,
        rate: toHotelRateDto({ id: quote.id, rate, price: breakdown }, nights, fx),
        nights,
        request: payload.request,
      },
    };
  }
}
