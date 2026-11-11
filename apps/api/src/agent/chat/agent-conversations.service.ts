import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';

import {
  AGENT_OPEN_CONVERSATION_LIMIT,
  DEFAULT_CURRENCY,
  DEFAULT_LOCALE,
  agentCardSchema,
  type AgentChannel,
  type AgentName,
  type AgentNotice,
} from '@suskii/shared';
import { z } from 'zod';

import { AttestationService } from '../../attestation/attestation.service';
import { BookingsService } from '../../bookings/bookings.service';
import { botCheckFailed } from '../../bot-protection/errors';
import { TurnstileVerifier } from '../../bot-protection/turnstile';
import { ProblemDetailsException } from '../../common/problem-details';
import type { RequestContext } from '../../common/request-context';
import { uuidv7 } from '../../common/uuid';
import { agentMessageContext } from '../../crypto/encryption-contexts';
import { FieldEncryption } from '../../crypto/field-encryption';
import { HmacService } from '../../crypto/hmac.service';
import { randomToken } from '../../crypto/random';
import type { AgentConversation, AgentMessage } from '../../generated/prisma/client';
import { PrismaService } from '../../infra/prisma.service';
import { AgentThreads } from '../../privacy/agent-threads';
import type { ClientContext } from '../../search/client-context';

import type {
  AgentConversationDto,
  AgentMessageDto,
  StartAgentConversation,
} from './agent-chat.schemas';

/** Who is asking, from the request: a session, or a guest's token. */
export interface AgentCaller {
  client: ClientContext;
  context: RequestContext;
  /** `X-Agent-Token`: a guest's access token. */
  token: string | null;
  bookingToken: string | null;
  /** `X-Suskii-Attestation` from the app (ADR-023). */
  attestation: string | null;
}

/** What is stored beside a message's words: cards, a notice code, a pending confirmation. */
const partsSchema = z.object({
  cards: z.array(agentCardSchema).max(6).default([]),
  notice: z.string().max(32).nullable().default(null),
  confirmationId: z.uuid().nullable().default(null),
});
export type MessageParts = z.input<typeof partsSchema>;

const REFERENCE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newReference = (): string =>
  `A-${Array.from({ length: 6 }, () => REFERENCE_ALPHABET[Math.floor(Math.random() * REFERENCE_ALPHABET.length)]).join('')}`;

const tooMany = (): ProblemDetailsException =>
  new ProblemDetailsException(
    HttpStatus.CONFLICT,
    'agent-conversation-limit',
    'Too many open conversations',
    'Delete a conversation you no longer need, then start a new one.',
  );

/**
 * Conversations with the assistant (ADR-101, ADR-105). A traveller reaches only their own: by
 * session, or as a guest by the token returned when the conversation started (stored as an
 * HMAC). Anyone else gets 404. Words are sealed per message; what the model gets is a scrubbed
 * copy the chat service makes, never what is stored here.
 */
