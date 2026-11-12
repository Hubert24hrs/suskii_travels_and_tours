import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';

import { equals, minOf, money, subtract, toWire, type Money } from '@suskii/shared';

import { AuditService } from '../audit/audit.service';
import { ProblemDetailsException } from '../common/problem-details';
import { PrismaService } from '../infra/prisma.service';
import { REDIS } from '../infra/redis';
import { LedgerService, transfer } from '../ledger/ledger.service';
import { supplierUnavailable } from '../search/search.errors';
import { SupplierRunner } from '../search/supplier-runner';
import { OfferUnavailableError, SupplierRequestError } from '../suppliers/supplier.errors';
import { FLIGHT_SUPPLIERS } from '../suppliers/suppliers.module';
import type { FlightSupplier } from '../suppliers/supplier.types';
import { ErrorReporter } from '../telemetry/error-reporter';

import { BookingFundsService } from './booking-funds.service';
import type { BookingRecord } from './booking-presenter';
import { BookingTransitions } from './booking-transitions';
import { bookingConflict, notCancellable } from './booking.errors';
import type { BookingDto, FlightCancellationQuoteDto } from './bookings.schemas';
import { BookingsService, customerActor, type BookingCaller } from './bookings.service';
import { cancellableFlight, supplierPaid, travellerRefund } from './flight-cancellation';
import { RefundsService } from './refunds.service';

const QUOTE_PREFIX = 'booking:flight-cancellation:';
/** Held while a flight is cancelled online, and by the refund offer (ADR-073), which also cancels. */
export const CANCELLATION_LOCK_PREFIX = 'booking:flight-cancellation-lock:';
/** The longest a refund quote is kept, whatever the supplier allows. */
const QUOTE_MAX_MS = 30 * 60_000;
/** A quote about to lapse is not offered: the traveller needs time to read and confirm it. */
const QUOTE_MIN_MS = 60_000;
/** Covers the supplier's confirmation; a second cancel waits for the first to finish. */
const LOCK_MS = 2 * 60_000;

export const cancellationQuoteExpired = (): ProblemDetailsException =>
  new ProblemDetailsException(
    HttpStatus.CONFLICT,
    'cancellation-quote-expired',
    'The refund quote has expired',
    'Ask for a new refund quote, then cancel.',
  );

/** A refund quote kept until the traveller confirms (or it lapses). Amounts in minor units. */
interface StoredQuote {
  supplier: string;
  quoteId: string;
  supplierRefund: { minor: string; currency: string };
  refund: { minor: string; currency: string };
  expiresAt: string;
}

const fromStored = (value: { minor: string; currency: string }): Money =>
  money(BigInt(value.minor), value.currency);
const toStored = (value: Money): { minor: string; currency: string } => ({
  minor: value.minor.toString(),
  currency: value.currency,
});

/**
 * Online cancellation of ticketed flights (ADR-064). The traveller first asks for a refund quote:
 * the supplier opens a pending cancellation and says what it refunds us, and the traveller's share
 * is kept for the quote's life. Cancelling confirms it with the supplier first, then refunds the
 * traveller through the ledger and the refund pipeline; the rest is kept as a cancellation fee.
 */
