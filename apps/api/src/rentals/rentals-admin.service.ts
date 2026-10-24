import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import type { z } from 'zod';

import { localDate, money, subtract, toWire } from '@suskii/shared';

import { conflict, fieldChanges, hasChanges, type StaffActor } from '../admin/admin-helpers';
import { AuditService, type AuditAction } from '../audit/audit.service';
import type { RentalItemPayload } from '../bookings/inhouse-items';
import { storedPolicy } from '../bookings/inhouse-catalog';
import { RefundsService } from '../bookings/refunds.service';
import { fromJsonValue } from '../common/json';
import { ProblemDetailsException } from '../common/problem-details';
import { uuidv7 } from '../common/uuid';
import {
  rentalLicenceKeyContext,
  rentalLicenceNumberContext,
  rentalPhotoKeyContext,
} from '../crypto/encryption-contexts';
import { FieldEncryption } from '../crypto/field-encryption';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../infra/prisma.service';
import { LedgerService, transfer } from '../ledger/ledger.service';

import { rentalConflict } from './rental-errors';
import { RentalFiles } from './rental-files';
import type {
  adminReservationListSchema,
  adminReservationQuerySchema,
  adminVehicleListSchema,
  depositReleaseSchema,
  handoverBodySchema,
  licenceReviewSchema,
  vehicleBodySchema,
  vehicleUpdateSchema,
} from './rentals.schemas';

type Tx = Prisma.TransactionClient;
type In<T extends z.ZodType> = z.output<T>;

/** Photos per reservation, both handovers together. */
const MAX_PHOTOS = 30;
/** Check-out may start this long before the booked pickup (early collection, delivery runs). */
const CHECK_OUT_EARLY_MS = 24 * 3_600_000;

const RESERVATION_INCLUDE = {
  licence: true,
  handovers: { include: { photos: { select: { id: true } } }, orderBy: { createdAt: 'asc' } },
  vehicle: { select: { id: true, make: true, model: true, plate: true, timeZone: true } },
  bookingItem: {
    select: {
      payload: true,
      booking: {
        select: {
          id: true,
          reference: true,
          status: true,
          currency: true,
          passengers: {
            select: { givenNames: true, surname: true },
            orderBy: { position: 'asc' },
            take: 1,
          },
        },
      },
    },
  },
} satisfies Prisma.RentalReservationInclude;

type ReservationRecord = Prisma.RentalReservationGetPayload<{
  include: typeof RESERVATION_INCLUDE;
}>;

const uniqueViolation = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

/**
 * Rental operations for staff with `ground:manage` (ADR-051): the fleet, licence review, photo
 * evidence, check-out and check-in (immutable once written, enforced by the database), and the
 * deposit release, which refunds what is not kept through the normal refund path.
 */
