import { DATA_REGISTRY, type Retention, type RegisteredModel } from './data-registry';
import { RETENTION_DAYS } from './retention.service';

/**
 * Records of processing and the transfer register (ADR-089). Every table that holds personal
 * data (`DATA_REGISTRY` deletion other than `none`) belongs to at least one activity, and every
 * party that receives personal data is a recipient with where it processes and the transfer
 * basis. `docs/privacy/records-of-processing.md` is rendered from this file
 * (`pnpm --filter @suskii/api privacy:records`); `processing-records.spec.ts` fails when either
 * drifts. Locations come from the providers' public terms: confirm each against the signed terms.
 */

export const LAWFUL_BASES = {
  contract: 'Contract: needed for the service the person asked for',
  legal_obligation: 'Legal obligation: accounting, tax, safety and data protection records',
  legitimate_interests: 'Legitimate interests: security, fraud prevention and service quality',
  consent: 'Consent: given, recorded and withdrawable',
  vital_interests: 'Vital interests: protecting someone in an emergency',
} as const;
export type LawfulBasis = keyof typeof LAWFUL_BASES;

export const TRANSFER_BASES = {
  contract_necessity:
    'Needed to perform the booking or payment the person asked for (NDPA ss. 41 to 43, Kenya DPA s. 48, POPIA s. 72)',
  processor_terms:
    "Processor terms with transfer safeguards (the provider's data processing terms, signed by the owner)",
  consent: 'Consent recorded before anything is sent (marketing consent, ADR-079)',
  no_personal_data: 'No personal data is sent',
} as const;
export type TransferBasis = keyof typeof TRANSFER_BASES;

export type RecipientRole = 'processor' | 'independent controller';
export type RecipientStatus = 'live' | 'optional' | 'not contracted' | 'off in production';

export interface Recipient {
  name: string;
  role: RecipientRole;
  /** What it receives from us; never more than its job needs. */
  receives: string;
  /** Where it processes, from its public terms (confirm against the signed terms). */
  location: string;
  transfer: TransferBasis;
  status: RecipientStatus;
  /** The setting that turns it on, when there is one. */
  setting?: string;
}

