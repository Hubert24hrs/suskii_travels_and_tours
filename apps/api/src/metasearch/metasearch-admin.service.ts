import { Injectable, NotFoundException } from '@nestjs/common';

import { money, toWire } from '@suskii/shared';

import { conflict, fieldChanges, hasChanges, type StaffActor } from '../admin/admin-helpers';
import { AuditService } from '../audit/audit.service';
import { SPEND_STATUSES } from '../companies/company-trips.service';
import { HmacService } from '../crypto/hmac.service';
import { Prisma, type MetasearchPartner } from '../generated/prisma/client';
import { PrismaService } from '../infra/prisma.service';

import { keyHint, newMetasearchKey } from './metasearch-links';
import {
  METASEARCH_OUTCOMES,
  type AdminMetasearchPartner,
  type AdminMetasearchPartnerKey,
  type AdminMetasearchReport,
  type MetasearchOutcome,
  type MetasearchPartnerInput,
  type MetasearchPartnerPatch,
} from './metasearch.schemas';

const REPORT_DAYS = 30;
const DAY_MS = 86_400_000;

const toAdmin = (partner: MetasearchPartner): AdminMetasearchPartner => ({
  id: partner.id,
  name: partner.name,
  code: partner.code,
  keyHint: partner.keyPrefix,
  active: partner.active,
  requestsPerMinute: partner.requestsPerMinute,
  requestsPerDay: partner.requestsPerDay,
  maxResults: partner.maxResults,
  keyRotatedAt: partner.keyRotatedAt.toISOString(),
  createdAt: partner.createdAt.toISOString(),
  updatedAt: partner.updatedAt.toISOString(),
});

const editable = (partner: MetasearchPartner) => ({
  name: partner.name,
  active: partner.active,
  requestsPerMinute: partner.requestsPerMinute,
  requestsPerDay: partner.requestsPerDay,
  maxResults: partner.maxResults,
});

/** Share in basis points, or null without a denominator. */
const bps = (part: number, whole: number): number | null =>
  whole === 0 ? null : Math.round((part * 10_000) / whole);

/**
 * Metasearch partners in the console (ADR-081): keys are shown once and stored as an HMAC;
 * creation, rotation and changes are audited in the same transaction.
 */
@Injectable()
export class MetasearchAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly hmac: HmacService,
    private readonly audit: AuditService,
  ) {}

  async create(
    input: MetasearchPartnerInput,
    staff: StaffActor,
  ): Promise<AdminMetasearchPartnerKey> {
    const key = newMetasearchKey();
    try {
      const partner = await this.prisma.$transaction(async (tx) => {
        const created = await tx.metasearchPartner.create({
          data: {
            name: input.name,
            code: input.code,
            keyHash: this.hmac.digest('metasearch-key', key),
            keyPrefix: keyHint(key),
            requestsPerMinute: input.requestsPerMinute,
            requestsPerDay: input.requestsPerDay,
            maxResults: input.maxResults,
            keyRotatedAt: new Date(),
          },
        });
        await this.audit.record(
          {
            action: 'metasearch_partner.created',
            actorUserId: staff.userId,
            targetType: 'metasearch_partner',
            targetId: created.id,
            context: staff.context,
            metadata: { code: created.code, changes: fieldChanges({}, editable(created)) },
          },
          tx,
        );
        return created;
      });
      return { partner: toAdmin(partner), key };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw conflict('metasearch-partner-exists', 'A partner with this code already exists');
      throw error;
    }
  }

  async update(
    id: string,
    patch: MetasearchPartnerPatch,
    staff: StaffActor,
  ): Promise<AdminMetasearchPartner> {
    const partner = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.metasearchPartner.findUnique({ where: { id } });
      if (!existing) throw new NotFoundException();
      const before = editable(existing);
      const after = { ...before, ...patch };
      const changes = fieldChanges(before, after);
      if (!hasChanges(changes)) return existing;
      const updated = await tx.metasearchPartner.update({ where: { id }, data: after });
      await this.audit.record(
        {
          action: 'metasearch_partner.updated',
          actorUserId: staff.userId,
          targetType: 'metasearch_partner',
          targetId: id,
          context: staff.context,
          metadata: { changes },
        },
        tx,
      );
      return updated;
    });
    return toAdmin(partner);
  }

  /** A new key; the old one stops working with this commit. */
  async rotateKey(id: string, staff: StaffActor): Promise<AdminMetasearchPartnerKey> {
    const key = newMetasearchKey();
    const partner = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.metasearchPartner.findUnique({ where: { id } });
      if (!existing) throw new NotFoundException();
      const updated = await tx.metasearchPartner.update({
        where: { id },
        data: {
          keyHash: this.hmac.digest('metasearch-key', key),
          keyPrefix: keyHint(key),
          keyRotatedAt: new Date(),
        },
      });
      await this.audit.record(
        {
          action: 'metasearch_partner.key_rotated',
          actorUserId: staff.userId,
          targetType: 'metasearch_partner',
          targetId: id,
          context: staff.context,
          metadata: { code: existing.code },
        },
        tx,
      );
      return updated;
    });
    return { partner: toAdmin(partner), key };
  }

  /** Every partner with 30 days of landings and the committed bookings they brought. */
  async report(now = new Date()): Promise<AdminMetasearchReport> {
    const from = new Date(now.getTime() - REPORT_DAYS * DAY_MS);
    const [partners, landings, bookings] = await Promise.all([
      this.prisma.metasearchPartner.findMany({ orderBy: { name: 'asc' } }),
      this.prisma.metasearchLanding.groupBy({
        by: ['partnerId', 'outcome'],
        where: { createdAt: { gte: from, lt: now } },
        _count: { _all: true },
      }),
      this.prisma.$queryRaw<
        { partner_id: string; currency: string; bookings: number; value: bigint }[]
      >`
        SELECT l.partner_id, b.currency, COUNT(*)::int AS bookings, SUM(b.total_minor)::bigint AS value
        FROM bookings b
        JOIN metasearch_landings l ON l.id = b.metasearch_landing_id
        WHERE b.created_at >= ${from} AND b.created_at < ${now}
          AND b.status::text IN (${Prisma.join([...SPEND_STATUSES])})
        GROUP BY l.partner_id, b.currency
        ORDER BY b.currency`,
    ]);

    return {
      from: from.toISOString(),
      to: now.toISOString(),
      partners: partners.map((partner) => {
        const outcomes = Object.fromEntries(
          METASEARCH_OUTCOMES.map((outcome) => [outcome, 0]),
        ) as Record<MetasearchOutcome, number>;
        for (const row of landings)
          if (row.partnerId === partner.id) outcomes[row.outcome] = row._count._all;
        const total = METASEARCH_OUTCOMES.reduce((sum, outcome) => sum + outcomes[outcome], 0);
        const found = outcomes.same + outcomes.lower + outcomes.higher;
        const sold = bookings.filter((row) => row.partner_id === partner.id);
        return {
          partner: toAdmin(partner),
          landings: total,
          outcomes,
          priceAccuracyBps: bps(outcomes.same + outcomes.lower, found),
          linkSuccessBps: bps(found, total),
          bookings: sold.reduce((sum, row) => sum + row.bookings, 0),
          value: sold.map((row) => toWire(money(row.value, row.currency))),
        };
      }),
    };
  }
}