@Injectable()
export class RentalsAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: FieldEncryption,
    private readonly files: RentalFiles,
    private readonly ledger: LedgerService,
    private readonly refunds: RefundsService,
    private readonly audit: AuditService,
  ) {}

  // --- Fleet ---------------------------------------------------------------------------------

  async vehicles(): Promise<z.infer<typeof adminVehicleListSchema>> {
    const now = new Date();
    const rows = await this.prisma.rentalVehicle.findMany({
      include: {
        _count: { select: { reservations: { where: { active: true, returnAt: { gt: now } } } } },
      },
      orderBy: [{ cityName: 'asc' }, { make: 'asc' }, { model: 'asc' }],
    });
    return {
      vehicles: rows.map((row) => ({
        id: row.id,
        slug: row.slug,
        status: row.status,
        plate: row.plate,
        make: row.make,
        model: row.model,
        year: row.year,
        category: row.category,
        transmission: row.transmission,
        seats: row.seats,
        features: row.features,
        photoUrls: row.photoUrls,
        artKey: row.artKey,
        sample: row.sample,
        cityName: row.cityName,
        branch: { name: row.branchName, address: row.branchAddress, lat: row.lat, lng: row.lng },
        daily: toWire(money(row.dailyMinor, row.currency)),
        chauffeurDaily:
          row.chauffeurDailyMinor === null
            ? null
            : toWire(money(row.chauffeurDailyMinor, row.currency)),
        deposit: toWire(money(row.depositMinor, row.currency)),
        delivery:
          row.deliveryPerKmMinor !== null && row.deliveryMaxKm !== null
            ? {
                perKm: toWire(money(row.deliveryPerKmMinor, row.currency)),
                maxKm: row.deliveryMaxKm,
              }
            : null,
        mileage: {
          kmPerDay: row.mileageKmPerDay,
          excessKm:
            row.excessKmMinor === null ? null : toWire(money(row.excessKmMinor, row.currency)),
        },
        fuelPolicy: row.fuelPolicy as 'full_to_full' | 'same_to_same',
        insuranceSummary: row.insuranceSummary,
        upcomingRentals: row._count.reservations,
      })),
    };
  }

  async createVehicle(
    input: In<typeof vehicleBodySchema>,
    staff: StaffActor,
  ): Promise<{ id: string }> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const row = await tx.rentalVehicle.create({ data: vehicleData(input) });
        await this.record(tx, 'rental.vehicle_created', 'rental_vehicle', row.id, staff, {
          slug: input.slug,
          category: input.category,
        });
        return { id: row.id };
      });
    } catch (error) {
      if (uniqueViolation(error))
        throw conflict('vehicle-exists', 'That slug or plate is already used');
      throw error;
    }
  }

  async updateVehicle(
    id: string,
    input: In<typeof vehicleUpdateSchema>,
    staff: StaffActor,
  ): Promise<void> {
    const current = await this.prisma.rentalVehicle.findUnique({ where: { id } });
    if (!current) throw new NotFoundException();
    const before = {
      status: current.status,
      dailyMinor: Number(current.dailyMinor),
      chauffeurDailyMinor:
        current.chauffeurDailyMinor === null ? null : Number(current.chauffeurDailyMinor),
      depositMinor: Number(current.depositMinor),
      deliveryPerKmMinor:
        current.deliveryPerKmMinor === null ? null : Number(current.deliveryPerKmMinor),
      deliveryMaxKm: current.deliveryMaxKm,
      mileageKmPerDay: current.mileageKmPerDay,
      excessKmMinor: current.excessKmMinor === null ? null : Number(current.excessKmMinor),
      fuelPolicy: current.fuelPolicy,
      branchName: current.branchName,
      cityName: current.cityName,
    };
    const after = { ...before, ...pick(input, Object.keys(before) as (keyof typeof before)[]) };
    const changes = fieldChanges(before, after);
    const other = Object.keys(input).filter((key) => !(key in before));
    if (!hasChanges(changes) && other.length === 0) return;
    if (input.cancellationPolicy) storedPolicy(input.cancellationPolicy);
    await this.prisma.$transaction(async (tx) => {
      await tx.rentalVehicle.update({ where: { id }, data: vehicleUpdate(input) });
      await this.record(tx, 'rental.vehicle_updated', 'rental_vehicle', id, staff, {
        changes,
        ...(other.length > 0 ? { also: other.sort() } : {}),
      });
    });
  }

  // --- Reservations --------------------------------------------------------------------------

  async reservations(
    query: In<typeof adminReservationQuerySchema>,
  ): Promise<z.infer<typeof adminReservationListSchema>> {
    const rows = await this.prisma.rentalReservation.findMany({
      where: {
        ...(query.status ? { status: query.status } : {}),
        ...(query.licence ? { licence: { status: query.licence } } : {}),
        bookingItem: { booking: { status: { notIn: ['DRAFT', 'PRICED'] } } },
      },
      include: RESERVATION_INCLUDE,
      orderBy: { pickupAt: 'asc' },
      take: 200,
    });
    return { reservations: rows.map((row) => this.present(row)) };
  }

  async reviewLicence(
    reservationId: string,
    input: In<typeof licenceReviewSchema>,
    staff: StaffActor,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const licence = await tx.rentalLicence.findUnique({ where: { reservationId } });
      if (!licence) throw new NotFoundException();
      if (licence.status !== 'pending_review') {
        throw rentalConflict('Only a scanned licence awaiting review can be reviewed');
      }
      await tx.rentalLicence.update({
        where: { id: licence.id },
        data: {
          status: input.decision === 'approve' ? 'approved' : 'rejected',
          rejectionReason: input.decision === 'approve' ? null : input.reason,
          reviewedById: staff.userId,
          reviewedAt: new Date(),
        },
      });
      await this.record(tx, 'rental.licence_reviewed', 'rental_licence', licence.id, staff, {
        reservationId,
        decision: input.decision,
        ...(input.reason ? { reason: input.reason } : {}),
      });
    });
  }

  async licenceContent(
    reservationId: string,
    staff: StaffActor,
  ): Promise<{ bytes: Buffer; contentType: string }> {
    const licence = await this.prisma.rentalLicence.findUnique({ where: { reservationId } });
    if (!licence?.storageKey || licence.status === 'pending_scan') throw new NotFoundException();
    const bytes = await this.files.open(licence, rentalLicenceKeyContext(licence.id));
    await this.record(this.prisma, 'rental.licence_accessed', 'rental_licence', licence.id, staff, {
      reservationId,
    });
    return { bytes, contentType: licence.contentType ?? 'application/octet-stream' };
  }

  /** A condition photo (JPEG or PNG), scanned now, sealed, and attached at the next handover. */
  async uploadPhoto(
    reservationId: string,
    bytes: Buffer,
    staff: StaffActor,
  ): Promise<{ id: string }> {
    const reservation = await this.prisma.rentalReservation.findUnique({
      where: { id: reservationId },
      select: { id: true, status: true, _count: { select: { photos: true } } },
    });
    if (!reservation) throw new NotFoundException();
    if (reservation.status === 'cancelled') throw rentalConflict('This rental was cancelled');
    if (reservation._count.photos >= MAX_PHOTOS)
      throw rentalConflict('This rental has all the photos it can take');
    await this.files.assertClean(bytes);
    const id = uuidv7();
    const sealed = await this.files.seal(
      id,
      bytes,
      `rentals/${reservationId}/photos`,
      rentalPhotoKeyContext(id),
      {
        images: true,
      },
    );
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.rentalHandoverPhoto.create({
          data: {
            id,
            reservationId,
            storageKey: sealed.storageKey,
            wrappedKey: sealed.wrappedKey,
            sha256: sealed.sha256,
            contentType: sealed.contentType,
            sizeBytes: sealed.sizeBytes,
            uploadedById: staff.userId,
          },
        });
        await this.record(tx, 'rental.photo_uploaded', 'rental_photo', id, staff, {
          reservationId,
        });
      });
    } catch (error) {
      await this.files.delete(sealed.storageKey);
      throw error;
    }
    return { id };
  }

  async photoContent(
    reservationId: string,
    photoId: string,
    staff: StaffActor,
  ): Promise<{ bytes: Buffer; contentType: string }> {
    const photo = await this.prisma.rentalHandoverPhoto.findUnique({ where: { id: photoId } });
    if (photo?.reservationId !== reservationId) throw new NotFoundException();
    const bytes = await this.files.open(photo, rentalPhotoKeyContext(photo.id));
    await this.record(this.prisma, 'rental.photo_accessed', 'rental_photo', photo.id, staff, {
      reservationId,
    });
    return { bytes, contentType: photo.contentType };
  }

  /**
   * Check-out or check-in, with odometer, fuel, notes and photos. Check-out needs a confirmed
   * booking, an approved licence in date for a self-drive car, or an approved driver for a
   * chauffeured one. Check-in needs a check-out and a reading no lower than it. Written once.
   */
  async handover(
    reservationId: string,
    input: In<typeof handoverBodySchema>,
    staff: StaffActor,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM rental_reservations WHERE id = ${reservationId}::uuid FOR UPDATE`;
      // Flat reads, one after another: the transaction holds a single connection.
      const reservation = await tx.rentalReservation.findUnique({ where: { id: reservationId } });
      if (!reservation) throw new NotFoundException();
      const item = await tx.bookingItem.findUniqueOrThrow({
        where: { id: reservation.bookingItemId },
        select: { payload: true, booking: { select: { status: true } } },
      });
      if (item.booking.status !== 'CONFIRMED') throw rentalConflict('The booking is not confirmed');
      const handovers = await tx.rentalHandover.findMany({ where: { reservationId } });
      const now = new Date();
      if (input.kind === 'check_out') {
        await this.assertReadyForCheckOut(tx, reservation, item.payload, input, now);
      } else {
        const out = handovers.find((entry) => entry.kind === 'check_out');
        if (reservation.status !== 'checked_out' || !out)
          throw rentalConflict('The car has not been checked out');
        if (input.odometerKm < out.odometerKm) {
          throw rentalConflict('The odometer reads lower than at check-out');
        }
      }

      const photos = await tx.rentalHandoverPhoto.findMany({
        where: { id: { in: input.photoIds }, reservationId, handoverId: null, deletedAt: null },
        select: { id: true },
      });
      if (photos.length !== new Set(input.photoIds).size) {
        throw rentalConflict('Upload the photos for this rental first', 'Each photo is used once.');
      }
      const handover = await tx.rentalHandover.create({
        data: {
          reservationId,
          kind: input.kind,
          odometerKm: input.odometerKm,
          fuelEighths: input.fuelEighths,
          damageNotes: input.damageNotes,
          recordedById: staff.userId,
        },
      });
      await tx.rentalHandoverPhoto.updateMany({
        where: { id: { in: input.photoIds } },
        data: { handoverId: handover.id },
      });
      await tx.rentalReservation.update({
        where: { id: reservationId },
        data:
          input.kind === 'check_out'
            ? { status: 'checked_out', chauffeurDriverId: input.chauffeurDriverId }
            : { status: 'returned' },
      });
      await this.record(
        tx,
        input.kind === 'check_out' ? 'rental.checked_out' : 'rental.checked_in',
        'rental_reservation',
        reservationId,
        staff,
        { handoverId: handover.id, photos: input.photoIds.length, odometerKm: input.odometerKm },
      );
    });
  }

  /**
   * After check-in: refunds the deposit less what is kept (with a reason), through the original
   * payment. What is kept moves to rental deductions in the ledger. Happens once.
   */
  async releaseDeposit(
    reservationId: string,
    input: In<typeof depositReleaseSchema>,
    staff: StaffActor,
  ): Promise<void> {
    const found = await this.prisma.rentalReservation.findUnique({
      where: { id: reservationId },
      select: { bookingItem: { select: { bookingId: true } } },
    });
    if (!found) throw new NotFoundException();
    const bookingId = found.bookingItem.bookingId;
    const refundIds = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM bookings WHERE id = ${bookingId}::uuid FOR UPDATE`;
      const reservation = await tx.rentalReservation.findUniqueOrThrow({
        where: { id: reservationId },
      });
      if (reservation.status !== 'returned')
        throw rentalConflict('The car has not been checked in');
      if (reservation.depositReleasedAt) throw rentalConflict('The deposit was already released');
      const kept = BigInt(input.keptMinor);
      if (kept > reservation.depositMinor) {
        throw new ProblemDetailsException(
          HttpStatus.UNPROCESSABLE_ENTITY,
          'deduction-too-large',
          'More than the deposit cannot be kept',
        );
      }
      const booking = await tx.booking.findUniqueOrThrow({ where: { id: bookingId } });
      const deposit = money(reservation.depositMinor, reservation.currency);
      const keep = money(kept, reservation.currency);
      if (kept > 0n) {
        await this.ledger.post(tx, {
          key: `rental:${reservationId}:deposit-deduction`,
          kind: 'deposit_deduction',
          bookingId,
          lines: transfer(
            { kind: 'booking', bookingId, currency: booking.currency },
            { kind: 'rental-deductions', currency: booking.currency },
            keep,
          ),
        });
      }
      const refund = subtract(deposit, keep);
      const ids =
        refund.minor > 0n
          ? await this.refunds.refundBookingBalance(tx, booking, 'deposit_release', {
              amount: refund,
            })
          : [];
      await tx.rentalReservation.update({
        where: { id: reservationId },
        data: {
          depositReleasedAt: new Date(),
          depositDeductionMinor: kept,
          depositDeductionReason: input.reason,
        },
      });
      await this.record(tx, 'rental.deposit_released', 'rental_reservation', reservationId, staff, {
        keptMinor: kept.toString(),
        refundMinor: refund.minor.toString(),
        currency: reservation.currency,
        ...(input.reason ? { reason: input.reason } : {}),
      });
      return ids;
    });
    this.refunds.executeLater(refundIds);
  }

  private async assertReadyForCheckOut(
    tx: Tx,
    reservation: {
      id: string;
      status: string;
      pickupAt: Date;
      returnAt: Date;
      chauffeur: boolean;
      vehicleId: string;
    },
    rawPayload: unknown,
    input: In<typeof handoverBodySchema>,
    now: Date,
  ): Promise<void> {
    if (reservation.status !== 'reserved') throw rentalConflict('The car was already checked out');
    if (
      now.getTime() < reservation.pickupAt.getTime() - CHECK_OUT_EARLY_MS ||
      now >= reservation.returnAt
    ) {
      throw rentalConflict('It is not the time for this rental');
    }
    if (reservation.chauffeur) {
      if (!input.chauffeurDriverId) throw rentalConflict('Assign the chauffeur at check-out');
      const driver = await tx.driver.findUnique({
        where: { id: input.chauffeurDriverId },
        select: { status: true },
      });
      if (driver?.status !== 'approved')
        throw rentalConflict('The chauffeur must be an approved driver');
      return;
    }
    if (input.chauffeurDriverId) throw rentalConflict('This rental is self-drive');
    const licence = await tx.rentalLicence.findUnique({ where: { reservationId: reservation.id } });
    const payload = fromJsonValue<RentalItemPayload>(rawPayload);
    if (licence?.status !== 'approved')
      throw rentalConflict("The renter's licence is not approved");
    if (
      licence.expiresOn.toISOString().slice(0, 10) < payload.returnAtLocal.slice(0, 10) ||
      licence.expiresOn.toISOString().slice(0, 10) < localDate(now, payload.timeZone)
    ) {
      throw rentalConflict("The renter's licence expires before the return");
    }
  }

  private present(
    row: ReservationRecord,
  ): z.infer<typeof adminReservationListSchema>['reservations'][number] {
    const payload = fromJsonValue<RentalItemPayload>(row.bookingItem.payload);
    const renter = row.bookingItem.booking.passengers[0];
    return {
      id: row.id,
      bookingId: row.bookingItem.booking.id,
      bookingReference: row.bookingItem.booking.reference,
      bookingStatus: row.bookingItem.booking.status,
      vehicle: {
        id: row.vehicle.id,
        make: row.vehicle.make,
        model: row.vehicle.model,
        plate: row.vehicle.plate,
      },
      renterName: renter ? `${renter.givenNames} ${renter.surname}` : '',
      pickupAt: row.pickupAt.toISOString(),
      returnAt: row.returnAt.toISOString(),
      chauffeur: row.chauffeur,
      chauffeurDriverId: row.chauffeurDriverId,
      delivery: payload.delivery,
      status: row.status,
      licenceRequired: row.licenceRequired,
      licence: row.licence
        ? {
            id: row.licence.id,
            status: row.licence.status as 'pending_upload',
            expiresOn: row.licence.expiresOn.toISOString().slice(0, 10),
            numberEndsWith: this.encryption
              .decrypt(row.licence.numberEncrypted, rentalLicenceNumberContext(row.licence.id))
              .slice(-3),
            rejectionReason: row.licence.rejectionReason,
          }
        : null,
      handovers: row.handovers.map((entry) => ({
        id: entry.id,
        kind: entry.kind,
        odometerKm: entry.odometerKm,
        fuelEighths: entry.fuelEighths,
        damageNotes: entry.damageNotes,
        photoIds: entry.photos.map((photo) => photo.id),
        recordedById: entry.recordedById,
        createdAt: entry.createdAt.toISOString(),
      })),
      deposit: toWire(money(row.depositMinor, row.currency)),
      depositReleasedAt: row.depositReleasedAt?.toISOString() ?? null,
      depositKept:
        row.depositDeductionMinor === null
          ? null
          : toWire(money(row.depositDeductionMinor, row.currency)),
      depositDeductionReason: row.depositDeductionReason,
    };
  }

  private async record(
    tx: Tx | PrismaService,
    action: AuditAction,
    targetType: string,
    targetId: string,
    staff: StaffActor,
    metadata: Prisma.InputJsonObject,
  ): Promise<void> {
    await this.audit.record(
      { action, actorUserId: staff.userId, targetType, targetId, context: staff.context, metadata },
      tx === this.prisma ? undefined : tx,
    );
  }
}

