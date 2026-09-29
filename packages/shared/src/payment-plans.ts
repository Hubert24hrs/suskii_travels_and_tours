import {
  add,
  allocate,
  currencyExponent,
  money,
  percentageOf,
  roundDiv,
  subtract,
  type Money,
} from './money';

/** Flexible payment modes (ADR-018). */
export const PAYMENT_PLAN_KINDS = ['hold', 'installments'] as const;
export type PaymentPlanKind = (typeof PAYMENT_PLAN_KINDS)[number];

/** Hosted-checkout payment providers the platform can route to (ADR-016). */
export const PAYMENT_PROVIDER_NAMES = ['mock', 'paystack', 'flutterwave', 'stripe'] as const;
export type PaymentProviderName = (typeof PAYMENT_PROVIDER_NAMES)[number];

export const REFUND_STATUSES = [
  'pending_approval',
  'approved',
  'processing',
  'succeeded',
  'failed',
  'rejected',
  'needs_review',
] as const;
export type RefundStatus = (typeof REFUND_STATUSES)[number];

/** Fixed reason codes: never free text in audit metadata (ADR-019). */
export const REFUND_REASONS = [
  'duplicate_payment',
  'amount_mismatch',
  'late_payment',
  'ticketing_failed',
  'installment_default',
  'customer_cancellation',
  'goodwill',
  'supplier_cancellation',
  'other',
] as const;
export type RefundReason = (typeof REFUND_REASONS)[number];

export const REFUND_DESTINATIONS = ['original', 'wallet'] as const;
export type RefundDestination = (typeof REFUND_DESTINATIONS)[number];

export interface InstallmentPolicy {
  /** Share of the total due now, in basis points (3000 = 30%). */
  depositBps: number;
  /** Payments after the deposit, at most. */
  maxInstallments: number;
  /** Fee added to the price for paying in installments, in basis points. */
  feeBps: number;
  /** Minimum time between two due dates. */
  minSpacingHours: number;
}

export interface ScheduledPayment {
  /** 0 is the deposit. */
  sequence: number;
  /** UTC instant, whole minutes. */
  dueAt: Date;
  amount: Money;
}

export interface InstallmentSchedule {
  /** Price plus fee: what the traveller pays over the plan. */
  total: Money;
  fee: Money;
  payments: ScheduledPayment[];
}

const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;

/** Rounds up to whole currency units (deposits read better as round numbers). */
function ceilToUnit(amount: Money): Money {
  const unit = 10n ** BigInt(currencyExponent(amount.currency));
  return money(roundDiv(amount.minor, unit, 'ceil') * unit, amount.currency);
}

const floorToMinute = (ms: number): Date => new Date(Math.floor(ms / MINUTE_MS) * MINUTE_MS);

/**
 * Deposit now plus evenly spaced installments, all due no later than `lastDueBy` (the hold
 * deadline minus the grace period). The parts always add up to the total exactly; the remainder
 * of an uneven split goes to the earliest installments. Returns null when no installment fits
 * after the deposit, so the plan is simply not offered.
 */
export function installmentSchedule(
  price: Money,
  now: Date,
  lastDueBy: Date,
  policy: InstallmentPolicy,
): InstallmentSchedule | null {
  if (price.minor <= 0n || policy.maxInstallments < 1) return null;
  const fee = percentageOf(price, policy.feeBps, 'ceil');
  const total = add(price, fee);
  const rawDeposit = ceilToUnit(percentageOf(total, policy.depositBps, 'ceil'));
  const deposit = rawDeposit.minor > total.minor ? total : rawDeposit;
  const remaining = subtract(total, deposit);
  if (remaining.minor <= 0n || deposit.minor <= 0n) return null;

  const windowMs = lastDueBy.getTime() - now.getTime();
  const spacingMs = policy.minSpacingHours * HOUR_MS;
  const count = Math.min(policy.maxInstallments, Math.floor(windowMs / spacingMs));
  if (count < 1) return null;

  const interval = windowMs / count;
  const parts = allocate(
    remaining,
    Array.from({ length: count }, () => 1),
  );
  return {
    total,
    fee,
    payments: [
      { sequence: 0, dueAt: floorToMinute(now.getTime()), amount: deposit },
      ...parts.map((amount, index) => ({
        sequence: index + 1,
        dueAt: floorToMinute(now.getTime() + interval * (index + 1)),
        amount,
      })),
    ],
  };
}

/**
 * What goes back on a default or a cancellation of a partly paid plan: everything paid minus the
 * policy fee, rounded down in the traveller's favour (ADR-018).
 */
export function defaultRefund(paid: Money, feeBps: number): { refund: Money; fee: Money } {
  const fee = percentageOf(paid, feeBps, 'floor');
  return { refund: subtract(paid, fee), fee };
}
