import { Injectable, NotFoundException } from '@nestjs/common';
import {
  PRIVACY_RULES,
  breachNoticeDueAt,
  type BreachDataCategory,
  type PrivacyBreachCreateInput,
  type PrivacyBreachNoticeInput,
} from '@suskii/shared';
import type { z } from 'zod';

import { conflict, type StaffActor } from '../admin/admin-helpers';
import { AuditService } from '../audit/audit.service';
import { uuidv7 } from '../common/uuid';
import { privacyBreachDetailsContext } from '../crypto/encryption-contexts';
import { FieldEncryption } from '../crypto/field-encryption';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../infra/prisma.service';

import type {
  privacyBreachDetailSchema,
  privacyBreachPageSchema,
  privacyBreachQuerySchema,
  privacyBreachSchema,
} from './privacy-register.schemas';

type BreachView = z.infer<typeof privacyBreachSchema>;
type BreachDetailView = z.infer<typeof privacyBreachDetailSchema>;

const WITH_NOTICES = {
  notices: { orderBy: [{ regulatorDueAt: 'asc' }, { jurisdiction: 'asc' }] },
} as const satisfies Prisma.PrivacyBreachInclude;
type BreachRow = Prisma.PrivacyBreachGetPayload<{ include: typeof WITH_NOTICES }>;

/** A pending notice this close to its deadline pages (`suskii.privacy_breach_notices.pending`). */
export const BREACH_NOTICE_WARNING_HOURS = 12;

/**
 * The breach register (ADR-089): from awareness to closing, with one notice per regulator due
 * `breachNoticeDueAt` after awareness. Details are encrypted and never leave in a list or the
 * audit log; a breach closes only when every regulator was told or found not to need telling.
 */
