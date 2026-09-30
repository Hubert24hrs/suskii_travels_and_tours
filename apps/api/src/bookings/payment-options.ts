import {
  installmentSchedule,
  toWire,
  type InstallmentPolicy,
  type InstallmentSchedule,
  type Money,
} from '@suskii/shared';

import type { AppConfig } from '../config/config';

import type { ItemPayload } from './booking-pricing';
import type { PaymentOptionsDto } from './bookings.schemas';

const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;

export interface PlanPolicy {
  /** Packages: the balance is due this long before departure (ADR-028). */
  packageBalanceDueMs: number;
  holdMinWindowMs: number;
  holdSafetyMarginMs: number;
  graceHours: number;
  defaultFeeBps: number;
  installment: InstallmentPolicy;
}

export function planPolicy(config: AppConfig): PlanPolicy {
  return {
    packageBalanceDueMs: config.PACKAGE_BALANCE_DUE_DAYS * 24 * HOUR_MS,
    holdMinWindowMs: config.HOLD_MIN_WINDOW_HOURS * HOUR_MS,
    holdSafetyMarginMs: config.HOLD_SAFETY_MARGIN_MINUTES * MINUTE_MS,
    graceHours: config.INSTALLMENT_GRACE_HOURS,
    defaultFeeBps: config.INSTALLMENT_DEFAULT_FEE_BPS,
    installment: {
      depositBps: config.INSTALLMENT_DEPOSIT_BPS,
      maxInstallments: config.INSTALLMENT_MAX_COUNT,
      feeBps: config.INSTALLMENT_FEE_BPS,
      minSpacingHours: config.INSTALLMENT_MIN_SPACING_HOURS,
    },
  };
}

export interface HoldTerms {
  /** The supplier's payment deadline. */
  paymentRequiredBy: Date;
  priceGuaranteedUntil: Date | null;
}

export interface PlanOptions {
  hold: { deadline: Date; total: Money } | null;
  installments: { deadline: Date; schedule: InstallmentSchedule } | null;
}

const NONE: PlanOptions = { hold: null, installments: null };

/**
 * The hold terms of an item, if it can be held at all: the airline's for flights; for packages,
 * our own seats until the balance-due date before departure, at a price we guarantee (ADR-028).
 */
export function holdTerms(payload: ItemPayload, policy: PlanPolicy): HoldTerms | null {
  if (payload.kind === 'package') {
    const due = new Date(
      new Date(`${payload.startDate}T00:00:00.000Z`).getTime() - policy.packageBalanceDueMs,
    );
    return { paymentRequiredBy: due, priceGuaranteedUntil: due };
  }
  if (payload.kind !== 'flight') return null;
  const { hold } = payload.offer;
  if (!hold.available || !hold.paymentRequiredBy) return null;
  return {
    paymentRequiredBy: new Date(hold.paymentRequiredBy),
    priceGuaranteedUntil: hold.priceGuaranteedUntil ? new Date(hold.priceGuaranteedUntil) : null,
  };
}

/**
 * Which flexible payment plans an item allows (ADR-018): a hold when the supplier's deadline,
 * less a safety margin, leaves enough time; installments when the airline also guarantees the
 * price for the whole plan and at least one installment fits after the deposit.
 */
export function planOptions(
  terms: HoldTerms | null,
  total: Money,
  hasExtras: boolean,
  policy: PlanPolicy,
  now: Date,
): PlanOptions {
  if (!terms || hasExtras) return NONE;
  const deadline = new Date(terms.paymentRequiredBy.getTime() - policy.holdSafetyMarginMs);
  if (deadline.getTime() - now.getTime() < policy.holdMinWindowMs) return NONE;
  const hold = { deadline, total };

  const guaranteed =
    terms.priceGuaranteedUntil !== null &&
    terms.priceGuaranteedUntil.getTime() >= deadline.getTime();
  if (!guaranteed) return { hold, installments: null };
  const lastDueBy = new Date(deadline.getTime() - policy.graceHours * HOUR_MS);
  const schedule = installmentSchedule(total, now, lastDueBy, policy.installment);
  return { hold, installments: schedule ? { deadline, schedule } : null };
}

/** The wire shape shared by quotes and bookings. */
export function paymentOptionsDto(
  providers: PaymentOptionsDto['providers'],
  plans: PlanOptions,
  policy: PlanPolicy,
  wallet: Money | null,
): PaymentOptionsDto {
  return {
    providers,
    hold: plans.hold
      ? { deadline: plans.hold.deadline.toISOString(), total: toWire(plans.hold.total) }
      : null,
    installments: plans.installments
      ? {
          deadline: plans.installments.deadline.toISOString(),
          total: toWire(plans.installments.schedule.total),
          fee: toWire(plans.installments.schedule.fee),
          graceHours: policy.graceHours,
          defaultFeeBps: policy.defaultFeeBps,
          schedule: plans.installments.schedule.payments.map((payment) => ({
            sequence: payment.sequence,
            dueAt: payment.dueAt.toISOString(),
            amount: toWire(payment.amount),
          })),
        }
      : null,
    wallet: wallet ? toWire(wallet) : null,
  };
}
