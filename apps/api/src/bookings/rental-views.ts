import type { z } from 'zod';

import { money, toWire } from '@suskii/shared';

import type { Prisma } from '../generated/prisma/client';

import type { RENTAL_LICENCE_STATES, rentalItemSchema } from './bookings.schemas';

export type RentalReservationDto = NonNullable<z.infer<typeof rentalItemSchema>['reservation']>;

export const RENTAL_RESERVATION_INCLUDE = {
  licence: true,
  handovers: { select: { kind: true, createdAt: true } },
} satisfies Prisma.RentalReservationInclude;

export type RentalReservationRecord = Prisma.RentalReservationGetPayload<{
  include: typeof RENTAL_RESERVATION_INCLUDE;
}>;

/**
 * A rental's progress as its renter sees it (ADR-051): the licence state (the number's last
 * three characters only), handovers and the deposit outcome. `licenceNumber` decrypts the number.
 */
export function rentalReservationView(
  row: RentalReservationRecord,
  licenceNumber: (licence: NonNullable<RentalReservationRecord['licence']>) => string,
): RentalReservationDto {
  const handover = (kind: 'check_out' | 'check_in') =>
    row.handovers.find((entry) => entry.kind === kind)?.createdAt.toISOString() ?? null;
  const kept = row.depositDeductionMinor ?? 0n;
  return {
    id: row.id,
    status: row.status,
    licenceRequired: row.licenceRequired,
    licence: row.licence
      ? {
          status: row.licence.status as (typeof RENTAL_LICENCE_STATES)[number],
          expiresOn: row.licence.expiresOn.toISOString().slice(0, 10),
          numberEndsWith: licenceNumber(row.licence).slice(-3),
          rejectionReason: row.licence.rejectionReason,
        }
      : null,
    chauffeurAssigned: row.chauffeurDriverId !== null,
    checkedOutAt: handover('check_out'),
    checkedInAt: handover('check_in'),
    deposit: row.depositReleasedAt
      ? {
          refund: toWire(money(row.depositMinor - kept, row.currency)),
          kept: toWire(money(kept, row.currency)),
          reason: row.depositDeductionReason,
          releasedAt: row.depositReleasedAt.toISOString(),
        }
      : null,
  };
}
