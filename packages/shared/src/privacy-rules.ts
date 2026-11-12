/**
 * Deadlines from the data protection laws Suskii sells under (ADR-089). Every value here comes
 * from a row in `docs/compliance/privacy-obligations.md`; `statutory: false` marks an internal
 * target where the law sets no number we could confirm ("without undue delay", "as soon as
 * reasonably possible").
 */

export const PRIVACY_REQUEST_KINDS = [
  'access',
  'rectification',
  'erasure',
  'objection',
  'restriction',
  'portability',
] as const;
export type PrivacyRequestKind = (typeof PRIVACY_REQUEST_KINDS)[number];

/** How a request reached Suskii; `self_service` is the account's export or deletion. */
export const PRIVACY_REQUEST_CHANNELS = [
  'self_service',
  'email',
  'support',
  'phone',
  'post',
] as const;
export type PrivacyRequestChannel = (typeof PRIVACY_REQUEST_CHANNELS)[number];

export const PRIVACY_REQUEST_STATUSES = ['open', 'completed', 'refused'] as const;
export type PrivacyRequestStatus = (typeof PRIVACY_REQUEST_STATUSES)[number];

/** Reasons a request may be refused; the register keeps a reason, never free text. */
export const PRIVACY_REFUSAL_REASONS = [
  'identity_not_verified',
  'manifestly_unfounded',
  'legal_obligation',
  'no_data',
] as const;
export type PrivacyRefusalReason = (typeof PRIVACY_REFUSAL_REASONS)[number];

export const PRIVACY_JURISDICTIONS = ['NG', 'KE', 'ZA', 'EU', 'GB', 'OTHER'] as const;
export type PrivacyJurisdiction = (typeof PRIVACY_JURISDICTIONS)[number];

/** What a breach exposed, for the register and the notices; no values, only categories. */
export const BREACH_DATA_CATEGORIES = [
  'contact',
  'identity_documents',
  'booking',
  'payment_references',
  'location',
  'credentials',
  'other_personal_data',
] as const;
export type BreachDataCategory = (typeof BREACH_DATA_CATEGORIES)[number];

export const BREACH_NOTICE_DECISIONS = ['pending', 'notified', 'not_required'] as const;
export type BreachNoticeDecision = (typeof BREACH_NOTICE_DECISIONS)[number];

const EU_COUNTRIES = new Set([
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE',
  'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
]); // prettier-ignore

/** The law that governs a person's request, from their country (the edge's for self-service). */
export function privacyJurisdiction(country: string | null | undefined): PrivacyJurisdiction {
  const code = country?.toUpperCase();
  if (code === 'NG' || code === 'KE' || code === 'ZA' || code === 'GB') return code;
  if (code && EU_COUNTRIES.has(code)) return 'EU';
  return 'OTHER';
}

export interface PrivacyDeadline {
  /** Calendar days, or calendar months (GDPR's "one month"). */
  days?: number;
  months?: number;
  statutory: boolean;
  source: string;
}

export interface JurisdictionRules {
  regulator: string;
  breach: { hours: number; statutory: boolean; source: string };
  requests: Record<PrivacyRequestKind, PrivacyDeadline>;
}

const every = (deadline: PrivacyDeadline): Record<PrivacyRequestKind, PrivacyDeadline> =>
  Object.fromEntries(PRIVACY_REQUEST_KINDS.map((kind) => [kind, deadline])) as Record<
    PrivacyRequestKind,
    PrivacyDeadline
  >;

const INTERNAL_30: PrivacyDeadline = { days: 30, statutory: false, source: 'Internal target' };

export const PRIVACY_RULES: Readonly<Record<PrivacyJurisdiction, JurisdictionRules>> = {
  NG: {
    regulator: 'Nigeria Data Protection Commission',
    breach: { hours: 72, statutory: true, source: 'NDPA 2023 s. 40' },
    requests: every({
      days: 30,
      statutory: false,
      source: 'Internal target: without undue delay (NDPA 2023, GAID 2025)',
    }),
  },
  KE: {
    regulator: 'Office of the Data Protection Commissioner',
    breach: { hours: 72, statutory: true, source: 'Data Protection Act 2019 s. 43' },
    requests: {
      access: { days: 7, statutory: true, source: 'General Regulations 2021, reg. 9(4)' },
      rectification: { days: 14, statutory: true, source: 'General Regulations 2021, reg. 10(4)' },
      erasure: { days: 14, statutory: true, source: 'General Regulations 2021, reg. 12(3)' },
      objection: { days: 14, statutory: false, source: 'Internal target, as rectification' },
      restriction: { days: 14, statutory: false, source: 'Internal target, as rectification' },
      portability: { days: 14, statutory: false, source: 'Internal target, as rectification' },
    },
  },
  ZA: {
    regulator: 'Information Regulator',
    breach: {
      hours: 72,
      statutory: false,
      source: 'Internal target: as soon as reasonably possible (POPIA s. 22)',
    },
    requests: every({ ...INTERNAL_30, source: 'Internal target: PAIA procedure (confirm)' }),
  },
  EU: {
    regulator: 'The lead supervisory authority',
    breach: { hours: 72, statutory: true, source: 'GDPR Art. 33' },
    requests: every({ months: 1, statutory: true, source: 'GDPR Art. 12(3)' }),
  },
  GB: {
    regulator: "Information Commissioner's Office",
    breach: { hours: 72, statutory: true, source: 'UK GDPR Art. 33' },
    requests: every({ months: 1, statutory: true, source: 'UK GDPR Art. 12(3)' }),
  },
  OTHER: {
    regulator: 'The regulator where the people live',
    breach: { hours: 72, statutory: false, source: 'Internal target' },
    requests: every(INTERNAL_30),
  },
};

/** One calendar month later; the last day of the month when that day does not exist. */
function addMonths(start: Date, months: number): Date {
  const target = new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + months, 1, 0, 0, 0, 0),
  );
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(start.getUTCDate(), lastDay));
  target.setUTCHours(
    start.getUTCHours(),
    start.getUTCMinutes(),
    start.getUTCSeconds(),
    start.getUTCMilliseconds(),
  );
  return target;
}

/** When a request must be answered, from when it was received. */
export function privacyRequestDueAt(
  kind: PrivacyRequestKind,
  jurisdiction: PrivacyJurisdiction,
  receivedAt: Date,
): Date {
  const deadline = PRIVACY_RULES[jurisdiction].requests[kind];
  if (deadline.months) return addMonths(receivedAt, deadline.months);
  return new Date(receivedAt.getTime() + (deadline.days ?? 30) * 86_400_000);
}

/** When the regulator must hear of a breach, from when Suskii became aware of it. */
export function breachNoticeDueAt(jurisdiction: PrivacyJurisdiction, awareAt: Date): Date {
  return new Date(awareAt.getTime() + PRIVACY_RULES[jurisdiction].breach.hours * 3_600_000);
}
