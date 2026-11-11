import { randomUUID } from 'node:crypto';

import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  AGENT_MESSAGE_MAX,
  DEFAULT_LOCALE,
  SUPPORT_MESSAGES_PER_CONVERSATION,
  formatMoney,
  isWhatsAppStop,
  money,
  type AgentCard,
} from '@suskii/shared';
import type { Redis } from 'ioredis';

import { BackgroundTasks } from '../../common/background-tasks';
import { ProblemDetailsException } from '../../common/problem-details';
import { APP_CONFIG, type AppConfig } from '../../config/config';
import { supportMessageContext } from '../../crypto/encryption-contexts';
import { FieldEncryption } from '../../crypto/field-encryption';
import { PrismaService } from '../../infra/prisma.service';
import { REDIS } from '../../infra/redis';
import { SupportAssistant } from '../../support/assistant/support-assistant.service';
import {
  WhatsAppAnswerers,
  type WhatsAppAnswerer,
} from '../../support/whatsapp/whatsapp-answerers';
import { agentWhatsApp } from '../../telemetry/metrics';
import { AgentFlags } from '../agent-flags';
import { AgentPause } from '../agent-pause';
import type { AgentMessageDto } from '../chat/agent-chat.schemas';
import { AgentChatService, type AgentRunResult } from '../chat/agent-chat.service';
import { AgentConversationsService } from '../chat/agent-conversations.service';
import { AgentHandoverNotes } from '../chat/agent-handover-notes';

/**
 * Sent before the first answer in a thread: the traveller is told what is answering and that
 * a person is one message away. English, like every fixed line here: a WhatsApp thread has no
 * language setting, and the model answers in the language it is written to.
 */
export const AGENT_WHATSAPP_DISCLOSURE =
  "This is Suskii's automated assistant. Ask for a person at any time and our team will reply here.";

/** The handover when the assistant has no words of its own for it. Promises no time. */
export const AGENT_WHATSAPP_HANDOVER =
  'I am passing this conversation to our team. A person will reply here.';

const GREETING = 'Hello. Ask me about flights, hotels, cars, tours or a booking you already have.';

/** WhatsApp takes 4096 characters in a text; the room left is for the disclosure. */
const WHATSAPP_TEXT_MAX = 3800;
/** The traveller's latest unanswered messages read together as one question. */
const MESSAGES_PER_ANSWER = 3;
/** On top of a run's own limit: storing and sending the answer. */
const LOCK_MARGIN_MS = 30_000;

/** Deletes the lock only if this run still holds it. */
const RELEASE = `
if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end
return 0
`;

interface Thread {
  channel: string;
  status: string;
  topic: string | null;
  messageCount: number;
  lastStaffMessageAt: Date | null;
  whatsappContactId: string | null;
}

/** One card as lines of plain text: what it is, its facts, its price and where to open it. */
function cardLines(card: AgentCard, webOrigin: string): string {
  const lines = [card.title, ...card.lines];
  if (card.price) {
    const price = formatMoney(
      money(BigInt(card.price.amountMinor), card.price.currency),
      DEFAULT_LOCALE,
    );
    // A price read on another site is never an offer (ADR-104), and says so on every channel.
    lines.push(
      card.indicative ? `${price} (indicative: seen elsewhere, not a price you can book)` : price,
    );
  }
  if (card.href) lines.push(`${webOrigin}${card.href}`);
  return lines.join('\n');
}

/**
 * The words of an answer as one WhatsApp text: the checked answer, then each card that still
 * fits whole. Null when the run left nothing a traveller can read.
 */
