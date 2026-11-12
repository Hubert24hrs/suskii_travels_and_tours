import { z } from 'zod';

import {
  DRIVER_DOCUMENT_KINDS,
  DRIVER_DOCUMENT_STATUSES,
  DRIVER_STATUSES,
  driverApplicationSchema,
  driverVehicleSchema,
  payoutAccountSchema,
  RIDE_CATEGORIES,
} from '@suskii/shared';

import { reauthProofSchema } from '../auth/auth.schemas';
import { named } from '../contract/contract';

/** Driver onboarding and review (ADR-050). Identity numbers are never returned. */

const timestamp = z.iso.datetime();
const isoDay = z.iso.date();

export const KYC_CHECK_STATES = ['pending', 'verified', 'mismatch', 'not_found'] as const;

/** Why staff rejected or suspended: short codes only, never free text about a person. */
export const DRIVER_REVIEW_REASONS = [
  'documents_unclear',
  'documents_expired',
  'identity_mismatch',
  'licence_invalid',
  'vehicle_unsuitable',
  'rating_below_minimum',
  'safety_concern',
  'fraud',
  'other',
] as const;

/** What still stands between a driver and going online, in the order to fix it. */
export const DRIVER_MISSING_STEPS = [
  'identity_check',
  'licence_check',
  'documents',
  'vehicle',
  'approval',
] as const;

export const driverApplicationBodySchema = driverApplicationSchema;
export const driverVehicleBodySchema = driverVehicleSchema;
export const payoutAccountBodySchema = named(
  'PayoutAccountRequest',
  z.object({
    account: payoutAccountSchema,
    reauth: reauthProofSchema.optional().meta({
      description:
        'Needed unless the session signed in within the last few minutes (401 `reauthentication-required`).',
    }),
  }),
);

export const documentKindParamsSchema = z.object({ kind: z.enum(DRIVER_DOCUMENT_KINDS) });
export const vehicleIdParamsSchema = z.object({ vehicleId: z.uuid() });
export const driverIdParamsSchema = z.object({ driverId: z.uuid() });
export const driverDocumentParamsSchema = z.object({
  driverId: z.uuid(),
  documentId: z.uuid(),
});
export const driverVehicleParamsSchema = z.object({
  driverId: z.uuid(),
  vehicleId: z.uuid(),
});

const documentViewSchema = z.object({
  id: z.uuid(),
  kind: z.enum(DRIVER_DOCUMENT_KINDS),
  status: z.enum(DRIVER_DOCUMENT_STATUSES),
  contentType: z.string(),
  sizeBytes: z.number().int(),
  rejectionReason: z.enum(DRIVER_REVIEW_REASONS).nullable(),
  createdAt: timestamp,
  reviewedAt: timestamp.nullable(),
});

const vehicleViewSchema = z.object({
  id: z.uuid(),
  make: z.string(),
  model: z.string(),
  year: z.number().int(),
  colour: z.string(),
  plate: z.string(),
  category: z.enum(RIDE_CATEGORIES),
  seats: z.number().int(),
  insuranceExpiresOn: isoDay,
  status: z.enum(['pending', 'approved', 'rejected']),
  active: z.boolean(),
});

/** A driver's own profile: progress towards going online, without identity numbers. */
export const driverProfileSchema = named(
  'DriverProfile',
  z.object({
    id: z.uuid(),
    status: z.enum(DRIVER_STATUSES),
    statusReason: z.enum(DRIVER_REVIEW_REASONS).nullable(),
    givenNames: z.string(),
    surname: z.string(),
    cityName: z.string(),
    identityCheck: z.enum(KYC_CHECK_STATES),
    licenceCheck: z.enum(KYC_CHECK_STATES),
    licenceEndsWith: z.string().meta({ description: 'The last three characters only.' }),
    licenceExpiresOn: isoDay,
    rating: z.number().nullable(),
    ratingCount: z.number().int(),
    documents: z.array(documentViewSchema),
    vehicles: z.array(vehicleViewSchema),
    payoutAccount: z
      .object({
        bankCode: z.string(),
        accountEndsWith: z.string(),
        accountName: z.string(),
      })
      .nullable(),
    missing: z.array(z.enum(DRIVER_MISSING_STEPS)),
    sample: z.boolean(),
    createdAt: timestamp,
  }),
);
export type DriverProfileDto = z.infer<typeof driverProfileSchema>;

export const adminDriverQuerySchema = z.object({
  status: z.enum(DRIVER_STATUSES).optional(),
});

export const adminDriverListSchema = named(
  'AdminDrivers',
  z.object({
    drivers: z.array(
      z.object({
        id: z.uuid(),
        userId: z.uuid(),
        status: z.enum(DRIVER_STATUSES),
        name: z.string(),
        cityName: z.string(),
        identityCheck: z.enum(KYC_CHECK_STATES),
        licenceCheck: z.enum(KYC_CHECK_STATES),
        documentsAwaitingReview: z.number().int(),
        vehiclesAwaitingReview: z.number().int(),
        online: z.boolean(),
        rating: z.number().nullable(),
        sample: z.boolean(),
        createdAt: timestamp,
      }),
    ),
  }),
);

export const adminDriverSchema = named(
  'AdminDriver',
  driverProfileSchema.extend({
    userId: z.uuid(),
    dateOfBirth: isoDay,
    identityReference: z.string().nullable(),
    licenceReference: z.string().nullable(),
    online: z.boolean(),
    reviewedAt: timestamp.nullable(),
  }),
);

export const reviewDecisionSchema = z
  .object({
    decision: z.enum(['approve', 'reject']),
    reason: z.enum(DRIVER_REVIEW_REASONS).nullable().default(null),
  })
  .refine((body) => body.decision === 'approve' || body.reason !== null, {
    message: 'reason_required',
    path: ['reason'],
  });

export const approveDriverSchema = z.object({
  manualIdentityCheck: z.boolean().default(false).meta({
    description:
      'The reviewer checked identity against the documents because the KYC provider could not answer (the check is `pending`). Never overrides a `mismatch` or `not_found`.',
  }),
  manualLicenceCheck: z.boolean().default(false),
});

export const driverReasonSchema = z.object({ reason: z.enum(DRIVER_REVIEW_REASONS) });

export const driverScanRunSchema = named(
  'DriverDocumentScanRun',
  z.object({ scanned: z.number().int() }),
);
