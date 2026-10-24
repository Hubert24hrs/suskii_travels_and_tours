import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import type { z } from 'zod';

import { localDate } from '@suskii/shared';

import type { StaffActor } from '../admin/admin-helpers';
import { AuditService, type AuditAction } from '../audit/audit.service';
import { ProblemDetailsException } from '../common/problem-details';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../infra/prisma.service';
import { rating } from '../rides/ride-views';

import { DRIVER_INCLUDE, documentsMissing, missingSteps } from './driver-views';
import type {
  adminDriverListSchema,
  adminDriverSchema,
  approveDriverSchema,
  DRIVER_REVIEW_REASONS,
  reviewDecisionSchema,
} from './drivers.schemas';
import { DriversService } from './drivers.service';

type Tx = Prisma.TransactionClient;
type Reason = (typeof DRIVER_REVIEW_REASONS)[number];

const TIME_ZONE = 'Africa/Lagos';

const reviewConflict = (title: string, detail?: string): ProblemDetailsException =>
  new ProblemDetailsException(HttpStatus.CONFLICT, 'driver-review-conflict', title, detail);

/**
 * Driver review for staff with `drivers:review` (ADR-050): documents and vehicles one by one,
 * then the application. Approval needs verified identity and licence (a pending KYC check can be
 * confirmed by hand; a mismatch never can), every required document approved and an approved,
 * insured vehicle, and grants the `driver` role. Nobody reviews their own application.
 */
