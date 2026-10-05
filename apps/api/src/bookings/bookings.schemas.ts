import { z } from 'zod';

import {
  ADDON_DETAIL_FIELDS,
  ADDON_PRICING_BASES,
  ADDON_PRODUCT_TYPES,
  BOOKING_STATUSES,
  CABIN_CLASSES,
  FLIGHT_NUMBER_PATTERN,
  VISA_APPLICATION_STATUSES,
  PRIME_PERIODS,
  VISA_PURPOSES,
  contactDetailsSchema,
  flightSearchRequestSchema,
  GENDERS,
  hotelGuestSchema,
  hotelSearchRequestSchema,
  localeCodeSchema,
  PASSENGER_ISSUES,
  PASSENGER_TITLES,
  PASSENGER_TYPES,
  PAYMENT_PLAN_KINDS,
  PAYMENT_PROVIDER_NAMES,
  REFUND_DESTINATIONS,
  REFUND_REASONS,
  REFUND_STATUSES,
  passengerInputSchema,
  travellerInputSchema,
} from '@suskii/shared';

import { named } from '../contract/contract';
import { moneySchema, priceSchema } from '../pricing/pricing.schemas';
import { flightOfferSchema, flightSliceSchema, hotelRateSchema } from '../search/search.schemas';

const timestamp = z.iso.datetime();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const verticalSchema = z.enum([
  'flights',
  'hotels',
  'packages',
  'tours',
  'visa',
  'travel_addons',
  'prime',
]);
const boardSchema = z.enum(['room_only', 'breakfast_included', 'half_board', 'full_board']);

export const bookingIdParamsSchema = z.object({ bookingId: z.uuid() });
export const quoteIdParamsSchema = z.object({ quoteId: z.uuid() });
export const documentParamsSchema = z.object({ bookingId: z.uuid(), documentId: z.uuid() });
export const travellerIdParamsSchema = z.object({ travellerId: z.uuid() });
export const paymentReferenceParamsSchema = z.object({
  reference: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
});
export const webhookParamsSchema = z.object({ provider: z.string().regex(/^[a-z]{2,20}$/) });

export const BOOKING_TOKEN_HEADER = {
  name: 'X-Booking-Token',
  required: false,
  description:
    'Guest bookings: the access token returned when the booking was created. Account bookings use the session instead.',
};

// ---------------------------------------------------------------------------
// Payment options (ADR-016, ADR-018)
// ---------------------------------------------------------------------------

export const PAYMENT_METHODS = ['card', 'bank_transfer', 'ussd', 'mobile_money'] as const;

export const paymentProviderOptionSchema = named(
  'PaymentProviderOption',
  z.object({
    name: z.enum(PAYMENT_PROVIDER_NAMES),
    methods: z.array(z.enum(PAYMENT_METHODS)),
  }),
);

export const scheduledPaymentSchema = named(
  'ScheduledPayment',
  z.object({
    sequence: z.number().int().meta({ description: '0 is the deposit.' }),
    dueAt: timestamp,
    amount: moneySchema,
  }),
);

export const paymentOptionsSchema = named(
  'PaymentOptions',
  z.object({
    providers: z
      .array(paymentProviderOptionSchema)
      .meta({ description: 'Enabled providers for this currency; the first is the default.' }),
    hold: z
      .object({
        deadline: timestamp.meta({
          description: 'Pay in full by then, or the seats are released.',
        }),
        total: moneySchema,
      })
      .nullable()
      .meta({ description: 'Reserve now, pay later. Not offered with paid extras.' }),
    installments: z
      .object({
        deadline: timestamp,
        total: moneySchema.meta({ description: 'Price plus fee.' }),
        fee: moneySchema,
        graceHours: z.number().int(),
        defaultFeeBps: z
          .number()
          .int()
          .meta({ description: 'Kept on a missed payment, in basis points of the amount paid.' }),
        schedule: z.array(scheduledPaymentSchema),
      })
      .nullable()
      .meta({
        description: 'Deposit now and installments; tickets are issued after the last one.',
      }),
    wallet: moneySchema
      .nullable()
      .meta({ description: 'Signed-in travellers: wallet balance in the booking currency.' }),
  }),
);
export type PaymentOptionsDto = z.infer<typeof paymentOptionsSchema>;

