import { z } from 'zod';

import {
  BUS_SEAT_STATES,
  BUS_TICKET_STATUSES,
  BUS_TRIP_STATUSES,
  busSeatLayoutSchema,
  cancellationPolicySchema,
  MAX_SEATS_PER_HOLD,
  seatSelectionSchema,
  slugSchema,
} from '@suskii/shared';

import { named } from '../contract/contract';
import { moneySchema } from '../pricing/pricing.schemas';
import { currencyQuerySchema } from '../search/search.schemas';

/** Interstate buses (ADR-049, ADR-051): search, seat maps, holds, tickets and boarding. */

const timestamp = z.iso.datetime();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const localDateTime = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, 'Use YYYY-MM-DDTHH:mm (local time)');
const cityName = z.string().trim().min(2).max(80);

export const tripIdParamsSchema = z.object({ tripId: z.uuid() });
export const holdIdParamsSchema = z.object({ holdId: z.uuid() });
export const idParamsSchema = z.object({ id: z.uuid() });

export const HOLD_TOKEN_HEADER = {
  name: 'X-Hold-Token',
  required: false,
  description: "Guest seat holds: the hold's `holdToken`. Account holds use the session instead.",
};

const terminalRefSchema = z.object({
  terminalId: z.uuid(),
  name: z.string(),
  cityName: z.string(),
  address: z.string(),
});

export const busCitiesSchema = named(
  'BusCities',
  z.object({
    cities: z.array(
      z.object({
        name: z.string(),
        stateName: z.string(),
        terminals: z.array(z.object({ id: z.uuid(), name: z.string(), address: z.string() })),
      }),
    ),
  }),
);

export const busSearchQuerySchema = currencyQuerySchema.extend({
  from: cityName.meta({ description: 'Origin city, as listed by `listBusCities`.' }),
  to: cityName,
  date: isoDate.meta({ description: 'Departure date, local to the origin.' }),
  seats: z.coerce.number().int().min(1).max(MAX_SEATS_PER_HOLD).default(1),
});
export type BusSearchQuery = z.output<typeof busSearchQuerySchema>;

export const busTripCardSchema = named(
  'BusTripCard',
  z.object({
    id: z.uuid(),
    operator: z.object({
      id: z
        .uuid()
        .meta({ description: 'Its verified reviews: `GET /v1/reviews?kind=bus_operator&ref=`.' }),
      name: z.string(),
      slug: z.string(),
    }),
    sample: z.boolean().meta({ description: 'Demo inventory: show a "Sample" badge.' }),
    origin: terminalRefSchema,
    destination: terminalRefSchema,
    timeZone: z.string(),
    departsAtLocal: z.string(),
    departsAt: timestamp,
    arrivesAt: timestamp,
    durationMinutes: z.number().int(),
    coach: z.string(),
    amenities: z.array(z.string()),
    seatsLeft: z.number().int(),
    pricePerSeat: moneySchema.meta({
      description: 'For the caller in the display currency; the quote prices the seats exactly.',
    }),
  }),
);

export const busSearchResultSchema = named(
  'BusSearchResult',
  z.object({ trips: z.array(busTripCardSchema) }),
);

export const busTripQuerySchema = currencyQuerySchema;

export const busSeatSchema = z.object({
  seatNumber: z.string(),
  state: z.enum(BUS_SEAT_STATES),
});

export const busTripDetailSchema = named(
  'BusTripDetail',
  busTripCardSchema.extend({
    status: z.enum(BUS_TRIP_STATUSES),
    seatMap: z.object({
      rows: z.array(z.array(busSeatSchema.nullable())).meta({
        description: 'Front to back, left to right; null is the aisle or an empty space.',
      }),
    }),
    cancellationPolicy: z.array(
      z.object({ daysBefore: z.number().int(), refundBps: z.number().int() }),
    ),
  }),
);

export const createHoldSchema = z.object({ seats: seatSelectionSchema });
export type CreateHoldRequest = z.output<typeof createHoldSchema>;

export const busHoldSchema = named(
  'BusHold',
  z.object({
    holdId: z.uuid(),
    holdToken: z.string().nullable().meta({
      description:
        'Guests only: send it as `holdToken` with the quote and in `X-Hold-Token` to release the hold. Shown once.',
    }),
    tripId: z.uuid(),
    seats: z.array(z.string()),
    expiresAt: timestamp,
  }),
);

