import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { z } from 'zod';

import { AuditService } from '../audit/audit.service';
import type { RentalItemPayload } from '../bookings/inhouse-items';
import {
  RENTAL_RESERVATION_INCLUDE,
  rentalReservationView,
  type RentalReservationRecord,
} from '../bookings/rental-views';
import { BackgroundTasks } from '../common/background-tasks';
import { fromJsonValue } from '../common/json';
import type { RequestContext } from '../common/request-context';
import { uuidv7 } from '../common/uuid';
import { rentalLicenceKeyContext, rentalLicenceNumberContext } from '../crypto/encryption-contexts';
import { FieldEncryption } from '../crypto/field-encryption';
import { PrismaService } from '../infra/prisma.service';

import { rentalConflict } from './rental-errors';
import { RentalFiles } from './rental-files';
import type { licenceBodySchema, reservationSchema } from './rentals.schemas';

export interface Renter {
  userId: string;
  context: RequestContext;
}

/** Booking statuses in which the renter may still provide a licence. */
const OPEN_BOOKING = ['AWAITING_PAYMENT', 'PAID', 'CONFIRMED', 'PARTIALLY_PAID'];

/**
 * The renter's side of a rental (ADR-050, ADR-051): the driver's licence for a self-drive car,
 * its number encrypted and its scan sealed and virus-scanned, before staff review it. Only the
 * booking's account sees or changes its reservation; anyone else gets 404.
 */
@Injectable()
export class RentalsService {
  private readonly logger = new Logger(RentalsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: FieldEncryption,
    private readonly files: RentalFiles,
    private readonly background: BackgroundTasks,
    private readonly audit: AuditService,
  ) {}

  async get(reservationId: string, userId: string): Promise<z.infer<typeof reservationSchema>> {
    return this.present(await this.owned(reservationId, userId));
  }

  /** Records the licence number and expiry; a new number replaces the earlier licence. */
  async submitLicence(
    reservationId: string,
    input: z.output<typeof licenceBodySchema>,
    renter: Renter,
  ): Promise<z.infer<typeof reservationSchema>> {
    const reservation = await this.owned(reservationId, renter.userId);
    this.assertLicenceOpen(reservation);
    const payload = fromJsonValue<RentalItemPayload>(reservation.bookingItem.payload);
    if (input.expiresOn < payload.returnAtLocal.slice(0, 10)) {
      throw rentalConflict('Your licence expires before the car is due back');
    }
    const previous = reservation.licence;
    const id = uuidv7();
    await this.prisma.$transaction(async (tx) => {
      if (previous) await tx.rentalLicence.delete({ where: { id: previous.id } });
      await tx.rentalLicence.create({
        data: {
          id,
          reservationId,
          numberEncrypted: this.encryption.encrypt(input.number, rentalLicenceNumberContext(id)),
          expiresOn: new Date(`${input.expiresOn}T00:00:00Z`),
        },
      });
      await this.audit.record(
        {
          action: 'rental.licence_submitted',
          actorUserId: renter.userId,
          targetType: 'rental_reservation',
          targetId: reservationId,
          context: renter.context,
          metadata: { replaced: previous !== null },
        },
        tx,
      );
    });
    if (previous?.storageKey) await this.files.delete(previous.storageKey);
    return this.get(reservationId, renter.userId);
  }