export const RECIPIENTS = {
  google_cloud: {
    name: 'Google Cloud (Cloud SQL, Cloud Run, Cloud Storage, Secret Manager)',
    role: 'processor',
    receives: 'Every stored record and file (hosting)',
    location: 'United Kingdom (europe-west2, London; ADR-059)',
    transfer: 'processor_terms',
    status: 'live',
  },
  cloudflare: {
    name: 'Cloudflare (edge, WAF, Turnstile)',
    role: 'processor',
    receives: 'Requests in transit: IP address, browser details, request content',
    location: 'Global network (the data centre nearest the visitor)',
    transfer: 'processor_terms',
    status: 'live',
  },
  duffel: {
    name: 'Duffel, and the airlines and hotels it books',
    role: 'processor',
    receives:
      'Passenger names, dates of birth, contact and passport details for the booked trip; airlines and hotels receive them as independent controllers',
    location: "United Kingdom; then the airline's or hotel's country",
    transfer: 'contract_necessity',
    status: 'optional',
    setting: 'FLIGHT_SUPPLIERS, HOTEL_SUPPLIERS',
  },
  hotelbeds: {
    name: 'Hotelbeds, and the hotels it books',
    role: 'independent controller',
    receives: "Guest names and the booker's contact details for the booked stay",
    location: "Spain; then the hotel's country",
    transfer: 'contract_necessity',
    status: 'optional',
    setting: 'HOTEL_SUPPLIERS',
  },
  expedia: {
    name: 'Expedia Rapid, and the hotels it books',
    role: 'independent controller',
    receives:
      "Guest names, the booker's contact details and the checkout IP address for the booked stay (ADR-086)",
    location: "United States; then the hotel's country",
    transfer: 'contract_necessity',
    status: 'optional',
    setting: 'HOTEL_SUPPLIERS',
  },
  payment_providers: {
    name: 'Paystack, Flutterwave, Stripe',
    role: 'independent controller',
    receives:
      'Email address, amount and our reference; card details are entered on their pages only (SAQ A)',
    location: 'Nigeria (Paystack, Flutterwave); United States and Ireland (Stripe)',
    transfer: 'contract_necessity',
    status: 'optional',
    setting: 'PAYMENT_PROVIDERS',
  },
  email_relay: {
    name: 'Email relay (SMTP)',
    role: 'processor',
    receives: 'Email address and the message',
    location: 'Depends on the relay the owner picks',
    transfer: 'processor_terms',
    status: 'not contracted',
    setting: 'SMTP_URL',
  },
  termii: {
    name: 'Termii (texts)',
    role: 'processor',
    receives: 'Phone number and the text (sign-in codes, booking and safety alerts) (ADR-091)',
    location: 'Nigeria',
    transfer: 'processor_terms',
    status: 'not contracted',
    setting: 'SMS_PROVIDER, SMS_ROUTES',
  },
  africastalking: {
    name: "Africa's Talking (texts)",
    role: 'processor',
    receives: 'Phone number and the text (sign-in codes, booking and safety alerts) (ADR-091)',
    location: 'Kenya; then the mobile networks of the number',
    transfer: 'processor_terms',
    status: 'not contracted',
    setting: 'SMS_PROVIDER, SMS_ROUTES',
  },
  expo_push: {
    name: 'Expo push service (to FCM and APNs)',
    role: 'processor',
    receives: 'Push token and the notification text (in-app paths only, no booking details)',
    location: 'United States',
    transfer: 'processor_terms',
    status: 'live',
  },
  whatsapp: {
    name: 'Meta WhatsApp Cloud API',
    role: 'processor',
    receives: "The traveller's WhatsApp number and support messages (ADR-084)",
    location: 'United States and Ireland',
    transfer: 'processor_terms',
    status: 'not contracted',
    setting: 'WHATSAPP_SUPPORT_PROVIDER',
  },
  ad_networks: {
    name: 'Meta Conversions API, TikTok Events API',
    role: 'independent controller',
    receives:
      'SHA-256 of the normalised email and phone, click ids and the Purchase value, only with marketing consent',
    location: 'United States and Ireland (Meta); Singapore, United States and Ireland (TikTok)',
    transfer: 'consent',
    status: 'not contracted',
    setting: 'AD_CONVERSIONS',
  },
  anthropic: {
    name: 'Anthropic Messages API',
    role: 'processor',
    receives:
      'Scrubbed trip descriptions (AI trip search) and scrubbed support messages with booking facts but no names, contacts or references (ADR-061, ADR-085)',
    location: 'United States',
    transfer: 'processor_terms',
    status: 'optional',
    setting: 'AI_SEARCH_ENABLED, SUPPORT_ASSISTANT_ENABLED',
  },
  sentry: {
    name: 'Sentry',
    role: 'processor',
    receives: 'Error events with ids and scrubbed messages; no IP addresses (ADR-046)',
    location: 'United States or Germany (the data region the owner picks)',
    transfer: 'processor_terms',
    status: 'not contracted',
    setting: 'SENTRY_DSN',
  },
  device_attestation: {
    name: 'Apple App Attest, Google Play Integrity',
    role: 'independent controller',
    receives: 'Attestation tokens from the app (no account data from us)',
    location: 'United States',
    transfer: 'no_personal_data',
    status: 'live',
  },
  driver_kyc: {
    name: 'Driver identity check (KYC) provider',
    role: 'processor',
    receives: "A driver's NIN, licence number and photo",
    location: 'Depends on the provider the owner picks',
    transfer: 'processor_terms',
    status: 'off in production',
    setting: 'CARS_RIDES_ENABLED (ADR-069)',
  },
  payout_provider: {
    name: 'Driver payout provider',
    role: 'processor',
    receives: "A driver's bank account details and the amount",
    location: 'Depends on the provider the owner picks',
    transfer: 'processor_terms',
    status: 'off in production',
    setting: 'CARS_RIDES_ENABLED (ADR-069)',
  },
  affiliate_networks: {
    name: 'Travelpayouts and Viator',
    role: 'independent controller',
    receives:
      'A click id as sub_id; the traveller books on the partner site under its own terms (ADR-070)',
    location: 'Not applicable',
    transfer: 'no_personal_data',
    status: 'optional',
    setting: 'PARTNER_OFFERS_ENABLED',
  },
} as const satisfies Record<string, Recipient>;
export type RecipientId = keyof typeof RECIPIENTS;

