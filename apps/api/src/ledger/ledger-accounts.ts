import type { LedgerAccountType } from '../generated/prisma/client';

/** A ledger account by meaning; `accountSpec` turns it into a code and properties (ADR-017). */
export type AccountRef =
  | { kind: 'psp'; provider: string; currency: string }
  | { kind: 'booking'; bookingId: string; currency: string }
  | { kind: 'unapplied'; currency: string }
  | { kind: 'wallet'; userId: string; currency: string }
  | { kind: 'refunds-in-flight'; provider: string; currency: string }
  | { kind: 'cancellation-fees'; currency: string }
  | { kind: 'promotions'; currency: string }
  // Cars (ADR-051): what a driver has earned and not yet been paid, the platform's commission,
  // and payouts sent to a driver's bank but not yet settled.
  | { kind: 'driver-earnings'; driverId: string; currency: string }
  | { kind: 'ride-commission'; currency: string }
  | { kind: 'payouts-in-flight'; provider: string; currency: string };

export interface AccountSpec {
  code: string;
  type: LedgerAccountType;
  currency: string;
  allowNegative: boolean;
  userId: string | null;
  bookingId: string | null;
}

export function accountSpec(ref: AccountRef): AccountSpec {
  const base = { currency: ref.currency, userId: null, bookingId: null };
  switch (ref.kind) {
    case 'psp':
      // Refunds can settle before the matching payout is reconciled, so this may dip below zero.
      return {
        ...base,
        code: `psp:${ref.provider}:${ref.currency}`,
        type: 'asset',
        allowNegative: true,
      };
    case 'booking':
      return {
        ...base,
        code: `booking:${ref.bookingId}:${ref.currency}`,
        type: 'liability',
        allowNegative: false,
        bookingId: ref.bookingId,
      };
    case 'unapplied':
      return {
        ...base,
        code: `unapplied:${ref.currency}`,
        type: 'liability',
        allowNegative: false,
      };
    case 'wallet':
      return {
        ...base,
        code: `wallet:${ref.userId}:${ref.currency}`,
        type: 'liability',
        allowNegative: false,
        userId: ref.userId,
      };
    case 'refunds-in-flight':
      return {
        ...base,
        code: `refunds-in-flight:${ref.provider}:${ref.currency}`,
        type: 'liability',
        allowNegative: false,
      };
    case 'cancellation-fees':
      return {
        ...base,
        code: `fees:cancellation:${ref.currency}`,
        type: 'income',
        allowNegative: false,
      };
    case 'promotions':
      // What referral rewards and other promotions cost us (ADR-031); grows with debits.
      return {
        ...base,
        code: `expense:promotions:${ref.currency}`,
        type: 'expense',
        allowNegative: false,
      };
    case 'driver-earnings':
      return {
        ...base,
        code: `${driverEarningsPrefix(ref.driverId)}${ref.currency}`,
        type: 'liability',
        allowNegative: false,
      };
    case 'ride-commission':
      return {
        ...base,
        code: `income:ride-commission:${ref.currency}`,
        type: 'income',
        allowNegative: false,
      };
    case 'payouts-in-flight':
      return {
        ...base,
        code: `payouts-in-flight:${ref.provider}:${ref.currency}`,
        type: 'liability',
        allowNegative: false,
      };
  }
}

/** Code prefix of a driver's earnings accounts (one per currency). */
export const driverEarningsPrefix = (driverId: string): string => `driver-earnings:${driverId}:`;

/** Transaction kinds, for reporting and the wallet history. */
export const LEDGER_KINDS = [
  'payment_captured',
  'payment_unapplied',
  'wallet_payment',
  'refund_initiated',
  'refund_settled',
  'refund_failed',
  'refund_to_wallet',
  'cancellation_fee',
  'referral_reward',
  'ride_earnings',
  'payout_sent',
  'payout_settled',
  'payout_failed',
] as const;
export type LedgerKind = (typeof LEDGER_KINDS)[number];
