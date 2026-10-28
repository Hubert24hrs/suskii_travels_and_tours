import { randomUUID } from 'node:crypto';

import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  DEFAULT_LOCALE,
  SUPPORT_MESSAGES_PER_CONVERSATION,
  isWhatsAppStop,
  parseSupportHours,
  supportStaffed,
  type SupportChannel,
  type SupportHoursSpan,
} from '@suskii/shared';
import type { Redis } from 'ioredis';

import { AiSearchBudget, type BudgetLimits } from '../../ai-search/ai-search-budget';
import { NO_USAGE } from '../../ai-search/llm-provider';
import { BookingsService } from '../../bookings/bookings.service';
import { BackgroundTasks } from '../../common/background-tasks';
import { uuidv7 } from '../../common/uuid';
import { APP_CONFIG, type AppConfig } from '../../config/config';
import { supportMessageContext } from '../../crypto/encryption-contexts';
import { FieldEncryption } from '../../crypto/field-encryption';
import { PrismaService } from '../../infra/prisma.service';
import { REDIS } from '../../infra/redis';
import {
  supportAssistantCost,
  supportAssistantDuration,
  supportAssistantRuns,
  supportAssistantTokens,
} from '../../telemetry/metrics';
import { WhatsAppReplies } from '../whatsapp/whatsapp-replies.service';

import { assistantBookingFacts, type AssistantFact } from './assistant-facts';
import type { AssistantFaq } from './assistant-prompt';
import {
  ASSISTANT_MAX_OUTPUT_TOKENS,
  SupportAnswerer,
  type AnswerOutcome,
} from './support-answerer';

/** What an answer rested on, stored with it for staff (ADR-085). */
export type AssistantSource =
  { kind: 'faq'; id: string; question: string } | { kind: 'fact'; key: string };

/** The handover as stored: older clients and WhatsApp show this; the website and app translate. */
export const ASSISTANT_HANDOVER_TEXT =
  'Our team is offline right now. We have your message, and a person will reply in this conversation when they are back.';

/** Long enough for one model call and its storage; a crashed run frees the lock by itself. */
const LOCK_SECONDS = 60;
/** FAQs sent with each question: all of them at today's size, and a bound if the CMS grows. */
const FAQ_LIMIT = 60;
/** The traveller's latest unanswered messages read together as one question. */
const MESSAGES_PER_ANSWER = 3;

/** Deletes the lock only if this run still holds it. */
const RELEASE = `
if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end
return 0
`;

type Faq = AssistantFaq & { faqId: string };

interface ConversationState {
  status: string;
  messageCount: number;
  lastStaffMessageAt: Date | null;
}

/** The assistant writes only before any person has, while the conversation is open and has room. */
const mayWrite = (conversation: ConversationState): boolean =>
  conversation.status !== 'resolved' &&
  conversation.lastStaffMessageAt === null &&
  conversation.messageCount < SUPPORT_MESSAGES_PER_CONVERSATION;

/**
 * The after-hours assistant (ADR-085). After a traveller's message commits, outside staffed hours
 * and before any staff reply, it answers once from the FAQs and the booking's facts, or hands
 * over once. It never changes the conversation's status, priority, assignee or SLA times, and
 * it stops after a handover or `SUPPORT_ASSISTANT_MAX_REPLIES` answers.
 */
