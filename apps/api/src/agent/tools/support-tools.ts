import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { z } from 'zod';

import {
  DEFAULT_LOCALE,
  SUPPORT_CATEGORIES,
  SUPPORT_MESSAGE_MAX,
  type AgentCard,
} from '@suskii/shared';

import { PrismaService } from '../../infra/prisma.service';
import { SupportService, type SupportCaller } from '../../support/support.service';
import { AgentToolError, agentTool, AgentToolRegistry } from '../agent-tool';
import { AgentConversationsService } from '../chat/agent-conversations.service';

import {
  AGENT_REQUEST_CONTEXT,
  AgentToolCallers,
  card,
  cardsOut,
  guarded,
  problemCodes,
  problemsSchema,
} from './tool-support';

/** Help articles one answer may be built from, and the words of the traveller a handover carries. */
const FAQS_SHOWN = 4;
const FAQS_READ = 60;
const HANDOVER_MESSAGES = 3;
/** The topic of a conversation the assistant opened for a traveller (`SUPPORT_TOPICS`). */
const HANDOVER_TOPIC = 'assistant_handover';

const words = (text: string): string[] =>
  text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 2);

/**
 * How well an article answers a question: the share of the question's words it holds, with the
 * article's own question counting double. Plain word overlap: the list is short, written by
 * staff, and the model reads the best few and decides.
 */
export function faqScore(query: string, faq: { question: string; answer: string }): number {
  const asked = new Set(words(query));
  if (asked.size === 0) return 0;
  const title = new Set(words(faq.question));
  const body = new Set(words(faq.answer));
  let score = 0;
  for (const word of asked) score += title.has(word) ? 2 : body.has(word) ? 1 : 0;
  return score / asked.size;
}

/**
 * `support.faqs` reads the published help articles; `support.handover` brings in the support
 * team. A handover opens an ordinary support conversation for the signed-in traveller (ADR-083)
 * with their own last messages as its first one, so staff read what the traveller wrote and
 * never a model's account of it. The after-hours assistant is not consulted on it (it has a
 * topic). A guest is pointed at the support page, where a conversation starts with a human
 * check and an email address.
 */
@Injectable()
export class SupportTools implements OnModuleInit {
  constructor(
    private readonly registry: AgentToolRegistry,
    private readonly callers: AgentToolCallers,
    private readonly prisma: PrismaService,
    private readonly support: SupportService,
    @Inject(AgentConversationsService) private readonly conversations: AgentConversationsService,
  ) {}

