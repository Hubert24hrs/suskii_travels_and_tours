import { HttpStatus, Injectable } from '@nestjs/common';

import { subtract } from '@suskii/shared';

import { AuditService } from '../audit/audit.service';
import { ProblemDetailsException } from '../common/problem-details';
import { PrismaService } from '../infra/prisma.service';
import { LedgerService, transfer } from '../ledger/ledger.service';

import { BookingFundsService } from './booking-funds.service';
import { itemPayload } from './booking-presenter';
import { isInhouse } from './booking-pricing';
import { BookingTransitions } from './booking-transitions';
import { bookingConflict } from './booking.errors';
import type { BookingDto } from './bookings.schemas';
import { BookingsService, customerActor, type BookingCaller } from './bookings.service';
import { cancellationTerms } from './inhouse-items';
import { PaymentPlansService } from './payment-plans.service';
import { RefundsService } from './refunds.service';

export const notCancellable = (): ProblemDetailsException =>
  new ProblemDetailsException(
    HttpStatus.CONFLICT,
    'not-cancellable',
    'This booking cannot be cancelled online',
    'Contact support to change or cancel it.',
  );

/**
 * Customer cancellation (ADR-018, ADR-028). Unpaid and plan bookings follow their plan policy;
 * confirmed packages, tours and add-ons are cancelled under their policy tiers: the tier's share
 * of what was paid is refunded automatically (non-discretionary, so no maker-checker), the rest is
 * kept as a cancellation fee, and the seats go back on sale. Visa assistance, flights and hotels
 * are cancelled through support once confirmed.
 */
@Injectable()
export class BookingCancellationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bookings: BookingsService,
    private readonly plans: PaymentPlansService,
    private readonly funds: BookingFundsService,
    private readonly ledger: LedgerService,
    private readonly refunds: RefundsService,
    private readonly transitions: BookingTransitions,
    private readonly audit: AuditService,
  ) {}

  async cancel(bookingId: string, caller: BookingCaller): Promise<BookingDto> {
    const booking = await this.bookings.load(bookingId, caller);
    if (booking.status !== 'CONFIRMED') return this.plans.cancel(bookingId, caller);

    const actor = customerActor(caller);
    const refundIds = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM bookings WHERE id = ${booking.id}::uuid FOR UPDATE`;
      const current = await tx.booking.findUniqueOrThrow({ where: { id: booking.id } });
      if (current.status !== 'CONFIRMED') throw bookingConflict();
      const paid = await this.funds.paid(tx, booking);
      const item = booking.items[0];
      const payload = item ? itemPayload(item) : null;
      const terms =
        payload && isInhouse(payload)
          ? cancellationTerms(payload, current.status, paid, new Date())
          : null;
      if (!terms) throw notCancellable();
      const fee = subtract(paid, terms.refund);
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
      if (terms.refund.minor > 0n) {
        await this.transitions.apply(tx, current, 'request_refund', actor, {
          reason: 'customer_cancellation',
        });
        ids = await this.refunds.refundBookingBalance(tx, booking, 'customer_cancellation', {
          amount: terms.refund,
        });
      } else {
        await this.transitions.apply(tx, current, 'withdraw', actor, {
          reason: 'customer_cancellation',
        });
      }
      await this.audit.record(
        {
          action: 'booking.cancelled_under_policy',
          actorUserId: actor.userId ?? null,
          targetType: 'booking',
          targetId: booking.id,
          context: caller.context,
          metadata: {
            refundBps: terms.refundBps,
            refundMinor: terms.refund.minor.toString(),
            feeMinor: fee.minor.toString(),
            currency: booking.currency,
          },
        },
        tx,
      );
      return ids;
    });
    this.refunds.executeLater(refundIds);
    return this.bookings.present(await this.bookings.reload(booking.id));
  }
}