@Injectable()
export class SupportAssistant {
  private readonly logger = new Logger(SupportAssistant.name);
  private readonly hours: SupportHoursSpan[];
  private readonly limits: BudgetLimits;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly encryption: FieldEncryption,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly background: BackgroundTasks,
    private readonly answerer: SupportAnswerer,
    private readonly budget: AiSearchBudget,
    private readonly bookings: BookingsService,
    private readonly whatsapp: WhatsAppReplies,
  ) {
    // The env schema has checked the text already.
    this.hours = parseSupportHours(config.SUPPORT_HOURS) ?? [];
    this.limits = {
      scope: 'support-assistant',
      callerCap: config.SUPPORT_ASSISTANT_CONVERSATION_MICROUSD,
      globalCap: config.SUPPORT_ASSISTANT_DAILY_MICROUSD,
    };
  }

  /** On, and nobody on shift at `now`. */
  answersAt(now: Date): boolean {
    return (
      this.config.SUPPORT_ASSISTANT_ENABLED &&
      !supportStaffed(this.hours, this.config.SUPPORT_TIME_ZONE, now)
    );
  }

  /** Called after a traveller's message commits: answers in the background when it should. */
  consider(conversationId: string): void {
    if (!this.answersAt(new Date())) return;
    this.background.run('support-assistant', () => this.run(conversationId));
  }

  /** One run per conversation at a time; a message that arrived meanwhile gets one more pass. */
  async run(conversationId: string): Promise<void> {
    const lock = `support:assistant:lock:${conversationId}`;
    const token = randomUUID();
    if ((await this.redis.set(lock, token, 'EX', LOCK_SECONDS, 'NX')) !== 'OK') {
      supportAssistantRuns.add(1, { outcome: 'busy' });
      return;
    }
    try {
      let passes = 0;
      while (passes < 2 && (await this.answerOnce(conversationId))) passes += 1;
    } finally {
      await this.redis.eval(RELEASE, 1, lock, token);
    }
  }

  /** Writes one answer or the handover; false when there was nothing (more) to do. */
  private async answerOnce(conversationId: string): Promise<boolean> {
    const now = new Date();
    if (!this.answersAt(now)) return false;
    const conversation = await this.prisma.supportConversation.findUnique({
      where: { id: conversationId },
      select: {
        channel: true,
        status: true,
        bookingId: true,
        messageCount: true,
        lastStaffMessageAt: true,
      },
    });
    if (!conversation || !mayWrite(conversation)) return false;
    const previous = await this.prisma.supportMessage.findMany({
      where: { conversationId, author: 'assistant' },
      select: { id: true, kind: true },
      orderBy: { id: 'asc' },
    });
    // After a handover, or once it has answered enough, the conversation is for people.
    if (
      previous.some((message) => message.kind === 'handover') ||
      previous.length >= this.config.SUPPORT_ASSISTANT_MAX_REPLIES
    ) {
      return false;
    }
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
    const messages = unanswered
      .reverse()
      .map((message) =>
        this.encryption.decrypt(message.bodyEncrypted, supportMessageContext(message.id)),
      )
      .filter((text) => !isWhatsAppStop(text));
    if (messages.length === 0) return false;

    const started = performance.now();
    const faqs = await this.faqs(now);
    const facts = conversation.bookingId ? await this.facts(conversation.bookingId) : [];
    const outcome = await this.ask(conversationId, { faqs, facts, messages }, now);
    this.measure(outcome, started);
    return this.store(conversationId, conversation.channel, outcome, faqs);
  }

  /** The model call inside the spend caps; any refusal or failure is a handover. */
  private async ask(
    conversationId: string,
    request: { faqs: Faq[]; facts: AssistantFact[]; messages: string[] },
    now: Date,
  ): Promise<AnswerOutcome> {
    const prepared = this.answerer.prepare(request);
    if (!prepared) return { kind: 'handover', reason: 'nothing_to_answer', usage: NO_USAGE };
    const reservation = await this.budget.reserve(
      `conversation:${conversationId}`,
      this.budget.worstCase(prepared.promptTokens, ASSISTANT_MAX_OUTPUT_TOKENS),
      now,
      this.limits,
    );
    if (typeof reservation === 'string') {
      return { kind: 'handover', reason: 'budget', usage: NO_USAGE };
    }
    const outcome = await this.answerer.answer(request, prepared);
    // A timeout or lost connection may still be billed: keep the reservation for those.
    const maybeBilled =
      outcome.kind === 'handover' &&
      (outcome.reason === 'timeout' || outcome.reason === 'unavailable');
    if (!maybeBilled) await this.budget.settle(reservation, this.budget.cost(outcome.usage));
    return outcome;
  }

  /**
   * Stores the answer or handover after a conditional claim on the conversation: a person who
   * replied, or a traveller who solved it, while the model was answering wins.
   */
  private async store(
    conversationId: string,
    channel: SupportChannel,
    outcome: AnswerOutcome,
    faqs: Faq[],
  ): Promise<boolean> {
    const id = uuidv7();
    const answer = outcome.kind === 'answer';
    const sources: AssistantSource[] | undefined = answer
      ? outcome.sources.map((source) => {
          const faq = faqs.find((candidate) => candidate.id === source);
          return faq
            ? { kind: 'faq', id: faq.faqId, question: faq.question }
            : { kind: 'fact', key: source };
        })
      : undefined;
    const stored = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.supportConversation.updateMany({
        where: {
          id: conversationId,
          status: { not: 'resolved' },
          lastStaffMessageAt: null,
          messageCount: { lt: SUPPORT_MESSAGES_PER_CONVERSATION },
        },
        data: { messageCount: { increment: 1 } },
      });
      if (claimed.count === 0) return false;
      await tx.supportMessage.create({
        data: {
          id,
          conversationId,
          author: 'assistant',
          kind: answer ? 'text' : 'handover',
          bodyEncrypted: this.encryption.encrypt(
            answer ? outcome.text : ASSISTANT_HANDOVER_TEXT,
            supportMessageContext(id),
          ),
          ...(sources ? { assistantSources: sources } : {}),
          deliveryStatus: channel === 'whatsapp' ? 'pending' : null,
        },
      });
      return true;
    });
    if (!stored) {
      supportAssistantRuns.add(1, { outcome: 'superseded' });
      return false;
    }
    if (channel === 'whatsapp') await this.whatsapp.deliver(id);
    return true;
  }

  /** Published FAQs in the default locale, cited as `faq-1`, `faq-2`... */
  private async faqs(now: Date): Promise<Faq[]> {
    const rows = await this.prisma.faq.findMany({
      where: { locale: DEFAULT_LOCALE, publishedAt: { lte: now } },
      select: { id: true, question: true, answer: true },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      take: FAQ_LIMIT,
    });
    return rows.map((row, index) => ({
      id: `faq-${index + 1}`,
      faqId: row.id,
      question: row.question,
      answer: row.answer,
    }));
  }

  /**
   * The booking's facts. It was attached only after `BookingsService.load()` succeeded for the
   * traveller (ADR-083), so reading it by id here is theirs to see. A booking that cannot be
   * read leaves the FAQs only.
   */
  private async facts(bookingId: string): Promise<AssistantFact[]> {
    try {
      return assistantBookingFacts(
        await this.bookings.present(await this.bookings.reload(bookingId)),
      );
    } catch (error) {
      this.logger.warn(
        { bookingId, reason: error instanceof Error ? error.name : 'unknown' },
        'support assistant could not read the booking',
      );
      return [];
    }
  }

  private measure(outcome: AnswerOutcome, started: number): void {
    const label = outcome.kind === 'answer' ? 'answer' : 'handover';
    supportAssistantRuns.add(1, {
      outcome: label,
      ...(outcome.kind === 'handover' ? { reason: outcome.reason } : {}),
    });
    supportAssistantDuration.record(performance.now() - started, { outcome: label });
    const usage = outcome.usage;
    supportAssistantTokens.add(usage.inputTokens, { kind: 'input' });
    supportAssistantTokens.add(usage.outputTokens, { kind: 'output' });
    supportAssistantTokens.add(usage.cacheReadTokens, { kind: 'cache_read' });
    supportAssistantTokens.add(usage.cacheWriteTokens, { kind: 'cache_write' });
    supportAssistantCost.add(this.budget.cost(usage));
  }
}
