import { Injectable, NotFoundException } from '@nestjs/common';
import type { z } from 'zod';

import type { LocaleCode } from '@suskii/shared';

import { AuditService } from '../audit/audit.service';
import { cmsContentSchemas, pageContentSchema } from '../content/content.schemas';
import type { CmsBlock, Faq, Prisma, TrustSignal } from '../generated/prisma/client';
import { PrismaService } from '../infra/prisma.service';

import {
  CMS_FIXED_KEYS,
  type adminCmsBlockListSchema,
  type adminCmsBlockSchema,
  type adminFaqSchema,
  type adminTrustSignalSchema,
  type FaqFields,
} from './admin-content.schemas';
import { checkMerged, conflict, fieldChanges, hasChanges, type StaffActor } from './admin-helpers';

type AdminCmsBlock = z.infer<typeof adminCmsBlockSchema>;
type AdminFaq = z.infer<typeof adminFaqSchema>;
type AdminTrustSignal = z.infer<typeof adminTrustSignalSchema>;

/** The schema the public site parses a block with (ContentService); null for unknown keys. */
function blockSchema(key: string): z.ZodType | null {
  if (key.startsWith('page.')) return pageContentSchema;
  return (cmsContentSchemas as Record<string, z.ZodType>)[key] ?? null;
}

const asObject = (value: Prisma.JsonValue): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value : {};

const presentBlock = (row: CmsBlock): AdminCmsBlock => ({
  key: row.key,
  locale: row.locale as LocaleCode,
  content: asObject(row.content),
  published: row.publishedAt !== null,
  publishedAt: row.publishedAt?.toISOString() ?? null,
  valid: blockSchema(row.key)?.safeParse(row.content).success ?? false,
  updatedAt: row.updatedAt.toISOString(),
});

function faqFields(row: Faq): FaqFields {
  return {
    locale: row.locale as LocaleCode,
    question: row.question,
    answer: row.answer,
    sortOrder: row.sortOrder,
    published: row.publishedAt !== null,
  };
}

const presentFaq = (row: Faq): AdminFaq => ({
  ...faqFields(row),
  id: row.id,
  publishedAt: row.publishedAt?.toISOString() ?? null,
  updatedAt: row.updatedAt.toISOString(),
});

const presentSignal = (row: TrustSignal): AdminTrustSignal => ({
  key: row.key,
  label: row.label,
  value: row.value,
  sortOrder: row.sortOrder,
  verified: row.verified,
  evidenceUrl: row.evidenceUrl,
  verifiedAt: row.verifiedAt?.toISOString() ?? null,
  verifiedBy: row.verifiedBy,
  updatedAt: row.updatedAt.toISOString(),
});

/** Publishing keeps the first publication time; unpublishing clears it. */
const publishedAt = (published: boolean, current: Date | null): Date | null =>
  published ? (current ?? new Date()) : null;

/**
 * CMS blocks, FAQs and trust signals for staff (ADR-035). Block content is validated against the
 * schema the public site parses, so nothing saved here is silently ignored there. Trust signals
 * render only once verified with evidence, and editing a claim clears its verification.
 */
