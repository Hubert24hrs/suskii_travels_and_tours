import { HttpStatus, Injectable } from '@nestjs/common';
import type { z } from 'zod';

import {
  addDays,
  coveredDays,
  isValidDate,
  localDate,
  MAX_ADDON_DAYS,
  MAX_ADVANCE_DAYS,
  seatsFor,
  type TravellerCounts,
} from '@suskii/shared';

import { priceItem } from '../bookings/booking-pricing';
import type { quoteSchema } from '../bookings/bookings.schemas';
import { PRICE_HOLD_MS } from '../bookings/bookings.service';
import { InhouseCatalog } from '../bookings/inhouse-catalog';
import {
  inhouseBasePrice,
  inhouseOfferId,
  INHOUSE_SUPPLIER,
  INHOUSE_VERTICAL,
  type InhouseItemPayload,
} from '../bookings/inhouse-items';
import { QuotesService } from '../bookings/quotes.service';
import { soldOut } from '../bookings/seat-inventory';
import { authenticationRequired } from '../auth/errors';
import { toJsonValue } from '../common/json';
import { ProblemDetailsException } from '../common/problem-details';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../infra/prisma.service';
import { toPriceDto } from '../pricing/pricing.schemas';
import { PricingService } from '../pricing/pricing.service';
import type { ClientContext } from '../search/client-context';
import { offerUnavailable } from '../search/search.errors';
import { OfferUnavailableError } from '../suppliers/supplier.errors';

import { AddonLinksService } from './addon-links.service';
import { INHOUSE_QUOTE_ISSUES, type InhouseQuoteInput } from './inhouse.schemas';
import { quotes } from '../telemetry/metrics';

type Quote = z.infer<typeof quoteSchema>;
type QuoteIssue = (typeof INHOUSE_QUOTE_ISSUES)[keyof typeof INHOUSE_QUOTE_ISSUES];

export const quoteInvalid = (code: QuoteIssue): ProblemDetailsException =>
  new ProblemDetailsException(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'quote-invalid',
    'This selection cannot be booked',
    'Change the travellers or dates and try again.',
    { code },
  );

const seatsLeft = (departure: { capacity: number; seatsReserved: number; seatsSold: number }) =>
  departure.capacity - departure.seatsReserved - departure.seatsSold;

const counts = (travellers: TravellerCounts): TravellerCounts => ({
  adults: travellers.adults,
  children: travellers.children,
  infants: travellers.infants,
});

/**
 * Quotes for in-house products (ADR-025): the selection is checked against the catalog, priced
 * through the pricing engine and stored as an `Offer` (supplier `suskii`) that the booking flow
 * uses exactly like a re-priced supplier offer. Seats are only taken when the booking is created.
 */
