import type { Prisma } from '../generated/prisma/client';

import type { RetentionRule } from './retention.service';

/**
 * What every table means for a person's data rights (ADR-029). `section` is where the account's
 * rows appear in the data export (null: nothing of theirs to give, or only secrets); `deletion` is
 * what account deletion does to them:
 *
 * - `delete`: the rows are removed (or, for stored files, the bytes and keys).
 * - `redact`: the rows stay with their personal fields cleared (tombstones, financial records).
 * - `retain`: kept as they are for the retention period: they hold ids and amounts, no personal
 *   values (accounting and audit obligations).
 * - `none`: the table holds no personal data.
 *
 * The `satisfies` clause and `data-registry.spec.ts` make a new table fail the build until it is
 * listed here.
 */
export const EXPORT_SECTIONS = [
  'profile',
  'preferences',
  'notificationPreferences',
  'notifications',
  'identities',
  'sessions',
  'mfa',
  'devices',
  'travellers',
  'bookings',
  'payments',
  'refunds',
  'wallet',
  'visaApplications',
  'memberships',
  'referrals',
  'priceAlerts',
  'newsletter',
  'activity',
] as const;
export type ExportSection = (typeof EXPORT_SECTIONS)[number];

export type DeletionTreatment = 'delete' | 'redact' | 'retain' | 'none';

/**
 * How long rows live regardless of account deletion (ADR-039):
 *
 * - `account`: as long as the account; account deletion applies `deletion`.
 * - `reference`: configuration and reference data, kept while in use (staff deactivate it).
 * - `rule`: purged by the named rule of the daily retention sweep (`RetentionService`).
 * - `job`: purged by its own scheduled job.
 * - `parent`: goes, or is anonymised, with the parent row.
 * - `append-only`: the database refuses updates and deletes; ids and amounts only, kept.
 */
export type Retention =
  | { kind: 'account' }
  | { kind: 'reference' }
  | { kind: 'rule'; rule: RetentionRule }
  | { kind: 'job'; job: 'visa-documents-prune' | 'snapshots-prune' | 'push-tokens-prune' }
  | { kind: 'parent'; parent: 'Session' | 'Booking' }
  | { kind: 'append-only' };

export interface DataTreatment {
  section: ExportSection | null;
  deletion: DeletionTreatment;
  retention: Retention;
  note: string;
}

const reference = (note: string): DataTreatment => ({
  section: null,
  deletion: 'none',
  retention: { kind: 'reference' },
  note,
});