@Injectable()
export class DriversAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly drivers: DriversService,
    private readonly audit: AuditService,
  ) {}

  async list(
    status?: 'pending' | 'approved' | 'rejected' | 'suspended',
  ): Promise<z.infer<typeof adminDriverListSchema>> {
    const rows = await this.prisma.driver.findMany({
      where: status ? { status } : {},
      include: {
        _count: {
          select: {
            documents: { where: { status: 'clean', supersededAt: null } },
            vehicles: { where: { status: 'pending' } },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
      take: 500,
    });
    return {
      drivers: rows.map((row) => ({
        id: row.id,
        userId: row.userId,
        status: row.status,
        name: `${row.givenNames} ${row.surname}`,
        cityName: row.cityName,
        identityCheck: row.identityCheck as 'pending',
        licenceCheck: row.licenceCheck as 'pending',
        documentsAwaitingReview: row._count.documents,
        vehiclesAwaitingReview: row._count.vehicles,
        online: row.online,
        rating: rating(row),
        sample: row.sample,
        createdAt: row.createdAt.toISOString(),
      })),
    };
  }

  async detail(driverId: string): Promise<z.infer<typeof adminDriverSchema>> {
    const driver = await this.prisma.driver.findUnique({
      where: { id: driverId },
      include: DRIVER_INCLUDE,
    });
    if (!driver) throw new NotFoundException();
    return {
      ...this.drivers.present(driver),
      userId: driver.userId,
      dateOfBirth: driver.dateOfBirth.toISOString().slice(0, 10),
      identityReference: driver.identityReference,
      licenceReference: driver.licenceReference,
      online: driver.online,
      reviewedAt: driver.reviewedAt?.toISOString() ?? null,
    };
  }

  /** Approves or rejects a document that scanned clean (pending ones are not reviewable yet). */
  async reviewDocument(
    driverId: string,
    documentId: string,
    input: z.output<typeof reviewDecisionSchema>,
    staff: StaffActor,
  ): Promise<void> {
    await this.notSelf(driverId, staff);
    await this.prisma.$transaction(async (tx) => {
      const document = await tx.driverDocument.findUnique({ where: { id: documentId } });
      if (document?.driverId !== driverId || document.supersededAt) throw new NotFoundException();
      if (document.status === 'pending') {
        throw reviewConflict('This document has not finished its virus scan');
      }
      await tx.driverDocument.update({
        where: { id: documentId },
        data: {
          status: input.decision === 'approve' ? 'approved' : 'rejected',
          rejectionReason: input.decision === 'approve' ? null : input.reason,
          reviewedById: staff.userId,
          reviewedAt: new Date(),
        },
      });
      await this.record(tx, 'driver.document_reviewed', 'driver_document', documentId, staff, {
        driverId,
        kind: document.kind,
        decision: input.decision,
        ...(input.reason ? { reason: input.reason } : {}),
      });
    });
  }

  async reviewVehicle(
    driverId: string,
    vehicleId: string,
    input: z.output<typeof reviewDecisionSchema>,
    staff: StaffActor,
  ): Promise<void> {
    await this.notSelf(driverId, staff);
    await this.prisma.$transaction(async (tx) => {
      const vehicle = await tx.driverVehicle.findUnique({ where: { id: vehicleId } });
      if (vehicle?.driverId !== driverId) throw new NotFoundException();
      const approve = input.decision === 'approve';
      // The first approved vehicle becomes the one the driver drives.
      const hasActive = approve
        ? (await tx.driverVehicle.count({ where: { driverId, active: true } })) > 0
        : true;
      await tx.driverVehicle.update({
        where: { id: vehicleId },
        data: {
          status: approve ? 'approved' : 'rejected',
          ...(approve && !hasActive ? { active: true } : {}),
          ...(!approve ? { active: false } : {}),
        },
      });
      await this.record(tx, 'driver.vehicle_reviewed', 'driver_vehicle', vehicleId, staff, {
        driverId,
        decision: input.decision,
        ...(input.reason ? { reason: input.reason } : {}),
      });
    });
  }

  async approve(
    driverId: string,
    input: z.output<typeof approveDriverSchema>,
    staff: StaffActor,
  ): Promise<void> {
    await this.notSelf(driverId, staff);
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM drivers WHERE id = ${driverId}::uuid FOR UPDATE`;
      const driver = await tx.driver.findUnique({
        where: { id: driverId },
        include: DRIVER_INCLUDE,
      });
      if (!driver) throw new NotFoundException();
      if (driver.status === 'approved') return;
      if (driver.status === 'suspended')
        throw reviewConflict('Reinstate a suspended driver instead');

      // A manual check stands in only for a provider that could not answer.
      const identity =
        driver.identityCheck === 'pending' && input.manualIdentityCheck
          ? 'verified'
          : driver.identityCheck;
      const licence =
        driver.licenceCheck === 'pending' && input.manualLicenceCheck
          ? 'verified'
          : driver.licenceCheck;
      const today = localDate(new Date(), TIME_ZONE);
      const blocking = missingSteps(
        { ...driver, identityCheck: identity, licenceCheck: licence, status: 'approved' },
        today,
      );
      if (blocking.length > 0) {
        throw new ProblemDetailsException(
          HttpStatus.CONFLICT,
          'driver-not-ready',
          'This driver cannot be approved yet',
          undefined,
          { missing: blocking, documents: documentsMissing(driver) },
        );
      }
      const now = new Date();
      await tx.driver.update({
        where: { id: driverId },
        data: {
          status: 'approved',
          statusReason: null,
          identityCheck: identity,
          licenceCheck: licence,
          ...(identity !== driver.identityCheck
            ? { identityReference: `manual:${staff.userId}` }
            : {}),
          ...(licence !== driver.licenceCheck
            ? { licenceReference: `manual:${staff.userId}` }
            : {}),
          reviewedById: staff.userId,
          reviewedAt: now,
        },
      });
      await tx.userRole.upsert({
        where: { userId_roleKey: { userId: driver.userId, roleKey: 'driver' } },
        create: { userId: driver.userId, roleKey: 'driver', grantedById: staff.userId },
        update: {},
      });
      await this.record(tx, 'driver.approved', 'driver', driverId, staff, {
        manualIdentityCheck: identity !== driver.identityCheck,
        manualLicenceCheck: licence !== driver.licenceCheck,
      });
    });
  }

  async reject(driverId: string, reason: Reason, staff: StaffActor): Promise<void> {
    await this.notSelf(driverId, staff);
    await this.setStatus(driverId, 'rejected', reason, staff, ['pending'], 'driver.rejected');
  }

  /** Stops a driver at once: offline, open offers withdrawn. A live ride continues to its end. */
  async suspend(driverId: string, reason: Reason, staff: StaffActor): Promise<void> {
    await this.notSelf(driverId, staff);
    await this.setStatus(driverId, 'suspended', reason, staff, ['approved'], 'driver.suspended');
  }

  async reinstate(driverId: string, staff: StaffActor): Promise<void> {
    await this.notSelf(driverId, staff);
    await this.setStatus(driverId, 'approved', null, staff, ['suspended'], 'driver.reinstated');
  }

  private async setStatus(
    driverId: string,
    status: 'approved' | 'rejected' | 'suspended',
    reason: Reason | null,
    staff: StaffActor,
    from: readonly ('pending' | 'approved' | 'suspended')[],
    action: AuditAction,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const driver = await tx.driver.findUnique({ where: { id: driverId } });
      if (!driver) throw new NotFoundException();
      if (driver.status === status) return;
      if (!(from as readonly string[]).includes(driver.status)) {
        throw reviewConflict(
          `A ${driver.status} driver cannot be ${status === 'approved' ? 'reinstated' : status}`,
        );
      }
      const now = new Date();
      await tx.driver.update({
        where: { id: driverId },
        data: {
          status,
          statusReason: reason,
          reviewedById: staff.userId,
          reviewedAt: now,
          ...(status === 'approved'
            ? {}
            : { online: false, lastLat: null, lastLng: null, lastLocationAt: null }),
        },
      });
      if (status !== 'approved') {
        await tx.rideOffer.updateMany({
          where: { driverId, status: 'open' },
          data: { status: 'withdrawn', respondedAt: now },
        });
      }
      await this.record(tx, action, 'driver', driverId, staff, reason ? { reason } : {});
    });
  }

  /** Separation of duties: staff never review their own driver account. */
  private async notSelf(driverId: string, staff: StaffActor): Promise<void> {
    const driver = await this.prisma.driver.findUnique({
      where: { id: driverId },
      select: { userId: true },
    });
    if (!driver) throw new NotFoundException();
    if (driver.userId === staff.userId) {
      throw new ProblemDetailsException(
        HttpStatus.FORBIDDEN,
        'self-review',
        'You cannot review your own driver account',
      );
    }
  }

  private async record(
    tx: Tx,
    action: AuditAction,
    targetType: string,
    targetId: string,
    staff: StaffActor,
    metadata: Prisma.InputJsonObject,
  ): Promise<void> {
    await this.audit.record(
      { action, actorUserId: staff.userId, targetType, targetId, context: staff.context, metadata },
      tx,
    );
  }
}