// ---------------------------------------------------------------------------
// In-house items (ADR-025 to ADR-028)
// ---------------------------------------------------------------------------

export const travellerCountsDtoSchema = named(
  'TravellerCounts',
  z.object({
    adults: z.number().int(),
    children: z.number().int(),
    infants: z.number().int(),
  }),
);

export const cancellationTierDtoSchema = named(
  'CancellationTier',
  z.object({
    daysBefore: z.number().int().meta({ description: 'Cancel at least this many days before.' }),
    refundBps: z.number().int().meta({ description: 'Share refunded, 10000 = everything.' }),
  }),
);

const productRefSchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  title: z.string(),
  sample: z.boolean().meta({ description: 'Demo inventory: show a "Sample" badge.' }),
  artKey: z.string().nullable(),
});

export const meetingPointDtoSchema = named(
  'MeetingPoint',
  z.object({ name: z.string(), address: z.string(), notes: z.string().nullable() }),
);

export const packageItemSchema = named(
  'PackageItem',
  z.object({
    product: productRefSchema,
    departureId: z.uuid(),
    cityName: z.string(),
    countryCode: z.string().length(2),
    nights: z.number().int(),
    startDate: isoDate,
    endDate: isoDate,
    passportRequired: z.boolean(),
    inclusions: z.array(z.string()),
    travellers: travellerCountsDtoSchema,
    cancellationPolicy: z.array(cancellationTierDtoSchema),
  }),
);

export const tourItemSchema = named(
  'TourItem',
  z.object({
    product: productRefSchema,
    departureId: z.uuid(),
    cityName: z.string(),
    countryCode: z.string().length(2),
    timeZone: z.string(),
    startsAtLocal: z.string().meta({ description: 'Wall time at the meeting point.' }),
    startsAt: timestamp,
    durationMinutes: z.number().int(),
    meetingPoint: meetingPointDtoSchema,
    inclusions: z.array(z.string()),
    travellers: travellerCountsDtoSchema,
    cancellationPolicy: z.array(cancellationTierDtoSchema),
  }),
);

export const visaApplicationSummarySchema = named(
  'VisaApplicationSummary',
  z.object({
    id: z.uuid(),
    applicantPosition: z.number().int(),
    status: z.enum(VISA_APPLICATION_STATUSES),
    submittedAt: timestamp.nullable(),
    updatedAt: timestamp,
  }),
);

export const visaItemSchema = named(
  'VisaItem',
  z.object({
    product: productRefSchema,
    destination: z.string().length(2),
    purpose: z.enum(VISA_PURPOSES),
    nationality: z.string().length(2),
    travelDate: isoDate,
    processingDaysMin: z.number().int(),
    processingDaysMax: z.number().int(),
    governmentFeeNote: z.string().nullable(),
    travellers: travellerCountsDtoSchema,
    applications: z
      .array(visaApplicationSummarySchema)
      .meta({ description: 'Opened once the booking is confirmed, one per applicant.' }),
  }),
);

export const addonItemSchema = named(
  'AddonItem',
  z.object({
    product: productRefSchema,
    type: z.enum(ADDON_PRODUCT_TYPES),
    pricingBasis: z.enum(ADDON_PRICING_BASES),
    units: z.number().int(),
    startDate: isoDate,
    endDate: isoDate,
    countryCode: z.string().length(2).nullable(),
    cityName: z.string().nullable(),
    travellers: travellerCountsDtoSchema,
    requiredDetails: z.array(z.enum(ADDON_DETAIL_FIELDS)),
    cancellationPolicy: z.array(cancellationTierDtoSchema),
    linkedBooking: z
      .object({ id: z.uuid(), reference: z.string() })
      .nullable()
      .meta({ description: 'The trip this add-on belongs to (ADR-027).' }),
  }),
);