export const ticketKeysSchema = named(
  'BusTicketKeys',
  z.object({
    keys: z
      .array(z.object({ kid: z.string(), spki: z.string() }))
      .meta({ description: 'Ed25519 public keys (base64 SPKI PEM) for offline ticket checks.' }),
  }),
);

// ---------------------------------------------------------------------------
// Operator agents (ADR-050)
// ---------------------------------------------------------------------------

export const operatorTripsQuerySchema = z.object({ date: isoDate });

export const operatorTripSchema = named(
  'OperatorTrip',
  z.object({
    id: z.uuid(),
    operatorName: z.string(),
    origin: z.string(),
    destination: z.string(),
    departsAtLocal: z.string(),
    status: z.enum(BUS_TRIP_STATUSES),
    seatCount: z.number().int(),
    sold: z.number().int(),
    boarded: z.number().int(),
  }),
);
export const operatorTripListSchema = named(
  'OperatorTripList',
  z.object({ trips: z.array(operatorTripSchema) }),
);

export const manifestSchema = named(
  'BusManifest',
  z.object({
    tripId: z.uuid(),
    passengers: z.array(
      z.object({
        ticketId: z.uuid(),
        seatNumber: z.string(),
        passengerName: z.string(),
        status: z.enum(BUS_TICKET_STATUSES),
        boardedAt: timestamp.nullable(),
      }),
    ),
  }),
);

const qrPayloadSchema = z.string().min(20).max(1000);

export const scanRequestSchema = z.object({ qrPayload: qrPayloadSchema });

export const SCAN_RESULTS = ['boarded', 'already_boarded', 'void', 'not_found', 'invalid'] as const;

export const scanResultSchema = named(
  'TicketScanResult',
  z.object({
    result: z.enum(SCAN_RESULTS),
    reason: z
      .enum(['malformed', 'bad_signature', 'unknown_key', 'not_yet_valid', 'expired'])
      .nullable()
      .meta({ description: 'Why the code is invalid (`invalid` only).' }),
    ticket: z
      .object({
        id: z.uuid(),
        tripId: z.uuid(),
        seatNumber: z.string(),
        passengerName: z.string(),
        boardedAt: timestamp.nullable(),
      })
      .nullable(),
  }),
);

export const syncScansRequestSchema = z.object({
  scans: z
    .array(z.object({ qrPayload: qrPayloadSchema, scannedAt: timestamp }))
    .min(1)
    .max(200),
});

export const syncScansResultSchema = named(
  'TicketScanSync',
  z.object({ results: z.array(scanResultSchema) }),
);

// ---------------------------------------------------------------------------
// Admin inventory (ground:manage)
// ---------------------------------------------------------------------------

const text = (max: number) => z.string().trim().min(1).max(max);
const minor = z.number().int().positive().max(1_000_000_000);
const status = z.enum(['draft', 'published', 'archived']);

export const createOperatorSchema = z.object({
  slug: slugSchema,
  name: text(120),
  cancellationPolicy: cancellationPolicySchema,
});
export const updateOperatorSchema = z
  .object({ name: text(120), status, cancellationPolicy: cancellationPolicySchema })
  .partial();

export const createTerminalSchema = z.object({
  slug: slugSchema,
  name: text(120),
  cityName: text(80),
  stateName: text(80),
  countryCode: z.string().regex(/^[A-Z]{2}$/),
  address: text(300),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  timeZone: z.string().min(3).max(64),
});
export const updateTerminalSchema = createTerminalSchema
  .omit({ slug: true })
  .extend({ active: z.boolean() })
  .partial();

export const createRouteSchema = z.object({
  operatorId: z.uuid(),
  originId: z.uuid(),
  destinationId: z.uuid(),
  distanceKm: z.number().int().min(1).max(3000),
  durationMinutes: z.number().int().min(10).max(3000),
});
export const updateRouteSchema = createRouteSchema
  .pick({ distanceKm: true, durationMinutes: true })
  .extend({ active: z.boolean() })
  .partial();

