import { Logger } from '@nestjs/common';

import {
  compare,
  equals,
  localToUtc,
  multiply,
  parseMoney,
  subtract,
  add,
  toDecimalString,
  zero,
  type CabinClass,
  type Money,
  type TravellerCounts,
} from '@suskii/shared';

import { buildSlice } from '../itinerary';
import {
  OfferUnavailableError,
  SupplierRequestError,
  SupplierUnavailableError,
} from '../supplier.errors';
import type { SupplierPrice } from '../../pricing/pricing-engine';
import {
  FlightSupplier,
  type AirlineChange,
  type AirlineChangesRequest,
  type AirportPoint,
  type FlightBookingRequest,
  type FlightBookingResult,
  type FlightCancellationQuote,
  type FlightCancellationRequest,
  type FlightHold,
  type FlightHoldRequest,
  type FlightSearchQuery,
  type FlightSegment,
  type FlightService,
  type FlightSlice,
  type HeldOrder,
  type OrderChanges,
  type PayHeldRequest,
  type SupplierContact,
  type SupplierFlightOffer,
  type SupplierPassenger,
} from '../supplier.types';

import type { DuffelClient } from './duffel.client';
import {
  duffelAirlineChangeSchema,
  duffelOfferSchema,
  duffelOrderCancellationSchema,
  duffelOrderChangesSchema,
  duffelOrderSchema,
  duffelServiceSchema,
  duffelSliceSchema,
  type DuffelOffer,
  type DuffelOrder,
  type DuffelOrderCancellation,
  type DuffelService,
  type DuffelSlice,
} from './duffel.schemas';

type DuffelSegment = DuffelSlice['segments'][number];
type DuffelPlace = DuffelSegment['origin'];

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

/** One flight in our shape. Throws when its times cannot be placed in the airports' zones. */
function toSegment(segment: DuffelSegment, cabinClass: CabinClass): FlightSegment {
  const departureUtc = localToUtc(localTime(segment.departing_at), segment.origin.time_zone);
  const arrivalUtc = localToUtc(localTime(segment.arriving_at), segment.destination.time_zone);
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
    cabinClass: segment.passengers[0]?.cabin_class ?? cabinClass,
  };
}

const toSlice = (slice: DuffelSlice, cabinClass: CabinClass): FlightSlice =>
  buildSlice(
    slice.segments.map((segment) => toSegment(segment, cabinClass)),
    slice.fare_brand_name ?? null,
  );

/** Order slices in our shape, or null when any of them cannot be represented faithfully. */
function orderSlices(raw: readonly unknown[], cabinClass: CabinClass): FlightSlice[] | null {
  const slices: FlightSlice[] = [];
  for (const value of raw) {
    const parsed = duffelSliceSchema.safeParse(value);
    if (!parsed.success) return null;
    try {
      slices.push(toSlice(parsed.data, cabinClass));
    } catch {
      return null;
    }
  }
  return slices;
}

/** The flights and fare an offer sells: offers with the same key are the same product. */
function itineraryKey(offer: SupplierFlightOffer): string {
  return [
    offer.owner.code,
    offer.cabinClass,
    ...offer.slices.map((slice) =>
      [
        slice.fareBrand ?? '',
        ...slice.segments.map(
          (segment) =>
            `${segment.marketingCarrier.code}${segment.flightNumber}@${segment.departureLocal}`,
        ),
      ].join('|'),
    ),
  ].join('/');
}

const offerTotal = (offer: SupplierFlightOffer): Money => add(offer.price.base, offer.price.taxes);

/** One passenger's checked bag for the whole trip: the Duffel services that together cover it. */
interface BagBundle {
  serviceIds: string[];
  /** Per bag, in the offer's currency. */
  unit: Money;
  maxQuantity: number;
}

const serviceTotal = (service: DuffelService): Money =>
  amount(service.total_amount, service.total_currency);

/**
 * Checked bags for the whole trip, by passenger id and then weight (ADR-063). Duffel sells a bag
 * per passenger and per segment or slice, so a bundle takes services of one weight that cover
 * every segment exactly once: the widest first, then the cheapest. A bag that names several
 * passengers, an unknown segment or weight, or another currency than the fare is not sold.
 */