/** What a Prime plan gives, as customers see it: the margin share itself stays internal. */
export const primeBenefitsDtoSchema = named(
  'PrimeBenefitsView',
  z.object({
    memberFares: z.boolean().meta({ description: 'Members get lower fares on eligible trips.' }),
    waivedFeeCodes: z
      .array(z.string())
      .meta({ description: 'Fee codes (as in price `fees`) members do not pay.' }),
    prioritySupport: z.boolean(),
  }),
);

export const membershipItemSchema = named(
  'MembershipItem',
  z.object({
    product: productRefSchema,
    summary: z.string(),
    period: z.enum(PRIME_PERIODS),
    benefits: primeBenefitsDtoSchema,
    term: z.object({ startsAt: timestamp, endsAt: timestamp }).nullable().meta({
      description:
        'Set once the booking is confirmed; a member buying again extends from their current end.',
    }),
  }),
);

// ---------------------------------------------------------------------------
// Quotes (checkout)
// ---------------------------------------------------------------------------

export const quoteSchema = named(
  'Quote',
  z.object({
    quoteId: z.uuid(),
    vertical: verticalSchema,
    currency: z.string().length(3),
    expiresAt: timestamp,
    termsVersion: z.string().meta({ description: 'Send back as `termsVersion` when booking.' }),
    flight: z.object({ offer: flightOfferSchema, request: flightSearchRequestSchema }).nullable(),
    hotel: z
      .object({
        name: z.string(),
        stars: z.number().int(),
        area: z.string().nullable(),
        cityName: z.string(),
        countryCode: z.string().length(2),
        amenities: z.array(z.string()),
        rate: hotelRateSchema,
        nights: z.number().int(),
        request: hotelSearchRequestSchema,
      })
      .nullable(),
    package: packageItemSchema.nullable(),
    tour: tourItemSchema.nullable(),
    visa: visaItemSchema.nullable(),
    addon: addonItemSchema.nullable(),
    membership: membershipItemSchema.nullable(),
    price: priceSchema.nullable().meta({
      description: 'In-house products: the priced total (flights and hotels: in the offer).',
    }),
    payment: paymentOptionsSchema,
  }),
);

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export const extraSelectionSchema = named(
  'ExtraSelection',
  z.object({
    serviceId: z.string().min(1).max(200),
    passengerIndex: z
      .number()
      .int()
      .min(0)
      .max(8)
      .meta({ description: 'Position in `passengers` as sent.' }),
    quantity: z.number().int().min(1).max(4),
  }),
);

export const createBookingRequestSchema = named(
  'CreateBookingRequest',
  z.object({
    quoteId: z.uuid(),
    contact: contactDetailsSchema,
    passengers: z.array(passengerInputSchema).max(9).default([]).meta({
      description:
        'Flights, packages, tours, visa assistance and add-ons: every traveller the quote was priced for.',
    }),
    guests: z
      .array(hotelGuestSchema)
      .max(8)
      .default([])
      .meta({ description: 'Hotels: one lead guest per room, in room order.' }),
    extras: z.array(extraSelectionSchema).max(18).default([]),
    addonDetails: z
      .object({
        flightNumber: z
          .string()
          .trim()
          .toUpperCase()
          .regex(FLIGHT_NUMBER_PATTERN, 'Use the flight number, for example P4 7121')
          .nullable()
          .default(null),
        arrivalTime: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, 'Use local time YYYY-MM-DDTHH:mm')
          .nullable()
          .default(null),
        pickupAddress: z.string().trim().min(5).max(300).nullable().default(null),
      })
      .nullable()
      .default(null)
      .meta({ description: 'Add-ons: the details the product asks for (`requiredDetails`).' }),
    promoCode: z.string().trim().min(3).max(32).nullable().default(null),
    termsVersion: z.string().min(1).max(32),
    acceptTerms: z.literal(true),
    locale: localeCodeSchema.default('en-NG'),
    turnstileToken: z.string().min(1).max(2048).nullable().default(null).meta({
      description: 'Cloudflare Turnstile token (action `checkout`); required for guests.',
    }),
  }),
);
export type CreateBookingRequest = z.output<typeof createBookingRequestSchema>;