@Injectable()
export class PrivacyBreachesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly encryption: FieldEncryption,
  ) {}

  async list(
    query: z.infer<typeof privacyBreachQuerySchema>,
    now = new Date(),
  ): Promise<z.infer<typeof privacyBreachPageSchema>> {
    const rows = await this.prisma.privacyBreach.findMany({
      where: {
        ...(query.status ? { status: query.status } : {}),
        ...(query.cursor ? { id: { lt: query.cursor } } : {}),
      },
      include: WITH_NOTICES,
      orderBy: { id: 'desc' },
      take: query.limit + 1,
    });
    const page = rows.slice(0, query.limit);
    return {
      items: page.map((row) => this.present(row, now)),
      nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
    };
  }

  async get(id: string, now = new Date()): Promise<BreachDetailView> {
    const row = await this.prisma.privacyBreach.findUnique({
      where: { id },
      include: WITH_NOTICES,
    });
    if (!row) throw new NotFoundException();
    return this.detail(row, now);
  }

  async open(
    input: PrivacyBreachCreateInput,
    staff: StaffActor,
    now = new Date(),
  ): Promise<BreachDetailView> {
    const id = uuidv7();
    const awareAt = new Date(input.awareAt);
    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.privacyBreach.create({
        data: {
          id,
          title: input.title,
          detailsCiphertext: this.encryption.encrypt(
            input.details,
            privacyBreachDetailsContext(id),
          ),
          awareAt,
          highRisk: input.highRisk,
          categories: input.categories,
          subjectsAffected: input.subjectsAffected ?? null,
          notices: {
            create: input.jurisdictions.map((jurisdiction) => ({
              jurisdiction,
              regulatorDueAt: breachNoticeDueAt(jurisdiction, awareAt),
            })),
          },
        },
        include: WITH_NOTICES,
      });
      await this.audit.record(
        {
          action: 'privacy.breach_opened',
          actorUserId: staff.userId,
          targetType: 'privacy_breach',
          targetId: id,
          metadata: {
            highRisk: input.highRisk,
            categories: input.categories,
            jurisdictions: input.jurisdictions,
          },
          context: staff.context,
        },
        tx,
      );
      return created;
    });
    return this.detail(row, now);
  }

  async recordNotice(
    id: string,
    input: PrivacyBreachNoticeInput,
    staff: StaffActor,
    now = new Date(),
  ): Promise<BreachDetailView> {
    const row = await this.prisma.$transaction(async (tx) => {
      const breach = await tx.privacyBreach.findUnique({ where: { id } });
      if (!breach) throw new NotFoundException();
      if (breach.status === 'closed') throw conflict('breach-closed', 'The breach is closed');
      const notified = input.decision === 'notified';
      const updated = await tx.privacyBreachNotice.updateMany({
        where: { breachId: id, jurisdiction: input.jurisdiction },
        data: {
          decision: input.decision,
          regulatorNotifiedAt: notified ? new Date(input.regulatorNotifiedAt) : null,
          regulatorReference: notified ? (input.regulatorReference ?? null) : null,
          subjectsNotifiedAt:
            notified && input.subjectsNotifiedAt ? new Date(input.subjectsNotifiedAt) : null,
        },
      });
      // A jurisdiction the breach was not opened for is not part of it.
      if (updated.count === 0) throw new NotFoundException();
      const notice = await tx.privacyBreachNotice.findUniqueOrThrow({
        where: { breachId_jurisdiction: { breachId: id, jurisdiction: input.jurisdiction } },
      });
      await this.audit.record(
        {
          action: 'privacy.breach_notice_recorded',
          actorUserId: staff.userId,
          targetType: 'privacy_breach',
          targetId: id,
          metadata: {
            jurisdiction: input.jurisdiction,
            decision: input.decision,
            late: notified && new Date(input.regulatorNotifiedAt) > notice.regulatorDueAt,
          },
          context: staff.context,
        },
        tx,
      );
      return tx.privacyBreach.findUniqueOrThrow({ where: { id }, include: WITH_NOTICES });
    });
    return this.detail(row, now);
  }

  async close(id: string, staff: StaffActor, now = new Date()): Promise<BreachDetailView> {
    const row = await this.prisma.$transaction(async (tx) => {
      const breach = await tx.privacyBreach.findUnique({ where: { id }, include: WITH_NOTICES });
      if (!breach) throw new NotFoundException();
      if (breach.notices.some((notice) => notice.decision === 'pending')) {
        throw conflict('notices-pending', 'Every regulator needs a notice or a decision first');
      }
      const claimed = await tx.privacyBreach.updateMany({
        where: { id, status: 'open' },
        data: { status: 'closed', closedAt: now },
      });
      if (claimed.count === 0) throw conflict('breach-closed', 'The breach is closed');
      await this.audit.record(
        {
          action: 'privacy.breach_closed',
          actorUserId: staff.userId,
          targetType: 'privacy_breach',
          targetId: id,
          metadata: { notices: breach.notices.length },
          context: staff.context,
        },
        tx,
      );
      return tx.privacyBreach.findUniqueOrThrow({ where: { id }, include: WITH_NOTICES });
    });
    return this.detail(row, now);
  }

  private present(row: BreachRow, now: Date): BreachView {
    return {
      id: row.id,
      title: row.title,
      awareAt: row.awareAt.toISOString(),
      highRisk: row.highRisk,
      categories: row.categories as BreachDataCategory[],
      subjectsAffected: row.subjectsAffected,
      status: row.status,
      closedAt: row.closedAt?.toISOString() ?? null,
      notices: row.notices.map((notice) => {
        const rules = PRIVACY_RULES[notice.jurisdiction];
        return {
          jurisdiction: notice.jurisdiction,
          regulator: rules.regulator,
          regulatorDueAt: notice.regulatorDueAt.toISOString(),
          statutory: rules.breach.statutory,
          source: rules.breach.source,
          decision: notice.decision,
          regulatorNotifiedAt: notice.regulatorNotifiedAt?.toISOString() ?? null,
          regulatorReference: notice.regulatorReference,
          subjectsNotifiedAt: notice.subjectsNotifiedAt?.toISOString() ?? null,
          overdue: notice.decision === 'pending' && notice.regulatorDueAt < now,
        };
      }),
    };
  }

  private detail(row: BreachRow, now: Date): BreachDetailView {
    return {
      ...this.present(row, now),
      details: this.encryption.decrypt(row.detailsCiphertext, privacyBreachDetailsContext(row.id)),
    };
  }
}
