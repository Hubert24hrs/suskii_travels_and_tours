import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';

import { money, type ContactDetails, type Gender, type PassengerTitle } from '@suskii/shared';

import { AuditService } from '../audit/audit.service';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { FieldEncryption } from '../crypto/field-encryption';
import { randomToken } from '../crypto/random';
import { documentDateTime, documentMoney } from '../documents/booking-pdf';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../infra/prisma.service';
import { REDIS } from '../infra/redis';
import { EmailProvider } from '../notifications/email';
import { bookingConfirmedTemplate } from '../notifications/templates';
import { SupplierRunner } from '../search/supplier-runner';
import {
  CircuitOpenError,
  OfferUnavailableError,
  SupplierError,
  SupplierRequestError,
  SupplierTimeoutError,
  SupplierUnavailableError,
} from '../suppliers/supplier.errors';
import type { FlightSupplier, HotelSupplier, SupplierPassenger } from '../suppliers/supplier.types';
import { FLIGHT_SUPPLIERS, HOTEL_SUPPLIERS } from '../suppliers/suppliers.module';

import { BookingDocumentsService } from './booking-documents.service';
import { BookingNotifications } from './booking-notifications';
import {
  itemPayload,
  itemServices,
  type BookingItemRecord,
  type BookingRecord,
} from './booking-presenter';
import {
  bookedRate,
  isInhouse,
  type ItemPayload,
  type SupplierItemPayload,
} from './booking-pricing';
import { InhouseFulfilment } from './inhouse-fulfilment';
import { inhouseSummary } from './inhouse-presenter';
import { BookingTransitions, SYSTEM_ACTOR } from './booking-transitions';
import { BookingsService, passportContext } from './bookings.service';
import { bookingUrl } from './booking-urls';
import { RefundsService } from './refunds.service';
import { ticketingAttempts } from '../telemetry/metrics';

export type TicketingOutcome = 'confirmed' | 'retrying' | 'exhausted' | 'skipped';

const LOCK_TTL_MS = 5 * 60_000;
/** PAID bookings are normally ticketed right after the webhook; the worker picks up stragglers. */
const PAID_PICKUP_AFTER_MS = 60_000;
/** A TICKETING booking without a retry time and untouched this long lost its worker mid-attempt. */
const STALLED_AFTER_MS = 10 * 60_000;
/** A sweep starts no new attempt after this long (one attempt can still take a booking timeout). */
const SWEEP_BUDGET_MS = 20_000;