// ---------------------------------------------------------------------------
// Booking
// ---------------------------------------------------------------------------

export const bookingExtraSchema = named(
  'BookingExtra',
  z.object({
    serviceId: z.string(),
    type: z.literal('checked_bag'),
    weightKg: z.number().int(),
    quantity: z.number().int(),
    unitPrice: moneySchema,
    amount: moneySchema,
  }),
);

export const bookingPriceSchema = named(
  'BookingPrice',
  priceSchema.extend({
    extras: z
      .array(bookingExtraSchema)
      .meta({ description: 'Sold at supplier cost, no discount.' }),
    total: moneySchema.meta({ description: 'fare + taxes + fees - discount + extras.' }),
  }),
);
export type BookingPriceDto = z.infer<typeof bookingPriceSchema>;

export const bookingPriceChangeSchema = named(
  'BookingPriceChange',
  z.object({
    previous: moneySchema,
    current: moneySchema,
    difference: moneySchema,
    price: bookingPriceSchema,
  }),
);

const maskedDocumentSchema = z.object({
  hint: z.string().meta({ description: 'Last three characters of the passport number.' }),
  issuingCountry: z.string().length(2),
  expiryDate: isoDate,
});

export const passengerIssueSchema = named(
  'PassengerIssue',
  z.object({
    index: z.number().int().nullable(),
    path: z.array(z.string()),
    code: z.enum(Object.values(PASSENGER_ISSUES) as [string, ...string[]]),
  }),
);

export const bookingPassengerSchema = named(
  'BookingPassenger',
  z.object({
    position: z.number().int(),
    type: z.enum(PASSENGER_TYPES),
    title: z.enum(PASSENGER_TITLES).nullable(),
    givenNames: z.string(),
    surname: z.string(),
    dateOfBirth: isoDate.nullable(),
    roomIndex: z.number().int().nullable(),
    document: maskedDocumentSchema.nullable(),
    ticketNumber: z.string().nullable(),
    extraBags: z.number().int(),
  }),
);

export const paymentPlanSchema = named(
  'PaymentPlan',
  z.object({
    kind: z.enum(PAYMENT_PLAN_KINDS),
    status: z.enum(['active', 'completed', 'defaulted', 'cancelled', 'expired']),
    deadline: timestamp,
    total: moneySchema,
    fee: moneySchema,
    graceHours: z.number().int(),
    defaultFeeBps: z.number().int(),
    installments: z.array(
      z.object({
        id: z.uuid(),
        sequence: z.number().int(),
        dueAt: timestamp,
        amount: moneySchema,
        status: z.enum(['pending', 'paid', 'cancelled']),
        paidAt: timestamp.nullable(),
      }),
    ),
  }),
);

export const bookingRefundSchema = named(
  'BookingRefund',
  z.object({
    id: z.uuid(),
    amount: moneySchema,
    destination: z.enum(REFUND_DESTINATIONS),
    status: z
      .enum(['in_progress', 'completed', 'failed'])
      .meta({ description: 'Customer view; staff see the full lifecycle.' }),
    createdAt: timestamp,
    settledAt: timestamp.nullable(),
  }),
);