function checkedBags(offer: DuffelOffer): Map<string, Map<number, BagBundle>> {
  const bags = new Map<string, Map<number, BagBundle>>();
  const segmentIds = offer.slices.flatMap((slice) => slice.segments.map((segment) => segment.id));
  const segments = new Set(segmentIds.filter((id): id is string => typeof id === 'string'));
  if (segments.size === 0 || segments.size !== segmentIds.length) return bags;

  const candidates = new Map<string, Map<number, DuffelService[]>>();
  for (const raw of offer.available_services ?? []) {
    const parsed = duffelServiceSchema.safeParse(raw);
    if (!parsed.success) continue;
    const service = parsed.data;
    const weight = service.metadata?.maximum_weight_kg;
    const [passengerId] = service.passenger_ids;
    if (
      service.type !== 'baggage' ||
      service.metadata?.type !== 'checked' ||
      typeof weight !== 'number' ||
      !Number.isInteger(weight) ||
      weight <= 0 ||
      service.passenger_ids.length !== 1 ||
      passengerId === undefined ||
      service.total_currency !== offer.total_currency ||
      service.maximum_quantity < 1 ||
      service.segment_ids.length === 0 ||
      !service.segment_ids.every((id) => segments.has(id))
    ) {
      continue;
    }
    const byWeight = candidates.get(passengerId) ?? new Map<number, DuffelService[]>();
    byWeight.set(weight, [...(byWeight.get(weight) ?? []), service]);
    candidates.set(passengerId, byWeight);
  }

  for (const [passengerId, byWeight] of candidates) {
    const bundles = new Map<number, BagBundle>();
    for (const [weight, services] of byWeight) {
      const ordered = [...services].sort(
        (a, b) =>
          b.segment_ids.length - a.segment_ids.length || compare(serviceTotal(a), serviceTotal(b)),
      );
      const covered = new Set<string>();
      const chosen: DuffelService[] = [];
      for (const service of ordered) {
        if (service.segment_ids.some((id) => covered.has(id))) continue;
        for (const id of service.segment_ids) covered.add(id);
        chosen.push(service);
      }
      if (covered.size !== segments.size) continue;
      bundles.set(weight, {
        serviceIds: chosen.map((service) => service.id),
        unit: chosen.reduce(
          (total, service) => add(total, serviceTotal(service)),
          zero(offer.total_currency),
        ),
        maxQuantity: Math.min(...chosen.map((service) => service.maximum_quantity)),
      });
    }
    if (bundles.size > 0) bags.set(passengerId, bundles);
  }
  return bags;
}

/**
 * The bags the offer sells, as our extras: one per weight that every passenger with a seat can
 * add at the same price (lap infants cannot add bags). The id names the offer and the weight, so
 * a re-check of the same offer keeps it.
 */
function bagServices(offer: DuffelOffer, travellers: TravellerCounts): FlightService[] {
  const seated = offer.passengers.slice(0, travellers.adults + travellers.children);
  const [first] = seated;
  if (!first || seated.length !== travellers.adults + travellers.children) return [];
  const bags = checkedBags(offer);
  const services: FlightService[] = [];
  for (const [weight, bundle] of bags.get(first.id) ?? []) {
    const bundles = seated.map((passenger) => bags.get(passenger.id)?.get(weight));
    if (bundles.some((other) => !other || !equals(other.unit, bundle.unit))) continue;
    services.push({
      id: `${offer.id}.bag${weight}`,
      type: 'checked_bag',
      weightKg: weight,
      maxQuantity: Math.min(...bundles.map((other) => other?.maxQuantity ?? 0)),
      price: bundle.unit,
    });
  }
  return services.sort((a, b) => a.weightKg - b.weightKg || compare(a.price, b.price));
}

/**
 * Duffel flights (https://duffel.com/docs/api/v2). Enabled only when FLIGHT_SUPPLIERS includes
 * `duffel` and DUFFEL_API_TOKEN is set. Offers that fail validation are skipped and counted,
 * never passed through half-parsed.
 */
export class DuffelFlightSupplier extends FlightSupplier {
  readonly name = 'duffel';
  /** Duffel cannot deduplicate order creation, so an ambiguous failure is never retried blindly. */
  readonly idempotentBooking = false;
  override readonly cancelsOnline = true;
  override readonly tracksChanges = true;
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