export const DATA_SUBJECTS = {
  travellers: 'Travellers with an account',
  guests: 'Guests who book without an account, and the passengers they name',
  staff: 'Suskii staff',
  drivers: 'Drivers and driver applicants',
  operator_agents: 'Bus operator agents',
  company_members: 'Members of company accounts',
  emergency_contacts: 'Emergency contacts named by riders',
  subscribers: 'Newsletter subscribers',
} as const;
export type DataSubject = keyof typeof DATA_SUBJECTS;

export const DATA_CATEGORIES = {
  identity: 'Names, dates of birth, nationality',
  contact: 'Email addresses and phone numbers',
  travel_documents: 'Passport details and visa documents',
  trips: 'Itineraries, bookings, tickets and vouchers',
  payments: 'Payment references, amounts and refunds (never card numbers)',
  location: 'Pickup and drop-off points, ride positions',
  credentials: 'Password hashes, authenticators, session tokens',
  device: 'Push tokens, hashed IP addresses, device attestation',
  communications: 'Support messages and notifications',
  driving: "Drivers' NIN, licence, vehicle and documents; renters' licences",
  preferences: 'Settings, consent choices and alerts',
  reviews: 'Ratings and review text',
} as const;
export type DataCategory = keyof typeof DATA_CATEGORIES;

export interface ProcessingActivity {
  id: string;
  name: string;
  purpose: string;
  basis: readonly LawfulBasis[];
  subjects: readonly DataSubject[];
  categories: readonly DataCategory[];
  models: readonly RegisteredModel[];
  recipients: readonly RecipientId[];
}

const hosting = ['google_cloud', 'cloudflare'] as const;

