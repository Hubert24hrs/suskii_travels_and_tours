import { Logger } from '@nestjs/common';

import {
  equals,
  localToUtc,
  parseMoney,
  subtract,
  add,
  type CabinClass,
  type Money,
} from '@suskii/shared';

import { buildSlice } from '../itinerary';
import { SupplierRequestError, SupplierUnavailableError } from '../supplier.errors';
import type { SupplierPrice } from '../../pricing/pricing-engine';
import {
  FlightSupplier,
  type AirportPoint,
  type FlightBookingRequest,
  type FlightBookingResult,
  type FlightHold,
  type FlightHoldRequest,
  type FlightSearchQuery,
  type FlightSegment,
  type HeldOrder,
  type PayHeldRequest,
  type SupplierContact,
  type SupplierFlightOffer,
  type SupplierPassenger,
} from '../supplier.types';

import type { DuffelClient } from './duffel.client';
import {
  duffelOfferSchema,
  duffelOrderSchema,
  type DuffelOffer,
  type DuffelOrder,
} from './duffel.schemas';

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
  /** Duffel cannot deduplicate order creation, so an ambiguous failure is never retried blindly. */
  readonly idempotentBooking = false;
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

  /**
   * Creates an instant order paid from the Duffel balance. The offer is fetched again for its
   * passenger ids; a total that no longer matches what the traveller paid is refused rather than
   * charged. Extras are not requested from Duffel yet, so none can be booked.
   */
  async book(request: FlightBookingRequest, signal: AbortSignal): Promise<FlightBookingResult> {
    if (request.services.length > 0) {
      throw new SupplierRequestError(this.name, 'Duffel extras are not supported yet');
    }
    const offer = await this.freshOffer(request.offer, request.passengers.length, signal);
    const created = await this.client.request('POST', '/air/orders', signal, {
      data: {
        type: 'instant',
        selected_offers: [offer.id],
        passengers: this.orderPassengers(offer, request.passengers, request.contact),
        payments: [{ type: 'balance', currency: offer.total_currency, amount: offer.total_amount }],
        metadata: { suskii_booking_item: request.idempotencyKey },
      },
    });
    const order = this.parseOrder(created);
    return { supplierReference: order.booking_reference, tickets: this.tickets(order, offer) };
  }

  /** Creates a `pay_later` order: the airline holds the space until `payment_required_by`. */
  override async hold(request: FlightHoldRequest, signal: AbortSignal): Promise<FlightHold> {
    const offer = await this.freshOffer(request.offer, request.passengers.length, signal);
    if (offer.payment_requirements?.requires_instant_payment !== false) {
      throw new SupplierRequestError(this.name, 'This offer cannot be held');
    }
    const created = await this.client.request('POST', '/air/orders', signal, {
      data: {
        type: 'pay_later',
        selected_offers: [offer.id],
        passengers: this.orderPassengers(offer, request.passengers, request.contact),
        metadata: { suskii_booking_item: request.idempotencyKey },
      },
    });
    const order = this.parseOrder(created);
    const status = order.payment_status;
    if (!status?.awaiting_payment || !status.payment_required_by) {
      throw new SupplierUnavailableError(this.name, 'Duffel did not return a held order');
    }
    return {
      orderId: order.id,
      supplierReference: order.booking_reference,
      paymentRequiredBy: new Date(status.payment_required_by).toISOString(),
      priceGuaranteedUntil: status.price_guarantee_expires_at
        ? new Date(status.price_guarantee_expires_at).toISOString()
        : null,
      price: this.orderPrice(order),
    };
  }

  /** Fetching a held order returns its latest price once the guarantee has lapsed. */
  override async heldOrder(orderId: string, signal: AbortSignal): Promise<HeldOrder> {
    const order = this.parseOrder(
      await this.client.request('GET', `/air/orders/${encodeURIComponent(orderId)}`, signal),
    );
    const status = order.payment_status;
    return {
      awaitingPayment: status?.awaiting_payment ?? false,
      paymentRequiredBy: status?.payment_required_by
        ? new Date(status.payment_required_by).toISOString()
        : null,
      priceGuaranteedUntil: status?.price_guarantee_expires_at
        ? new Date(status.price_guarantee_expires_at).toISOString()
        : null,
      price: this.orderPrice(order),
    };
  }

  /**
   * Pays a held order from the Duffel balance (`POST /air/payments`) after checking that its
   * current total is what the traveller paid for, then reads the tickets from the order.
   */
  override async payHeld(
    request: PayHeldRequest,
    signal: AbortSignal,
  ): Promise<FlightBookingResult> {
    const path = `/air/orders/${encodeURIComponent(request.orderId)}`;
    const before = this.parseOrder(await this.client.request('GET', path, signal));
    if (before.payment_status && !before.payment_status.awaiting_payment) {
      // Paid already (a retry after an ambiguous failure): just read the tickets.
      return { supplierReference: before.booking_reference, tickets: this.tickets(before, null) };
    }
    const current = this.orderPrice(before);
    const agreed = add(request.price.base, request.price.taxes);
    if (!equals(add(current.base, current.taxes), agreed)) {
      throw new SupplierRequestError(this.name, 'The held fare changed before payment');
    }
    await this.client.request('POST', '/air/payments', signal, {
      data: {
        order_id: request.orderId,
        payment: { type: 'balance', amount: before.total_amount, currency: before.total_currency },
      },
    });
    const after = this.parseOrder(await this.client.request('GET', path, signal));
    return { supplierReference: after.booking_reference, tickets: this.tickets(after, null) };
  }

  /** Unpaid holds cancel free of charge: create the cancellation, then confirm it. */
  override async cancelHold(orderId: string, signal: AbortSignal): Promise<void> {
    const created = (await this.client.request('POST', '/air/order_cancellations', signal, {
      data: { order_id: orderId },
    })) as { data?: { id?: unknown } } | null;
    const id = created?.data?.id;
    if (typeof id !== 'string') {
      throw new SupplierUnavailableError(this.name, 'Duffel returned an invalid cancellation');
    }
    await this.client.request(
      'POST',
      `/air/order_cancellations/${encodeURIComponent(id)}/actions/confirm`,
      signal,
    );
  }

  private async freshOffer(
    known: SupplierFlightOffer,
    passengerCount: number,
    signal: AbortSignal,
  ): Promise<DuffelOffer> {
    const response = await this.client.request(
      'GET',
      `/air/offers/${encodeURIComponent(known.supplierOfferId)}?return_available_services=false`,
      signal,
    );
    const parsed = duffelOfferSchema.safeParse((response as { data?: unknown } | null)?.data);
    if (!parsed.success)
      throw new SupplierUnavailableError(this.name, 'Duffel returned an invalid offer');
    const offer = parsed.data;
    const total = amount(offer.total_amount, offer.total_currency);
    if (!equals(total, add(known.price.base, known.price.taxes))) {
      throw new SupplierRequestError(this.name, 'The fare changed after payment');
    }
    if (offer.passengers.length !== passengerCount) {
      throw new SupplierRequestError(this.name, 'Passengers do not match the offer');
    }
    return offer;
  }

  private orderPassengers(
    offer: DuffelOffer,
    travellers: SupplierPassenger[],
    contact: SupplierContact,
  ): Record<string, unknown>[] {
    const passengers: Record<string, unknown>[] = travellers.map((passenger, index) => ({
      id: offer.passengers[index]?.id,
      title: passenger.title,
      gender: passenger.gender,
      given_name: passenger.givenNames,
      family_name: passenger.surname,
      born_on: passenger.dateOfBirth,
      email: contact.email,
      phone_number: contact.phone,
      ...(passenger.document
        ? {
            identity_documents: [
              {
                type: 'passport',
                unique_identifier: passenger.document.number,
                issuing_country_code: passenger.document.issuingCountry,
                expires_on: passenger.document.expiryDate,
              },
            ],
          }
        : {}),
    }));
    // Each lap infant travels with one adult, in order.
    const adultIndexes = travellers.flatMap((p, index) => (p.type === 'adult' ? [index] : []));
    travellers.forEach((passenger, index) => {
      if (passenger.type !== 'infant') return;
      const adult = passengers[adultIndexes.shift() ?? -1];
      if (adult) adult.infant_passenger_id = offer.passengers[index]?.id;
    });
    return passengers;
  }

  private parseOrder(response: unknown): DuffelOrder {
    const order = duffelOrderSchema.safeParse((response as { data?: unknown } | null)?.data);
    if (!order.success)
      throw new SupplierUnavailableError(this.name, 'Duffel returned an invalid order');
    return order.data;
  }

  private orderPrice(order: DuffelOrder): SupplierPrice {
    if (!order.total_amount || !order.total_currency) {
      throw new SupplierUnavailableError(this.name, 'Duffel returned an order without a total');
    }
    const total = amount(order.total_amount, order.total_currency);
    const taxes =
      order.tax_amount && (order.tax_currency ?? order.total_currency) === order.total_currency
        ? amount(order.tax_amount, order.total_currency)
        : amount('0', order.total_currency);
    return { base: subtract(total, taxes), taxes };
  }

  /**
   * E-tickets by passenger position. Offer passenger ids give the order when known; otherwise
   * the order's own passenger list (same order as requested) does.
   */
  private tickets(
    order: DuffelOrder,
    offer: DuffelOffer | null,
  ): { passengerIndex: number; number: string }[] {
    const ids =
      offer?.passengers.map((passenger) => passenger.id) ??
      order.passengers.map((passenger) => passenger.id);
    const indexById = new Map(ids.map((id, index) => [id, index]));
    return order.documents
      .filter((document) => document.type === 'electronic_ticket')
      .flatMap((document) =>
        document.passenger_ids.flatMap((id) => {
          const passengerIndex = indexById.get(id);
          return passengerIndex === undefined
            ? []
            : [{ passengerIndex, number: document.unique_identifier }];
        }),
      );
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
          priceGuaranteedUntil: payment?.price_guarantee_expires_at
            ? new Date(payment.price_guarantee_expires_at).toISOString()
            : null,
        },
        services: [],
      };
    } catch (error) {
      this.logger.warn({ err: error, offerId: offer.id }, 'Could not map Duffel offer');
      return null;
    }
  }
}
