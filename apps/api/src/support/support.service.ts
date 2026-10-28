import { HttpStatus, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { z } from 'zod';

import {
  SUPPORT_MESSAGES_PER_CONVERSATION,
  SUPPORT_OPEN_CONVERSATIONS_MAX,
  SUPPORT_REFERENCE_ALPHABET,
  supportPriority,
  supportSchedule,
  type SupportChannel,
  type SupportPriority,
  type SupportStartInput,
  type SupportStatus,
  type SupportTargets,
} from '@suskii/shared';

import { AttestationService } from '../attestation/attestation.service';
import { itemPayload, type BookingRecord } from '../bookings/booking-presenter';
import { BookingsService, type BookingCaller } from '../bookings/bookings.service';
import { tripFacts } from '../bookings/trip-facts';
import { botCheckFailed } from '../bot-protection/errors';
import { TurnstileVerifier } from '../bot-protection/turnstile';
import { ProblemDetailsException } from '../common/problem-details';
import type { RequestContext } from '../common/request-context';
import { uuidv7 } from '../common/uuid';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { supportEmailContext, supportMessageContext } from '../crypto/encryption-contexts';
import { FieldEncryption } from '../crypto/field-encryption';
import { randomCode } from '../crypto/random';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../infra/prisma.service';
import { currentPrime } from '../prime/prime-status';
import type { ClientContext } from '../search/client-context';
import { supportConversations } from '../telemetry/metrics';

import { SupportAccess } from './support-access';
import {
  SUPPORT_PAGE_MESSAGES,
  type startedSupportSchema,
  type supportConversationListSchema,
  type supportConversationSchema,
  type supportConversationSummarySchema,
} from './support.schemas';

type ConversationDto = z.infer<typeof supportConversationSchema>;
type SummaryDto = z.infer<typeof supportConversationSummarySchema>;

/** Who is asking: their session, a guest's support token, a booking token, bot evidence. */
export interface SupportCaller {
  client: ClientContext;
  context: RequestContext;
  /** `X-Support-Token`: a guest's access token or an emailed link token. */
  token: string | null;
  /** `X-Booking-Token`, to start a conversation about a guest booking. */
  bookingToken: string | null;
  /** `X-Suskii-Attestation` from the app (ADR-023). */
  attestation: string | null;
}

const include = { booking: { select: { id: true, reference: true } } } as const;
type ConversationRow = Prisma.SupportConversationGetPayload<{ include: typeof include }>;

export const supportLimit = (): ProblemDetailsException =>
  new ProblemDetailsException(
    HttpStatus.CONFLICT,
    'support-limit',
    'Too many open conversations',
    `You can have ${SUPPORT_OPEN_CONVERSATIONS_MAX} open conversations at a time. Add to one of them, or mark one as solved.`,
  );

export const supportEmailRequired = (): ProblemDetailsException =>
  new ProblemDetailsException(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'support-email-required',
    'An email address is needed',
    'Sign in, choose a booking, or give an email address so we can tell you when we reply.',
  );

export const supportConversationFull = (): ProblemDetailsException =>
  new ProblemDetailsException(
    HttpStatus.CONFLICT,
    'support-conversation-full',
    'This conversation is full',
    'Start a new conversation to keep writing to us.',
  );

/** "S-7KX2Q9". */
export const newSupportReference = (): string => `S-${randomCode(SUPPORT_REFERENCE_ALPHABET, 6)}`;

/**
 * What a traveller's message changes, whichever channel it came on: staff owe a reply from the
 * first unanswered one, and a message on a resolved conversation reopens it with fresh targets.
 */
export function customerMessageChanges(
  row: {
    status: SupportStatus;
    priority: SupportPriority;
    openedAt: Date;
    replyOwedSince: Date | null;
  },
  now: Date,
  targets: SupportTargets,
) {
  const openedAt = row.status === 'resolved' ? now : row.openedAt;
  const replyOwedSince = row.replyOwedSince ?? now;
  return {
    status: 'open' as const,
    openedAt,
    replyOwedSince,
    resolvedAt: null,
    ...supportSchedule(
      { status: 'open', priority: row.priority, openedAt, replyOwedSince },
      targets,
    ),
    lastCustomerMessageAt: now,
  };
}

/** When the booking's first item starts, for the urgent queue; null when it is not a trip. */
function tripStart(booking: BookingRecord): Date | null {
  const starts = booking.items
    .map((item) => tripFacts(itemPayload(item))?.startDate)
    .filter((date): date is string => date !== undefined)
    .sort();
  return starts[0] ? new Date(`${starts[0]}T00:00:00Z`) : null;
}

/**
 * Support conversations as travellers see them (ADR-083): start one (about a booking or not),
 * list an account's own, read one with its messages (never internal notes), reply and resolve.
 * Account holders reach only their own conversations; guests only the one their token opens;
 * everything else answers 404.
 */
@Injectable()
export class SupportService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly bookings: BookingsService,
    private readonly encryption: FieldEncryption,
    private readonly access: SupportAccess,
    private readonly turnstile: TurnstileVerifier,
    private readonly attestation: AttestationService,
  ) {}

  async start(
    input: SupportStartInput & { turnstileToken: string | null },
    caller: SupportCaller,
  ): Promise<z.infer<typeof startedSupportSchema>> {
    const userId = caller.client.userId;
    if (!userId) await this.checkHuman(input.turnstileToken, caller);
    if (userId) {
      const open = await this.prisma.supportConversation.count({
        where: { userId, status: { not: 'resolved' } },
      });
      if (open >= SUPPORT_OPEN_CONVERSATIONS_MAX) throw supportLimit();
    }

    const booking = input.bookingId
      ? await this.bookings.load(input.bookingId, {
          client: caller.client,
          token: caller.bookingToken,
        } satisfies Pick<BookingCaller, 'client' | 'token'>)
      : null;
    const email = userId
      ? null
      : (input.email ?? (booking ? this.bookings.contact(booking).email : null));
    if (!userId && !email) throw supportEmailRequired();

    const now = new Date();
    const prime = userId ? await currentPrime(this.prisma, userId, now) : null;
    const priority: SupportPriority = supportPriority({
      tripStartsAt: booking ? tripStart(booking) : null,
      prime: prime?.benefits.prioritySupport === true,
      now,
      urgentHours: this.config.SUPPORT_URGENT_HOURS,
    });
    const channel: SupportChannel = caller.client.channel === 'mobile' ? 'app' : 'web';
    const guest = userId ? null : this.access.issue();
    const id = uuidv7();
    const messageId = uuidv7();
    const schedule = supportSchedule(
      { status: 'open', priority, openedAt: now, replyOwedSince: now },
      this.config.SUPPORT_SLA,
    );

    const row = await this.prisma.$transaction(async (tx) => {
      let reference = newSupportReference();
      while (
        await tx.supportConversation.findUnique({ where: { reference }, select: { id: true } })
      ) {
        reference = newSupportReference();
      }
      const created = await tx.supportConversation.create({
        data: {
          id,
          reference,
          userId,
          accessTokenHash: guest?.hash ?? null,
          emailEncrypted: email ? this.encryption.encrypt(email, supportEmailContext(id)) : null,
          bookingId: booking?.id ?? null,
          channel,
          category: input.category,
          priority,
          status: 'open',
          openedAt: now,
          replyOwedSince: now,
          ...schedule,
          lastCustomerMessageAt: now,
          customerReadAt: now,
          messageCount: 1,
          createdAt: now,
        },
        include,
      });
      await tx.supportMessage.create({
        data: {
          id: messageId,
          conversationId: id,
          author: 'customer',
          bodyEncrypted: this.encryption.encrypt(input.message, supportMessageContext(messageId)),
          createdAt: now,
        },
      });
      return created;
    });
    supportConversations.add(1, { channel, category: input.category });
    return { conversation: await this.present(row, undefined), accessToken: guest?.token ?? null };
  }

  /** An account's conversations, most recently active first. */
  async list(caller: SupportCaller): Promise<z.infer<typeof supportConversationListSchema>> {
    const userId = caller.client.userId;
    if (!userId) return { conversations: [] };
    const rows = await this.prisma.supportConversation.findMany({
      where: { userId },
      include,
      orderBy: { updatedAt: 'desc' },
      take: 50,
    });
    return { conversations: rows.map((row) => this.summary(row)) };
  }

  /** One conversation with its messages after `after` (or the newest page). */
  async get(
    conversationId: string,
    caller: SupportCaller,
    after?: string,
  ): Promise<ConversationDto> {
    return this.present(await this.load(conversationId, caller), after);
  }

  /** The traveller has seen every reply so far. */
  async markRead(conversationId: string, caller: SupportCaller): Promise<ConversationDto> {
    const row = await this.load(conversationId, caller);
    const updated = await this.prisma.supportConversation.update({
      where: { id: row.id },
      data: { customerReadAt: new Date() },
      include,
    });
    return this.present(updated, undefined);
  }

  /**
   * A traveller's message. Staff owe a reply from the first unanswered one; a message on a
   * resolved conversation reopens it with fresh targets.
   */
  async reply(
    conversationId: string,
    text: string,
    caller: SupportCaller,
  ): Promise<ConversationDto> {
    const row = await this.load(conversationId, caller);
    if (row.messageCount >= SUPPORT_MESSAGES_PER_CONVERSATION) throw supportConversationFull();
    const now = new Date();
    const messageId = uuidv7();
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.supportMessage.create({
        data: {
          id: messageId,
          conversationId: row.id,
          author: 'customer',
          bodyEncrypted: this.encryption.encrypt(text, supportMessageContext(messageId)),
          createdAt: now,
        },
      });
      return tx.supportConversation.update({
        where: { id: row.id },
        data: {
          ...customerMessageChanges(row, now, this.config.SUPPORT_SLA),
          customerReadAt: now,
          messageCount: { increment: 1 },
        },
        include,
      });
    });
    return this.present(updated, undefined);
  }

  /** The traveller's question is answered. */
  async resolve(conversationId: string, caller: SupportCaller): Promise<ConversationDto> {
    const row = await this.load(conversationId, caller);
    if (row.status === 'resolved') return this.present(row, undefined);
    const updated = await this.prisma.supportConversation.update({
      where: { id: row.id },
      data: {
        status: 'resolved',
        resolvedAt: new Date(),
        replyOwedSince: null,
        responseDueAt: null,
        resolutionDueAt: null,
        dueAt: null,
      },
      include,
    });
    return this.present(updated, undefined);
  }

  private async checkHuman(turnstileToken: string | null, caller: SupportCaller): Promise<void> {
    // Website visitors send Turnstile; the app sends a device attestation instead (ADR-023).
    const verified =
      turnstileToken !== null
        ? await this.turnstile.verify(turnstileToken, {
            remoteIp: caller.context.ip,
            action: 'support',
          })
        : (await this.attestation.verify(caller.attestation ?? undefined, 'support')) === 'valid';
    if (!verified) throw botCheckFailed();
  }

  /** The conversation if the caller may open it; 404 otherwise, whatever the reason. */
  private async load(conversationId: string, caller: SupportCaller): Promise<ConversationRow> {
    const row = await this.prisma.supportConversation.findUnique({
      where: { id: conversationId },
      include,
    });
    if (!row) throw new NotFoundException();
    const allowed = row.userId
      ? row.userId === caller.client.userId
      : caller.token !== null && this.access.opens(row, caller.token);
    if (!allowed) throw new NotFoundException();
    return row;
  }

  private summary(row: ConversationRow): SummaryDto {
    const lastMessageAt = [row.lastCustomerMessageAt, row.lastStaffMessageAt]
      .filter((date): date is Date => date !== null)
      .reduce((latest, date) => (date > latest ? date : latest));
    return {
      id: row.id,
      reference: row.reference,
      category: row.category,
      status: row.status,
      booking: row.booking,
      lastMessageAt: lastMessageAt.toISOString(),
      unread:
        row.lastStaffMessageAt !== null &&
        (row.customerReadAt === null || row.lastStaffMessageAt > row.customerReadAt),
      createdAt: row.createdAt.toISOString(),
    };
  }

  private async present(row: ConversationRow, after: string | undefined): Promise<ConversationDto> {
    // Internal notes are filtered in the query, so they never reach this code.
    const messages = await this.prisma.supportMessage.findMany({
      where: { conversationId: row.id, internal: false, ...(after ? { id: { gt: after } } : {}) },
      orderBy: { id: after ? 'asc' : 'desc' },
      take: SUPPORT_PAGE_MESSAGES,
    });
    if (!after) messages.reverse();
    return {
      ...this.summary(row),
      messages: messages.map((message) => ({
        id: message.id,
        author: message.author,
        text: this.encryption.decrypt(message.bodyEncrypted, supportMessageContext(message.id)),
        createdAt: message.createdAt.toISOString(),
      })),
    };
  }
}