export function whatsappText(message: AgentMessageDto | null, webOrigin: string): string | null {
  if (!message) return null;
  if (message.kind === 'notice') return message.notice === 'greeting' ? GREETING : null;
  // A confirmation is tapped in the app or on the website, never agreed to in a chat.
  if (message.confirmationId) return null;
  const blocks: string[] = [];
  const text = message.text.trim();
  if (text) blocks.push(text.slice(0, WHATSAPP_TEXT_MAX));
  let length = blocks[0]?.length ?? 0;
  for (const card of message.cards) {
    const block = cardLines(card, webOrigin);
    if (length + block.length + 2 > WHATSAPP_TEXT_MAX) break;
    blocks.push(block);
    length += block.length + 2;
  }
  return blocks.length > 0 ? blocks.join('\n\n') : null;
}

/**
 * The assistant on WhatsApp (ADR-084, ADR-101). A traveller's message is stored in its support
 * conversation as always; this answers there, as a guest's run (no account, so nothing that
 * needs one or a tap), until a person replies, the assistant hands over, or it has answered
 * `AGENT_WHATSAPP_MAX_REPLIES` times. Whatever it cannot do ends in the handover: the thread is
 * the support inbox already, so a person finds the whole exchange where they work.
 *
 * It registers with the support module's list of answerers instead of being called by it:
 * support never imports the assistant. STOP, the 24-hour window and the template are the
 * channel's own (`WhatsAppReplies`), exactly as for a person's reply.
 */
@Injectable()
export class AgentWhatsApp implements WhatsAppAnswerer, OnModuleInit {
  private readonly logger = new Logger(AgentWhatsApp.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly encryption: FieldEncryption,
    private readonly background: BackgroundTasks,
    private readonly flags: AgentFlags,
    private readonly pause: AgentPause,
    private readonly answerers: WhatsAppAnswerers,
    private readonly support: SupportAssistant,
    private readonly conversations: AgentConversationsService,
    private readonly chat: AgentChatService,
    private readonly notes: AgentHandoverNotes,
  ) {}

  onModuleInit(): void {
    this.answerers.register(this);
  }

  /** On for WhatsApp, on at all, reachable and not paused. The pause is read every time. */
  private async offered(): Promise<boolean> {
    if (!this.config.AGENT_WHATSAPP_ENABLED) return false;
    if (!this.flags.enabled() || !this.flags.configured()) return false;
    return !(await this.pause.paused());
  }

  private thread(conversationId: string): Promise<Thread | null> {
    return this.prisma.supportConversation.findUnique({
      where: { id: conversationId },
      select: {
        channel: true,
        status: true,
        topic: true,
        messageCount: true,
        lastStaffMessageAt: true,
        whatsappContactId: true,
      },
    });
  }

  /** A WhatsApp thread nobody has answered yet, that is no request of a kind of its own. */
  private static open(thread: Thread | null): thread is Thread {
    return (
      thread !== null &&
      thread.channel === 'whatsapp' &&
      thread.status !== 'resolved' &&
      thread.topic === null &&
      thread.lastStaffMessageAt === null &&
      thread.messageCount < SUPPORT_MESSAGES_PER_CONVERSATION
    );
  }

  private previous(conversationId: string): Promise<{ id: string; kind: string }[]> {
    return this.prisma.supportMessage.findMany({
      where: { conversationId, author: 'assistant' },
      select: { id: true, kind: true },
      orderBy: { id: 'asc' },
    });
  }

  /**
   * True when the assistant takes the message: it then answers in the background, and the
   * after-hours assistant (ADR-085) is not asked. False leaves the thread as it always was.
   */
  async take(conversationId: string): Promise<boolean> {
    if (!(await this.offered())) return false;
    if (!AgentWhatsApp.open(await this.thread(conversationId))) return false;
    // After a handover the thread is for people.
    const previous = await this.previous(conversationId);
    if (previous.some((message) => message.kind === 'handover')) return false;
    this.background.run('agent-whatsapp', () => this.run(conversationId));
    return true;
  }