  onModuleInit(): void {
    this.registry.register(
      agentTool({
        name: 'support.faqs',
        description:
          "Search Suskii's published help articles (payments, refunds, changes, baggage, documents, accounts). Answer policy questions only from what an article says; if none fits, say you do not have that information and offer a person.",
        tier: 'read',
        scope: 'catalog',
        agents: [
          'concierge',
          'flights',
          'hotels',
          'cars',
          'tours',
          'trip_builder',
          'bookings',
          'payments',
          'support',
          'disruption',
        ],
        input: z.object({
          query: z.string().trim().min(2).max(160).meta({ description: 'What to look up.' }),
        }),
        output: z.object({
          found: z.number().int(),
          articles: z.array(z.object({ question: z.string(), answer: z.string() })),
        }),
        run: async (input, { grant }) => {
          const now = new Date();
          const read = (locale: string) =>
            this.prisma.faq.findMany({
              where: { locale, publishedAt: { lte: now } },
              select: { question: true, answer: true },
              orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
              take: FAQS_READ,
            });
          const localised = grant.locale === DEFAULT_LOCALE ? [] : await read(grant.locale);
          const faqs = localised.length > 0 ? localised : await read(DEFAULT_LOCALE);
          const best = faqs
            .map((faq) => ({ faq, score: faqScore(input.query, faq) }))
            .filter((entry) => entry.score > 0)
            .sort((a, b) => b.score - a.score)
            .slice(0, FAQS_SHOWN)
            .map((entry) => entry.faq);
          return { found: best.length, articles: best };
        },
      }),
    );

    this.registry.register(
      agentTool({
        name: 'support.handover',
        description:
          'Bring in a person from the support team: opens a support conversation for the signed-in traveller with their own last messages, attached to a booking of theirs when you name one. Use it when the traveller asks for a person, or when you cannot resolve what they need. A guest gets the support page instead. After it, tell the traveller the team will answer in that conversation; never promise a time.',
        tier: 'propose',
        scope: 'support',
        agents: [
          'concierge',
          'flights',
          'hotels',
          'cars',
          'tours',
          'trip_builder',
          'bookings',
          'payments',
          'support',
          'disruption',
        ],
        input: z.object({
          category: z.enum(SUPPORT_CATEGORIES).default('general'),
          bookingId: z
            .uuid()
            .optional()
            .meta({ description: "One of the traveller's own bookings, from bookings.list." }),
        }),
        output: z.object({
          problems: problemsSchema,
          handedOver: z.boolean(),
          alreadyOpen: z.boolean(),
          needsTheSupportPage: z.boolean(),
          cards: cardsOut,
        }),
        run: async (input, { grant }) => {
          const page = (problems: string[]) => ({
            problems,
            handedOver: false,
            alreadyOpen: false,
            needsTheSupportPage: true,
            cards: card('link', 'Support', [], { href: '/support' }),
          });
          // A guest has no account for staff to answer in: the support page starts one.
          if (!grant.userId || !grant.conversationId) return page([]);

          const supportCard = (id: string, reference: string): AgentCard[] =>
            card('link', reference, [], {
              href: `/support/${id}`,
              ref: { type: 'support', id },
            });
          // One handover per open request: asking twice does not open two conversations.
          const open = await this.prisma.supportConversation.findFirst({
            where: {
              userId: grant.userId,
              topic: HANDOVER_TOPIC,
              status: { not: 'resolved' },
            },
            orderBy: { id: 'desc' },
            select: { id: true, reference: true },
          });
          if (open) {
            return {
              problems: [],
              handedOver: true,
              alreadyOpen: true,
              needsTheSupportPage: false,
              cards: supportCard(open.id, open.reference),
            };
          }

          const rows = await this.prisma.agentMessage.findMany({
            where: { conversationId: grant.conversationId, role: 'user' },
            orderBy: { id: 'desc' },
            take: HANDOVER_MESSAGES,
          });
          const said = rows
            .reverse()
            .map((row) => this.conversations.message(row).text.trim())
            .filter((text) => text.length > 0)
            .join('\n\n')
            .slice(-SUPPORT_MESSAGE_MAX);
          if (said.length === 0) throw new AgentToolError('refused');

          const caller: SupportCaller = {
            client: await this.callers.client(grant),
            context: AGENT_REQUEST_CONTEXT,
            token: null,
            bookingToken: null,
            attestation: null,
          };
          try {
            const started = await guarded(() =>
              this.support.start(
                {
                  category: input.category,
                  message: said,
                  bookingId: input.bookingId ?? null,
                  email: null,
                  turnstileToken: null,
                },
                caller,
                HANDOVER_TOPIC,
              ),
            );
            // The assistant's conversation says which support conversation took it over.
            await this.prisma.agentConversation.updateMany({
              where: { id: grant.conversationId },
              data: { handoverConversationId: started.conversation.id },
            });
            return {
              problems: [],
              handedOver: true,
              alreadyOpen: false,
              needsTheSupportPage: false,
              cards: supportCard(started.conversation.id, started.conversation.reference),
            };
          } catch (error) {
            // Too many open conversations: the traveller continues in one of them.
            const problems = problemCodes(error);
            if (!problems) throw error;
            return page(problems);
          }
        },
      }),
    );
  }
}
