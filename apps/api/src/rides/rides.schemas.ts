import { z } from 'zod';

import {
  emergencyContactsSchema,
  INCIDENT_KINDS,
  INCIDENT_STATUSES,
  RIDE_CATEGORIES,
  RIDE_STATUSES,
  ratingSchema,
  ridePinSchema,
} from '@suskii/shared';

import { named } from '../contract/contract';
import { moneySchema } from '../pricing/pricing.schemas';

/** Intrastate rides (ADR-049 to ADR-053): places, rides, driver actions, safety and sharing. */

const timestamp = z.iso.datetime();
const coordinate = (min: number, max: number) =>
  z.number().refine(Number.isFinite, 'must_be_finite').min(min).max(max);

/** A point; the service area (Nigeria, or West Africa when enabled) is checked by the API. */
export const pointSchema = z.object({
  lat: coordinate(-90, 90),
  lng: coordinate(-180, 180),
});

export const rideStopInputSchema = pointSchema.extend({
  label: z.string().trim().min(1).max(200),
});

export const rideIdParamsSchema = z.object({ rideId: z.uuid() });
export const offerIdParamsSchema = z.object({ offerId: z.uuid() });
export const shareTokenParamsSchema = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{20,64}$/),
});
export const idParamsSchema = z.object({ id: z.uuid() });

/** Why a ride cannot be quoted (`quote-invalid` with `code`). */
export const RIDE_QUOTE_ISSUES = {
  outsideServiceArea: 'outside_service_area',
  tooShort: 'too_short',
  tooLong: 'too_long',
  pickupTimeInvalid: 'pickup_time_invalid',
  categoryUnavailable: 'category_unavailable',
} as const;

export const ridePlacesQuerySchema = z.object({
  city: z.string().trim().min(2).max(80).optional(),
});

export const ridePlacesSchema = named(
  'RidePlaces',
  z.object({
    places: z.array(
      z.object({
        id: z.uuid(),
        name: z.string(),
        kind: z.enum(['airport', 'terminal', 'landmark']),
        cityName: z.string(),
        lat: z.number(),
        lng: z.number(),
        sample: z.boolean(),
      }),
    ),
  }),
);

const positionSchema = z
  .object({ lat: z.number(), lng: z.number(), at: timestamp })
  .nullable()
  .meta({ description: 'Rounded to about 110 m; only while the ride is live.' });

const driverViewSchema = z
  .object({
    firstName: z.string(),
    rating: z.number().nullable(),
    vehicle: z.object({
      make: z.string(),
      model: z.string(),
      colour: z.string(),
      plate: z.string(),
    }),
  })
  .nullable();

/** A ride as its rider sees it. */
export const rideSchema = named(
  'Ride',
  z.object({
    id: z.uuid(),
    bookingId: z.uuid(),
    status: z.enum(RIDE_STATUSES),
    category: z.enum(RIDE_CATEGORIES),
    cityName: z.string(),
    pickup: z.object({ label: z.string(), lat: z.number(), lng: z.number() }),
    dropoff: z.object({ label: z.string(), lat: z.number(), lng: z.number() }),
    scheduledFor: timestamp.nullable(),
    polyline: z.string(),
    distanceMetres: z.number().int(),
    durationSeconds: z.number().int(),
    fare: moneySchema,
    pin: z.string().nullable().meta({
      description: 'Tell the driver this code to start the trip (rider only, until started).',
    }),
    driver: driverViewSchema,
    driverPosition: positionSchema,
    etaSeconds: z.number().int().nullable(),
    assignedAt: timestamp.nullable(),
    arrivedAt: timestamp.nullable(),
    startedAt: timestamp.nullable(),
    completedAt: timestamp.nullable(),
    cancelledAt: timestamp.nullable(),
    cancelledBy: z.enum(['rider', 'driver', 'staff', 'system']).nullable(),
    cancellationFee: moneySchema.nullable(),
    rated: z.boolean().meta({ description: 'The rider has rated this ride.' }),
    sharing: z
      .object({ expiresAt: timestamp })
      .nullable()
      .meta({ description: 'A live share link exists (the token is shown only when created).' }),
  }),
);
export type RideDto = z.infer<typeof rideSchema>;