  /** Fetches the offer with its extras: search results never carry them. */
  async reprice(offer: SupplierFlightOffer, signal: AbortSignal): Promise<SupplierFlightOffer> {
    const response = await this.client.request(
      'GET',
      `/air/offers/${encodeURIComponent(offer.supplierOfferId)}?return_available_services=true`,
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
   * Duffel takes one order per offer request (`offer_request_already_booked`, ADR-062), and our
   * search cache shares a search between travellers. A quote therefore searches again and takes
   * the same flights and fare from its own offer request, preferring the same total, then
   * fetches that offer for its current price and its extras (bags). Any change in price shows as
   * the quote's price change.
   */
  override async quoteOffer(
    offer: SupplierFlightOffer,
    query: FlightSearchQuery,
    signal: AbortSignal,
  ): Promise<SupplierFlightOffer> {
    const key = itineraryKey(offer);
    const matches = (await this.search(query, signal)).filter(
      (candidate) => itineraryKey(candidate) === key,
    );
    const same = matches.find((candidate) => equals(offerTotal(candidate), offerTotal(offer)));
    const choice =
      same ??
      matches.reduce<SupplierFlightOffer | undefined>(
        (best, candidate) =>
          best && compare(offerTotal(best), offerTotal(candidate)) <= 0 ? best : candidate,
        undefined,
      );
    if (!choice) throw new OfferUnavailableError(this.name, 'The flights are no longer offered');
    return this.reprice(choice, signal);
  }

  /**
   * Creates an instant order paid from the Duffel balance. The offer is fetched again for its
   * passenger ids and extras; a fare or bag price that no longer matches what the traveller paid
   * is refused rather than charged. The payment covers the fare and the bags.
   */
  async book(request: FlightBookingRequest, signal: AbortSignal): Promise<FlightBookingResult> {
    const withBags = request.services.length > 0;
    const offer = await this.freshOffer(request.offer, request.passengers.length, signal, withBags);
    const bags = this.orderBags(offer, request);
    const total = add(amount(offer.total_amount, offer.total_currency), bags.total);
    const created = await this.client.request('POST', '/air/orders', signal, {
      data: {
        type: 'instant',
        selected_offers: [offer.id],
        passengers: this.orderPassengers(offer, request.passengers, request.contact),
        ...(withBags ? { services: bags.services } : {}),
        payments: [
          {
            type: 'balance',
            currency: offer.total_currency,
            amount: withBags ? toDecimalString(total) : offer.total_amount,
          },
        ],
        metadata: { suskii_booking_item: request.idempotencyKey },
      },
    });
    const order = this.parseOrder(created);
    return {
      supplierReference: order.booking_reference,
      tickets: this.tickets(order, offer),
      orderId: order.id,
    };
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
      return {
        supplierReference: before.booking_reference,
        tickets: this.tickets(before, null),
        orderId: request.orderId,
      };
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
    return {
      supplierReference: after.booking_reference,
      tickets: this.tickets(after, null),
      orderId: request.orderId,
    };
  }

  /** Unpaid holds cancel free of charge: create the cancellation, then confirm it. */
  override async cancelHold(orderId: string, signal: AbortSignal): Promise<void> {
    const cancellation = await this.createCancellation(orderId, signal);
    await this.confirmCancellation(cancellation.id, signal);
  }

  /**
   * Creates a pending cancellation of a ticketed order: Duffel states what it would refund and
   * until when the offer stands. Nothing is cancelled until it is confirmed (ADR-064).
   */
  override async cancellationQuote(
    request: FlightCancellationRequest,
    signal: AbortSignal,
  ): Promise<FlightCancellationQuote> {
    const cancellation = await this.createCancellation(request.orderId, signal);
    const currency = cancellation.refund_currency ?? request.supplierTotal.currency;
    return {
      quoteId: cancellation.id,
      refund: amount(cancellation.refund_amount ?? '0', currency),
      refundToBalance: cancellation.refund_to === 'balance',
      // Without a stated expiry the quote is treated as short-lived.
      expiresAt: new Date(
        cancellation.expires_at ? Date.parse(cancellation.expires_at) : Date.now() + 5 * 60_000,
      ).toISOString(),
    };
  }

  /**
   * Confirms a pending cancellation. When the confirmation fails or times out, Duffel is asked
   * whether it went through, so a retry never mistakes a done cancellation for a failure.
   */
  override async confirmCancellation(quoteId: string, signal: AbortSignal): Promise<void> {
    const path = `/air/order_cancellations/${encodeURIComponent(quoteId)}`;
    try {
      await this.client.request('POST', `${path}/actions/confirm`, signal);
    } catch (error) {
      const current = await this.client
        .request('GET', path, AbortSignal.timeout(this.supplierTimeoutMs))
        .then((response) => this.parseCancellation(response))
        .catch(() => null);
      if (current?.confirmed_at) return;
      throw error;
    }
  }

  /**
   * One call returns the order's current flights and its airline-initiated changes (ADR-065).
   * A change whose slices cannot be read is still reported, as one to resolve through support.
   */
  override async orderChanges(
    request: AirlineChangesRequest,
    signal: AbortSignal,
  ): Promise<OrderChanges> {
    const response = await this.client.request(
      'GET',
      `/air/orders/${encodeURIComponent(request.orderId)}`,
      signal,
    );
    const parsed = duffelOrderChangesSchema.safeParse(
      (response as { data?: unknown } | null)?.data,
    );
    if (!parsed.success) {
      throw new SupplierUnavailableError(this.name, 'Duffel returned an invalid order');
    }
    const cabinClass = request.offer.cabinClass;
    const slices = orderSlices(parsed.data.slices, cabinClass);
    if (!slices || slices.length === 0) {
      throw new SupplierUnavailableError(this.name, 'Duffel returned an order without flights');
    }
    const changes: AirlineChange[] = [];
    let invalid = 0;
    for (const raw of parsed.data.airline_initiated_changes ?? []) {
      const change = duffelAirlineChangeSchema.safeParse(raw);
      if (!change.success) {
        invalid += 1;
        continue;
      }
      const removed = orderSlices(change.data.removed, cabinClass);
      const added = orderSlices(change.data.added, cabinClass);
      const readable = removed !== null && added !== null;
      changes.push({
        id: change.data.id,
        createdAt: new Date(change.data.created_at).toISOString(),
        // Half a change shows nothing useful: either both sides or neither.
        removed: readable ? removed : [],
        added: readable ? added : [],
        // Nobody should accept what they cannot see.
        acceptable: readable && change.data.available_actions.includes('accept'),
        actionTaken: change.data.action_taken ?? null,
      });
    }
    if (invalid > 0) {
      this.logger.warn({ invalid, orderId: request.orderId }, 'Skipped unreadable airline changes');
    }
    return { slices, changes };
  }

  /**
   * Accepts an airline-initiated change, then reads the order back. When the call fails or times
   * out, the order is read to see whether the change was accepted anyway, so a retry never
   * mistakes a done acceptance for a failure.
   */
  override async acceptAirlineChange(
    request: AirlineChangesRequest & { changeId: string },
    signal: AbortSignal,
  ): Promise<OrderChanges> {
    try {
      await this.client.request(
        'POST',
        `/air/airline_initiated_changes/${encodeURIComponent(request.changeId)}/actions/accept`,
        signal,
      );
    } catch (error) {
      const current = await this.orderChanges(
        request,
        AbortSignal.timeout(this.supplierTimeoutMs),
      ).catch(() => null);
      const accepted = current?.changes.some(
        (change) => change.id === request.changeId && change.actionTaken === 'accepted',
      );
      if (current && accepted) return current;
      throw error;
    }
    return this.orderChanges(request, AbortSignal.timeout(this.supplierTimeoutMs));
  }

  private async createCancellation(
    orderId: string,
    signal: AbortSignal,
  ): Promise<DuffelOrderCancellation> {
    return this.parseCancellation(
      await this.client.request('POST', '/air/order_cancellations', signal, {
        data: { order_id: orderId },
      }),
    );
  }

  private parseCancellation(response: unknown): DuffelOrderCancellation {
    const parsed = duffelOrderCancellationSchema.safeParse(
      (response as { data?: unknown } | null)?.data,
    );
    if (!parsed.success) {
      throw new SupplierUnavailableError(this.name, 'Duffel returned an invalid cancellation');
    }
    return parsed.data;
  }

  private async freshOffer(
    known: SupplierFlightOffer,
    passengerCount: number,
    signal: AbortSignal,
    withServices = false,
  ): Promise<DuffelOffer> {
    const response = await this.client.request(
      'GET',
      `/air/offers/${encodeURIComponent(known.supplierOfferId)}?return_available_services=${withServices}`,
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

  /**
   * The Duffel services for the bags the traveller paid for, by passenger. A bag that is gone,
   * over its limit or at another price than the one paid is refused rather than charged.
   */
  private orderBags(
    offer: DuffelOffer,
    request: FlightBookingRequest,
  ): { services: { id: string; quantity: number }[]; total: Money } {
    const services: { id: string; quantity: number }[] = [];
    let total = zero(offer.total_currency);
    if (request.services.length === 0) return { services, total };
    const bags = checkedBags(offer);
    for (const selection of request.services) {
      const paid = request.offer.services.find((service) => service.id === selection.serviceId);
      const passengerId = offer.passengers[selection.passengerIndex]?.id;
      const bundle =
        paid && passengerId !== undefined ? bags.get(passengerId)?.get(paid.weightKg) : undefined;
      if (!paid || !bundle || selection.quantity < 1 || selection.quantity > bundle.maxQuantity) {
        throw new SupplierRequestError(this.name, 'A bag is no longer offered');
      }
      if (!equals(bundle.unit, paid.price)) {
        throw new SupplierRequestError(this.name, 'A bag changed price after payment');
      }
      for (const id of bundle.serviceIds) services.push({ id, quantity: selection.quantity });
      total = add(total, multiply(bundle.unit, selection.quantity));
    }
    return { services, total };
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
      for (const segment of offer.slices.flatMap((slice) => slice.segments)) {
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
      }
      const slices = offer.slices.map((slice) => toSlice(slice, query.cabinClass));

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
        services: bagServices(offer, query.passengers),
      };
    } catch (error) {
      this.logger.warn({ err: error, offerId: offer.id }, 'Could not map Duffel offer');
      return null;
    }
  }
}
