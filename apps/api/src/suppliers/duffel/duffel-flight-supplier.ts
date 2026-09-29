import { Logger } from '@nestjs/common';

import { localToUtc, parseMoney, subtract, type CabinClass, type Money } from '@suskii/shared';

import { buildSlice } from '../itinerary';
import { SupplierUnavailableError } from '../supplier.errors';
import {
  FlightSupplier,
  type AirportPoint,
  type FlightSearchQuery,
  type FlightSegment,
  type SupplierFlightOffer,
} from '../supplier.types';

import type { DuffelClient } from './duffel.client';
import { duffelOfferSchema, type DuffelOffer } from './duffel.schemas';

type DuffelPlace = DuffelOffer['slices'][number]['segments'][number]['origin'];

const place = (value: DuffelPlace): AirportPoint => ({
  code: value.iata_code,
  name: value.name ?? null,
  cityName: value.city_name ?? null,
  countryCode: value.iata_country_code ?? null,
  timeZone: value.time_zone,
});

/** Duffel sends local times without an offset; the airport's zone gives the instant. */
const localTime = (value: string): string => value.slice(0, 16);

const amount = (value: string, currency: string): Money => parseMoney(value, currency, 'half-up');

/**
 * Duffel flights (https://duffel.com/docs/api/v2). Enabled only when FLIGHT_SUPPLIERS includes
 * `duffel` and DUFFEL_API_TOKEN is set. Offers that fail validation are skipped and counted,
 * never passed through half-parsed.
 */
export class DuffelFlightSupplier extends FlightSupplier {
  readonly name = 'duffel';
  private readonly logger = new Logger(DuffelFlightSupplier.name);

  constructor(
    private readonly client: DuffelClient,
    private readonly supplierTimeoutMs: number,
  ) {
    super();
  }

  async search(query: FlightSearchQuery, signal: AbortSignal): Promise<SupplierFlightOffer[]> {
    const passengers = [
      ...Array.from({ length: query.passengers.adults }, () => ({ type: 'adult' })),
      ...Array.from({ length: query.passengers.children }, () => ({ type: 'child' })),
      ...Array.from({ length: query.passengers.infants }, () => ({ type: 'infant_without_seat' })),
    ];
    // Ask Duffel to return what it has a little before our own timeout fires.
    const supplierTimeout = Math.max(2000, this.supplierTimeoutMs - 1500);
    const response = await this.client.request(
      'POST',
      `/air/offer_requests?return_offers=true&supplier_timeout=${supplierTimeout}`,
      signal,
      {
        data: {
          slices: query.slices.map((slice) => ({
            origin: slice.origin,
            destination: slice.destination,
            departure_date: slice.departureDate,
          })),
          passengers,
          cabin_class: query.cabinClass,
          ...(query.maxConnections === null ? {} : { max_connections: query.maxConnections }),
        },
      },
    );
    const offers = (response as { data?: { offers?: unknown[] } } | null)?.data?.offers;
    if (!Array.isArray(offers))
      throw new SupplierUnavailableError(this.name, 'Duffel returned no offers array');

    const mapped: SupplierFlightOffer[] = [];
    let invalid = 0;
    for (const raw of offers) {
      const parsed = duffelOfferSchema.safeParse(raw);
      const offer = parsed.success ? this.toOffer(parsed.data, query) : null;
      if (offer) mapped.push(offer);
      else invalid += 1;
    }
    if (invalid > 0)
      this.logger.warn(
        { invalid, total: offers.length },
        'Skipped Duffel offers that failed validation',
      );
    return mapped;
  }

  async reprice(offer: SupplierFlightOffer, signal: AbortSignal): Promise<SupplierFlightOffer> {
    const response = await this.client.request(
      'GET',
      `/air/offers/${encodeURIComponent(offer.supplierOfferId)}?return_available_services=false`,
      signal,
    );
    const parsed = duffelOfferSchema.safeParse((response as { data?: unknown } | null)?.data);
    const fresh = parsed.success
      ? this.toOffer(parsed.data, {
          slices: [],
          passengers: offer.passengers,
          cabinClass: offer.cabinClass,
          maxConnections: null,
        })
      : null;
    if (!fresh) throw new SupplierUnavailableError(this.name, 'Duffel returned an invalid offer');
    return fresh;
  }

