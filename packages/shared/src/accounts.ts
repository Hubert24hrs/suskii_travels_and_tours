import { money, multiplyRatio, type Money } from './money';
import { VOUCHER_ALPHABET } from './inhouse';

/**
 * Accounts, Suskii Prime, referrals and notification preferences (ADR-029 to ADR-032). Zod-free,
 * so the website's client code and the app can use it through `lite`.
 */

// ---------------------------------------------------------------------------
// Suskii Prime (ADR-030)
// ---------------------------------------------------------------------------

export const PRIME_PERIODS = ['month', 'year'] as const;
export type PrimePeriod = (typeof PRIME_PERIODS)[number];

/** What a plan gives its members in pricing; snapshotted on each membership term. */
export interface PrimeBenefits {
  /** Share of the markup given back as a lower fare (10000 = the whole markup). */
  markupShareBps: number;
  /** Fee codes (as in fee rules) that members do not pay. */
  waivedFeeCodes: string[];
  prioritySupport: boolean;
}

export const NO_PRIME_BENEFITS: PrimeBenefits = {
  markupShareBps: 0,
  waivedFeeCodes: [],
  prioritySupport: false,
};

/**
 * The fare saving a member gets from a markup: `shareBps` of it, rounded down, never more than
 * the markup and never negative. The fare can therefore never drop below the supplier's price.
 */
export function memberMarkupSaving(markup: Money, shareBps: number): Money {
  if (markup.minor <= 0n || shareBps <= 0) return money(0, markup.currency);
  return multiplyRatio(markup, Math.min(Math.trunc(shareBps), 10_000), 10_000, 'floor');
}

/**
 * The end of a membership term starting at `start`: one calendar month or year later, at the same
 * instant, clamped to the last day of a shorter month (31 Jan + 1 month = 28/29 Feb).
 */
export function primeTermEnd(start: Date, period: PrimePeriod): Date {
  const end = new Date(start.getTime());
  const day = end.getUTCDate();
  end.setUTCDate(1);
  if (period === 'month') end.setUTCMonth(end.getUTCMonth() + 1);
  else end.setUTCFullYear(end.getUTCFullYear() + 1);
  const lastDay = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0)).getUTCDate();
  end.setUTCDate(Math.min(day, lastDay));
  return end;
}

// ---------------------------------------------------------------------------
// Notifications (ADR-032)
// ---------------------------------------------------------------------------

export const NOTIFICATION_CATEGORIES = [
  'booking',
  'payment',
  'trip_reminder',
  'price_alert',
  'prime',
  'marketing',
] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

export const NOTIFICATION_CHANNELS = ['email', 'sms', 'whatsapp', 'push'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export type NotificationMatrix = Record<NotificationCategory, Record<NotificationChannel, boolean>>;

/** Travellers must receive their documents and payment notices: these cannot be turned off. */
export function isMandatoryChannel(
  category: NotificationCategory,
  channel: NotificationChannel,
): boolean {
  return channel === 'email' && (category === 'booking' || category === 'payment');
}

/**
 * The default for a category and channel: email for everything but marketing, push for what a
 * traveller is waiting on, SMS and WhatsApp off until chosen, marketing opt-in everywhere.
 */
export function defaultPreference(
  category: NotificationCategory,
  channel: NotificationChannel,
): boolean {
  if (category === 'marketing') return false;
  if (channel === 'email') return true;
  if (channel === 'push') return category !== 'prime';
  return false;
}

/** The effective matrix from stored choices: defaults where nothing is stored, mandatory always on. */
export function resolvePreferences(
  stored: readonly {
    category: NotificationCategory;
    channel: NotificationChannel;
    enabled: boolean;
  }[],
): NotificationMatrix {
  const matrix = Object.fromEntries(
    NOTIFICATION_CATEGORIES.map((category) => [
      category,
      Object.fromEntries(
        NOTIFICATION_CHANNELS.map((channel) => [channel, defaultPreference(category, channel)]),
      ),
    ]),
  ) as NotificationMatrix;
  for (const row of stored) matrix[row.category][row.channel] = row.enabled;
  for (const category of NOTIFICATION_CATEGORIES) {
    for (const channel of NOTIFICATION_CHANNELS) {
      if (isMandatoryChannel(category, channel)) matrix[category][channel] = true;
    }
  }
  return matrix;
}

// ---------------------------------------------------------------------------
// Referrals (ADR-031)
// ---------------------------------------------------------------------------

export const REFERRAL_CODE_LENGTH = 8;
export const REFERRAL_STATUSES = [
  'pending',
  'qualified',
  'rewarded',
  'review',
  'rejected',
] as const;
export type ReferralStatus = (typeof REFERRAL_STATUSES)[number];

const REFERRAL_PATTERN = new RegExp(`^[${VOUCHER_ALPHABET}]{${REFERRAL_CODE_LENGTH}}$`);

/** A typed or shared referral code, normalised (case, spaces, dashes), or null when invalid. */
export function parseReferralCode(input: string): string | null {
  const code = input.trim().toUpperCase().replace(/[\s-]/g, '');
  return REFERRAL_PATTERN.test(code) ? code : null;
}

// ---------------------------------------------------------------------------
// Price alerts (ADR-032)
// ---------------------------------------------------------------------------

export const MAX_PRICE_ALERTS = 10;

/** The last date an alert watches: the departure date, or the last day of the month. */
export function alertEndsOn(alert: {
  departureDate?: string | null;
  departureMonth?: string | null;
}): string {
  if (alert.departureDate) return alert.departureDate;
  const [year, month] = (alert.departureMonth ?? '').split('-').map(Number);
  if (!year || !month) throw new Error('A price alert needs a departure date or month');
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

/**
 * Whether a newly seen price deserves a notice: at or below the target, or (without a target, or
 * above it) lower than the last notified price by at least `minDropBps`; never twice in a day.
 */
export function shouldNotifyPrice(input: {
  priceMinor: bigint;
  targetMinor: bigint | null;
  lastNotifiedMinor: bigint | null;
  lastNotifiedAt: Date | null;
  minDropBps: number;
  now: Date;
}): boolean {
  if (input.lastNotifiedAt && input.now.getTime() - input.lastNotifiedAt.getTime() < 86_400_000) {
    return false;
  }
  const reference = input.lastNotifiedMinor;
  if (input.targetMinor !== null && input.priceMinor <= input.targetMinor) {
    // At the target: tell once, then only when it drops again below what was last told.
    return reference === null || input.priceMinor < reference;
  }
  if (reference === null) return false;
  return input.priceMinor * 10_000n <= reference * BigInt(10_000 - input.minDropBps);
}