export const PROCESSING_ACTIVITIES: readonly ProcessingActivity[] = [
  {
    id: 'accounts',
    name: 'Accounts, sign-in and security',
    purpose:
      'Create and protect accounts: sign-in, MFA, sessions, devices, staff roles and the audit log of security-relevant actions.',
    basis: ['contract', 'legitimate_interests'],
    subjects: ['travellers', 'staff', 'drivers', 'operator_agents'],
    categories: ['identity', 'contact', 'credentials', 'device'],
    models: [
      'User',
      'UserRole',
      'Session',
      'RefreshToken',
      'MfaFactor',
      'MfaRecoveryCode',
      'SocialIdentity',
      'DeviceCredential',
      'VerificationToken',
      'AuditLog',
      'IdempotencyKey',
    ],
    recipients: [
      ...hosting,
      'email_relay',
      'termii',
      'africastalking',
      'device_attestation',
      'sentry',
    ],
  },
  {
    id: 'bookings',
    name: 'Bookings and trip fulfilment',
    purpose:
      'Quote, book, ticket and change flights, hotels, packages, tours and add-ons; send documents; handle airline changes and cancellations.',
    basis: ['contract'],
    subjects: ['travellers', 'guests'],
    categories: ['identity', 'contact', 'travel_documents', 'trips'],
    models: [
      'Offer',
      'Booking',
      'BookingItem',
      'BookingPassenger',
      'FlightScheduleChange',
      'BookingStatusHistory',
      'BookingNote',
      'BookingDocument',
      'BookingVoucher',
      'BookingAccessLink',
      'Traveller',
      'PromoRedemption',
    ],
    recipients: [...hosting, 'duffel', 'hotelbeds', 'expedia', 'email_relay', 'expo_push'],
  },
  {
    id: 'payments',
    name: 'Payments, refunds, wallet and fraud checks',
    purpose:
      'Take payments through hosted checkout, run installment plans, refund, keep the double-entry ledger and review risky payments.',
    basis: ['contract', 'legal_obligation', 'legitimate_interests'],
    subjects: ['travellers', 'guests'],
    categories: ['contact', 'payments'],
    models: [
      'Payment',
      'WebhookEvent',
      'LedgerAccount',
      'LedgerTransaction',
      'LedgerEntry',
      'PaymentPlan',
      'Installment',
      'PaymentRiskReview',
      'Refund',
    ],
    recipients: [...hosting, 'payment_providers'],
  },
  {
    id: 'visa',
    name: 'Visa assistance',
    purpose:
      'Collect, scan and review the documents for a visa application and track it to a decision.',
    basis: ['contract'],
    subjects: ['travellers', 'guests'],
    categories: ['identity', 'travel_documents', 'contact'],
    models: ['VisaApplication', 'VisaApplicationEvent', 'VisaDocument'],
    recipients: [...hosting],
  },
  {
    id: 'membership',
    name: 'Suskii Prime and referrals',
    purpose:
      'Run Prime terms and member prices; issue referral codes, check referrals for fraud and pay rewards.',
    basis: ['contract', 'legitimate_interests'],
    subjects: ['travellers'],
    categories: ['identity', 'payments', 'device'],
    models: ['PrimeMembership', 'ReferralCode', 'Referral'],
    recipients: [...hosting],
  },
  {
    id: 'communications',
    name: 'Notifications, preferences, price alerts and the newsletter',
    purpose:
      'Send booking and account messages, honour channel preferences, watch fares for alerts and send the newsletter to people who confirmed it.',
    basis: ['contract', 'consent'],
    subjects: ['travellers', 'subscribers'],
    categories: ['contact', 'preferences', 'communications', 'device'],
    models: [
      'UserPreference',
      'NotificationPreference',
      'Notification',
      'PriceAlert',
      'NewsletterSubscription',
      'PushToken',
    ],
    recipients: [...hosting, 'email_relay', 'termii', 'africastalking', 'expo_push'],
  },
  {
    id: 'ground',
    name: 'Buses, rides and car rental',
    purpose:
      'Hold and sell bus seats, issue and scan boarding passes, run rides with safety tools and rent cars with handover records.',
    basis: ['contract', 'vital_interests', 'legitimate_interests'],
    subjects: ['travellers', 'guests', 'operator_agents', 'emergency_contacts'],
    categories: ['identity', 'contact', 'trips', 'location', 'driving'],
    models: [
      'OperatorMember',
      'BusSeatHold',
      'BusSeatAssignment',
      'BusTicket',
      'BusTicketScan',
      'Ride',
      'RideEvent',
      'RideOffer',
      'RideLocationPing',
      'RideRating',
      'RideShareLink',
      'SafetyIncident',
      'EmergencyContact',
      'RentalReservation',
      'RentalHandover',
      'RentalLicence',
      'RentalHandoverPhoto',
    ],
    recipients: [...hosting, 'termii', 'africastalking', 'expo_push'],
  },
  {
    id: 'drivers',
    name: 'Driver onboarding and payouts',
    purpose:
      'Review driver applications, vehicles and documents, and pay earnings. Off in production while own rides stay off (ADR-069).',
    basis: ['contract', 'legal_obligation'],
    subjects: ['drivers'],
    categories: ['identity', 'contact', 'driving', 'payments'],
    models: ['Driver', 'DriverVehicle', 'DriverDocument', 'DriverPayout'],
    recipients: [...hosting, 'driver_kyc', 'payout_provider'],
  },
  {
    id: 'partners',
    name: 'Partner offers and affiliate tracking',
    purpose:
      'Show partner offers and count clicks and commissions; the partner sells under its own terms.',
    basis: ['legitimate_interests'],
    subjects: ['travellers', 'guests'],
    categories: ['trips'],
    models: ['PartnerClick'],
    recipients: [...hosting, 'affiliate_networks'],
  },
  {
    id: 'reviews',
    name: 'Verified reviews',
    purpose:
      'Invite travellers to review finished trips, moderate and publish reviews with a shortened name.',
    basis: ['consent', 'legitimate_interests'],
    subjects: ['travellers', 'guests'],
    categories: ['identity', 'reviews'],
    models: ['Review'],
    recipients: [...hosting, 'email_relay'],
  },
  {
    id: 'companies',
    name: 'Company accounts',
    purpose:
      'Run company accounts: members and roles, invitations, travel policy, approvals and spend reports.',
    basis: ['contract'],
    subjects: ['company_members'],
    categories: ['identity', 'contact', 'trips'],
    models: ['CompanyMember', 'CompanyInvitation'],
    recipients: [...hosting, 'email_relay'],
  },
  {
    id: 'advertising',
    name: 'Ad measurement with consent',
    purpose:
      'Report paid bookings to ad networks for people whose recorded choice allows marketing (ADR-079).',
    basis: ['consent'],
    subjects: ['travellers', 'guests'],
    categories: ['contact', 'payments'],
    models: ['AdConversion'],
    recipients: [...hosting, 'ad_networks'],
  },
  {
    id: 'support',
    name: 'Customer support',
    purpose:
      'Answer conversations on the website, the app and WhatsApp, tied to bookings, with an after-hours assistant that answers from FAQs and booking facts.',
    basis: ['contract', 'legitimate_interests'],
    subjects: ['travellers', 'guests'],
    categories: ['contact', 'communications', 'trips'],
    models: ['SupportConversation', 'SupportMessage'],
    recipients: [...hosting, 'email_relay', 'whatsapp', 'anthropic'],
  },
  {
    id: 'ai-search',
    name: 'AI trip search',
    purpose:
      'Turn a described trip into the flight form; nothing is stored and the text is scrubbed first (ADR-061).',
    basis: ['legitimate_interests'],
    subjects: ['travellers', 'guests'],
    categories: ['trips'],
    models: [],
    recipients: [...hosting, 'anthropic'],
  },
  {
    id: 'privacy',
    name: 'Data rights requests and breach records',
    purpose:
      'Record each rights request and its answer, and each personal data breach and its regulator notices (ADR-089).',
    basis: ['legal_obligation'],
    subjects: ['travellers', 'guests'],
    categories: ['contact'],
    models: ['PrivacyRequest'],
    recipients: [...hosting],
  },
];

