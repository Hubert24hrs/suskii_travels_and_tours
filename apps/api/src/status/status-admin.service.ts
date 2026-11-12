import { Injectable, NotFoundException } from '@nestjs/common';
import type { StatusIncidentCreateInput, StatusIncidentUpdateInput } from '@suskii/shared';
import type { z } from 'zod';

import { conflict, fieldChanges, type StaffActor } from '../admin/admin-helpers';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../infra/prisma.service';

import type { adminIncidentPageSchema, adminIncidentQuerySchema } from './status.schemas';
import {
  INCIDENT_WITH_UPDATES,
  StatusService,
  presentIncident,
  type PublicIncident,
} from './status.service';

/**
 * Incidents staff write for the status page (ADR-087). Each change is audited in its
 * transaction with names only (titles and messages are public text, but the audit log is for
 * who changed what). The status cache is cleared after the commit.
 */
@Injectable()
export class StatusAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly status: StatusService,
  ) {}

  async list(
    query: z.infer<typeof adminIncidentQuerySchema>,
  ): Promise<z.infer<typeof adminIncidentPageSchema>> {
    const rows = await this.prisma.statusIncident.findMany({
      where: {
        ...(query.state === 'open' ? { resolvedAt: null } : {}),
        ...(query.state === 'resolved' ? { resolvedAt: { not: null } } : {}),
        ...(query.cursor ? { id: { lt: query.cursor } } : {}),
      },
      include: INCIDENT_WITH_UPDATES,
      orderBy: { id: 'desc' },
      take: query.limit + 1,
    });
    const page = rows.slice(0, query.limit);
    return {
      items: page.map(presentIncident),
      nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
    };
  }

  async open(input: StatusIncidentCreateInput, staff: StaffActor): Promise<PublicIncident> {
    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.statusIncident.create({
        data: {
          title: input.title,
          impact: input.impact,
          status: input.status,
          components: input.components,
          updates: { create: { status: input.status, message: input.message } },
        },
        include: INCIDENT_WITH_UPDATES,
      });
      await this.audit.record(
        {
          action: 'status.incident_opened',
          actorUserId: staff.userId,
          targetType: 'status_incident',
          targetId: created.id,
          metadata: { impact: input.impact, components: input.components },
          context: staff.context,
        },
        tx,
      );
      return created;
    });
    await this.status.invalidate();
    return presentIncident(row);
  }

  async update(
    id: string,
    input: StatusIncidentUpdateInput,
    staff: StaffActor,
  ): Promise<PublicIncident> {
    const resolving = input.status === 'resolved';
    const row = await this.prisma.$transaction(async (tx) => {
      const current = await tx.statusIncident.findUnique({ where: { id } });
      if (!current) throw new NotFoundException();
      const next = {
        status: input.status,
        impact: input.impact ?? current.impact,
        components: input.components ?? current.components,
      };
      // Claims the change: a second resolve (or an update racing it) finds nothing to update.
      const claimed = await tx.statusIncident.updateMany({
        where: { id, resolvedAt: null },
        data: { ...next, resolvedAt: resolving ? new Date() : null },
      });
      if (claimed.count === 0) {
        throw conflict('incident-resolved', 'The incident is resolved');
      }
      await tx.statusIncidentUpdate.create({
        data: { incidentId: id, status: input.status, message: input.message },
      });
      await this.audit.record(
        {
          action: resolving ? 'status.incident_resolved' : 'status.incident_updated',
          actorUserId: staff.userId,
          targetType: 'status_incident',
          targetId: id,
          metadata: fieldChanges(
            { status: current.status, impact: current.impact, components: current.components },
            next,
          ),
          context: staff.context,
        },
        tx,
      );
      return tx.statusIncident.findUniqueOrThrow({ where: { id }, include: INCIDENT_WITH_UPDATES });
    });
    await this.status.invalidate();
    return presentIncident(row);
  }
}