function pick<T extends object, K extends keyof T>(
  source: Partial<T>,
  keys: readonly K[],
): Partial<Pick<T, K>> {
  const out: Partial<Pick<T, K>> = {};
  for (const key of keys) if (source[key] !== undefined) out[key] = source[key];
  return out;
}

const big = (value: number | null | undefined): bigint | null | undefined =>
  value === undefined ? undefined : value === null ? null : BigInt(value);

function vehicleData(input: In<typeof vehicleBodySchema>): Prisma.RentalVehicleCreateInput {
  return {
    slug: input.slug,
    make: input.make,
    model: input.model,
    year: input.year,
    category: input.category,
    transmission: input.transmission,
    seats: input.seats,
    plate: input.plate,
    features: input.features,
    photoUrls: input.photoUrls,
    artKey: input.artKey,
    cityName: input.cityName,
    branchName: input.branchName,
    branchAddress: input.branchAddress,
    lat: input.lat,
    lng: input.lng,
    timeZone: input.timeZone,
    currency: input.currency,
    dailyMinor: BigInt(input.dailyMinor),
    chauffeurDailyMinor: big(input.chauffeurDailyMinor) ?? null,
    depositMinor: BigInt(input.depositMinor),
    deliveryPerKmMinor: big(input.deliveryPerKmMinor) ?? null,
    deliveryMaxKm: input.deliveryMaxKm,
    mileageKmPerDay: input.mileageKmPerDay,
    excessKmMinor: big(input.excessKmMinor) ?? null,
    fuelPolicy: input.fuelPolicy,
    insuranceSummary: input.insuranceSummary,
    cancellationPolicy: input.cancellationPolicy,
  };
}

function vehicleUpdate(input: In<typeof vehicleUpdateSchema>): Prisma.RentalVehicleUpdateInput {
  const {
    dailyMinor,
    chauffeurDailyMinor,
    depositMinor,
    deliveryPerKmMinor,
    excessKmMinor,
    ...rest
  } = input;
  return {
    ...rest,
    ...(dailyMinor !== undefined ? { dailyMinor: BigInt(dailyMinor) } : {}),
    ...(chauffeurDailyMinor !== undefined ? { chauffeurDailyMinor: big(chauffeurDailyMinor) } : {}),
    ...(depositMinor !== undefined ? { depositMinor: BigInt(depositMinor) } : {}),
    ...(deliveryPerKmMinor !== undefined ? { deliveryPerKmMinor: big(deliveryPerKmMinor) } : {}),
    ...(excessKmMinor !== undefined ? { excessKmMinor: big(excessKmMinor) } : {}),
  };
}