export const bookingSchema = named(
  'Booking',
  z.object({
    id: z.uuid(),
    reference: z.string(),
    status: z.enum(BOOKING_STATUSES),
    vertical: verticalSchema,
    createdAt: timestamp,
    paymentDeadline: timestamp.nullable(),
    confirmedAt: timestamp.nullable(),
    contact: z.object({ email: z.string(), phone: z.string() }).meta({ description: 'Masked.' }),
    price: bookingPriceSchema,
    pendingPriceChange: bookingPriceChangeSchema
      .nullable()
      .meta({ description: 'A re-priced total waiting for consent (`price-consent`).' }),
    flight: z
      .object({
        owner: z.object({ code: z.string(), name: z.string() }),
        slices: z.array(flightSliceSchema),
        baggage: z.object({ carryOn: z.number().int(), checked: z.number().int() }),
        conditions: z.object({ refundable: z.boolean(), changeable: z.boolean() }),
        cabinClass: z.enum(CABIN_CLASSES),
        airlineReference: z.string().nullable(),
        request: flightSearchRequestSchema,
      })
      .nullable(),
    hotel: z
      .object({
        name: z.string(),
        stars: z.number().int(),
        area: z.string().nullable(),
        cityName: z.string(),
        countryCode: z.string().length(2),
        checkIn: isoDate,
        checkOut: isoDate,
        nights: z.number().int(),
        rooms: z.number().int(),
        roomName: z.string(),
        board: boardSchema,
        refundable: z.boolean(),
        freeCancellationUntil: timestamp.nullable(),
        payAtProperty: moneySchema.nullable(),
        confirmationNumber: z.string().nullable(),
        request: hotelSearchRequestSchema,
      })
      .nullable(),
    package: packageItemSchema.nullable(),
    tour: tourItemSchema.nullable(),
    visa: visaItemSchema.nullable(),
    addon: addonItemSchema.nullable(),
    membership: membershipItemSchema.nullable(),
    voucher: z
      .object({
        code: z
          .string()
          .meta({ description: 'Grouped for display, e.g. ABCD-EFGH-JKMN-PQRS-TUVW.' }),
        qrPayload: z.string().meta({ description: 'What the QR code encodes (no personal data).' }),
        redeemedAt: timestamp.nullable(),
      })
      .nullable()
      .meta({ description: 'Confirmed packages, tours and add-ons (ADR-028).' }),
    cancellation: z
      .object({
        refundBps: z.number().int(),
        refund: moneySchema.meta({ description: 'What cancelling now would refund.' }),
      })
      .nullable()
      .meta({ description: 'Confirmed packages, tours and add-ons the traveller can cancel.' }),
    addons: z
      .array(
        z.object({
          id: z.uuid(),
          reference: z.string(),
          status: z.enum(BOOKING_STATUSES),
          title: z.string(),
          type: z.enum(ADDON_PRODUCT_TYPES),
        }),
      )
      .meta({ description: 'Add-ons bought for this trip by the same traveller.' }),
    passengers: z.array(bookingPassengerSchema),
    warnings: z.array(passengerIssueSchema),
    payment: z
      .object({
        id: z.uuid(),
        status: z.enum(['pending', 'succeeded', 'failed', 'cancelled', 'expired']),
        amount: moneySchema,
        checkoutUrl: z
          .string()
          .nullable()
          .meta({ description: 'Set while the session can still be paid.' }),
        expiresAt: timestamp,
      })
      .nullable()
      .meta({ description: 'The latest payment attempt.' }),
    documents: z.array(
      z.object({
        id: z.uuid(),
        type: z.enum([
          'e_ticket',
          'hotel_voucher',
          'package_voucher',
          'tour_voucher',
          'addon_voucher',
          'visa_confirmation',
        ]),
        fileName: z.string(),
        sizeBytes: z.number().int(),
        createdAt: timestamp,
      }),
    ),
    paid: moneySchema.meta({ description: 'Received so far and not refunded.' }),
    amountDue: moneySchema.nullable().meta({
      description: 'What the next payment would be (installment or balance), if payable.',
    }),
    paymentPlan: paymentPlanSchema.nullable(),
    paymentOptions: paymentOptionsSchema
      .nullable()
      .meta({ description: 'How the booking can be paid now; null when nothing is payable.' }),
    refunds: z.array(bookingRefundSchema),
  }),
);
export type BookingDto = z.infer<typeof bookingSchema>;

export const createdBookingSchema = named(
  'CreatedBooking',
  z.object({
    booking: bookingSchema,
    accessToken: z.string().nullable().meta({
      description:
        'Guest bookings only, returned once: send it as `X-Booking-Token`. It cannot be recovered.',
    }),
  }),
);

