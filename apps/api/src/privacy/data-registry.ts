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
  'rides',
  'emergencyContacts',
  'driving',
  'rentals',
  'reviews',
  'company',
  'support',
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
  | { kind: 'parent'; parent: 'Session' | 'Booking' | 'SupportConversation' | 'StatusIncident' }
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
  DeviceCredential: {
    section: 'mfa',
    deletion: 'delete',
    retention: { kind: 'rule', rule: 'device-credentials' },
    note: 'Fingerprint sign-in: exported as the phone label and dates; the secret hash is a credential.',
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
  TaxRule: reference('Tax configuration (ADR-072): rates and the seller registration number.'),
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
  MetasearchPartner: {
    section: null,
    deletion: 'none',
    retention: { kind: 'reference' },
    note: 'Metasearch partners (ADR-081): names, limits and the HMAC of their API key.',
  },
  MetasearchLanding: {
    section: null,
    deletion: 'none',
    retention: { kind: 'rule', rule: 'metasearch-landings' },
    note: 'Arrivals from metasearch deep links: partner, outcome and totals; no personal data.',
  },
  RouteFare: {
    section: null,
    deletion: 'none',
    retention: { kind: 'job', job: 'snapshots-prune' },
    note: 'Fare history behind route facts (ADR-080); ROUTE_FARE_RETENTION_DAYS.',
  },
  DestinationContent: reference('Destination content.'),
  DestinationHotelSnapshot: {
    section: null,
    deletion: 'none',
    retention: { kind: 'job', job: 'snapshots-prune' },
    note: 'Hotel snapshots.',
  },
  CookieConsent: {
    section: null,
    deletion: 'none',
    retention: { kind: 'rule', rule: 'cookie-consents' },
    note: 'Proof of cookie choices: a random id from the consent cookie, the policy version and the choices. No account, IP or browser.',
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
  FlightScheduleChange: {
    section: 'bookings',
    deletion: 'retain',
    retention: { kind: 'parent', parent: 'Booking' },
    note: 'Airline changes to a booked flight: flight times and numbers, no personal data (ADR-065).',
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
  PaymentRiskReview: {
    section: null,
    deletion: 'retain',
    retention: { kind: 'parent', parent: 'Booking' },
    note: 'Fraud screening of a captured payment: score, signal codes and the staff decision; withheld from the export as fraud-prevention data.',
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

  // --- Cars: buses, rides and car rental (ADR-049 to ADR-053) ------------------------------
  BusOperator: reference('Bus operators.'),
  OperatorMember: {
    section: 'profile',
    deletion: 'delete',
    retention: { kind: 'account' },
    note: 'Which operator an agent boards passengers for; removed with the account.',
  },
  BusTerminal: reference('Bus terminals.'),
  BusRoute: reference('Bus routes.'),
  BusLayout: reference('Coach seat maps.'),
  BusTrip: reference('Bus departures and fares.'),
  BusSeatHold: {
    section: null,
    deletion: 'delete',
    retention: { kind: 'rule', rule: 'bus-seat-holds' },
    note: 'Ten-minute seat holds: an account id or a token HMAC and an IP HMAC; purged after they lapse.',
  },
  BusSeatAssignment: {
    section: 'bookings',
    deletion: 'retain',
    retention: { kind: 'parent', parent: 'Booking' },
    note: 'Seat numbers sold to a booking.',
  },
  BusTicket: {
    section: 'bookings',
    deletion: 'retain',
    retention: { kind: 'parent', parent: 'Booking' },
    note: 'Boarding passes: seat, status and boarding time (the passenger name stays on the booking).',
  },
  BusTicketScan: {
    section: null,
    deletion: 'retain',
    retention: { kind: 'rule', rule: 'ticket-scans' },
    note: 'Scan log for duplicate-boarding checks: ticket, agent and result ids only.',
  },
  RidePlace: reference('Curated pickup places.'),
  RideFareRule: reference('Ride fare tables.'),
  Driver: {
    section: 'driving',
    deletion: 'redact',
    retention: { kind: 'account' },
    note: 'Driver profile: names, NIN, licence and bank details are cleared on deletion; ratings and status stay for safety records.',
  },
  DriverVehicle: {
    section: 'driving',
    deletion: 'redact',
    retention: { kind: 'account' },
    note: 'Vehicles a driver registered; the plate is cleared on deletion, the model kept for past rides.',
  },
  DriverDocument: {
    section: 'driving',
    deletion: 'delete',
    retention: { kind: 'rule', rule: 'driver-documents' },
    note: 'Licence, vehicle papers and selfie: bytes deleted and keys destroyed when superseded, rejected or the account goes.',
  },
  Ride: {
    section: 'rides',
    deletion: 'redact',
    retention: { kind: 'rule', rule: 'ride-locations' },
    note: 'Kept with its booking; pickup and drop-off are coarsened to about 1 km and the route cleared after RIDE_PING_RETENTION_DAYS, or at deletion.',
  },
  RideEvent: {
    section: 'rides',
    deletion: 'retain',
    retention: { kind: 'parent', parent: 'Booking' },
    note: 'Ride status changes with actor kinds and ids.',
  },
  RideOffer: {
    section: null,
    deletion: 'retain',
    retention: { kind: 'rule', rule: 'ride-offers' },
    note: 'Which driver was offered which ride: ids, distances and outcomes.',
  },
  RideLocationPing: {
    section: 'rides',
    deletion: 'delete',
    retention: { kind: 'rule', rule: 'ride-location-pings' },
    note: 'Driver positions during a ride, deleted after RIDE_PING_RETENTION_DAYS (ADR-053).',
  },
  RideRating: {
    section: 'rides',
    deletion: 'redact',
    retention: { kind: 'parent', parent: 'Booking' },
    note: 'Stars kept for driver quality; comments cleared on deletion.',
  },
  RideShareLink: {
    section: null,
    deletion: 'delete',
    retention: { kind: 'rule', rule: 'ride-share-links' },
    note: 'Live-trip link token HMACs: credentials, never exported.',
  },
  SafetyIncident: {
    section: 'rides',
    deletion: 'retain',
    retention: { kind: 'rule', rule: 'safety-incidents' },
    note: 'SOS and safety signals: kept two years after resolution as a safety record.',
  },
  EmergencyContact: {
    section: 'emergencyContacts',
    deletion: 'delete',
    retention: { kind: 'account' },
    note: 'Trusted contacts texted on SOS (third parties): encrypted, removed with the account.',
  },
  DriverPayout: {
    section: 'driving',
    deletion: 'retain',
    retention: { kind: 'rule', rule: 'driver-payouts' },
    note: 'Transfers of earnings: amounts and outcomes, kept for FINANCIAL_RECORDS_RETENTION_YEARS.',
  },
  ReconciliationDiscrepancy: {
    section: null,
    deletion: 'none',
    retention: { kind: 'rule', rule: 'reconciliation-discrepancies' },
    note: 'Ledger and provider differences: ids, amounts and the resolution; no personal data.',
  },
  RentalVehicle: reference('Rental fleet.'),
  RentalReservation: {
    section: 'rentals',
    deletion: 'retain',
    retention: { kind: 'parent', parent: 'Booking' },
    note: 'Rental period, chauffeur choice and deposit outcome.',
  },
  RentalHandover: {
    section: 'rentals',
    deletion: 'redact',
    retention: { kind: 'parent', parent: 'Booking' },
    note: 'Odometer, fuel and damage notes at pickup and return; immutable evidence, notes cleared with the booking.',
  },
  RentalLicence: {
    section: 'rentals',
    deletion: 'redact',
    retention: { kind: 'rule', rule: 'rental-licences' },
    note: "Renter's licence for a self-drive rental: the number is cleared and the scan destroyed 30 days after return, or at deletion.",
  },
  RentalHandoverPhoto: {
    section: null,
    deletion: 'delete',
    retention: { kind: 'rule', rule: 'rental-photos' },
    note: 'Condition photos at check-out and check-in: files and keys destroyed RENTAL_PHOTO_RETENTION_DAYS after return (dispute window), or at deletion.',
  },
  // --- Partner supply (ADR-070) -------------------------------------------------------------
  PartnerClick: {
    section: 'activity',
    deletion: 'redact',
    retention: { kind: 'rule', rule: 'partner-clicks' },
    note: 'Outbound partner clicks: programme, booking and channel ids, no IP, browser or URL. The user id is cleared at deletion.',
  },
  PartnerConversion: {
    section: null,
    deletion: 'none',
    retention: { kind: 'rule', rule: 'partner-conversions' },
    note: 'Commission reported by a partner network: its booking id, amounts and status. No personal data; kept for FINANCIAL_RECORDS_RETENTION_YEARS.',
  },
  // --- Verified reviews (ADR-077) -----------------------------------------------------------
  ReviewSubject: reference(
    'What reviews are about (a hotel, package, tour, bus operator or rental car) and its published totals.',
  ),
  Review: {
    section: 'reviews',
    deletion: 'redact',
    retention: { kind: 'rule', rule: 'rejected-reviews' },
    note: 'Rating, texts and the shown name ("Ada O." or none). Deletion removes unpublished reviews and keeps published ones without the account or name; rejected ones go after 90 days; the name goes when the booking is anonymised.',
  },
  // --- Company accounts (ADR-078) ----------------------------------------------------------
  Company: reference(
    "A company that books travel for its people: name, country, registration and tax numbers and its billing email. Kept while in use; staff suspend it. Members' trips stay with it for its reports.",
  ),
  CompanyPolicy: reference(
    "A company's travel policy: caps and the approval mode, no personal data.",
  ),
  CompanyMember: {
    section: 'company',
    deletion: 'delete',
    retention: { kind: 'account' },
    note: "The account's company and role. Deleted with the account; the last admin of a company with other members hands it over first (`company_admin` blocker).",
  },
  CompanyInvitation: {
    section: null,
    deletion: 'retain',
    retention: { kind: 'rule', rule: 'company-invitations' },
    note: 'Emailed invitations: HMACs of the token and the address, a masked address and the role. Purged 30 days after they expire.',
  },
  AdConversion: {
    section: 'activity',
    deletion: 'delete',
    retention: { kind: 'rule', rule: 'ad-conversions' },
    note: "A consented booking's server-side Purchase event (ADR-079): the consent id, the ad networks' click ids until it is sent or given up, and its status. Deleted with the account; purged 30 days after the booking.",
  },
  // --- Support conversations (ADR-083) -------------------------------------------------------
  SupportConversation: {
    section: 'support',
    deletion: 'delete',
    retention: { kind: 'rule', rule: 'support-conversations' },
    note: "A traveller's support conversation: category, priority, status, SLA times, the booking it is about, and a guest's email (encrypted) or token HMAC. Deleted with the account; resolved ones purged two years after their last change.",
  },
  SupportMessage: {
    section: 'support',
    deletion: 'delete',
    retention: { kind: 'parent', parent: 'SupportConversation' },
    note: 'Messages of a support conversation (bodies encrypted per message). The export holds what the traveller and staff wrote to each other, never internal notes or staff names.',
  },
  WhatsAppContact: {
    section: null,
    deletion: 'none',
    retention: { kind: 'rule', rule: 'whatsapp-contacts' },
    note: 'Someone who wrote to support on WhatsApp: sealed phone number and business-scoped user id, their HMACs, last message time and STOP. Never linked to an account (recycled numbers, ADR-084), so outside account export and deletion; purged 30 days after their last message once no conversation is left.',
  },
  StatusIncident: {
    section: null,
    deletion: 'none',
    retention: { kind: 'rule', rule: 'status-incidents' },
    note: 'Incidents on the public status page (ADR-087): public text staff wrote, no personal data (authors are in the audit log). Purged a year after they were resolved.',
  },
  StatusIncidentUpdate: {
    section: null,
    deletion: 'none',
    retention: { kind: 'parent', parent: 'StatusIncident' },
    note: 'Public updates on a status page incident.',
  },
} as const satisfies Record<Prisma.ModelName, DataTreatment>;

export type RegisteredModel = keyof typeof DATA_REGISTRY;
