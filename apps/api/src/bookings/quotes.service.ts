import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { z } from 'zod';

import { BOOKING_TERMS_VERSION, daysBetween, type Money } from '@suskii/shared';

import { fromJsonValue } from '../common/json';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { PrismaService } from '../infra/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { PaymentProviders } from '../payments/payment-providers';
import { FxService } from '../pricing/fx.service';
import { toPriceDto } from '../pricing/pricing.schemas';
import { PricingService } from '../pricing/pricing.service';
import type { ClientContext } from '../search/client-context';
import { flightPricingContext, toFlightOfferDto } from '../search/flight-search.service';
import { hotelPricingContext, toHotelRateDto } from '../search/hotel-search.service';
import { offerUnavailable } from '../search/search.errors';

import { bookedRate, type ItemPayload } from './booking-pricing';
import type { PaymentOptionsDto, quoteSchema } from './bookings.schemas';
import { holdTerms, paymentOptionsDto, planOptions, planPolicy } from './payment-options';

/** A quote as the checkout page shows it, priced for the current caller. */
@Injectable()
export class QuotesService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly fx: FxService,
    private readonly providers: PaymentProviders,
    private readonly ledger: LedgerService,
  ) {}

  /** Providers and flexible plans for the quoted total, before any extras (ADR-018). */
  private async paymentOptions(
    payload: ItemPayload,
    total: Money,
    client: ClientContext,
    now: Date,
  ): Promise<PaymentOptionsDto> {
    const policy = planPolicy(this.config);
    const wallet = client.userId
      ? await this.ledger.balance(this.prisma, {
          kind: 'wallet',
          userId: client.userId,
          currency: total.currency,
        })
      : null;
    return paymentOptionsDto(
      this.providers.options(total.currency),
      planOptions(holdTerms(payload), total, false, policy, now),
      policy,
      wallet,
    );
  }

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
        payment: await this.paymentOptions(payload, breakdown.total, client, now),
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
      payment: await this.paymentOptions(payload, breakdown.total, client, now),
    };
  }
}