export const startPaymentRequestSchema = named(
  'StartPaymentRequest',
  z.object({
    provider: z
      .enum(PAYMENT_PROVIDER_NAMES)
      .nullable()
      .default(null)
      .meta({ description: 'One of `paymentOptions.providers`; the default when null.' }),
    installmentId: z
      .uuid()
      .nullable()
      .default(null)
      .meta({ description: 'Payment plans: the installment to pay (default: the next one).' }),
    payInFull: z
      .boolean()
      .default(false)
      .meta({ description: 'Payment plans: pay the whole remaining balance now.' }),
    useWallet: z
      .boolean()
      .default(false)
      .meta({ description: 'Pay from the wallet; it must cover the whole amount.' }),
  }),
);
export type StartPaymentRequest = z.output<typeof startPaymentRequestSchema>;

export const paymentSessionSchema = named(
  'PaymentSession',
  z.object({
    paymentId: z.uuid(),
    status: z
      .enum(['pending', 'succeeded'])
      .meta({ description: '`succeeded` when the wallet paid at once (no checkout).' }),
    checkoutUrl: z.string().nullable().meta({
      description: 'Send the traveller here (hosted checkout); null for wallet payments.',
    }),
    amount: moneySchema,
    expiresAt: timestamp,
  }),
);

export const priceConsentRequestSchema = named(
  'PriceConsentRequest',
  z.object({
    total: moneySchema.meta({ description: 'The new total exactly as shown to the traveller.' }),
  }),
);

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

export const webhookReceiptSchema = named(
  'WebhookReceipt',
  z.object({ received: z.literal(true) }),
);

export const mockPaymentSchema = named(
  'MockPayment',
  z.object({
    reference: z.string(),
    bookingReference: z.string(),
    amount: moneySchema,
    status: z.enum(['pending', 'succeeded', 'failed', 'cancelled', 'expired']),
    expiresAt: timestamp,
    returnUrl: z.string(),
  }),
);

export const mockPaymentCompleteRequestSchema = named(
  'MockPaymentCompleteRequest',
  z.object({ outcome: z.enum(['succeeded', 'failed']) }),
);

export const mockPaymentResultSchema = named(
  'MockPaymentResult',
  z.object({
    status: z.enum(['pending', 'succeeded', 'failed', 'cancelled', 'expired']),
    returnUrl: z.string(),
  }),
);

// ---------------------------------------------------------------------------
// Saved travellers
// ---------------------------------------------------------------------------

export const travellerRequestSchema = named('TravellerRequest', travellerInputSchema);

export const travellerSchema = named(
  'Traveller',
  z.object({
    id: z.uuid(),
    title: z.enum(PASSENGER_TITLES),
    gender: z.enum(GENDERS),
    givenNames: z.string(),
    surname: z.string(),
    dateOfBirth: isoDate,
    nationality: z.string().length(2),
    document: maskedDocumentSchema.nullable(),
    createdAt: timestamp,
    updatedAt: timestamp,
  }),
);
export type TravellerDto = z.infer<typeof travellerSchema>;

export const travellerListSchema = named(
  'TravellerList',
  z.object({ travellers: z.array(travellerSchema) }),
);

// ---------------------------------------------------------------------------
// Internal (worker)
// ---------------------------------------------------------------------------

export const expiryRunSchema = named('BookingExpiryRun', z.object({ expired: z.number().int() }));

export const ticketingRunSchema = named(
  'TicketingRun',
  z.object({
    attempted: z.number().int(),
    confirmed: z.number().int(),
    retrying: z.number().int(),
    exhausted: z.number().int(),
  }),
);

export const paymentRunSchema = named(
  'PaymentReconciliationRun',
  z.object({ checked: z.number().int(), settled: z.number().int() }),
);

export const planRunSchema = named(
  'PaymentPlanRun',
  z.object({
    reminders: z.number().int(),
    defaulted: z.number().int(),
    expired: z.number().int(),
  }),
);

export const refundRunSchema = named(
  'RefundRun',
  z.object({ executed: z.number().int(), settled: z.number().int(), review: z.number().int() }),
);

// ---------------------------------------------------------------------------
// Admin refunds (ADR-019)
// ---------------------------------------------------------------------------

export const refundIdParamsSchema = z.object({ refundId: z.uuid() });

