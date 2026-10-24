import {
  addDays,
  REQUIRED_DRIVER_DOCUMENTS,
  type DriverDocumentKind,
  type PayoutAccountInput,
} from '@suskii/shared';

import type { Prisma } from '../generated/prisma/client';
import { rating } from '../rides/ride-views';

import type {
  DRIVER_MISSING_STEPS,
  DRIVER_REVIEW_REASONS,
  DriverProfileDto,
  KYC_CHECK_STATES,
} from './drivers.schemas';

export const DRIVER_INCLUDE = {
  documents: { where: { supersededAt: null, deletedAt: null }, orderBy: { createdAt: 'desc' } },
  vehicles: { orderBy: { createdAt: 'asc' } },
} satisfies Prisma.DriverInclude;

export type DriverRecord = Prisma.DriverGetPayload<{ include: typeof DRIVER_INCLUDE }>;

type Reason = (typeof DRIVER_REVIEW_REASONS)[number];
type Check = (typeof KYC_CHECK_STATES)[number];
type Missing = (typeof DRIVER_MISSING_STEPS)[number];

const day = (date: Date): string => date.toISOString().slice(0, 10);
const asReason = (value: string | null): Reason | null => (value as Reason | null) ?? null;
const asCheck = (value: string): Check => value as Check;

/** Required document kinds without a current, approved file. */
export function documentsMissing(driver: DriverRecord): DriverDocumentKind[] {
  return REQUIRED_DRIVER_DOCUMENTS.filter(
    (kind) =>
      !driver.documents.some(
        (document) => document.kind === kind && document.status === 'approved',
      ),
  );
}

/** What still blocks going online. Approval is listed last: staff approve once the rest is done. */
export function missingSteps(driver: DriverRecord, today: string): Missing[] {
  const missing: Missing[] = [];
  if (driver.identityCheck !== 'verified') missing.push('identity_check');
  if (driver.licenceCheck !== 'verified' || day(driver.licenceExpiresOn) < today) {
    missing.push('licence_check');
  }
  if (documentsMissing(driver).length > 0) missing.push('documents');
  if (
    !driver.vehicles.some(
      (vehicle) => vehicle.status === 'approved' && day(vehicle.insuranceExpiresOn) >= today,
    )
  ) {
    missing.push('vehicle');
  }
  if (driver.status !== 'approved') missing.push('approval');
  return missing;
}

export function toDriverProfile(
  driver: DriverRecord,
  licence: string,
  payout: PayoutAccountInput | null,
  today: string,
): DriverProfileDto {
  return {
    id: driver.id,
    status: driver.status,
    statusReason: asReason(driver.statusReason),
    givenNames: driver.givenNames,
    surname: driver.surname,
    cityName: driver.cityName,
    identityCheck: asCheck(driver.identityCheck),
    licenceCheck: asCheck(driver.licenceCheck),
    licenceEndsWith: licence.slice(-3),
    licenceExpiresOn: day(driver.licenceExpiresOn),
    rating: rating(driver),
    ratingCount: driver.ratingCount,
    documents: driver.documents.map((document) => ({
      id: document.id,
      kind: document.kind,
      status: document.status,
      contentType: document.contentType,
      sizeBytes: document.sizeBytes,
      rejectionReason: asReason(document.rejectionReason),
      createdAt: document.createdAt.toISOString(),
      reviewedAt: document.reviewedAt?.toISOString() ?? null,
    })),
    vehicles: driver.vehicles.map((vehicle) => ({
      id: vehicle.id,
      make: vehicle.make,
      model: vehicle.model,
      year: vehicle.year,
      colour: vehicle.colour,
      plate: vehicle.plate,
      category: vehicle.category,
      seats: vehicle.seats,
      insuranceExpiresOn: day(vehicle.insuranceExpiresOn),
      status: vehicle.status,
      active: vehicle.active,
    })),
    payoutAccount: payout
      ? {
          bankCode: payout.bankCode,
          accountEndsWith: payout.accountNumber.slice(-4),
          accountName: payout.accountName,
        }
      : null,
    missing: missingSteps(driver, today),
    sample: driver.sample,
    createdAt: driver.createdAt.toISOString(),
  };
}

/** The youngest a driver can be on the day they apply. */
export const MIN_DRIVER_AGE_YEARS = 18;

export function isOldEnough(dateOfBirth: string, today: string): boolean {
  const [year, month, dayOfMonth] = today.split('-').map(Number) as [number, number, number];
  const cutoff = `${String(year - MIN_DRIVER_AGE_YEARS).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(dayOfMonth).padStart(2, '0')}`;
  return dateOfBirth <= cutoff;
}

/** A licence must stay valid for at least this long after applying. */
export const LICENCE_MIN_DAYS_LEFT = 30;

export const licenceLongEnough = (expiresOn: string, today: string): boolean =>
  expiresOn >= addDays(today, LICENCE_MIN_DAYS_LEFT);