export const createLayoutSchema = z.object({
  operatorId: z.uuid(),
  name: text(80),
  layout: busSeatLayoutSchema,
  amenities: z.array(z.string().regex(/^[a-z_]{2,40}$/)).max(20),
});
export const updateLayoutSchema = createLayoutSchema.omit({ operatorId: true }).partial();

export const createTripSchema = z.object({
  routeId: z.uuid(),
  layoutId: z.uuid(),
  departsAtLocal: localDateTime,
  fareMinor: minor,
  currency: z.string().regex(/^[A-Z]{3}$/),
});

export const scheduleTripsSchema = z.object({
  routeId: z.uuid(),
  layoutId: z.uuid(),
  fromDate: isoDate,
  toDate: isoDate,
  times: z
    .array(z.string().regex(/^\d{2}:\d{2}$/))
    .min(1)
    .max(12),
  fareMinor: minor,
  currency: z.string().regex(/^[A-Z]{3}$/),
});

export const updateTripSchema = z
  .object({
    fareMinor: minor,
    blockedSeats: z.array(z.string()).max(60),
    status: z.enum(['scheduled', 'boarding', 'departed']),
  })
  .partial();

export const cancelTripSchema = z.object({
  reason: z.enum(['operator_cancelled', 'weather', 'security', 'vehicle_fault', 'other']),
});

export const adminTripQuerySchema = z.object({
  routeId: z.uuid().optional(),
  from: isoDate,
  to: isoDate,
});

export const groundCreatedSchema = named('GroundCreated', z.object({ id: z.uuid() }));
export const tripsScheduledSchema = named(
  'TripsScheduled',
  z.object({ created: z.number().int(), skipped: z.number().int() }),
);
export const tripCancelledSchema = named(
  'TripCancelled',
  z.object({ refundedBookings: z.number().int(), releasedBookings: z.number().int() }),
);

export const adminOperatorListSchema = named(
  'AdminBusOperators',
  z.object({
    operators: z.array(
      z.object({
        id: z.uuid(),
        slug: z.string(),
        name: z.string(),
        status,
        sample: z.boolean(),
        cancellationPolicy: z.array(
          z.object({ daysBefore: z.number().int(), refundBps: z.number().int() }),
        ),
        agents: z.number().int(),
      }),
    ),
  }),
);

export const adminTerminalListSchema = named(
  'AdminBusTerminals',
  z.object({
    terminals: z.array(
      z.object({
        id: z.uuid(),
        slug: z.string(),
        name: z.string(),
        cityName: z.string(),
        stateName: z.string(),
        countryCode: z.string(),
        address: z.string(),
        lat: z.number(),
        lng: z.number(),
        timeZone: z.string(),
        active: z.boolean(),
        sample: z.boolean(),
      }),
    ),
  }),
);

export const adminRouteListSchema = named(
  'AdminBusRoutes',
  z.object({
    routes: z.array(
      z.object({
        id: z.uuid(),
        operatorId: z.uuid(),
        operatorName: z.string(),
        originId: z.uuid(),
        origin: z.string(),
        destinationId: z.uuid(),
        destination: z.string(),
        distanceKm: z.number().int(),
        durationMinutes: z.number().int(),
        active: z.boolean(),
      }),
    ),
  }),
);

export const adminLayoutListSchema = named(
  'AdminBusLayouts',
  z.object({
    layouts: z.array(
      z.object({
        id: z.uuid(),
        operatorId: z.uuid(),
        name: z.string(),
        seatCount: z.number().int(),
        amenities: z.array(z.string()),
        layout: z.object({ rows: z.array(z.array(z.string().nullable())) }),
      }),
    ),
  }),
);

export const adminTripListSchema = named(
  'AdminBusTrips',
  z.object({
    trips: z.array(
      z.object({
        id: z.uuid(),
        routeId: z.uuid(),
        layoutId: z.uuid(),
        operatorName: z.string(),
        origin: z.string(),
        destination: z.string(),
        departsAtLocal: z.string(),
        departsAt: timestamp,
        status: z.enum(BUS_TRIP_STATUSES),
        fare: moneySchema,
        seatCount: z.number().int(),
        sold: z.number().int(),
        blockedSeats: z.array(z.string()),
        sample: z.boolean(),
      }),
    ),
  }),
);

export const agentParamsSchema = z.object({ id: z.uuid(), userId: z.uuid() });
