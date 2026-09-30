import { Inject, Injectable } from '@nestjs/common';

import { minOf, money, subtract, type Money } from '@suskii/shared';

import { APP_CONFIG, type AppConfig } from '../config/config';
import type { BookingStatus, Prisma } from '../generated/prisma/client';
import { PrismaService } from '../infra/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { PaymentProviders } from '../payments/payment-providers';

import {
  itemPayload,
  itemServices,
  pendingPrice,
  type BookingMoney,
  type BookingRecord,
} from './booking-presenter';
import {
  holdTerms,
  paymentOptionsDto,
  planOptions,
  planPolicy,
  type PlanOptions,
} from './payment-options';

type Db = Prisma.TransactionClient | PrismaService;

/** Statuses in which the traveller can start a payment. */
export const PAYABLE_STATUSES: readonly BookingStatus[] = [
  'PRICED',
  'AWAITING_PAYMENT',
  'HELD',
  'PARTIALLY_PAID',
];

type PlanRecord = NonNullable<BookingRecord['paymentPlan']>;

/**
 * What a booking has paid, what it still owes and how it can pay, from the ledger (ADR-017) and
 * the payment plan (ADR-018).
 */
@Injectable()
export class BookingFundsService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly providers: PaymentProviders,
  ) {}

  /** Customer money held for the booking (payments in, refunds and kept fees out). */
  paid(db: Db, booking: { id: string; currency: string }): Promise<Money> {
    return this.ledger.balance(db, {
      kind: 'booking',
      bookingId: booking.id,
      currency: booking.currency,
    });
  }

  /** Everything the traveller pays: the plan total (fee included) or the booking total. */
  required(
    booking: Pick<BookingRecord, 'totalMinor' | 'currency'>,
    plan: PlanRecord | null,
  ): Money {
    return plan
      ? money(plan.totalMinor, plan.currency)
      : money(booking.totalMinor, booking.currency);
  }

  /** The next payment: the next installment (capped at what is left) or the whole balance. */
  amountDue(booking: BookingRecord, paid: Money): Money | null {
    if (!PAYABLE_STATUSES.includes(booking.status) || pendingPrice(booking)) return null;
    const plan = booking.paymentPlan?.status === 'active' ? booking.paymentPlan : null;
    const remaining = subtract(this.required(booking, plan), paid);
    if (remaining.minor <= 0n) return null;
    const next = plan?.installments.find((installment) => installment.status === 'pending');
    return next ? minOf(money(next.amountMinor, next.currency), remaining) : remaining;
  }

  /** Plans an unpaid, un-held booking could still switch to. */
  planOptions(booking: BookingRecord, now = new Date()): PlanOptions {
    const item = booking.items[0];
    if (booking.status !== 'PRICED' || booking.paymentPlan || !item || pendingPrice(booking)) {
      return { hold: null, installments: null };
    }
    const policy = planPolicy(this.config);
    return planOptions(
      holdTerms(itemPayload(item), policy),
      money(booking.totalMinor, booking.currency),
      itemServices(item).length > 0,
      policy,
      now,
    );
  }

  async forBooking(booking: BookingRecord, now = new Date()): Promise<BookingMoney> {
    const paid = await this.paid(this.prisma, booking);
    const amountDue = this.amountDue(booking, paid);
    if (!amountDue) return { paid, amountDue, options: null };
    const wallet = booking.userId
      ? await this.ledger.balance(this.prisma, {
          kind: 'wallet',
          userId: booking.userId,
          currency: booking.currency,
        })
      : null;
    return {
      paid,
      amountDue,
      options: paymentOptionsDto(
        this.providers.options(booking.currency),
        this.planOptions(booking, now),
        planPolicy(this.config),
        wallet,
      ),
    };
  }
}