/** The tables that hold personal data: everything the registry does not mark `none`. */
export function personalDataModels(): RegisteredModel[] {
  return (Object.keys(DATA_REGISTRY) as RegisteredModel[]).filter(
    (model) => DATA_REGISTRY[model].deletion !== 'none',
  );
}

const plural = (days: number): string => (days === 1 ? '1 day' : `${days} days`);

/** How long a table's rows live, in words, from its registry retention. */
export function describeRetention(retention: Retention): string {
  switch (retention.kind) {
    case 'account':
      return 'While the account exists; deletion applies its treatment';
    case 'reference':
      return 'Reference data, kept while in use';
    case 'rule': {
      const days = (RETENTION_DAYS as Partial<Record<string, number>>)[retention.rule];
      if (days === undefined) return `Retention sweep \`${retention.rule}\` (period from settings)`;
      return days === 0
        ? `Retention sweep \`${retention.rule}\`: as soon as it expires`
        : `Retention sweep \`${retention.rule}\`: ${plural(days)} after the event`;
    }
    case 'job':
      return `Its own job: \`${retention.job}\``;
    case 'parent':
      return `With its ${retention.parent}`;
    case 'append-only':
      return 'Kept: append-only, ids, amounts and reasons only';
  }
}

const cell = (text: string): string => text.replace(/\|/g, '\\|');