  /** One run per thread at a time; a message that arrived meanwhile gets one more pass. */
  async run(conversationId: string): Promise<void> {
    const lock = `agent:whatsapp:lock:${conversationId}`;
    const token = randomUUID();
    const held = await this.redis.set(
      lock,
      token,
      'PX',
      this.config.AGENT_RUN_TIMEOUT_MS + LOCK_MARGIN_MS,
      'NX',
    );
    if (held !== 'OK') return void agentWhatsApp.add(1, { outcome: 'busy' });
    try {
      let passes = 0;
      while (passes < 2 && (await this.answerOnce(conversationId))) passes += 1;
    } finally {
      await this.redis.eval(RELEASE, 1, lock, token);
    }
  }

  /** Writes one answer or the handover; false when there is nothing (more) to do. */
  private async answerOnce(conversationId: string): Promise<boolean> {
    if (!(await this.offered())) return false;
    const thread = await this.thread(conversationId);
    if (!AgentWhatsApp.open(thread)) return false;
    const previous = await this.previous(conversationId);
    if (previous.some((message) => message.kind === 'handover')) return false;

    const after = previous.at(-1)?.id;
    const unanswered = await this.prisma.supportMessage.findMany({
      where: {
        conversationId,
        author: 'customer',
        kind: 'text',
        ...(after ? { id: { gt: after } } : {}),
      },
      select: { id: true, bodyEncrypted: true },
      orderBy: { id: 'desc' },
      take: MESSAGES_PER_ANSWER,
    });
    const said = unanswered
      .reverse()
      .map((message) =>
        this.encryption.decrypt(message.bodyEncrypted, supportMessageContext(message.id)),
      )
      .filter((text) => !isWhatsAppStop(text));
    if (said.length === 0) return false;

    // Enough answers: what is still open is for a person.
    if (previous.length >= this.config.AGENT_WHATSAPP_MAX_REPLIES) {
      return this.handOver(conversationId, 'reply_limit');
    }

    let result: AgentRunResult;
    try {
      const conversation = await this.conversations.forWhatsAppThread(conversationId);
      result = await this.chat.answerWhatsApp(
        conversation,
        said.join('\n\n').slice(-AGENT_MESSAGE_MAX),
        thread.whatsappContactId ?? conversationId,
      );
    } catch (error) {
      // Over the day's spend, a full conversation, paused or switched off meanwhile: the
      // reason is a slug of ours, never the traveller's words.
      const reason = error instanceof ProblemDetailsException ? error.slug : 'failed';
      this.logger.warn({ conversationId, reason }, 'the assistant could not answer on WhatsApp');
      return this.handOver(conversationId, 'refused');
    }

    const words = whatsappText(result.message, this.config.WEB_APP_URL.replace(/\/+$/u, ''));
    if (result.outcome === 'handover') {
      return this.handOver(conversationId, 'handover', words);
    }
    if (result.outcome !== 'answered' || words === null) {
      return this.handOver(conversationId, result.outcome);
    }
    const text = previous.length === 0 ? `${AGENT_WHATSAPP_DISCLOSURE}\n\n${words}` : words;
    const stored = await this.support.write(conversationId, 'whatsapp', { kind: 'text', text });
    agentWhatsApp.add(1, { outcome: stored ? 'answered' : 'superseded' });
    return stored;
  }

  /**
   * Hands the thread to people, once, and tells them in an internal note what the assistant
   * had already looked up. Always the end of the assistant's part in the thread.
   */
  private async handOver(
    conversationId: string,
    outcome: string,
    words: string | null = null,
  ): Promise<false> {
    const stored = await this.support.write(conversationId, 'whatsapp', {
      kind: 'handover',
      text: words ?? AGENT_WHATSAPP_HANDOVER,
    });
    agentWhatsApp.add(1, { outcome: stored ? outcome : 'superseded' });
    if (stored) {
      const linked = await this.prisma.agentConversation.findUnique({
        where: { supportConversationId: conversationId },
        select: { id: true },
      });
      if (linked) await this.notes.add(conversationId, linked.id, outcome);
    }
    return false;
  }
}