  /** The licence scan (PDF, JPEG or PNG); staff review it once the virus scan is clean. */
  async uploadLicence(
    reservationId: string,
    bytes: Buffer,
    renter: Renter,
  ): Promise<z.infer<typeof reservationSchema>> {
    const reservation = await this.owned(reservationId, renter.userId);
    this.assertLicenceOpen(reservation);
    const licence = reservation.licence;
    if (!licence) throw rentalConflict('Enter your licence number first');
    // Every upload is its own file (sealed to the licence id): a scan still reading an earlier
    // upload cannot clear this one (its guard compares storage keys), and a failed upload never
    // removes the file the licence points to.
    const sealed = await this.files.seal(
      licence.id,
      bytes,
      `rentals/${reservationId}/licence/${uuidv7()}`,
      rentalLicenceKeyContext(licence.id),
    );
    let replaced: string | null = null;
    try {
      await this.prisma.$transaction(async (tx) => {
        // Two uploads at once: the second sees (and later removes) the first one's file.
        const [current] = await tx.$queryRaw<{ storage_key: string | null }[]>`
          SELECT storage_key FROM rental_licences WHERE id = ${licence.id}::uuid FOR UPDATE`;
        replaced = current?.storage_key ?? null;
        await tx.rentalLicence.update({
          where: { id: licence.id },
          data: {
            status: 'pending_scan',
            storageKey: sealed.storageKey,
            wrappedKey: sealed.wrappedKey,
            sha256: sealed.sha256,
            contentType: sealed.contentType,
            sizeBytes: sealed.sizeBytes,
            reviewedById: null,
            reviewedAt: null,
            rejectionReason: null,
          },
        });
        await this.audit.record(
          {
            action: 'rental.licence_uploaded',
            actorUserId: renter.userId,
            targetType: 'rental_licence',
            targetId: licence.id,
            context: renter.context,
            metadata: { sizeBytes: String(sealed.sizeBytes) },
          },
          tx,
        );
      });
    } catch (error) {
      await this.files.delete(sealed.storageKey);
      throw error;
    }
    if (replaced) await this.files.delete(replaced);
    this.background.run('rental-licence-scan', () => this.scan(licence.id));
    return this.get(reservationId, renter.userId);
  }

  /** Clean scans wait for review; infected ones are destroyed and the licence rejected. */
  async scan(licenceId: string): Promise<void> {
    const licence = await this.prisma.rentalLicence.findUnique({ where: { id: licenceId } });
    if (licence?.status !== 'pending_scan' || !licence.storageKey) return;
    let verdict: 'clean' | 'infected';
    try {
      const bytes = await this.files.open(licence, rentalLicenceKeyContext(licence.id));
      verdict = await this.files.scan(bytes);
    } catch (error) {
      this.logger.warn({ licenceId, reason: (error as Error).name }, 'licence scan failed');
      return;
    }
    const { count } = await this.prisma.rentalLicence.updateMany({
      where: { id: licence.id, status: 'pending_scan', storageKey: licence.storageKey },
      data:
        verdict === 'clean'
          ? { status: 'pending_review' }
          : { status: 'rejected', rejectionReason: 'unreadable', storageKey: null, wrappedKey: '' },
    });
    if (count === 1 && verdict === 'infected') await this.files.delete(licence.storageKey);
  }

  private assertLicenceOpen(reservation: OwnedReservation): void {
    if (!reservation.licenceRequired) throw rentalConflict('A chauffeured rental needs no licence');
    if (
      reservation.status !== 'reserved' ||
      !OPEN_BOOKING.includes(reservation.bookingItem.booking.status)
    ) {
      throw rentalConflict('The licence can no longer be changed for this rental');
    }
    if (reservation.licence?.status === 'approved') {
      throw rentalConflict('Your licence is already approved for this rental');
    }
  }

  private async owned(reservationId: string, userId: string): Promise<OwnedReservation> {
    const reservation = await this.prisma.rentalReservation.findUnique({
      where: { id: reservationId },
      include: {
        ...RENTAL_RESERVATION_INCLUDE,
        bookingItem: {
          select: { payload: true, booking: { select: { id: true, userId: true, status: true } } },
        },
      },
    });
    if (reservation?.bookingItem.booking.userId !== userId) throw new NotFoundException();
    return reservation;
  }

  private present(reservation: OwnedReservation): z.infer<typeof reservationSchema> {
    const view = rentalReservationView(reservation, (licence) =>
      this.encryption.decrypt(licence.numberEncrypted, rentalLicenceNumberContext(licence.id)),
    );
    return {
      id: view.id,
      bookingId: reservation.bookingItem.booking.id,
      status: view.status,
      licenceRequired: view.licenceRequired,
      licence: view.licence,
    };
  }
}

type OwnedReservation = RentalReservationRecord & {
  bookingItem: { payload: unknown; booking: { id: string; userId: string | null; status: string } };
};