const RELEASE_LOCK = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end`;

/** Reason codes for the audit log; never supplier messages (they can echo passenger data). */
function failureReason(error: unknown): string {
  if (error instanceof CircuitOpenError) return 'circuit_open';
  if (error instanceof SupplierTimeoutError) return 'timeout';
  if (error instanceof SupplierUnavailableError) return 'supplier_unavailable';
  if (error instanceof OfferUnavailableError) return 'offer_unavailable';
  if (error instanceof SupplierRequestError) return 'supplier_rejected';
  return 'internal_error';
}

/**
 * Books paid bookings with the supplier (ADR-014 step 5). The booking item id is the supplier
 * idempotency key, so a retry can never issue twice. Transient failures retry with exponential
 * backoff (1, 2, 4, 8, 16 minutes); definitive failures, an exhausted budget, or an ambiguous
 * failure with a supplier that cannot retry safely move the booking to REFUND_PENDING.
 */
@Injectable()
export class TicketingService {
  private readonly logger = new Logger(TicketingService.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(FLIGHT_SUPPLIERS) private readonly flightSuppliers: FlightSupplier[],
    @Inject(HOTEL_SUPPLIERS) private readonly hotelSuppliers: HotelSupplier[],
    private readonly prisma: PrismaService,
    private readonly runner: SupplierRunner,
    private readonly encryption: FieldEncryption,
    private readonly bookings: BookingsService,
    private readonly transitions: BookingTransitions,
    private readonly audit: AuditService,
    private readonly documents: BookingDocumentsService,
    private readonly email: EmailProvider,
    private readonly refunds: RefundsService,
    private readonly notifications: BookingNotifications,
    private readonly fulfilment: InhouseFulfilment,
  ) {}

  /** One ticketing attempt for a booking, if it is due. Safe to call concurrently. */
  async process(bookingId: string, now = new Date()): Promise<TicketingOutcome> {
    const key = `lock:booking-ticketing:${bookingId}`;
    const token = randomToken(16);
    const acquired = await this.redis.set(key, token, 'PX', LOCK_TTL_MS, 'NX');
    if (acquired !== 'OK') return 'skipped';
    try {
      const outcome = await this.attempt(bookingId, now);
      if (outcome !== 'skipped') ticketingAttempts.add(1, { outcome });
      return outcome;
    } finally {
      await this.redis.eval(RELEASE_LOCK, 1, key, token);
    }
  }

  /** Every booking due for a (re)try; used by the worker every minute. */
  async processDue(now = new Date()): Promise<Record<TicketingOutcome | 'attempted', number>> {
    const due = await this.prisma.booking.findMany({
      where: {
        OR: [
          {
            status: 'PAID',
            updatedAt: { lt: new Date(now.getTime() - PAID_PICKUP_AFTER_MS) },
            // Held by a payment risk review until staff decide (ADR-040).
            riskReviews: { none: { status: 'open' } },
          },
          { status: 'TICKETING', nextTicketingAt: { lte: now } },
          {
            status: 'TICKETING',
            nextTicketingAt: null,
            updatedAt: { lt: new Date(now.getTime() - STALLED_AFTER_MS) },
          },
        ],
      },
      select: { id: true },
      orderBy: { updatedAt: 'asc' },
      take: 20,
    });
    const counts = { attempted: 0, confirmed: 0, retrying: 0, exhausted: 0, skipped: 0 };
    // Keeps the worker's HTTP call bounded: what is left waits for the next sweep a minute later.
    const stopStartingAt = Date.now() + SWEEP_BUDGET_MS;
    for (const { id } of due) {
      if (Date.now() > stopStartingAt) break;
      const outcome = await this.process(id);
      counts[outcome] += 1;
      if (outcome !== 'skipped') counts.attempted += 1;
    }
    return counts;
  }

  private async attempt(bookingId: string, now: Date): Promise<TicketingOutcome> {
    let booking = await this.bookings.reload(bookingId);
    if (booking.status === 'PAID') {
      const held = await this.prisma.paymentRiskReview.count({
        where: { bookingId, status: 'open' },
      });
      if (held > 0) return 'skipped';
      const paid = booking;
      await this.prisma.$transaction((tx) =>
        this.transitions.apply(tx, paid, 'start_ticketing', SYSTEM_ACTOR),
      );
      booking = await this.bookings.reload(bookingId);
    }
    if (booking.status !== 'TICKETING') return 'skipped';
    if (booking.nextTicketingAt && booking.nextTicketingAt > now) return 'skipped';

    const attempt = booking.ticketingAttempts + 1;
    await this.prisma.booking.update({
      where: { id: booking.id },
      data: { ticketingAttempts: attempt, nextTicketingAt: null },
    });
    const contact = this.bookings.contact(booking);
    for (const item of booking.items) {
      // Held items already carry the airline reference; `bookedAt` marks them ticketed.
      if (item.bookedAt) continue;
      const payload = itemPayload(item);
      // Our own products are fulfilled with the confirmation itself, below.
      if (isInhouse(payload)) continue;
      try {
        const result = await this.bookItem(booking, item, payload, contact);
        await this.prisma.bookingItem.update({
          where: { id: item.id },
          data: {
            supplierReference: result.reference,
            ticketNumbers: result.tickets ?? Prisma.DbNull,
            bookedAt: new Date(),
          },
        });
      } catch (error) {
        return this.failed(booking, item, attempt, error, now);
      }
    }

    await this.prisma.$transaction(async (tx) => {
      for (const item of booking.items) {
        const payload = itemPayload(item);
        if (isInhouse(payload)) await this.fulfilment.fulfil(tx, booking, item, payload);
      }
      await this.transitions.apply(
        tx,
        { id: booking.id, status: 'TICKETING' },
        'ticketed',
        SYSTEM_ACTOR,
        {
          data: { confirmedAt: new Date(), nextTicketingAt: null },
        },
      );
    });
    await this.confirm(booking.id);
    return 'confirmed';
  }

  private async bookItem(
    booking: BookingRecord,
    item: BookingItemRecord,
    payload: SupplierItemPayload,
    contact: ContactDetails,
  ): Promise<{ reference: string; tickets: { passengerIndex: number; number: string }[] | null }> {
    const timeout = this.config.SUPPLIER_BOOKING_TIMEOUT_MS;
    if (payload.kind === 'flight' && item.supplierOrderId) {
      // A held order (ADR-018): pay it instead of creating a new one.
      const supplier = this.flightSupplier(payload);
      const orderId = item.supplierOrderId;
      const result = await this.runner.call(
        'flights',
        supplier.name,
        'pay-held',
        (signal) =>
          supplier.payHeld(
            { orderId, price: payload.offer.price, idempotencyKey: item.id },
            signal,
          ),
        timeout,
      );
      return { reference: result.supplierReference, tickets: result.tickets };
    }
    if (payload.kind === 'flight') {
      const supplier = this.flightSupplier(payload);
      const passengers = this.supplierPassengers(booking);
      const result = await this.runner.call(
        'flights',
        supplier.name,
        'book',
        (signal) =>
          supplier.book(
            {
              offer: payload.offer,
              passengers,
              contact,
              services: itemServices(item).map(({ serviceId, passengerIndex, quantity }) => ({
                serviceId,
                passengerIndex,
                quantity,
              })),
              idempotencyKey: item.id,
            },
            signal,
          ),
        timeout,
      );
      return { reference: result.supplierReference, tickets: result.tickets };
    }
    const supplier = this.hotelSupplier(payload);
    const result = await this.runner.call(
      'hotels',
      supplier.name,
      'book',
      (signal) =>
        supplier.book(
          {
            hotel: payload.hotel,
            rate: bookedRate(payload),
            query: payload.query,
            guests: booking.passengers.map(({ givenNames, surname }) => ({ givenNames, surname })),
            contact,
            idempotencyKey: item.id,
          },
          signal,
        ),
      timeout,
    );
    return { reference: result.confirmationNumber, tickets: null };
  }

  /** Passengers as suppliers need them, passports decrypted in memory only. */
  supplierPassengers(booking: BookingRecord): SupplierPassenger[] {
    return booking.passengers.map((passenger) => this.supplierPassenger(passenger));
  }

  private supplierPassenger(passenger: BookingRecord['passengers'][number]): SupplierPassenger {
    const date = (value: Date | null): string => value?.toISOString().slice(0, 10) ?? '';
    return {
      type: passenger.type,
      title: passenger.title as PassengerTitle,
      gender: passenger.gender as Gender,
      givenNames: passenger.givenNames,
      surname: passenger.surname,
      dateOfBirth: date(passenger.dateOfBirth),
      nationality: passenger.nationality ?? '',
      document:
        passenger.passportEncrypted && passenger.issuingCountry && passenger.documentExpiry
          ? {
              number: this.encryption.decrypt(
                passenger.passportEncrypted,
                passportContext('booking-passenger', passenger.id),
              ),
              issuingCountry: passenger.issuingCountry,
              expiryDate: date(passenger.documentExpiry),
            }
          : null,
    };
  }

  private flightSupplier(payload: Extract<ItemPayload, { kind: 'flight' }>): FlightSupplier {
    const supplier = this.flightSuppliers.find((s) => s.name === payload.offer.supplier);
    if (!supplier) throw new SupplierRequestError(payload.offer.supplier, 'Supplier is disabled');
    return supplier;
  }

  private hotelSupplier(payload: Extract<ItemPayload, { kind: 'hotel' }>): HotelSupplier {
    const supplier = this.hotelSuppliers.find((s) => s.name === payload.hotel.supplier);
    if (!supplier) throw new SupplierRequestError(payload.hotel.supplier, 'Supplier is disabled');
    return supplier;
  }

  private async failed(
    booking: BookingRecord,
    item: BookingItemRecord,
    attempt: number,
    error: unknown,
    now: Date,
  ): Promise<TicketingOutcome> {
    const payload = itemPayload(item);
    const idempotent =
      payload.kind === 'flight'
        ? this.flightSuppliers.find((s) => s.name === payload.offer.supplier)?.idempotentBooking
        : payload.kind === 'hotel'
          ? this.hotelSuppliers.find((s) => s.name === payload.hotel.supplier)?.idempotentBooking
          : true;
    const transient =
      error instanceof SupplierUnavailableError || error instanceof CircuitOpenError;
    // A timeout or an internal failure may have booked anyway: retry only when that is harmless.
    const ambiguous = error instanceof SupplierTimeoutError || !(error instanceof SupplierError);
    const retryable = transient || (ambiguous && idempotent === true);
    const reason =
      ambiguous && !retryable ? `${failureReason(error)}_needs_review` : failureReason(error);
    this.logger.warn({ bookingId: booking.id, attempt, reason }, 'ticketing attempt failed');

    if (retryable && attempt < this.config.TICKETING_MAX_ATTEMPTS) {
      const retryAt = new Date(now.getTime() + 2 ** (attempt - 1) * 60_000);
      await this.prisma.$transaction(async (tx) => {
        await tx.booking.update({ where: { id: booking.id }, data: { nextTicketingAt: retryAt } });
        await this.audit.record(
          {
            action: 'booking.ticketing_failed',
            actorType: 'system',
            targetType: 'booking',
            targetId: booking.id,
            metadata: { attempt, reason, retryAt: retryAt.toISOString() },
          },
          tx,
        );
      });
      return 'retrying';
    }

    // Payment succeeded but nothing was issued: refund automatically, unless the airline may have
    // issued tickets after all (ambiguous failure), where operations check first (ADR-019).
    const needsReview = reason.endsWith('_needs_review');
    const refundIds = await this.prisma.$transaction(async (tx) => {
      await this.transitions.apply(
        tx,
        { id: booking.id, status: 'TICKETING' },
        'ticketing_exhausted',
        SYSTEM_ACTOR,
        { reason, data: { nextTicketingAt: null } },
      );
      await this.audit.record(
        {
          action: 'booking.ticketing_failed',
          actorType: 'system',
          targetType: 'booking',
          targetId: booking.id,
          metadata: { attempt, reason, final: true },
        },
        tx,
      );
      return this.refunds.refundBookingBalance(tx, booking, 'ticketing_failed', {
        needsApproval: needsReview,
      });
    });
    if (!needsReview) this.refunds.executeLater(refundIds);
    await this.notifications.ops(
      needsReview ? 'ticketing.needs_review' : 'ticketing.failed_refunding',
      booking.reference,
      {
        bookingId: booking.id,
        reason,
        attempt: String(attempt),
        refunds: String(refundIds.length),
      },
    );
    await this.releaseHold(item, payload);
    return 'exhausted';
  }

  /** A held order that will not be paid any more is released at the airline (best effort). */
  private async releaseHold(item: BookingItemRecord, payload: ItemPayload): Promise<void> {
    if (payload.kind !== 'flight' || !item.supplierOrderId || item.bookedAt) return;
    const supplier = this.flightSuppliers.find((s) => s.name === payload.offer.supplier);
    const orderId = item.supplierOrderId;
    if (!supplier) return;
    try {
      await this.runner.call('flights', supplier.name, 'cancel-hold', (signal) =>
        supplier.cancelHold(orderId, signal),
      );
    } catch (error) {
      this.logger.warn(
        { itemId: item.id, reason: failureReason(error) },
        'releasing the hold failed',
      );
    }
  }

  /** Documents and the confirmation email. Failures are logged; the booking stays confirmed. */
  private async confirm(bookingId: string): Promise<void> {
    try {
      await this.sendConfirmationEmail(bookingId);
      await this.notifications.confirmed(bookingId);
    } catch (error) {
      this.logger.error(
        { bookingId, reason: (error as Error).name },
        'booking documents or confirmation email failed',
      );
    }
  }

  /**
   * The confirmation email with the booking's documents attached (created if missing). Staff
   * resend it from the admin console; it throws when the email cannot be sent.
   */
  async sendConfirmationEmail(bookingId: string): Promise<void> {
    const documents = await this.documents.ensure(bookingId);
    const booking = await this.bookings.reload(bookingId);
    const item = booking.items[0];
    if (!item) return;
    const payload = itemPayload(item);
    const contact = this.bookings.contact(booking);
    const template = bookingConfirmedTemplate({
      reference: booking.reference,
      vertical: booking.vertical,
      summary: summaryOf(payload),
      supplierLabel: supplierLabel(payload),
      supplierReference: item.supplierReference ?? '',
      total: documentMoney(money(booking.totalMinor, booking.currency)),
      bookingUrl: booking.userId ? bookingUrl(this.config, booking.id) : null,
    });
    await this.email.send({
      to: contact.email,
      ...template,
      attachments: documents.map((document) => ({
        filename: document.fileName,
        content: document.bytes,
        contentType: document.contentType,
      })),
    });
  }
}

function supplierLabel(payload: ItemPayload): string | null {
  if (payload.kind === 'flight') return 'Airline booking reference';
  if (payload.kind === 'hotel') return 'Hotel confirmation number';
  return null;
}

function summaryOf(payload: ItemPayload): string {
  if (isInhouse(payload)) return inhouseSummary(payload);
  if (payload.kind === 'hotel') {
    return `${payload.hotel.name}, ${payload.hotel.cityName}, ${documentDateTime(
      payload.request.checkIn,
    )} to ${documentDateTime(payload.request.checkOut)}`;
  }
  const first = payload.offer.slices[0];
  if (!first) return '';
  const place = (point: { code: string; cityName: string | null }) =>
    `${point.cityName ?? point.code} (${point.code})`;
  return `${place(first.origin)} to ${place(first.destination)}, ${documentDateTime(
    first.departureLocal,
  )}`;
}