@Injectable()
export class AdminContentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async listBlocks(
    locale: LocaleCode | undefined,
  ): Promise<z.infer<typeof adminCmsBlockListSchema>> {
    const rows = await this.prisma.cmsBlock.findMany({
      where: locale ? { locale } : {},
      orderBy: [{ key: 'asc' }, { locale: 'asc' }],
    });
    return { blocks: rows.map(presentBlock), fixedKeys: CMS_FIXED_KEYS };
  }

  async saveBlock(
    locale: LocaleCode,
    key: string,
    input: { content: Record<string, unknown>; published: boolean },
    staff: StaffActor,
  ): Promise<AdminCmsBlock> {
    const schema = blockSchema(key);
    if (!schema) throw new NotFoundException();
    const content = checkMerged(schema, input.content, 'content') as Prisma.InputJsonObject;
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.cmsBlock.findUnique({ where: { key_locale: { key, locale } } });
      const contentChanged = JSON.stringify(existing?.content ?? null) !== JSON.stringify(content);
      const wasPublished = existing ? existing.publishedAt !== null : null;
      if (existing && !contentChanged && wasPublished === input.published) {
        return presentBlock(existing);
      }
      const row = await tx.cmsBlock.upsert({
        where: { key_locale: { key, locale } },
        create: { key, locale, content, publishedAt: publishedAt(input.published, null) },
        update: {
          content,
          publishedAt: publishedAt(input.published, existing?.publishedAt ?? null),
        },
      });
      await this.audit.record(
        {
          action: 'cms.block_saved',
          actorUserId: staff.userId,
          targetType: 'cms_block',
          targetId: row.id,
          context: staff.context,
          metadata: {
            key,
            locale,
            contentChanged,
            ...(wasPublished !== input.published
              ? { published: { from: wasPublished, to: input.published } }
              : {}),
          },
        },
        tx,
      );
      return presentBlock(row);
    });
  }

  async listFaqs(locale: LocaleCode | undefined): Promise<{ faqs: AdminFaq[] }> {
    const rows = await this.prisma.faq.findMany({
      where: locale ? { locale } : {},
      orderBy: [{ locale: 'asc' }, { sortOrder: 'asc' }, { id: 'asc' }],
    });
    return { faqs: rows.map(presentFaq) };
  }

  async createFaq(input: FaqFields, staff: StaffActor): Promise<AdminFaq> {
    return this.prisma.$transaction(async (tx) => {
      const { published, ...fields } = input;
      const row = await tx.faq.create({
        data: { ...fields, publishedAt: publishedAt(published, null) },
      });
      await this.audit.record(
        {
          action: 'cms.faq_created',
          actorUserId: staff.userId,
          targetType: 'faq',
          targetId: row.id,
          context: staff.context,
          metadata: { changes: fieldChanges({}, input, ['question', 'answer']) },
        },
        tx,
      );
      return presentFaq(row);
    });
  }

  async updateFaq(id: string, patch: Partial<FaqFields>, staff: StaffActor): Promise<AdminFaq> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.faq.findUnique({ where: { id } });
      if (!existing) throw new NotFoundException();
      const before = faqFields(existing);
      const after = { ...before, ...patch };
      const changes = fieldChanges(before, after, ['question', 'answer']);
      if (!hasChanges(changes)) return presentFaq(existing);
      const { published, ...fields } = after;
      const row = await tx.faq.update({
        where: { id },
        data: { ...fields, publishedAt: publishedAt(published, existing.publishedAt) },
      });
      await this.audit.record(
        {
          action: 'cms.faq_updated',
          actorUserId: staff.userId,
          targetType: 'faq',
          targetId: id,
          context: staff.context,
          metadata: { changes },
        },
        tx,
      );
      return presentFaq(row);
    });
  }

  async listTrustSignals(): Promise<{ signals: AdminTrustSignal[] }> {
    const rows = await this.prisma.trustSignal.findMany({
      orderBy: [{ sortOrder: 'asc' }, { key: 'asc' }],
    });
    return { signals: rows.map(presentSignal) };
  }

  /** Label, value or order. A changed claim loses its verification until it is checked again. */
  async updateTrustSignal(
    key: string,
    patch: { label?: string; value?: string | null; sortOrder?: number },
    staff: StaffActor,
  ): Promise<AdminTrustSignal> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.trustSignal.findUnique({ where: { key } });
      if (!existing) throw new NotFoundException();
      const before = {
        label: existing.label,
        value: existing.value,
        sortOrder: existing.sortOrder,
      };
      const after = { ...before, ...patch };
      const changes = fieldChanges(before, after);
      if (!hasChanges(changes)) return presentSignal(existing);
      const claimChanged = after.label !== before.label || after.value !== before.value;
      const clearVerification = claimChanged && existing.verified;
      const row = await tx.trustSignal.update({
        where: { key },
        data: {
          ...after,
          ...(clearVerification ? { verified: false, verifiedAt: null, verifiedBy: null } : {}),
        },
      });
      await this.audit.record(
        {
          action: 'trust_signal.updated',
          actorUserId: staff.userId,
          targetType: 'trust_signal',
          targetId: key,
          context: staff.context,
          metadata: { changes, verificationCleared: clearVerification },
        },
        tx,
      );
      return presentSignal(row);
    });
  }

  async verifyTrustSignal(
    key: string,
    evidenceUrl: string,
    staff: StaffActor,
  ): Promise<AdminTrustSignal> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.trustSignal.findUnique({ where: { key } });
      if (!existing) throw new NotFoundException();
      const row = await tx.trustSignal.update({
        where: { key },
        data: { verified: true, evidenceUrl, verifiedAt: new Date(), verifiedBy: staff.userId },
      });
      await this.audit.record(
        {
          action: 'trust_signal.verified',
          actorUserId: staff.userId,
          targetType: 'trust_signal',
          targetId: key,
          context: staff.context,
          metadata: { evidenceUrl, wasVerified: existing.verified },
        },
        tx,
      );
      return presentSignal(row);
    });
  }

  async unverifyTrustSignal(
    key: string,
    reason: string,
    staff: StaffActor,
  ): Promise<AdminTrustSignal> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.trustSignal.findUnique({ where: { key } });
      if (!existing) throw new NotFoundException();
      if (!existing.verified) {
        throw conflict('trust-signal-not-verified', 'This trust signal is not verified');
      }
      const row = await tx.trustSignal.update({
        where: { key },
        data: { verified: false, verifiedAt: null, verifiedBy: null },
      });
      await this.audit.record(
        {
          action: 'trust_signal.unverified',
          actorUserId: staff.userId,
          targetType: 'trust_signal',
          targetId: key,
          context: staff.context,
          metadata: { reason },
        },
        tx,
      );
      return presentSignal(row);
    });
  }
}
