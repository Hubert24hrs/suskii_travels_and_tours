import { Injectable, NotFoundException } from '@nestjs/common';
import {
  PRIVACY_RULES,
  privacyJurisdiction,
  privacyRequestDueAt,
  type PrivacyRequestCloseInput,
  type PrivacyRequestCreateInput,
  type PrivacyRequestKind,
} from '@suskii/shared';
import type { z } from 'zod';

import { conflict, type StaffActor } from '../admin/admin-helpers';
import { AuditService } from '../audit/audit.service';
import { maskEmail } from '../bookings/booking-codes';
import { uuidv7 } from '../common/uuid';
import { privacyRequestEmailContext } from '../crypto/encryption-contexts';
import { FieldEncryption } from '../crypto/field-encryption';
import type { Prisma, PrivacyRequest } from '../generated/prisma/client';
import { PrismaService } from '../infra/prisma.service';

import type {
  privacyRequestPageSchema,
  privacyRequestQuerySchema,
  privacyRequestSchema,
} from './privacy-register.schemas';

type RequestView = z.infer<typeof privacyRequestSchema>;

/**
 * The register of data rights requests (ADR-089). Each request gets the due time its
 * jurisdiction sets (`privacyRequestDueAt`); self-service exports and deletions are recorded
 * closed as they happen, so the register shows every request, not only the emailed ones.
 */
@Injectable()
export class PrivacyRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly encryption: FieldEncryption,
  ) {}

  /** An export or deletion the person did themselves, answered at once. */
  async recordSelfService(
    userId: string,
    kind: Extract<PrivacyRequestKind, 'access' | 'erasure'>,
    country: string | undefined,
    now = new Date(),
  ): Promise<void> {
    const jurisdiction = privacyJurisdiction(country);
    await this.prisma.privacyRequest.create({
      data: {
        kind,
        jurisdiction,
        channel: 'self_service',
        status: 'completed',
        userId,
        receivedAt: now,
        dueAt: privacyRequestDueAt(kind, jurisdiction, now),
        closedAt: now,
      },
    });
  }

  async list(
    query: z.infer<typeof privacyRequestQuerySchema>,
    now = new Date(),
  ): Promise<z.infer<typeof privacyRequestPageSchema>> {
    // Open requests by due time (the next deadline first, keyset on due time and id), closed
    // ones newest first.
    const open = query.status !== 'closed';
    let after: Prisma.PrivacyRequestWhereInput = {};
    if (query.cursor && open) {
      const cursor = await this.prisma.privacyRequest.findUnique({
        where: { id: query.cursor },
        select: { dueAt: true },
      });
      after = cursor
        ? {
            OR: [
              { dueAt: { gt: cursor.dueAt } },
              { dueAt: cursor.dueAt, id: { gt: query.cursor } },
            ],
          }
        : {};
    } else if (query.cursor) after = { id: { lt: query.cursor } };
    const rows = await this.prisma.privacyRequest.findMany({
      where: { status: open ? 'open' : { in: ['completed', 'refused'] }, ...after },
      orderBy: open ? [{ dueAt: 'asc' }, { id: 'asc' }] : [{ id: 'desc' }],
      take: query.limit + 1,
    });
    const page = rows.slice(0, query.limit);
    return {
      items: page.map((row) => this.present(row, now)),
      nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
    };
  }

  async open(
    input: PrivacyRequestCreateInput,
    staff: StaffActor,
    now = new Date(),
  ): Promise<RequestView> {
    const receivedAt = new Date(input.receivedAt);
    if (input.userId) {
      const user = await this.prisma.user.findUnique({
        where: { id: input.userId },
        select: { id: true },
      });
      if (!user) throw new NotFoundException();
    }
    const id = uuidv7();
    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.privacyRequest.create({
        data: {
          id,
          kind: input.kind,
          jurisdiction: input.jurisdiction,
          channel: input.channel,
          userId: input.userId ?? null,
          subjectEmailCiphertext: input.subjectEmail
            ? this.encryption.encrypt(input.subjectEmail, privacyRequestEmailContext(id))
            : null,
          receivedAt,
          dueAt: privacyRequestDueAt(input.kind, input.jurisdiction, receivedAt),
        },
      });
      await this.audit.record(
        {
          action: 'privacy.request_opened',
          actorUserId: staff.userId,
          targetType: 'privacy_request',
          targetId: id,
          metadata: { kind: input.kind, jurisdiction: input.jurisdiction, channel: input.channel },
          context: staff.context,
        },
        tx,
      );
      return created;
    });
    return this.present(row, now);
  }

  async close(
    id: string,
    input: PrivacyRequestCloseInput,
    staff: StaffActor,
    now = new Date(),
  ): Promise<RequestView> {
    const row = await this.prisma.$transaction(async (tx) => {
      const current = await tx.privacyRequest.findUnique({ where: { id } });
      if (!current) throw new NotFoundException();
      // Claims the decision: a second close (or one racing it) finds nothing open.
      const claimed = await tx.privacyRequest.updateMany({
        where: { id, status: 'open' },
        data: {
          status: input.outcome,
          closedAt: now,
          refusalReason: input.outcome === 'refused' ? input.reason : null,
        },
      });
      if (claimed.count === 0) throw conflict('request-closed', 'The request is already closed');
      await this.audit.record(
        {
          action: 'privacy.request_closed',
          actorUserId: staff.userId,
          targetType: 'privacy_request',
          targetId: id,
          metadata: {
            outcome: input.outcome,
            ...(input.outcome === 'refused' ? { reason: input.reason } : {}),
            late: now > current.dueAt,
          },
          context: staff.context,
        },
        tx,
      );
      return tx.privacyRequest.findUniqueOrThrow({ where: { id } });
    });
    return this.present(row, now);
  }

  private present(row: PrivacyRequest, now: Date): RequestView {
    const deadline = PRIVACY_RULES[row.jurisdiction].requests[row.kind];
    return {
      id: row.id,
      kind: row.kind,
      jurisdiction: row.jurisdiction,
      channel: row.channel,
      status: row.status,
      userId: row.userId,
      subjectEmail: row.subjectEmailCiphertext
        ? maskEmail(
            this.encryption.decrypt(row.subjectEmailCiphertext, privacyRequestEmailContext(row.id)),
          )
        : null,
      receivedAt: row.receivedAt.toISOString(),
      dueAt: row.dueAt.toISOString(),
      statutory: deadline.statutory,
      source: deadline.source,
      overdue: row.status === 'open' && row.dueAt < now,
      closedAt: row.closedAt?.toISOString() ?? null,
      refusalReason: row.refusalReason,
    };
  }
}