export const rideListQuerySchema = z.object({
  cursor: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export const rideListSchema = named(
  'RideList',
  z.object({ rides: z.array(rideSchema), nextCursor: z.uuid().nullable() }),
);

export const cancelRideSchema = named(
  'RideCancellation',
  z.object({
    ride: rideSchema,
    fee: moneySchema.meta({ description: 'Kept; zero within the free window.' }),
    refund: moneySchema.meta({ description: 'Going back to how the rider paid.' }),
  }),
);

export const rateRideSchema = ratingSchema;

export const sosRequestSchema = z.object({
  position: pointSchema.nullable().default(null),
});
export const sosResultSchema = named(
  'SosResult',
  z.object({
    incidentId: z.uuid(),
    contactsNotified: z.number().int(),
    emergencyNumber: z
      .string()
      .meta({ description: 'Call the emergency services on this number.' }),
  }),
);

export const shareCreatedSchema = named(
  'RideShareCreated',
  z.object({
    token: z.string().meta({ description: 'Shown once; the link is /ride/shared/{token}.' }),
    expiresAt: timestamp,
  }),
);

/** What a share link shows: no rider data, the driver's first name and a rounded position. */
export const sharedRideSchema = named(
  'SharedRide',
  z.object({
    status: z.enum(RIDE_STATUSES),
    cityName: z.string(),
    pickupLabel: z.string(),
    dropoffLabel: z.string(),
    driver: driverViewSchema,
    driverPosition: positionSchema,
    etaSeconds: z.number().int().nullable(),
    updatedAt: timestamp,
  }),
);

export const emergencyContactsBodySchema = z.object({ contacts: emergencyContactsSchema });
export const emergencyContactsViewSchema = named(
  'EmergencyContacts',
  z.object({ contacts: emergencyContactsSchema }),
);

// ---------------------------------------------------------------------------
// Drivers on the road (role `driver`, ADR-050, ADR-052)
// ---------------------------------------------------------------------------

export const goOnlineSchema = z.object({ position: pointSchema });
export const locationSchema = z.object({
  position: pointSchema,
  recordedAt: timestamp.optional().meta({ description: "The device's fix time; default now." }),
});

export const driverStateSchema = named(
  'DriverState',
  z.object({
    online: z.boolean(),
    currentRideId: z.uuid().nullable(),
  }),
);

export const rideOfferSchema = named(
  'RideOffer',
  z.object({
    id: z.uuid(),
    rideId: z.uuid(),
    category: z.enum(RIDE_CATEGORIES),
    pickupLabel: z.string(),
    pickup: z.object({ lat: z.number(), lng: z.number() }),
    dropoffLabel: z.string(),
    distanceToPickupMetres: z.number().int(),
    tripDistanceMetres: z.number().int(),
    earnings: moneySchema.meta({ description: "The driver's share of the fare." }),
    expiresAt: timestamp,
  }),
);
export const rideOfferListSchema = named(
  'RideOfferList',
  z.object({ offers: z.array(rideOfferSchema) }),
);

/** A ride as its driver sees it: the rider's first name only, never contact details. */
export const driverRideSchema = named(
  'DriverRide',
  z.object({
    id: z.uuid(),
    status: z.enum(RIDE_STATUSES),
    category: z.enum(RIDE_CATEGORIES),
    riderFirstName: z.string(),
    pickup: z.object({ label: z.string(), lat: z.number(), lng: z.number() }),
    dropoff: z.object({ label: z.string(), lat: z.number(), lng: z.number() }),
    polyline: z.string(),
    distanceMetres: z.number().int(),
    earnings: moneySchema,
    pinLocked: z.boolean(),
    assignedAt: timestamp.nullable(),
    arrivedAt: timestamp.nullable(),
    startedAt: timestamp.nullable(),
  }),
);
export const currentDriverRideSchema = named(
  'CurrentDriverRide',
  z.object({ ride: driverRideSchema.nullable() }),
);

export const startRideSchema = z.object({ pin: ridePinSchema });

export const driverEarningsSchema = named(
  'DriverEarnings',
  z.object({
    balance: moneySchema.meta({ description: 'Earned and not yet paid out.' }),
    rides: z.array(
      z.object({
        rideId: z.uuid(),
        completedAt: timestamp.nullable(),
        earnings: moneySchema,
      }),
    ),
    payouts: z.array(
      z.object({
        id: z.uuid(),
        amount: moneySchema,
        status: z.enum(['pending', 'paid', 'failed']),
        createdAt: timestamp,
        settledAt: timestamp.nullable(),
      }),
    ),
  }),
);

// ---------------------------------------------------------------------------
// Staff (ground:manage, safety:manage)
// ---------------------------------------------------------------------------

const minor = z.number().int().min(0).max(1_000_000_000);

export const fareRuleBodySchema = z.object({
  cityName: z.string().trim().min(2).max(80),
  category: z.enum(RIDE_CATEGORIES),
  currency: z.string().regex(/^[A-Z]{3}$/),
  baseMinor: minor,
  perKmMinor: minor,
  perMinuteMinor: minor,
  bookingFeeMinor: minor,
  minimumMinor: minor,
  cancellationFeeMinor: minor,
  freeCancelSeconds: z.number().int().min(0).max(3600),
  waitGraceSeconds: z.number().int().min(0).max(3600),
  driverShareBps: z.number().int().min(0).max(10_000),
  surgeBps: z.number().int().min(0).max(20_000),
  active: z.boolean(),
});

export const fareRuleListSchema = named(
  'RideFareRules',
  z.object({
    rules: z.array(fareRuleBodySchema.extend({ id: z.uuid() })),
  }),
);

export const placeBodySchema = z.object({
  name: z.string().trim().min(2).max(120),
  kind: z.enum(['airport', 'terminal', 'landmark']),
  cityName: z.string().trim().min(2).max(80),
  lat: coordinate(-90, 90),
  lng: coordinate(-180, 180),
  active: z.boolean().default(true),
});
export const placeUpdateSchema = placeBodySchema.partial();

export const createdSchema = named('RideConfigCreated', z.object({ id: z.uuid() }));

export const adminLiveRidesSchema = named(
  'AdminLiveRides',
  z.object({
    rides: z.array(
      z.object({
        id: z.uuid(),
        bookingId: z.uuid(),
        status: z.enum(RIDE_STATUSES),
        category: z.enum(RIDE_CATEGORIES),
        cityName: z.string(),
        driverId: z.uuid().nullable(),
        driverPosition: z.object({ lat: z.number(), lng: z.number(), at: timestamp }).nullable(),
        pickup: z.object({ lat: z.number(), lng: z.number() }),
        offRoute: z.boolean(),
        openIncidents: z.number().int(),
        createdAt: timestamp,
      }),
    ),
  }),
);

export const staffCancelSchema = z.object({
  reason: z.enum(['safety', 'driver_unreachable', 'rider_request', 'fraud', 'other']),
});

export const incidentQuerySchema = z.object({
  status: z.enum(INCIDENT_STATUSES).optional(),
});

export const incidentListSchema = named(
  'SafetyIncidents',
  z.object({
    incidents: z.array(
      z.object({
        id: z.uuid(),
        kind: z.enum(INCIDENT_KINDS),
        status: z.enum(INCIDENT_STATUSES),
        rideId: z.uuid().nullable(),
        reporter: z.enum(['rider', 'driver', 'system']),
        position: z.object({ lat: z.number(), lng: z.number() }).nullable(),
        createdAt: timestamp,
        acknowledgedAt: timestamp.nullable(),
        resolvedAt: timestamp.nullable(),
        resolution: z.string().nullable(),
      }),
    ),
  }),
);

export const resolveIncidentSchema = z.object({
  resolution: z.enum([
    'false_alarm',
    'assisted',
    'escalated_to_police',
    'driver_suspended',
    'other',
  ]),
});

export const dispatchRunSchema = named(
  'RideDispatchRun',
  z.object({
    started: z.number().int(),
    offered: z.number().int(),
    expired: z.number().int(),
    timedOut: z.number().int(),
  }),
);
