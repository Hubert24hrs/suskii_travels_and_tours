import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { z } from 'zod';

import type { EmergencyContact, GeoPoint, IncidentKind } from '@suskii/shared';

import { AuditService } from '../audit/audit.service';
import type { RequestContext } from '../common/request-context';
import { uuidv7 } from '../common/uuid';
import { emergencyContactContext } from '../crypto/encryption-contexts';
import { FieldEncryption } from '../crypto/field-encryption';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../infra/prisma.service';
import { SmsProvider } from '../notifications/sms';
import { rideSos } from '../telemetry/metrics';

import type { incidentListSchema, resolveIncidentSchema } from './rides.schemas';

type Tx = Prisma.TransactionClient;

/** Nigeria's emergency number, shown with every SOS answer. */
export const EMERGENCY_NUMBER = '112';
const MAX_CONTACTS = 3;

export interface SosCaller {
  userId: string;
  context: RequestContext;
}

/**
 * Safety (ADR-050): SOS alerts from riders and drivers, automatic signals (PIN lockout, route
 * deviation) and staff triage. An SOS is handled synchronously, never queued: the incident is
 * recorded and the rider's trusted contacts are texted before the request returns. Nothing
 * happens to a driver automatically; staff decide.
 */
@Injectable()
export class SafetyService {
  private readonly logger = new Logger(SafetyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: FieldEncryption,
    private readonly sms: SmsProvider,
    private readonly audit: AuditService,
  ) {}

  /** Records an automatic signal (in the caller's transaction when given). */
  async raise(
    kind: IncidentKind,
    rideId: string,
    position: GeoPoint | null,
    tx: Tx | PrismaService = this.prisma,
  ): Promise<string> {
    const open = await tx.safetyIncident.findFirst({
      where: { rideId, kind, status: { not: 'resolved' } },
      select: { id: true },
    });
    if (open) return open.id;
    const incident = await tx.safetyIncident.create({
      data: { kind, rideId, lat: position?.lat ?? null, lng: position?.lng ?? null },
    });
    return incident.id;
  }

  /**
   * SOS on a ride the caller rides or drives (404 otherwise). Texts the rider's emergency
   * contacts with the ride's live-share link if one exists, never coordinates in clear.
   */
  async sos(
    rideId: string,
    caller: SosCaller,
    position: GeoPoint | null,
  ): Promise<{ incidentId: string; contactsNotified: number; emergencyNumber: string }> {
    const ride = await this.prisma.ride.findUnique({
      where: { id: rideId },
      include: { driver: { select: { userId: true } } },
    });
    const isRider = ride?.riderUserId === caller.userId;
    const isDriver = ride?.driver?.userId === caller.userId;
    if (!ride || (!isRider && !isDriver)) throw new NotFoundException();

    const incident = await this.prisma.safetyIncident.create({
      data: {
        id: uuidv7(),
        kind: 'sos',
        rideId,
        reporterUserId: caller.userId,
        lat: position?.lat ?? null,
        lng: position?.lng ?? null,
      },
    });
    await this.audit.record({
      action: 'ride.sos_raised',
      actorUserId: caller.userId,
      targetType: 'ride',
      targetId: rideId,
      context: caller.context,
      metadata: { incidentId: incident.id, by: isRider ? 'rider' : 'driver' },
    });
    rideSos.add(1, { by: isRider ? 'rider' : 'driver' });

    let notified = 0;
    if (isRider) {
      for (const contact of await this.contacts(ride.riderUserId)) {
        try {
          await this.sms.send({
            to: contact.phone,
            template: 'ride-sos',
            body: `Suskii safety alert: ${contact.name}, someone who listed you as an emergency contact raised an SOS on a ride in ${ride.cityName}. Our safety team is responding. If you cannot reach them, call ${EMERGENCY_NUMBER}.`,
          });
          notified += 1;
        } catch (error) {
          this.logger.warn({ reason: (error as Error).name }, 'sos contact text failed');
        }
      }
    }
    return {
      incidentId: incident.id,
      contactsNotified: notified,
      emergencyNumber: EMERGENCY_NUMBER,
    };
  }