/** The Markdown page for `docs/privacy/records-of-processing.md`. */
export function renderRecordsOfProcessing(): string {
  const lines: string[] = [
    '# Records of processing and transfers',
    '',
    '<!-- Generated by `pnpm --filter @suskii/api privacy:records` from',
    '     apps/api/src/privacy/processing-records.ts and data-registry.ts. Do not edit by hand. -->',
    '',
    'What Suskii processes, why, on which basis, for how long and who receives it (ADR-089). The',
    'NDPA, the Kenya Data Protection Act and POPIA expect a controller to be able to show this; the',
    'GDPR calls it the record of processing activities (Art. 30). Locations come from the',
    "providers' public terms: confirm each against the terms the owner signs.",
    '',
    '- **Controller:** Suskii Travels and Tours (legal entity, registration numbers and the data',
    '  protection officer to be named by the owner; see `docs/compliance/privacy-obligations.md`).',
    '- **Hosting:** Google Cloud, London (europe-west2), behind Cloudflare (ADR-059).',
    '- **Security:** field encryption, TLS everywhere, staff MFA and audit (`docs/security/`).',
    '- **Rights:** self-service export and deletion, staff-recorded requests with deadlines per law',
    '  (`docs/runbooks/data-rights-requests.md`).',
    '',
    '## Activities',
    '',
  ];
  for (const activity of PROCESSING_ACTIVITIES) {
    lines.push(`### ${activity.name}`, '');
    lines.push(`${activity.purpose}`, '');
    lines.push(
      `- **Lawful basis:** ${activity.basis.map((basis) => LAWFUL_BASES[basis]).join('; ')}`,
    );
    lines.push(
      `- **People:** ${activity.subjects.map((subject) => DATA_SUBJECTS[subject]).join('; ')}`,
    );
    lines.push(
      `- **Data:** ${activity.categories.map((category) => DATA_CATEGORIES[category]).join('; ')}`,
    );
    lines.push(
      `- **Recipients:** ${activity.recipients.map((recipient) => RECIPIENTS[recipient].name).join('; ')}`,
    );
    lines.push('');
    if (activity.models.length === 0) {
      lines.push('Nothing is stored.', '');
      continue;
    }
    lines.push('| Table | Retention | On account deletion |', '| --- | --- | --- |');
    for (const model of activity.models) {
      const treatment = DATA_REGISTRY[model];
      lines.push(
        `| \`${model}\` | ${cell(describeRetention(treatment.retention))} | ${treatment.deletion} |`,
      );
    }
    lines.push('');
  }
  lines.push(
    '## Recipients and transfers',
    '',
    'Who receives personal data, where it processes it and the basis for sending it abroad.',
    '"Not contracted" recipients run on mock adapters until the owner signs up; nothing is sent.',
    '',
    '| Recipient | Role | Receives | Location | Transfer basis | Status |',
    '| --- | --- | --- | --- | --- | --- |',
  );
  for (const recipient of Object.values(RECIPIENTS) as Recipient[]) {
    const status = recipient.setting
      ? `${recipient.status} (\`${recipient.setting}\`)`
      : recipient.status;
    lines.push(
      `| ${cell(recipient.name)} | ${recipient.role} | ${cell(recipient.receives)} | ${cell(recipient.location)} | ${cell(TRANSFER_BASES[recipient.transfer])} | ${cell(status)} |`,
    );
  }
  lines.push(
    '',
    '## Coverage',
    '',
    `All ${personalDataModels().length} tables that hold personal data belong to an activity above;`,
    `the other ${Object.keys(DATA_REGISTRY).length - personalDataModels().length} hold reference or operational data only.`,
    '',
  );
  return lines.join('\n');
}