export const DATA_REGISTRY = {
  // --- Accounts and authentication ---------------------------------------------------------
  User: {
    section: 'profile',
    deletion: 'redact',
    retention: { kind: 'account' },
    note: 'Becomes a tombstone (deleted-{id}@invalid, no names, phone or password) so retained records keep a valid owner.',
  },
  UserRole: {
    section: 'profile',
    deletion: 'delete',
    retention: { kind: 'account' },
    note: 'Role keys only; removed so a deleted account holds no access.',
  },
  Role: reference('Role catalogue.'),
  Permission: reference('Permission catalogue.'),
  RolePermission: reference('Role to permission mapping.'),
  Session: {
    section: 'sessions',
    deletion: 'delete',
    retention: { kind: 'rule', rule: 'sessions' },
    note: 'Revoked (denylist) and removed. Exported without the IP hash.',
  },
  RefreshToken: {
    section: null,
    deletion: 'delete',
    retention: { kind: 'parent', parent: 'Session' },
    note: 'Token hashes are credentials: never exported; removed with their session.',
  },
  MfaFactor: {
    section: 'mfa',
    deletion: 'delete',
    retention: { kind: 'account' },
    note: 'Exported as type and dates only; the secret never leaves.',
  },
  MfaRecoveryCode: {
    section: 'mfa',
    deletion: 'delete',
    retention: { kind: 'account' },
    note: 'Exported as counts only; code hashes are credentials.',
  },
  SocialIdentity: {
    section: 'identities',
    deletion: 'delete',
    retention: { kind: 'account' },
    note: 'Provider and email (the provider subject is an internal identifier).',
  },
  VerificationToken: {
    section: null,
    deletion: 'delete',
    retention: { kind: 'rule', rule: 'verification-tokens' },
    note: 'Single-use link token hashes: credentials, never exported.',
  },
  AuditLog: {
    section: 'activity',
    deletion: 'retain',
    retention: { kind: 'append-only' },
    note: 'Append-only security record of what the account did: ids and reasons, never personal values.',
  },
  IdempotencyKey: {
    section: null,
    deletion: 'delete',
    retention: { kind: 'rule', rule: 'idempotency-keys' },
    note: 'Replay cache of write responses (24 hours, encrypted): transient, removed for the account scope.',
  },

  // --- Reference data, search and content ---------------------------------------------------
  Country: reference('Reference data.'),
  City: reference('Reference data.'),
  Airport: reference('Reference data.'),
  Airline: reference('Reference data.'),
  MarkupRule: reference('Pricing configuration.'),
  FeeRule: reference('Pricing configuration.'),
  PromoCode: reference('Promotion configuration.'),
  PromoRedemption: {
    section: null,
    deletion: 'retain',
    retention: { kind: 'parent', parent: 'Booking' },
    note: 'Discount given on a booking (ids and amounts): part of the booking financial record, shown in its price.',
  },
  Offer: {
    section: null,
    deletion: 'retain',
    retention: { kind: 'rule', rule: 'offers' },
    note: 'Priced supplier offers; holds supplier cost (internal) and no personal values. Booked offers appear through the booking.',
  },
  SearchLog: {
    section: null,
    deletion: 'none',
    retention: { kind: 'rule', rule: 'search-logs' },
    note: 'Anonymised search analytics: no user, session or IP.',
  },
  TrustSignal: reference('Marketing content.'),
  CmsBlock: reference('Marketing content.'),
  Faq: reference('Marketing content.'),
  DealRoute: reference('Deal configuration.'),
  DealSnapshot: {
    section: null,
    deletion: 'none',
    retention: { kind: 'job', job: 'snapshots-prune' },
    note: 'Fare snapshots.',
  },
  DestinationContent: reference('Destination content.'),
  DestinationHotelSnapshot: {
    section: null,
    deletion: 'none',
    retention: { kind: 'job', job: 'snapshots-prune' },
    note: 'Hotel snapshots.',
  },
  NewsletterSubscription: {
    section: 'newsletter',
    deletion: 'delete',
    retention: { kind: 'rule', rule: 'newsletter-pending' },
    note: 'Matched by the account email; removed (consent proof goes with it).',
  },

  // --- Bookings, payments and money ---------------------------------------------------------
  Booking: {
    section: 'bookings',
    deletion: 'redact',
    retention: { kind: 'rule', rule: 'closed-bookings' },
    note: 'Financial record kept for FINANCIAL_RECORDS_RETENTION_YEARS; contact details wiped (redactedAt).',
  },
  BookingItem: {
    section: 'bookings',
    deletion: 'retain',
    retention: { kind: 'parent', parent: 'Booking' },
    note: 'What was bought and the supplier references; exported through the customer booking view (no costs).',
  },
  BookingPassenger: {
    section: 'bookings',
    deletion: 'redact',
    retention: { kind: 'parent', parent: 'Booking' },
    note: 'Names stay on the financial record; birth date, nationality and passport details are wiped.',
  },
  BookingStatusHistory: {
    section: 'bookings',
    deletion: 'retain',
    retention: { kind: 'parent', parent: 'Booking' },
    note: 'Status timeline: ids and reasons.',
  },
  BookingNote: {
    section: 'bookings',
    deletion: 'delete',
    retention: { kind: 'parent', parent: 'Booking' },
    note: 'Internal staff notes (encrypted): exported with the booking, deleted with the account.',
  },
  BookingDocument: {
    section: 'bookings',
    deletion: 'delete',
    retention: { kind: 'parent', parent: 'Booking' },
    note: 'E-tickets and vouchers: files deleted from storage (they can be rebuilt from the retained record).',
  },
  BookingVoucher: {
    section: 'bookings',
    deletion: 'retain',
    retention: { kind: 'parent', parent: 'Booking' },
    note: 'Redemption record; codes are bearer credentials and are not exported.',
  },
  BookingAccessLink: {
    section: null,
    deletion: 'delete',
    retention: { kind: 'rule', rule: 'booking-access-links' },
    note: 'Emailed access token hashes: credentials.',
  },
  Traveller: {
    section: 'travellers',
    deletion: 'delete',
    retention: { kind: 'account' },
    note: 'Saved passengers, exported with passport numbers (the account owner entered them).',
  },
  Payment: {
    section: 'payments',
    deletion: 'retain',
    retention: { kind: 'parent', parent: 'Booking' },
    note: 'Amounts, status and provider references; never card data (SAQ-A).',
  },
  WebhookEvent: {
    section: null,
    deletion: 'retain',
    retention: { kind: 'rule', rule: 'webhook-events' },
    note: 'Provider notices linked by payment reference: normalised status fields, no contact values.',
  },
  LedgerAccount: {
    section: 'wallet',
    deletion: 'retain',
    retention: { kind: 'append-only' },
    note: 'Double-entry accounts; deletion requires a zero wallet balance.',
  },
  LedgerTransaction: {
    section: 'wallet',
    deletion: 'retain',
    retention: { kind: 'append-only' },
    note: 'Append-only money movements (database-enforced).',
  },
  LedgerEntry: {
    section: 'wallet',
    deletion: 'retain',
    retention: { kind: 'append-only' },
    note: 'Append-only money movements (database-enforced).',
  },
  PaymentPlan: {
    section: 'bookings',
    deletion: 'retain',
    retention: { kind: 'parent', parent: 'Booking' },
    note: 'Hold or installment terms of a booking.',
  },
  Installment: {
    section: 'bookings',
    deletion: 'retain',
    retention: { kind: 'parent', parent: 'Booking' },
    note: 'Schedule and payment state of a plan.',
  },
  Refund: {
    section: 'refunds',
    deletion: 'retain',
    retention: { kind: 'parent', parent: 'Booking' },
    note: 'Amounts and outcome; staff notes are internal and not exported.',
  },
  PushToken: {
    section: 'devices',
    deletion: 'delete',
    retention: { kind: 'job', job: 'push-tokens-prune' },
    note: 'Exported as platform and dates; the device token itself is a credential.',
  },

  // --- In-house catalog, visa assistance ----------------------------------------------------
  TravelPackage: reference('Catalog.'),
  PackageDeparture: reference('Catalog.'),
  Tour: reference('Catalog.'),
  TourDeparture: reference('Catalog.'),
  Addon: reference('Catalog.'),
  VisaRule: reference('Eligibility rules.'),
  VisaProduct: reference('Catalog.'),
  VisaApplication: {
    section: 'visaApplications',
    deletion: 'retain',
    retention: { kind: 'parent', parent: 'Booking' },
    note: 'Service record of a paid booking: status, purpose and dates.',
  },
  VisaApplicationEvent: {
    section: 'visaApplications',
    deletion: 'retain',
    retention: { kind: 'parent', parent: 'Booking' },
    note: 'Status changes and officer messages; internal notes are never exported.',
  },
  VisaDocument: {
    section: 'visaApplications',
    deletion: 'delete',
    retention: { kind: 'job', job: 'visa-documents-prune' },
    note: 'Uploaded files: bytes deleted and keys destroyed; metadata kept for the application record.',
  },

  // --- Phase 9: preferences, Prime, referrals, alerts ---------------------------------------
  UserPreference: {
    section: 'preferences',
    deletion: 'delete',
    retention: { kind: 'account' },
    note: 'Settings and consent.',
  },
  NotificationPreference: {
    section: 'notificationPreferences',
    deletion: 'delete',
    retention: { kind: 'account' },
    note: 'Channel choices per category.',
  },
  Notification: {
    section: 'notifications',
    deletion: 'delete',
    retention: { kind: 'rule', rule: 'notifications' },
    note: 'Delivery log (template, channel, outcome); never bodies or contact values.',
  },
  PrimePlan: reference('Membership catalogue.'),
  PrimeMembership: {
    section: 'memberships',
    deletion: 'redact',
    retention: { kind: 'parent', parent: 'Booking' },
    note: 'Paid terms are ended (status cancelled) and kept with their booking as the purchase record.',
  },
  ReferralCode: {
    section: 'referrals',
    deletion: 'delete',
    retention: { kind: 'account' },
    note: 'The account code; removed so it cannot be used again.',
  },
  Referral: {
    section: 'referrals',
    deletion: 'redact',
    retention: { kind: 'account' },
    note: 'Kept for reward accounting with the sign-up signals (HMACs) cleared; exported without the other person.',
  },
  PriceAlert: {
    section: 'priceAlerts',
    deletion: 'delete',
    retention: { kind: 'account' },
    note: 'Watched routes.',
  },
} as const satisfies Record<Prisma.ModelName, DataTreatment>;

export type RegisteredModel = keyof typeof DATA_REGISTRY;
