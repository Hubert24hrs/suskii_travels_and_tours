import { HttpStatus, Injectable, Logger, NotFoundException } from '@nestjs/common';

import {
  localDate,
  type DriverApplicationInput,
  type DriverVehicleInput,
  type PayoutAccountInput,
} from '@suskii/shared';

import { AuditService } from '../audit/audit.service';
import { ProblemDetailsException } from '../common/problem-details';
import type { RequestContext } from '../common/request-context';
import { uuidv7 } from '../common/uuid';
import {
  driverLicenceContext,
  driverNinContext,
  driverPayoutContext,
} from '../crypto/encryption-contexts';
import { FieldEncryption } from '../crypto/field-encryption';
import { HmacService } from '../crypto/hmac.service';
import { KycProvider, KycUnavailableError, type KycResult } from '../ground/kyc';
import { PrismaService } from '../infra/prisma.service';

import {
  DRIVER_INCLUDE,
  isOldEnough,
  licenceLongEnough,
  toDriverProfile,
  type DriverRecord,
} from './driver-views';
import type { DriverProfileDto } from './drivers.schemas';

const TIME_ZONE = 'Africa/Lagos';
const MAX_VEHICLES = 3;

export interface DriverActor {
  userId: string;
  context: RequestContext;
}

const conflict = (slug: string, title: string, detail?: string): ProblemDetailsException =>
  new ProblemDetailsException(HttpStatus.CONFLICT, slug, title, detail);

const invalid = (slug: string, title: string, detail?: string): ProblemDetailsException =>
  new ProblemDetailsException(HttpStatus.UNPROCESSABLE_ENTITY, slug, title, detail);

const uniqueViolation = (error: unknown): boolean => (error as { code?: string }).code === 'P2002';

/**
 * Driver onboarding (ADR-050): an application with the NIN and licence checked through the KYC
 * adapter, vehicles, and the payout account. Identity numbers are encrypted, looked up only by
 * HMAC (one driver account per person) and never returned. When the KYC provider cannot answer,
 * the check stays `pending` and the application waits for a staff member to check by hand.
 */
@Injectable()
export class DriversService {
  private readonly logger = new Logger(DriversService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: FieldEncryption,
    private readonly hmac: HmacService,
    private readonly kyc: KycProvider,
    private readonly audit: AuditService,
  ) {}