@Injectable()
export class InhouseQuotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: InhouseCatalog,
    private readonly pricing: PricingService,
    private readonly quotes: QuotesService,
    private readonly links: AddonLinksService,
  ) {}

  async create(input: InhouseQuoteInput, client: ClientContext): Promise<Quote> {
    // Suskii Prime is bought by an account for itself (ADR-030).
    if (input.kind === 'membership' && !client.userId) throw authenticationRequired();
    const now = new Date();
    let payload: InhouseItemPayload;
    try {
      payload = await this.payload(input, now);
    } catch (error) {
      if (error instanceof OfferUnavailableError) throw offerUnavailable(this.request(input));
      throw error;
    }
    const base = inhouseBasePrice(payload);
    if ('issue' in base) {
      throw quoteInvalid(
        base.issue === 'children_not_allowed'
          ? INHOUSE_QUOTE_ISSUES.childrenNotAllowed
          : base.issue === 'infants_not_allowed'
            ? INHOUSE_QUOTE_ISSUES.infantsNotAllowed
            : INHOUSE_QUOTE_ISSUES.tooManyTravellers,
      );
    }
    const pricer = await this.pricing.pricer(INHOUSE_VERTICAL[payload.kind], input.currency);
    const { breakdown } = priceItem(pricer, payload, client, now);
    const offer = await this.prisma.offer.create({
      data: {
        vertical: INHOUSE_VERTICAL[payload.kind],
        supplier: INHOUSE_SUPPLIER,
        supplierOfferId: inhouseOfferId(payload),
        payload: toJsonValue(payload) as Prisma.InputJsonValue,
        supplierTotalMinor: breakdown.supplierTotal.minor,
        supplierCurrency: breakdown.supplierTotal.currency,
        price: toPriceDto(breakdown),
        totalMinor: breakdown.total.minor,
        currency: input.currency,
        userId: client.userId,
        expiresAt: new Date(now.getTime() + PRICE_HOLD_MS),
      },
    });
    quotes.add(1, { vertical: offer.vertical });
    return this.quotes.get(offer.id, client);
  }

  /** The request echoed in a 410, so clients can start the selection again. */
  private request(input: InhouseQuoteInput): InhouseItemPayload['request'] {
    switch (input.kind) {
      case 'package':
      case 'tour':
        return {
          kind: input.kind,
          departureId: input.departureId,
          travellers: counts(input.travellers),
        };
      case 'visa':
        return {
          kind: 'visa',
          productId: input.productId,
          purpose: input.purpose,
          nationality: input.nationality,
          travelDate: input.travelDate,
          travellers: counts(input.travellers),
        };
      case 'addon':
        return {
          kind: 'addon',
          addonId: input.addonId,
          startDate: input.startDate,
          endDate: input.endDate,
          travellers: counts(input.travellers),
          linkToken: input.linkToken,
        };
      case 'membership':
        return { kind: 'membership', planSlug: input.planSlug, currency: input.currency };
    }
  }

  private async payload(input: InhouseQuoteInput, now: Date): Promise<InhouseItemPayload> {
    const today = localDate(now, 'UTC');
    switch (input.kind) {
      case 'membership': {
        const plan = await this.prisma.primePlan.findUnique({ where: { slug: input.planSlug } });
        if (!plan) throw new OfferUnavailableError(INHOUSE_SUPPLIER, 'No such Prime plan');
        const { price } = await this.catalog.primePlan(plan.id, input.currency);
        return this.catalog.membershipPayload(plan, price, now);
      }
      case 'package': {
        const row = await this.catalog.packageDeparture(input.departureId, now);
        if (seatsLeft(row) < seatsFor(input.travellers)) throw soldOut();
        return this.catalog.packagePayload(row, {
          kind: 'package',
          departureId: row.id,
          travellers: counts(input.travellers),
        });
      }
      case 'tour': {
        const row = await this.catalog.tourDeparture(input.departureId, now);
        if (seatsLeft(row) < seatsFor(input.travellers)) throw soldOut();
        return this.catalog.tourPayload(row, {
          kind: 'tour',
          departureId: row.id,
          travellers: counts(input.travellers),
        });
      }
      case 'visa': {
        const product = await this.catalog.visaProduct(input.productId);
        if (!product.purposes.includes(input.purpose))
          throw quoteInvalid(INHOUSE_QUOTE_ISSUES.purposeNotOffered);
        if (input.nationality === product.destination)
          throw quoteInvalid(INHOUSE_QUOTE_ISSUES.sameNationalityDestination);
        if (
          !isValidDate(input.travelDate) ||
          input.travelDate < today ||
          input.travelDate > addDays(today, MAX_ADVANCE_DAYS)
        ) {
          throw quoteInvalid(INHOUSE_QUOTE_ISSUES.datesInvalid);
        }
        return this.catalog.visaPayload(product, {
          kind: 'visa',
          productId: product.id,
          purpose: input.purpose,
          nationality: input.nationality,
          travelDate: input.travelDate,
          travellers: counts(input.travellers),
        });
      }
      case 'addon': {
        const addon = await this.catalog.addon(input.addonId);
        if (
          !isValidDate(input.startDate) ||
          !isValidDate(input.endDate) ||
          input.startDate < today ||
          input.startDate > addDays(today, MAX_ADVANCE_DAYS) ||
          input.endDate < input.startDate ||
          coveredDays(input.startDate, input.endDate) > MAX_ADDON_DAYS
        ) {
          throw quoteInvalid(INHOUSE_QUOTE_ISSUES.datesInvalid);
        }
        if (seatsFor(input.travellers) > addon.maxTravellers)
          throw quoteInvalid(INHOUSE_QUOTE_ISSUES.tooManyTravellers);
        const linked = input.linkToken ? await this.links.verify(input.linkToken) : null;
        let trip: {
          countryCode: string | null;
          cityName: string | null;
          timeZone: string | null;
        } = { countryCode: null, cityName: null, timeZone: null };
        if (linked) {
          trip = linked.trip;
        } else if (input.cityId) {
          const city = await this.prisma.city.findUnique({ where: { id: input.cityId } });
          if (city)
            trip = { countryCode: city.countryCode, cityName: city.name, timeZone: city.timezone };
        }
        // Country-specific products (a lounge, a local eSIM) need a trip in one of their countries.
        if (
          addon.countryCodes.length > 0 &&
          (!trip.countryCode || !addon.countryCodes.includes(trip.countryCode))
        ) {
          throw quoteInvalid(INHOUSE_QUOTE_ISSUES.notAvailableThere);
        }
        return this.catalog.addonPayload(
          addon,
          {
            kind: 'addon',
            addonId: addon.id,
            startDate: input.startDate,
            endDate: input.endDate,
            travellers: counts(input.travellers),
            linkToken: null,
          },
          {
            ...trip,
            linkedBookingId: linked?.bookingId ?? null,
            linkedReference: linked?.reference ?? null,
          },
        );
      }
    }
  }
}