@Injectable()
export class FlightCancellationService {
  private readonly logger = new Logger(FlightCancellationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bookings: BookingsService,
    private readonly funds: BookingFundsService,
    private readonly ledger: LedgerService,
    private readonly refunds: RefundsService,
    private readonly transitions: BookingTransitions,
    private readonly audit: AuditService,
    private readonly runner: SupplierRunner,
    private readonly errors: ErrorReporter,
    @Inject(FLIGHT_SUPPLIERS) private readonly suppliers: FlightSupplier[],
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  /** Whether the booking is a flight its traveller can cancel online. */
  cancellable(booking: BookingRecord, now = new Date()): boolean {
    return cancellableFlight(booking, this.suppliers, now) !== null;
  }

  async quote(bookingId: string, caller: BookingCaller): Promise<FlightCancellationQuoteDto> {
    const booking = await this.bookings.load(bookingId, caller);
    const flight = cancellableFlight(booking, this.suppliers, new Date());
    if (!flight) throw notCancellable();
    const { supplier, payload, item, orderId } = flight;
    const supplierTotal = supplierPaid(payload, item);
    let quote;
    try {
      quote = await this.runner.call('flights', supplier.name, 'cancellation-quote', (signal) =>
        supplier.cancellationQuote({ orderId, offer: payload.offer, supplierTotal }, signal),
      );
    } catch (error) {
      // The supplier will not cancel this order online (or it is gone): support takes over.
      if (error instanceof OfferUnavailableError || error instanceof SupplierRequestError) {
        throw notCancellable();
      }
      throw supplierUnavailable();
    }
    const lifetime = Math.min(Date.parse(quote.expiresAt) - Date.now(), QUOTE_MAX_MS);
    // Credits or vouchers are not money we can return, and a refund in another currency than we
    // paid cannot be shared out: both go through support, as does a quote about to lapse.
    if (
      !quote.refundToBalance ||
      quote.refund.currency !== supplierTotal.currency ||
      !(lifetime >= QUOTE_MIN_MS)
    ) {
      throw notCancellable();
    }
    const paid = await this.funds.paid(this.prisma, booking);
    const refund = travellerRefund(paid, quote.refund, supplierTotal);
    const expiresAt = new Date(Date.now() + lifetime).toISOString();
    const stored: StoredQuote = {
      supplier: supplier.name,
      quoteId: quote.quoteId,
      supplierRefund: toStored(quote.refund),
      refund: toStored(refund),
      expiresAt,
    };
    await this.redis.set(QUOTE_PREFIX + booking.id, JSON.stringify(stored), 'PX', lifetime);
    return { refund: toWire(refund), kept: toWire(subtract(paid, refund)), expiresAt };
  }

  /**
   * Cancels under the quote the traveller saw (`expected`, when the client sends it). The
   * supplier cancels first: nothing is refunded unless the airline has cancelled the order.
   */
  async cancel(
    booking: BookingRecord,
    caller: BookingCaller,
    expected: Money | null,
  ): Promise<BookingDto> {
    const flight = cancellableFlight(booking, this.suppliers, new Date());
    if (!flight) throw notCancellable();
    const { supplier } = flight;
    const key = QUOTE_PREFIX + booking.id;
    const raw = await this.redis.get(key);
    const stored = raw ? (JSON.parse(raw) as StoredQuote) : null;
    if (stored?.supplier !== supplier.name || Date.parse(stored.expiresAt) <= Date.now()) {
      throw cancellationQuoteExpired();
    }
    const refund = fromStored(stored.refund);
    if (expected && !equals(expected, refund)) throw cancellationQuoteExpired();

    const lock = CANCELLATION_LOCK_PREFIX + booking.id;
    if ((await this.redis.set(lock, '1', 'PX', LOCK_MS, 'NX')) !== 'OK') throw bookingConflict();
    try {
      try {
        await this.runner.call('flights', supplier.name, 'cancel', (signal) =>
          supplier.confirmCancellation(stored.quoteId, signal),
        );
      } catch (error) {
        if (error instanceof OfferUnavailableError || error instanceof SupplierRequestError) {
          await this.redis.del(key);
          throw cancellationQuoteExpired();
        }
        throw supplierUnavailable();
      }
      const refundIds = await this.settle(booking, caller, stored).catch((error: unknown) => {
        // The airline has cancelled; the booking must follow. Staff reconcile it from here.
        this.logger.error(
          { bookingId: booking.id, reason: (error as Error).name },
          'Flight cancelled with the supplier but not on the booking',
        );
        void this.errors.capture(error);
        throw error;
      });
      await this.redis.del(key);
      this.refunds.executeLater(refundIds);
    } finally {
      await this.redis.del(lock);
    }
    return this.bookings.present(await this.bookings.reload(booking.id));
  }

  /** The traveller's share back through the refund pipeline, the rest kept as a fee. */
  private settle(
    booking: BookingRecord,
    caller: BookingCaller,
    stored: StoredQuote,
  ): Promise<string[]> {
    const actor = customerActor(caller);
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM bookings WHERE id = ${booking.id}::uuid FOR UPDATE`;
      const current = await tx.booking.findUniqueOrThrow({ where: { id: booking.id } });
      if (current.status !== 'CONFIRMED') throw bookingConflict();
      const paid = await this.funds.paid(tx, booking);
      const refund = minOf(fromStored(stored.refund), paid);
      const fee = subtract(paid, refund);
      if (fee.minor > 0n) {
        await this.ledger.post(tx, {
          key: `booking:${booking.id}:cancellation-fee`,
          kind: 'cancellation_fee',
          bookingId: booking.id,
          lines: transfer(
            { kind: 'booking', bookingId: booking.id, currency: booking.currency },
            { kind: 'cancellation-fees', currency: booking.currency },
            fee,
          ),
        });
      }
      let ids: string[] = [];
      if (refund.minor > 0n) {
        await this.transitions.apply(tx, current, 'request_refund', actor, {
          reason: 'customer_cancellation',
        });
        ids = await this.refunds.refundBookingBalance(tx, booking, 'customer_cancellation', {
          amount: refund,
        });
      } else {
        await this.transitions.apply(tx, current, 'withdraw', actor, {
          reason: 'customer_cancellation',
        });
      }
      await this.audit.record(
        {
          action: 'booking.flight_cancelled',
          actorUserId: actor.userId ?? null,
          targetType: 'booking',
          targetId: booking.id,
          context: caller.context,
          metadata: {
            supplier: stored.supplier,
            supplierRefundMinor: stored.supplierRefund.minor,
            supplierCurrency: stored.supplierRefund.currency,
            refundMinor: refund.minor.toString(),
            feeMinor: fee.minor.toString(),
            currency: booking.currency,
          },
        },
        tx,
      );
      return ids;
    });
  }
}