  async apply(input: DriverApplicationInput, actor: DriverActor): Promise<DriverProfileDto> {
    const today = localDate(new Date(), TIME_ZONE);
    if (!isOldEnough(input.dateOfBirth, today)) {
      throw invalid('driver-too-young', 'Drivers must be at least 18 years old');
    }
    if (!licenceLongEnough(input.licenceExpiresOn, today)) {
      throw invalid(
        'licence-expiring',
        'Your licence expires too soon',
        'Renew your licence, then apply with the new expiry date.',
      );
    }
    if (
      await this.prisma.driver.findUnique({ where: { userId: actor.userId }, select: { id: true } })
    ) {
      throw conflict('driver-exists', 'You have already applied to drive');
    }

    const identity = await this.check(() =>
      this.kyc.verifyIdentity({
        nin: input.nin,
        givenNames: input.givenNames,
        surname: input.surname,
        dateOfBirth: input.dateOfBirth,
      }),
    );
    const licence = await this.check(() =>
      this.kyc.verifyLicence({
        licenceNumber: input.licenceNumber,
        surname: input.surname,
        expiresOn: input.licenceExpiresOn,
      }),
    );

    const id = uuidv7();
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.driver.create({
          data: {
            id,
            userId: actor.userId,
            givenNames: input.givenNames,
            surname: input.surname,
            dateOfBirth: new Date(`${input.dateOfBirth}T00:00:00Z`),
            cityName: input.cityName,
            ninEncrypted: this.encryption.encrypt(input.nin, driverNinContext(id)),
            ninHash: this.hmac.digest('driver-nin', input.nin),
            identityCheck: identity?.outcome ?? 'pending',
            identityReference: identity?.reference ?? null,
            licenceEncrypted: this.encryption.encrypt(
              input.licenceNumber,
              driverLicenceContext(id),
            ),
            licenceHash: this.hmac.digest('driver-licence', input.licenceNumber),
            licenceExpiresOn: new Date(`${input.licenceExpiresOn}T00:00:00Z`),
            licenceCheck: licence?.outcome ?? 'pending',
            licenceReference: licence?.reference ?? null,
          },
        });
        await this.audit.record(
          {
            action: 'driver.applied',
            actorUserId: actor.userId,
            targetType: 'driver',
            targetId: id,
            context: actor.context,
            metadata: {
              identityCheck: identity?.outcome ?? 'pending',
              licenceCheck: licence?.outcome ?? 'pending',
              kyc: this.kyc.name,
            },
          },
          tx,
        );
      });
    } catch (error) {
      // The NIN or licence already belongs to another driver account (or a double submit).
      if (uniqueViolation(error)) {
        throw conflict(
          'driver-exists',
          'This identity is already registered to drive',
          'Contact driver support if you think this is a mistake.',
        );
      }
      throw error;
    }
    return this.profile(actor.userId);
  }

  async profile(userId: string): Promise<DriverProfileDto> {
    return this.present(await this.load(userId));
  }

  async addVehicle(input: DriverVehicleInput, actor: DriverActor): Promise<DriverProfileDto> {
    const driver = await this.load(actor.userId);
    if (driver.status === 'rejected')
      throw conflict('driver-rejected', 'Your application was not approved');
    if (driver.vehicles.length >= MAX_VEHICLES) {
      throw conflict('vehicle-limit', 'You can register at most three vehicles');
    }
    const today = localDate(new Date(), TIME_ZONE);
    if (input.insuranceExpiresOn < today) {
      throw invalid('insurance-expired', 'The insurance has expired');
    }
    try {
      await this.prisma.$transaction(async (tx) => {
        const vehicle = await tx.driverVehicle.create({
          data: {
            driverId: driver.id,
            make: input.make,
            model: input.model,
            year: input.year,
            colour: input.colour,
            plate: input.plate,
            category: input.category,
            seats: input.seats,
            insuranceExpiresOn: new Date(`${input.insuranceExpiresOn}T00:00:00Z`),
          },
        });
        await this.audit.record(
          {
            action: 'driver.vehicle_added',
            actorUserId: actor.userId,
            targetType: 'driver_vehicle',
            targetId: vehicle.id,
            context: actor.context,
            metadata: { driverId: driver.id, category: input.category },
          },
          tx,
        );
      });
    } catch (error) {
      if (uniqueViolation(error))
        throw conflict('plate-taken', 'This vehicle is already registered');
      throw error;
    }
    return this.profile(actor.userId);
  }

  /** Chooses which approved vehicle the driver drives today (not during a ride). */
  async activateVehicle(vehicleId: string, actor: DriverActor): Promise<DriverProfileDto> {
    const driver = await this.load(actor.userId);
    const vehicle = driver.vehicles.find((candidate) => candidate.id === vehicleId);
    if (!vehicle) throw new NotFoundException();
    if (vehicle.status !== 'approved')
      throw conflict('vehicle-not-approved', 'This vehicle is not approved yet');
    const live = await this.prisma.ride.findFirst({
      where: { driverId: driver.id, status: { in: ['assigned', 'arrived', 'in_progress'] } },
      select: { id: true },
    });
    if (live) throw conflict('ride-in-progress', 'Finish your current ride first');
    await this.prisma.$transaction([
      this.prisma.driverVehicle.updateMany({
        where: { driverId: driver.id, active: true },
        data: { active: false },
      }),
      this.prisma.driverVehicle.update({ where: { id: vehicleId }, data: { active: true } }),
    ]);
    return this.profile(actor.userId);
  }

  /** Where payouts go; changing it needs a recent sign-in or re-authentication (checked by the caller). */
  async setPayoutAccount(
    account: PayoutAccountInput,
    actor: DriverActor,
  ): Promise<DriverProfileDto> {
    const driver = await this.load(actor.userId);
    await this.prisma.$transaction(async (tx) => {
      await tx.driver.update({
        where: { id: driver.id },
        data: {
          payoutAccountEncrypted: this.encryption.encrypt(
            JSON.stringify({
              bankCode: account.bankCode,
              accountNumber: account.accountNumber,
              accountName: account.accountName,
            }),
            driverPayoutContext(driver.id),
          ),
          // A payout the bank rejected is tried again only after the details change.
          payoutAccountUpdatedAt: new Date(),
        },
      });
      await this.audit.record(
        {
          action: 'driver.payout_account_updated',
          actorUserId: actor.userId,
          targetType: 'driver',
          targetId: driver.id,
          context: actor.context,
          metadata: { replaced: driver.payoutAccountEncrypted !== null },
        },
        tx,
      );
    });
    return this.profile(actor.userId);
  }

  /** The caller's driver record; 404 for accounts that never applied. */
  async load(userId: string): Promise<DriverRecord> {
    const driver = await this.prisma.driver.findUnique({
      where: { userId },
      include: DRIVER_INCLUDE,
    });
    if (!driver) throw new NotFoundException();
    return driver;
  }

  present(driver: DriverRecord): DriverProfileDto {
    return toDriverProfile(
      driver,
      this.encryption.decrypt(driver.licenceEncrypted, driverLicenceContext(driver.id)),
      this.payoutAccount(driver),
      localDate(new Date(), TIME_ZONE),
    );
  }

  payoutAccount(driver: {
    id: string;
    payoutAccountEncrypted: string | null;
  }): PayoutAccountInput | null {
    if (!driver.payoutAccountEncrypted) return null;
    return JSON.parse(
      this.encryption.decrypt(driver.payoutAccountEncrypted, driverPayoutContext(driver.id)),
    ) as PayoutAccountInput;
  }

  /** A KYC answer, or null when the provider could not answer (the check stays pending). */
  private async check(run: () => Promise<KycResult>): Promise<KycResult | null> {
    try {
      return await run();
    } catch (error) {
      if (!(error instanceof KycUnavailableError)) throw error;
      this.logger.warn({ provider: this.kyc.name, reason: error.name }, 'kyc check unavailable');
      return null;
    }
  }
}
