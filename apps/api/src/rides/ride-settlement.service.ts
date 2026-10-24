import { Injectable } from '@nestjs/common';

import {
  driverShare,
  minOf,
  money,
  multiplyRatio,
  subtract,
  zero,
  type Money,
} from '@suskii/shared';

import { BookingFundsService } from '../bookings/booking-funds.service';
import { BookingTransitions, type BookingActor } from '../bookings/booking-transitions';
import type { RideItemPayload } from '../bookings/inhouse-items';
import { RefundsService } from '../bookings/refunds.service';
import type { Prisma } from '../generated/prisma/client';
import { LedgerService, type LedgerLine } from '../ledger/ledger.service';

type Tx = Prisma.TransactionClient;

interface BookingRef {
  id: string;
  status: Prisma.BookingGetPayload<object>['status'];
  currency: string;
}

export interface CancellationOutcome {
  fee: Money;
  refund: Money;
  refundIds: string[];
}

/**
 * Money at the end of a ride (ADR-051), always in the caller's transaction and through the
 * ledger: completion moves the paid fare out of the booking account to the driver's earnings
 * and the platform's commission; a rider's late cancellation keeps the fee (shared with the
 * driver who came) and refunds the rest; no driver found, or a staff cancellation, refunds all.
 */
@Injectable()
export class RideSettlementService {
  constructor(
    private readonly ledger: LedgerService,
    private readonly refunds: RefundsService,
    private readonly transitions: BookingTransitions,
    private readonly funds: BookingFundsService,
  ) {}

  /**
   * The driver earns their share of the metered fare (the booking fee and VAT stay with the
   * platform), in the booking's currency. Returns the earnings posted.
   */
  async complete(
    tx: Tx,
    ride: { id: string; driverId: string | null },
    payload: RideItemPayload,
    booking: BookingRef,
  ): Promise<Money> {
    const paid = await this.funds.paid(tx, booking);
    if (paid.minor <= 0n || !ride.driverId) return zero(booking.currency);
    const total = payload.fare.total.minor;
    const metered = total - payload.fare.bookingFee.minor;
    const earnings =
      total > 0n && metered > 0n
        ? multiplyRatio(
            paid,
            metered * BigInt(payload.rule.driverShareBps),
            total * 10_000n,
            'floor',
          )
        : zero(booking.currency);
    const commission = subtract(paid, earnings);
    await this.ledger.post(tx, {
      key: `ride:${ride.id}:completed`,
      kind: 'ride_earnings',
      bookingId: booking.id,
      lines: split(booking, paid, [
        [
          { kind: 'driver-earnings', driverId: ride.driverId, currency: booking.currency },
          earnings,
        ],
        [{ kind: 'ride-commission', currency: booking.currency }, commission],
      ]),
    });
    return earnings;
  }

  /** What a rider's cancellation would keep now (never more than was paid). */
  async previewCancellation(tx: Tx, booking: BookingRef, fee: Money): Promise<CancellationOutcome> {
    const paid = await this.funds.paid(tx, booking);
    const kept = minOf(money(fee.minor, paid.currency), paid);
    return { fee: kept, refund: subtract(paid, kept), refundIds: [] };
  }

  async riderCancelled(
    tx: Tx,
    ride: { id: string; driverId: string | null },
    payload: RideItemPayload,
    booking: BookingRef,
    fee: Money,
    actor: BookingActor,
  ): Promise<CancellationOutcome> {
    const outcome = await this.previewCancellation(tx, booking, fee);
    if (outcome.fee.minor > 0n) {
      // The driver who was on the way gets their share of the fee.
      const share = ride.driverId
        ? driverShare(outcome.fee, payload.rule.driverShareBps)
        : zero(booking.currency);
      await this.ledger.post(tx, {
        key: `ride:${ride.id}:cancellation-fee`,
        kind: 'cancellation_fee',
        bookingId: booking.id,
        lines: split(booking, outcome.fee, [
          ...(ride.driverId
            ? ([
                [
                  { kind: 'driver-earnings', driverId: ride.driverId, currency: booking.currency },
                  share,
                ],
              ] as const)
            : []),
          [{ kind: 'cancellation-fees', currency: booking.currency }, subtract(outcome.fee, share)],
        ]),
      });
    }
    let refundIds: string[] = [];
    if (outcome.refund.minor > 0n) {
      await this.transitions.apply(tx, booking, 'request_refund', actor, {
        reason: 'ride_cancelled',
      });
      refundIds = await this.refunds.refundBookingBalance(tx, booking, 'customer_cancellation', {
        amount: outcome.refund,
      });
    } else {
      await this.transitions.apply(tx, booking, 'withdraw', actor, { reason: 'ride_cancelled' });
    }
    return { ...outcome, refundIds };
  }

  /** No driver came, or staff stopped the ride: everything paid goes back. */
  async refundInFull(
    tx: Tx,
    booking: BookingRef,
    reason: 'no_driver_found' | 'staff_cancelled',
    actor: BookingActor,
  ): Promise<string[]> {
    const paid = await this.funds.paid(tx, booking);
    if (paid.minor <= 0n) {
      await this.transitions.apply(tx, booking, 'withdraw', actor, { reason });
      return [];
    }
    await this.transitions.apply(tx, booking, 'request_refund', actor, { reason });
    return this.refunds.refundBookingBalance(tx, booking, 'supplier_cancellation');
  }
}

type Target = Parameters<LedgerService['post']>[1]['lines'][number]['account'];

/** A debit of `amount` from the booking against credits to the targets (zero ones skipped). */
function split(
  booking: { id: string; currency: string },
  amount: Money,
  targets: readonly (readonly [Target, Money])[],
): LedgerLine[] {
  return [
    {
      account: { kind: 'booking', bookingId: booking.id, currency: booking.currency },
      direction: 'debit',
      amount,
    },
    ...targets
      .filter(([, value]) => value.minor > 0n)
      .map(([account, value]): LedgerLine => ({ account, direction: 'credit', amount: value })),
  ];
}