@Injectable()
export class AgentConversationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: FieldEncryption,
    private readonly hmac: HmacService,
    private readonly turnstile: TurnstileVerifier,
    private readonly attestation: AttestationService,
    private readonly bookings: BookingsService,
    private readonly threads: AgentThreads,
  ) {}

  async start(
    input: StartAgentConversation,
    caller: AgentCaller,
  ): Promise<{ conversation: AgentConversationDto; accessToken: string | null }> {
    const userId = caller.client.userId;
    if (!userId) await this.checkHuman(input.turnstileToken, caller);
    if (userId) {
      const open = await this.prisma.agentConversation.count({
        where: { userId, status: 'open' },
      });
      if (open >= AGENT_OPEN_CONVERSATION_LIMIT) throw tooMany();
    }
    // A booking is attached only when the caller may open it (404 otherwise, as everywhere).
    const booking = input.bookingId
      ? await this.bookings.load(input.bookingId, {
          client: caller.client,
          token: caller.bookingToken,
        })
      : null;

    const token = userId ? null : randomToken();
    const channel: AgentChannel = caller.client.channel === 'mobile' ? 'app' : 'web';
    let reference = newReference();
    while (
      await this.prisma.agentConversation.findUnique({ where: { reference }, select: { id: true } })
    ) {
      reference = newReference();
    }
    const row = await this.prisma.agentConversation.create({
      data: {
        id: uuidv7(),
        reference,
        userId,
        accessTokenHash: token ? this.hmac.digest('agent-access', token) : null,
        audience: 'customer',
        channel,
        locale: input.locale ?? DEFAULT_LOCALE,
        currency: input.currency ?? DEFAULT_CURRENCY,
        country: caller.context.country ?? caller.client.country ?? null,
        bookingId: booking?.id ?? null,
        lastMessageAt: new Date(),
      },
    });
    return { conversation: this.present(row, [], null), accessToken: token };
  }

  /**
   * A staff member's conversation with the staff agents, in the console (ADR-107). It is
   * theirs alone, like a traveller's: another member of staff gets 404 for it.
   */
  async startForStaff(userId: string, locale: string): Promise<AgentConversationDto> {
    const open = await this.prisma.agentConversation.count({
      where: { userId, audience: 'staff', status: 'open' },
    });
    if (open >= AGENT_OPEN_CONVERSATION_LIMIT) throw tooMany();
    let reference = newReference();
    while (
      await this.prisma.agentConversation.findUnique({ where: { reference }, select: { id: true } })
    ) {
      reference = newReference();
    }
    const row = await this.prisma.agentConversation.create({
      data: {
        id: uuidv7(),
        reference,
        userId,
        audience: 'staff',
        channel: 'console',
        locale,
        currency: DEFAULT_CURRENCY,
        lastMessageAt: new Date(),
      },
    });
    return this.present(row, [], null);
  }

  /**
   * The assistant's conversation for a WhatsApp support thread (ADR-084, ADR-101): found, or
   * created the first time. It belongs to nobody a traveller route could name (no account and
   * no access token), so it is reached only from the thread; staff read it in the thread
   * itself. Two first messages at once both try to create: the loser reads the winner.
   */
  async forWhatsAppThread(supportConversationId: string): Promise<AgentConversation> {
    const find = () =>
      this.prisma.agentConversation.findUnique({ where: { supportConversationId } });
    const existing = await find();
    if (existing) return existing;
    let reference = newReference();
    while (
      await this.prisma.agentConversation.findUnique({ where: { reference }, select: { id: true } })
    ) {
      reference = newReference();
    }
    try {
      return await this.prisma.agentConversation.create({
        data: {
          id: uuidv7(),
          reference,
          userId: null,
          audience: 'customer',
          channel: 'whatsapp',
          locale: DEFAULT_LOCALE,
          currency: DEFAULT_CURRENCY,
          supportConversationId,
          lastMessageAt: new Date(),
        },
      });
    } catch (error) {
      const winner = await find();
      if (!winner) throw error;
      return winner;
    }
  }

  /** The staff conversation if it is this staff member's; 404 otherwise. */
  async loadForStaff(conversationId: string, userId: string): Promise<AgentConversation> {
    const row = await this.prisma.agentConversation.findUnique({ where: { id: conversationId } });
    if (row?.audience !== 'staff' || row.userId !== userId) throw new NotFoundException();
    return row;
  }

  async getForStaff(conversationId: string, userId: string): Promise<AgentConversationDto> {
    return this.withMessages(await this.loadForStaff(conversationId, userId));
  }

  /** The signed-in traveller's conversations, most recent first; none without a session. */
  async list(caller: AgentCaller): Promise<AgentConversation[]> {
    const userId = caller.client.userId;
    if (!userId) return [];
    return this.prisma.agentConversation.findMany({
      where: { userId, audience: 'customer' },
      orderBy: { lastMessageAt: 'desc' },
      take: AGENT_OPEN_CONVERSATION_LIMIT,
    });
  }

  /** The conversation if the caller may open it; 404 otherwise, whatever the reason. */
  async load(conversationId: string, caller: AgentCaller): Promise<AgentConversation> {
    const row = await this.prisma.agentConversation.findUnique({ where: { id: conversationId } });
    if (row?.audience !== 'customer') throw new NotFoundException();
    const allowed = row.userId
      ? row.userId === caller.client.userId
      : caller.token !== null &&
        row.accessTokenHash !== null &&
        this.hmac.verify('agent-access', caller.token, row.accessTokenHash);
    if (!allowed) throw new NotFoundException();
    return row;
  }

  async get(conversationId: string, caller: AgentCaller): Promise<AgentConversationDto> {
    return this.withMessages(await this.load(conversationId, caller));
  }

  private async withMessages(row: AgentConversation): Promise<AgentConversationDto> {
    const conversationId = row.id;
    // The run first, then the messages, never both at once. A run ends and stores its answer
    // in one transaction, so a run seen as finished here has its answer in the messages read
    // after it. Read the other way round (or in parallel), a run that ends between the two
    // reads would show as "nothing running, no answer", and a client would stop waiting.
    const running = await this.prisma.agentRun.findFirst({
      where: { conversationId, status: 'running' },
      orderBy: { id: 'desc' },
      select: { id: true },
    });
    const messages = await this.prisma.agentMessage.findMany({
      where: { conversationId, role: { in: ['user', 'assistant'] } },
      orderBy: { id: 'asc' },
    });
    return this.present(row, messages, running?.id ?? null);
  }

  /** Deletes the conversation, its messages and the agent service's checkpoints of it. */
  async delete(conversationId: string, caller: AgentCaller): Promise<void> {
    const row = await this.load(conversationId, caller);
    await this.prisma.$transaction(async (tx) => {
      await this.threads.delete([row.id], tx);
      await tx.agentConversation.delete({ where: { id: row.id } });
    });
  }

  /** A thumb on an answer of the caller's own conversation: 404 for anyone else's. */
  async feedback(
    messageId: string,
    feedback: 'up' | 'down' | null,
    caller: AgentCaller,
  ): Promise<AgentMessageDto> {
    const message = await this.prisma.agentMessage.findUnique({ where: { id: messageId } });
    if (message?.role !== 'assistant') throw new NotFoundException();
    await this.load(message.conversationId, caller);
    const updated = await this.prisma.agentMessage.update({
      where: { id: messageId },
      data: { feedback, feedbackAt: feedback ? new Date() : null },
    });
    return this.message(updated);
  }

  /** Seals a message's words under its own id. */
  seal(messageId: string, text: string): string {
    return this.encryption.encrypt(text, agentMessageContext(messageId));
  }

  message(row: AgentMessage): AgentMessageDto {
    const parts = partsSchema
      .catch({ cards: [], notice: null, confirmationId: null })
      .parse(row.parts ?? {});
    let text = '';
    try {
      text = this.encryption.decrypt(row.bodyEncrypted, agentMessageContext(row.id));
    } catch {
      // A body that no longer opens is shown as nothing rather than failing the conversation.
      text = '';
    }
    const notice = row.kind === 'notice' ? ((parts.notice as AgentNotice | null) ?? null) : null;
    return {
      id: row.id,
      role: row.role === 'assistant' ? 'assistant' : 'user',
      kind: row.kind === 'handover' ? 'handover' : row.kind === 'notice' ? 'notice' : 'text',
      agent: (row.agent as AgentName | null) ?? null,
      text: notice ? '' : text,
      notice,
      cards: parts.cards,
      confirmationId: parts.confirmationId,
      feedback: row.feedback,
      createdAt: row.createdAt.toISOString(),
    };
  }

  present(
    row: AgentConversation,
    messages: AgentMessage[],
    activeRunId: string | null,
  ): AgentConversationDto {
    return {
      id: row.id,
      reference: row.reference,
      locale: row.locale,
      currency: row.currency,
      status: row.status,
      bookingId: row.bookingId,
      messageCount: row.messageCount,
      activeRunId,
      lastMessageAt: row.lastMessageAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
      messages: messages.map((message) => this.message(message)),
    };
  }

  private async checkHuman(turnstileToken: string | null, caller: AgentCaller): Promise<void> {
    // Website visitors send Turnstile; the app sends a device attestation instead (ADR-023).
    const verified =
      turnstileToken !== null
        ? await this.turnstile.verify(turnstileToken, {
            remoteIp: caller.context.ip,
            action: 'agent',
          })
        : (await this.attestation.verify(caller.attestation ?? undefined, 'agent')) === 'valid';
    if (!verified) throw botCheckFailed();
  }
}
