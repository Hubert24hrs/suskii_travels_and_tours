import { Injectable, NotFoundException } from '@nestjs/common';
import type { z } from 'zod';

import { toWire, type HotelSearchRequest } from '@suskii/shared';

import { fromJsonValue } from '../common/json';
import { PrismaService } from '../infra/prisma.service';
import { toPriceDto } from '../pricing/pricing.schemas';
import { PricingService } from '../pricing/pricing.service';
import type { SupplierFlightOffer, SupplierHotel } from '../suppliers/supplier.types';

import type { ClientContext } from './client-context';
import { flightPricingContext } from './flight-search.service';
import { hotelPricingContext } from './hotel-search.service';
import { promoInvalid, quoteExpired } from './search.errors';
import type { promoValidationSchema } from './search.schemas';

type QuotePayload =
  | { kind: 'flight'; offer: SupplierFlightOffer }
  | { kind: 'hotel'; hotel: SupplierHotel; request: HotelSearchRequest };

/**
 * Applies a promo code to a quote and returns the discounted price. Redemption (and usage
 * counting) happens at payment (phase 6). Every failure looks the same to the caller.
 */
@Injectable()
export class PromoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
  ) {}

  async validate(
    code: string,
    quoteId: string,
    client: ClientContext,
  ): Promise<z.infer<typeof promoValidationSchema>> {
    const quote = await this.prisma.offer.findUnique({ where: { id: quoteId } });
    if (!quote) throw new NotFoundException();
    if (quote.expiresAt.getTime() <= Date.now()) throw quoteExpired();
    const promo = await this.pricing.findPromo(code, client.userId);
    if (!promo) throw promoInvalid();

    const payload = fromJsonValue<QuotePayload>(quote.payload);
    const pricer = await this.pricing.pricer(quote.vertical, quote.currency);
    const now = new Date();
    let result;
    if (payload.kind === 'flight') {
      result = pricer(payload.offer.price, flightPricingContext(payload.offer, client, now), promo);
    } else {
      const rate = payload.hotel.rates[0];
      if (!rate) throw promoInvalid();
      result = pricer(
        rate.price,
        hotelPricingContext(payload.hotel, payload.request, client, now),
        promo,
      );
    }
    const discount = result.breakdown.discount;
    if (result.promo?.status !== 'applied' || !discount) throw promoInvalid();
    return {
      code: discount.code,
      discount: toWire(discount.amount),
      price: toPriceDto(result.breakdown),
    };
  }
}
