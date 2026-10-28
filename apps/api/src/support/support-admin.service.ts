import { HttpStatus, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { z } from 'zod';

import {
  ROLES,
  ROLE_PERMISSIONS,
  SUPPORT_MESSAGES_PER_CONVERSATION,
  supportSchedule,
  supportSlaState,
  whatsappWindowClosesAt,
  type SupportStatus,
} from '@suskii/shared';

import { fieldChanges, hasChanges, type StaffActor } from '../admin/admin-helpers';
import { AuditService } from '../audit/audit.service';
import { maskEmail } from '../bookings/booking-codes';
import { ProblemDetailsException } from '../common/problem-details';
import { uuidv7 } from '../common/uuid';
import { APP_CONFIG, type AppConfig } from '../config/config';
import {
  supportEmailContext,
  supportMessageContext,
  whatsappPhoneContext,
} from '../crypto/encryption-contexts';
import { FieldEncryption } from '../crypto/field-encryption';
import type { Prisma, RoleKey } from '../generated/prisma/client';
import { PrismaService } from '../infra/prisma.service';
import { supportReplyEmail, supportReplyMessage } from '../messaging/messages';
import { NotificationService } from '../messaging/notification.service';
import { EmailProvider } from '../notifications/email';
import { supportResponseTime } from '../telemetry/metrics';

import { SupportAccess } from './support-access';
import type {
  adminSupportConversationSchema,
  adminSupportPageSchema,
  adminSupportQuerySchema,
  adminSupportReplySchema,
  adminSupportRowSchema,
  adminSupportUpdateSchema,
} from './support.schemas';
import { supportConversationFull } from './support.service';
import { WhatsAppReplies } from './whatsapp/whatsapp-replies.service';

type AdminRow = z.infer<typeof adminSupportRowSchema>;
type AdminConversation = z.infer<typeof adminSupportConversationSchema>;

/** Roles whose holders handle support, so they can be assigned a conversation. */
const SUPPORT_ROLES = ROLES.filter((role) =>
  ROLE_PERMISSIONS[role].includes('support:manage'),
) as RoleKey[];

const person = { select: { id: true, displayName: true, email: true } } as const;
const include = {
  booking: { select: { id: true, reference: true } },
  user: person,
  assignee: person,
  whatsappContact: {
    select: { id: true, phoneEncrypted: true, lastInboundAt: true, optedOutAt: true },
  },
} as const;
type ConversationRow = Prisma.SupportConversationGetPayload<{ include: typeof include }>;

const nameOf = (user: { displayName: string | null; email: string | null }): string =>
  user.displayName ?? (user.email ? maskEmail(user.email) : 'Staff');

export const assigneeInvalid = (): ProblemDetailsException =>
  new ProblemDetailsException(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'support-assignee-invalid',
    'This person cannot take support conversations',
    'Assign an active staff member who handles support.',
  );

/** Active queue cursor: the due time and id of the last row shown. */
const encodeCursor = (dueAt: Date, id: string): string => `${dueAt.toISOString()}_${id}`;
function decodeCursor(cursor: string): { dueAt: Date; id: string } | null {
  const [due, id] = cursor.split('_');
  const dueAt = new Date(due ?? '');
  return id && !Number.isNaN(dueAt.getTime()) ? { dueAt, id } : null;
}

/**
 * The console's support inbox (ADR-083): queues sorted by the nearest due time, conversations
 * with internal notes, replies and notes, assignment and status, priority or category changes.
 * Every change is audited with ids and field names only; message text never enters the audit log.
 */
@Injectable()
export class SupportAdminService {
  private readonly logger = new Logger(SupportAdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly encryption: FieldEncryption,
    private readonly access: SupportAccess,
    private readonly audit: AuditService,
    private readonly notifications: NotificationService,
    private readonly email: EmailProvider,
    private readonly whatsapp: WhatsAppReplies,
  ) {}

  async list(
    query: z.infer<typeof adminSupportQuerySchema>,
    staffId: string,
  ): Promise<z.infer<typeof adminSupportPageSchema>> {
    const statuses: SupportStatus[] =
      query.queue === 'active' ? ['open', 'waiting'] : [query.queue];
    const where: Prisma.SupportConversationWhereInput = {
      status: { in: statuses },
      ...(query.priority ? { priority: query.priority } : {}),
      ...(query.channel ? { channel: query.channel } : {}),
      ...(query.assignee === 'me' ? { assigneeId: staffId } : {}),
      ...(query.assignee === 'unassigned' ? { assigneeId: null } : {}),
    };
    if (query.queue === 'resolved') {
      const rows = await this.prisma.supportConversation.findMany({
        where: { ...where, ...(query.cursor ? { id: { lt: query.cursor } } : {}) },
        include,
        orderBy: { id: 'desc' },
        take: query.limit + 1,
      });
      const page = rows.slice(0, query.limit);
      return {
        items: page.map((row) => this.row(row)),
        nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
      };
    }
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;
    const rows = await this.prisma.supportConversation.findMany({
      where: {
        ...where,
        ...(cursor
          ? {
              OR: [{ dueAt: { gt: cursor.dueAt } }, { dueAt: cursor.dueAt, id: { gt: cursor.id } }],
            }
          : {}),
      },
      include,
      orderBy: [{ dueAt: 'asc' }, { id: 'asc' }],
      take: query.limit + 1,
    });
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      items: page.map((row) => this.row(row)),
      nextCursor:
        rows.length > query.limit && last?.dueAt ? encodeCursor(last.dueAt, last.id) : null,
    };
  }

  async get(id: string): Promise<AdminConversation> {
    return this.present(await this.load(id));
  }

  /** Staff members who can be assigned a conversation. */
  async agents(): Promise<{ agents: { id: string; name: string }[] }> {
    const users = await this.prisma.user.findMany({
      where: { status: 'active', roles: { some: { roleKey: { in: SUPPORT_ROLES } } } },
      select: { id: true, displayName: true, email: true },
      orderBy: { createdAt: 'asc' },
      take: 200,
    });
    return { agents: users.map((user) => ({ id: user.id, name: nameOf(user) })) };
  }

  /**
   * A reply to the traveller, or an internal note. A reply answers what is owed (the clock stops),
   * waits for the traveller and tells them by email or push; a note changes nothing they see.
   */
  async reply(
    id: string,
    body: z.infer<typeof adminSupportReplySchema>,
    staff: StaffActor,
  ): Promise<AdminConversation> {
    const row = await this.load(id);
    if (row.messageCount >= SUPPORT_MESSAGES_PER_CONVERSATION) throw supportConversationFull();
    const now = new Date();
    const messageId = uuidv7();
    const owedSince = row.replyOwedSince;
    // A reply on a resolved conversation opens a new spell with fresh targets.
    const openedAt = row.status === 'resolved' ? now : row.openedAt;
    // A reply on WhatsApp is sent after the commit; it starts as pending (ADR-084).
    const viaWhatsApp = row.channel === 'whatsapp' && !body.internal;
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.supportMessage.create({
        data: {
          id: messageId,
          conversationId: row.id,
          author: 'staff',
          staffId: staff.userId,
          internal: body.internal,
          bodyEncrypted: this.encryption.encrypt(body.message, supportMessageContext(messageId)),
          ...(viaWhatsApp ? { deliveryStatus: 'pending' as const } : {}),
          createdAt: now,
        },
      });
      const data: Prisma.SupportConversationUpdateInput = body.internal
        ? { messageCount: { increment: 1 } }
        : {
            status: 'waiting',
            openedAt,
            replyOwedSince: null,
            resolvedAt: null,
            ...supportSchedule(
              { status: 'waiting', priority: row.priority, openedAt, replyOwedSince: null },
              this.config.SUPPORT_SLA,
            ),
            firstRespondedAt: row.firstRespondedAt ?? now,
            lastStaffMessageAt: now,
            messageCount: { increment: 1 },
            ...(row.assigneeId ? {} : { assignee: { connect: { id: staff.userId } } }),
          };
      const saved = await tx.supportConversation.update({ where: { id: row.id }, data, include });
      await this.audit.record(
        {
          action: body.internal ? 'support.note_added' : 'support.replied',
          actorUserId: staff.userId,
          targetType: 'support_conversation',
          targetId: row.id,
          context: staff.context,
          metadata: { messageId },
        },
        tx,
      );
      return saved;
    });
    if (!body.internal) {
      if (owedSince) {
        supportResponseTime.record((now.getTime() - owedSince.getTime()) / 1000, {
          priority: row.priority,
        });
      }
      // The WhatsApp reply is the message itself; other channels get a notice to come and read it.
      if (viaWhatsApp) await this.whatsapp.deliver(messageId);
      else await this.tellTraveller(updated);
    }
    return this.present(updated);
  }

  async update(
    id: string,
    body: z.infer<typeof adminSupportUpdateSchema>,
    staff: StaffActor,
  ): Promise<AdminConversation> {
    const row = await this.load(id);
    if (body.assigneeId) await this.checkAssignee(body.assigneeId);
    const now = new Date();
    const status = body.status ?? row.status;
    const priority = body.priority ?? row.priority;
    const reopened = row.status === 'resolved' && status !== 'resolved';
    const openedAt = reopened ? now : row.openedAt;
    // Opening by hand owes a reply from now; waiting or resolving owes none.
    const replyOwedSince = status === 'open' ? (row.replyOwedSince ?? now) : null;
    const changes = fieldChanges(
      {
        status: row.status,
        priority: row.priority,
        category: row.category,
        assigneeId: row.assigneeId,
      },
      {
        status,
        priority,
        category: body.category ?? row.category,
        assigneeId: body.assigneeId === undefined ? row.assigneeId : body.assigneeId,
      },
    );
    if (!hasChanges(changes)) return this.present(row);
    const updated = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.supportConversation.update({
        where: { id: row.id },
        data: {
          status,
          priority,
          ...(body.category ? { category: body.category } : {}),
          ...(body.assigneeId !== undefined
            ? body.assigneeId
              ? { assignee: { connect: { id: body.assigneeId } } }
              : { assignee: { disconnect: true } }
            : {}),
          openedAt,
          replyOwedSince,
          resolvedAt: status === 'resolved' ? (row.resolvedAt ?? now) : null,
          ...supportSchedule(
            { status, priority, openedAt, replyOwedSince },
            this.config.SUPPORT_SLA,
          ),
        },
        include,
      });
      await this.audit.record(
        {
          action: 'support.updated',
          actorUserId: staff.userId,
          targetType: 'support_conversation',
          targetId: row.id,
          context: staff.context,
          metadata: { changes },
        },
        tx,
      );
      return saved;
    });
    return this.present(updated);
  }

  private async checkAssignee(userId: string): Promise<void> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, status: 'active', roles: { some: { roleKey: { in: SUPPORT_ROLES } } } },
      select: { id: true },
    });
    if (!user) throw assigneeInvalid();
  }

  /**
   * Account holders hear through their notification choices (`support`); guests by email with a
   * link that opens only this conversation. A failure is logged and never fails the reply.
   */
  private async tellTraveller(row: ConversationRow): Promise<void> {
    const base = this.config.WEB_APP_URL.replace(/\/$/, '');
    try {
      if (row.userId) {
        await this.notifications.notify(
          row.userId,
          supportReplyMessage({
            reference: row.reference,
            conversationId: row.id,
            conversationUrl: `${base}/support/${row.id}`,
            bookingId: row.bookingId,
          }),
        );
        return;
      }
      if (!row.emailEncrypted) return;
      const to = this.encryption.decrypt(row.emailEncrypted, supportEmailContext(row.id));
      await this.email.send({
        to,
        template: 'support-reply',
        ...supportReplyEmail({
          reference: row.reference,
          conversationUrl: `${base}/support/${row.id}#access=${this.access.link(row.id)}`,
        }),
      });
    } catch (error) {
      this.logger.warn(
        { conversationId: row.id, reason: error instanceof Error ? error.name : 'unknown' },
        'support reply notice failed',
      );
    }
  }

  private async load(id: string): Promise<ConversationRow> {
    const row = await this.prisma.supportConversation.findUnique({ where: { id }, include });
    if (!row) throw new NotFoundException();
    return row;
  }

  private row(row: ConversationRow): AdminRow {
    return {
      id: row.id,
      reference: row.reference,
      category: row.category,
      priority: row.priority,
      status: row.status,
      channel: row.channel,
      customer: {
        userId: row.userId,
        label: row.user
          ? nameOf(row.user)
          : row.emailEncrypted
            ? maskEmail(this.encryption.decrypt(row.emailEncrypted, supportEmailContext(row.id)))
            : row.whatsappContact
              ? this.whatsappLabel(row.whatsappContact)
              : 'Guest',
        guest: row.userId === null,
      },
      booking: row.booking,
      assignee: row.assignee ? { id: row.assignee.id, name: nameOf(row.assignee) } : null,
      sla: {
        state: supportSlaState(row, this.config.SUPPORT_SLA, new Date()),
        responseDueAt: row.responseDueAt?.toISOString() ?? null,
        resolutionDueAt: row.resolutionDueAt?.toISOString() ?? null,
      },
      whatsapp: row.whatsappContact
        ? {
            windowClosesAt:
              whatsappWindowClosesAt(
                row.whatsappContact.lastInboundAt,
                new Date(),
              )?.toISOString() ?? null,
            optedOut: row.whatsappContact.optedOutAt !== null,
            reachable: row.whatsappContact.phoneEncrypted !== null,
          }
        : null,
      awaitingReply: row.replyOwedSince !== null,
      messageCount: row.messageCount,
      lastCustomerMessageAt: row.lastCustomerMessageAt.toISOString(),
      lastStaffMessageAt: row.lastStaffMessageAt?.toISOString() ?? null,
      firstRespondedAt: row.firstRespondedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  }

  /** "WhatsApp •••• 4567", or "WhatsApp user" for someone who shows no number. */
  private whatsappLabel(contact: { id: string; phoneEncrypted: string | null }): string {
    if (!contact.phoneEncrypted) return 'WhatsApp user';
    const phone = this.encryption.decrypt(contact.phoneEncrypted, whatsappPhoneContext(contact.id));
    return `WhatsApp •••• ${phone.slice(-4)}`;
  }

  private async present(row: ConversationRow): Promise<AdminConversation> {
    const messages = await this.prisma.supportMessage.findMany({
      where: { conversationId: row.id },
      include: { staff: person },
      orderBy: { id: 'asc' },
    });
    return {
      ...this.row(row),
      messages: messages.map((message) => ({
        id: message.id,
        author: message.author,
        internal: message.internal,
        staff: message.staff ? { id: message.staff.id, name: nameOf(message.staff) } : null,
        kind: message.kind,
        text: this.encryption.decrypt(message.bodyEncrypted, supportMessageContext(message.id)),
        delivery: message.deliveryStatus
          ? {
              status: message.deliveryStatus,
              error: message.deliveryError,
              noticeSentAt: message.noticeSentAt?.toISOString() ?? null,
            }
          : null,
        createdAt: message.createdAt.toISOString(),
      })),
    };
  }
}