  /** Maps one validated Duffel offer; returns null when it cannot be represented faithfully. */
  toOffer(offer: DuffelOffer, query: FlightSearchQuery): SupplierFlightOffer | null {
    try {
      const total = amount(offer.total_amount, offer.total_currency);
      const taxes =
        offer.tax_amount && (offer.tax_currency ?? offer.total_currency) === offer.total_currency
          ? amount(offer.tax_amount, offer.total_currency)
          : amount('0', offer.total_currency);
      const base = subtract(total, taxes);

      let cabinClass: CabinClass = query.cabinClass;
      let carryOn = Number.POSITIVE_INFINITY;
      let checked = Number.POSITIVE_INFINITY;
      const slices = offer.slices.map((slice) => {
        const segments: FlightSegment[] = slice.segments.map((segment) => {
          const departureUtc = localToUtc(
            localTime(segment.departing_at),
            segment.origin.time_zone,
          );
          const arrivalUtc = localToUtc(
            localTime(segment.arriving_at),
            segment.destination.time_zone,
          );
          const firstPassenger = segment.passengers[0];
          if (firstPassenger?.cabin_class) cabinClass = firstPassenger.cabin_class;
          const bags = firstPassenger?.baggages ?? [];
          carryOn = Math.min(
            carryOn,
            bags.filter((b) => b.type === 'carry_on').reduce((a, b) => a + b.quantity, 0),
          );
          checked = Math.min(
            checked,
            bags.filter((b) => b.type === 'checked').reduce((a, b) => a + b.quantity, 0),
          );
          return {
            marketingCarrier: {
              code: segment.marketing_carrier.iata_code ?? '',
              name: segment.marketing_carrier.name,
            },
            operatingCarrier: {
              code: segment.operating_carrier.iata_code ?? '',
              name: segment.operating_carrier.name,
            },
            flightNumber: segment.marketing_carrier_flight_number,
            origin: place(segment.origin),
            destination: place(segment.destination),
            departureLocal: localTime(segment.departing_at),
            departureUtc: departureUtc.toISOString(),
            arrivalLocal: localTime(segment.arriving_at),
            arrivalUtc: arrivalUtc.toISOString(),
            durationMinutes: Math.round((arrivalUtc.getTime() - departureUtc.getTime()) / 60_000),
            aircraft: segment.aircraft?.name ?? null,
            cabinClass: firstPassenger?.cabin_class ?? query.cabinClass,
          };
        });
        return buildSlice(segments, slice.fare_brand_name ?? null);
      });

      const penaltyOf = (
        condition:
          | { allowed: boolean; penalty_amount?: string | null; penalty_currency?: string | null }
          | null
          | undefined,
      ): Money | null =>
        condition?.allowed && condition.penalty_amount && condition.penalty_currency
          ? amount(condition.penalty_amount, condition.penalty_currency)
          : null;
      const refund = offer.conditions?.refund_before_departure;
      const change = offer.conditions?.change_before_departure;
      const payment = offer.payment_requirements;

      return {
        supplier: this.name,
        supplierOfferId: offer.id,
        owner: { code: offer.owner.iata_code ?? '', name: offer.owner.name },
        slices,
        baggage: {
          carryOn: Number.isFinite(carryOn) ? carryOn : 0,
          checked: Number.isFinite(checked) ? checked : 0,
        },
        conditions: {
          refundable: refund?.allowed === true,
          refundPenalty: penaltyOf(refund),
          changeable: change?.allowed === true,
          changePenalty: penaltyOf(change),
        },
        cabinClass,
        passengers: query.passengers,
        price: { base, taxes },
        expiresAt: new Date(offer.expires_at).toISOString(),
        hold: {
          available: payment ? !payment.requires_instant_payment : false,
          paymentRequiredBy: payment?.payment_required_by
            ? new Date(payment.payment_required_by).toISOString()
            : null,
        },
      };
    } catch (error) {
      this.logger.warn({ err: error, offerId: offer.id }, 'Could not map Duffel offer');
      return null;
    }
  }
}