  async contacts(userId: string): Promise<EmergencyContact[]> {
    const rows = await this.prisma.emergencyContact.findMany({
      where: { userId },
      orderBy: { position: 'asc' },
    });
    return rows.map(
      (row) =>
        JSON.parse(
          this.encryption.decrypt(row.contactEncrypted, emergencyContactContext(row.id)),
        ) as EmergencyContact,
    );
  }

  /** Replaces the rider's trusted contacts (at most three), each encrypted with its own id. */
  async setContacts(
    userId: string,
    contacts: readonly EmergencyContact[],
    context: RequestContext,
  ) {
    await this.prisma.$transaction(async (tx) => {
      await tx.emergencyContact.deleteMany({ where: { userId } });
      for (const [position, contact] of contacts.slice(0, MAX_CONTACTS).entries()) {
        const id = uuidv7();
        await tx.emergencyContact.create({
          data: {
            id,
            userId,
            position,
            contactEncrypted: this.encryption.encrypt(
              JSON.stringify({ name: contact.name, phone: contact.phone }),
              emergencyContactContext(id),
            ),
          },
        });
      }
      await this.audit.record(
        {
          action: 'account.emergency_contacts_updated',
          actorUserId: userId,
          targetType: 'user',
          targetId: userId,
          context,
          metadata: { count: Math.min(contacts.length, MAX_CONTACTS) },
        },
        tx,
      );
    });
    return { contacts: await this.contacts(userId) };
  }

  async incidents(
    status?: 'open' | 'acknowledged' | 'resolved',
  ): Promise<z.infer<typeof incidentListSchema>> {
    const rows = await this.prisma.safetyIncident.findMany({
      where: status ? { status } : {},
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { ride: { select: { riderUserId: true } } },
    });
    return {
      incidents: rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        status: row.status,
        rideId: row.rideId,
        reporter: !row.reporterUserId
          ? 'system'
          : row.reporterUserId === row.ride?.riderUserId
            ? 'rider'
            : 'driver',
        position: row.lat !== null && row.lng !== null ? { lat: row.lat, lng: row.lng } : null,
        createdAt: row.createdAt.toISOString(),
        acknowledgedAt: row.acknowledgedAt?.toISOString() ?? null,
        resolvedAt: row.resolvedAt?.toISOString() ?? null,
        resolution: row.resolution,
      })),
    };
  }

  async acknowledge(id: string, staff: { userId: string; context: RequestContext }): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.safetyIncident.updateMany({
        where: { id, status: 'open' },
        data: {
          status: 'acknowledged',
          acknowledgedById: staff.userId,
          acknowledgedAt: new Date(),
        },
      });
      if (count === 0 && !(await tx.safetyIncident.findUnique({ where: { id } }))) {
        throw new NotFoundException();
      }
      await this.audit.record(
        {
          action: 'safety.incident_acknowledged',
          actorUserId: staff.userId,
          targetType: 'safety_incident',
          targetId: id,
          context: staff.context,
        },
        tx,
      );
    });
  }

  async resolve(
    id: string,
    input: z.output<typeof resolveIncidentSchema>,
    staff: { userId: string; context: RequestContext },
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const incident = await tx.safetyIncident.findUnique({ where: { id } });
      if (!incident) throw new NotFoundException();
      if (incident.status === 'resolved') return;
      await tx.safetyIncident.update({
        where: { id },
        data: {
          status: 'resolved',
          resolution: input.resolution,
          resolvedById: staff.userId,
          resolvedAt: new Date(),
          acknowledgedById: incident.acknowledgedById ?? staff.userId,
          acknowledgedAt: incident.acknowledgedAt ?? new Date(),
        },
      });
      await this.audit.record(
        {
          action: 'safety.incident_resolved',
          actorUserId: staff.userId,
          targetType: 'safety_incident',
          targetId: id,
          context: staff.context,
          metadata: { resolution: input.resolution },
        },
        tx,
      );
    });
  }
}