export const adminRefundSchema = named(
  'AdminRefund',
  z.object({
    id: z.uuid(),
    bookingId: z.uuid(),
    bookingReference: z.string(),
    paymentId: z.uuid(),
    provider: z.string(),
    amount: moneySchema,
    destination: z.enum(REFUND_DESTINATIONS),
    reason: z.enum(REFUND_REASONS),
    status: z.enum(REFUND_STATUSES),
    automatic: z.boolean(),
    cancelsBooking: z.boolean(),
    note: z.string().nullable(),
    requestedByUserId: z.uuid().nullable(),
    approvedByUserId: z.uuid().nullable(),
    approvedAt: timestamp.nullable(),
    rejectionReason: z.string().nullable(),
    providerRefundId: z.string().nullable(),
    failureReason: z.string().nullable(),
    attempts: z.number().int(),
    createdAt: timestamp,
    updatedAt: timestamp,
    settledAt: timestamp.nullable(),
  }),
);
export type AdminRefundDto = z.infer<typeof adminRefundSchema>;

export const adminRefundListSchema = named(
  'AdminRefundList',
  z.object({ refunds: z.array(adminRefundSchema) }),
);

export const adminRefundQuerySchema = z.object({
  status: z.enum(REFUND_STATUSES).optional(),
  bookingId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

/** Staff can choose these; the others are set by the system. */
export const STAFF_REFUND_REASONS = [
  'customer_cancellation',
  'goodwill',
  'supplier_cancellation',
  'ticketing_failed',
  'duplicate_payment',
  'other',
] as const;

export const createRefundRequestSchema = named(
  'CreateRefundRequest',
  z.object({
    paymentId: z.uuid(),
    amount: moneySchema,
    destination: z.enum(REFUND_DESTINATIONS).default('original'),
    reason: z.enum(STAFF_REFUND_REASONS),
    note: z.string().trim().max(500).nullable().default(null),
    cancelBooking: z
      .boolean()
      .default(false)
      .meta({ description: 'Moves the booking to REFUND_PENDING and REFUNDED once repaid.' }),
  }),
);
export type CreateRefundRequest = z.output<typeof createRefundRequestSchema>;

export const rejectRefundRequestSchema = named(
  'RejectRefundRequest',
  z.object({ reason: z.string().trim().min(3).max(300) }),
);

export const resolveRefundRequestSchema = named(
  'ResolveRefundRequest',
  z.object({
    outcome: z.enum(['succeeded', 'failed']),
    providerRefundId: z.string().trim().min(1).max(100).nullable().default(null),
  }),
);

// ---------------------------------------------------------------------------
// Trips list (mobile Trips tab, ADR-020)
// ---------------------------------------------------------------------------

const summaryPlaceSchema = z.object({ code: z.string(), cityName: z.string().nullable() });

export const bookingSummarySchema = named(
  'BookingSummary',
  z.object({
    id: z.uuid(),
    reference: z.string(),
    status: z.enum(BOOKING_STATUSES),
    vertical: verticalSchema,
    createdAt: timestamp,
    total: moneySchema,
    startsOn: z.string().meta({ description: 'Local date of the first departure or check-in.' }),
    endsOn: z
      .string()
      .nullable()
      .meta({ description: 'Local date of the last departure or check-out; null one-way.' }),
    flight: z
      .object({
        tripType: z.enum(['one_way', 'round_trip', 'multi_city']),
        origin: summaryPlaceSchema,
        destination: summaryPlaceSchema,
        airline: z.string(),
      })
      .nullable(),
    hotel: z.object({ name: z.string(), cityName: z.string() }).nullable(),
    product: z
      .object({
        title: z.string(),
        cityName: z.string().nullable(),
        countryCode: z.string().length(2).nullable(),
      })
      .nullable()
      .meta({ description: 'Packages, tours, visa assistance and add-ons.' }),
  }),
);
export type BookingSummaryDto = z.infer<typeof bookingSummarySchema>;

export const bookingSummaryPageSchema = named(
  'BookingSummaryPage',
  z.object({
    bookings: z.array(bookingSummarySchema),
    nextCursor: z.uuid().nullable().meta({ description: 'Pass as `cursor` for the next page.' }),
  }),
);

export const bookingListQuerySchema = z.object({
  cursor: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
