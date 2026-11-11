import { z } from 'zod';

import {
  AGENT_MESSAGE_KINDS,
  AGENT_MESSAGE_MAX,
  AGENT_NAMES,
  AGENT_NOTICES,
  AGENT_RUN_OUTCOMES,
  agentCardSchema,
  currencyCodeSchema,
  localeCodeSchema,
} from '@suskii/shared';

import { named } from '../../contract/contract';

export const AGENT_TOKEN_HEADER = {
  name: 'X-Agent-Token',
  required: false,
  description:
    'Guests: the access token returned when the conversation started. Account holders use their session instead.',
};

const timestamp = z.iso.datetime();
const uuid = z.uuid();

export const startAgentConversationSchema = named(
  'StartAgentConversationRequest',
  z.object({
    locale: localeCodeSchema.optional().meta({
      description: 'The language the assistant answers in; the default locale when left out.',
    }),
    currency: currencyCodeSchema.optional(),
    bookingId: uuid.optional().meta({
      description: "One of the caller's own bookings the conversation is opened from.",
    }),
    turnstileToken: z.string().min(1).max(2048).nullable().default(null).meta({
      description:
        'Cloudflare Turnstile token (action `agent`); required on the website without a session. The app sends a device attestation instead.',
    }),
  }),
);
export type StartAgentConversation = z.infer<typeof startAgentConversationSchema>;

/**
 * A staff member's conversation with the staff agents: only the language is theirs to choose,
 * and the console states it (a request without it starts nothing).
 */
export const startStaffAgentConversationSchema = named(
  'StartStaffAgentConversationRequest',
  z.object({ locale: localeCodeSchema }),
);

export const agentMessageSchema = named(
  'AgentMessage',
  z.object({
    id: uuid,
    role: z.enum(['user', 'assistant']),
    kind: z.enum(AGENT_MESSAGE_KINDS),
    /** Which agent answered; null for the traveller's own messages. */
    agent: z.enum(AGENT_NAMES).nullable(),
    /** The words; empty for a notice, which clients show from `notice` in their own language. */
    text: z.string(),
    notice: z.enum(AGENT_NOTICES).nullable(),
    cards: z.array(agentCardSchema),
    /** A confirmation waiting for the traveller's tap. */
    confirmationId: uuid.nullable(),
    feedback: z.enum(['up', 'down']).nullable(),
    createdAt: timestamp,
  }),
);
export type AgentMessageDto = z.infer<typeof agentMessageSchema>;

export const agentConversationSchema = named(
  'AgentConversation',
  z.object({
    id: uuid,
    reference: z.string(),
    locale: z.string(),
    currency: z.string(),
    status: z.enum(['open', 'closed']),
    bookingId: uuid.nullable(),
    messageCount: z.number().int(),
    /** The run answering right now, to stream or poll; null when nothing is running. */
    activeRunId: uuid.nullable(),
    lastMessageAt: timestamp,
    createdAt: timestamp,
    /** How well the assistant helped, 1 to 5, once the traveller said; absent in older answers. */
    rating: z.number().int().min(1).max(5).nullable().optional(),
    messages: z.array(agentMessageSchema),
  }),
);

export const agentRatingSchema = named(
  'AgentConversationRating',
  z.object({ score: z.number().int().min(1).max(5) }),
);
export type AgentConversationDto = z.infer<typeof agentConversationSchema>;

export const agentConversationSummarySchema = z.object({
  id: uuid,
  reference: z.string(),
  status: z.enum(['open', 'closed']),
  messageCount: z.number().int(),
  lastMessageAt: timestamp,
  createdAt: timestamp,
});

export const agentConversationListSchema = named(
  'AgentConversationList',
  z.object({ conversations: z.array(agentConversationSummarySchema) }),
);

export const startedAgentConversationSchema = named(
  'StartedAgentConversation',
  z.object({
    conversation: agentConversationSchema,
    accessToken: z.string().nullable().meta({
      description:
        'Guests only, shown once: send it as `X-Agent-Token` to read or continue the conversation.',
    }),
  }),
);

export const agentConversationParamsSchema = z.object({ conversationId: uuid });
export const agentRunParamsSchema = z.object({ runId: uuid });
export const agentMessageParamsSchema = z.object({ messageId: uuid });

export const agentChatRequestSchema = named(
  'AgentChatRequest',
  z.object({
    conversationId: uuid,
    text: z.string().trim().min(1).max(AGENT_MESSAGE_MAX),
  }),
);

export const agentChatStartedSchema = named(
  'AgentChatStarted',
  z.object({
    runId: uuid.meta({
      description: 'Read `GET /v1/agent/runs/{runId}` (or its stream) for the answer.',
    }),
    message: agentMessageSchema,
  }),
);

/** What a client may see of a run while it happens. */
export const agentStreamEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('status'),
    agent: z.enum(AGENT_NAMES),
    phase: z.enum(['routing', 'thinking', 'tool', 'checking']),
    tool: z.string().max(64).optional(),
  }),
  z.object({ type: z.literal('message'), message: agentMessageSchema }),
  z.object({
    type: z.literal('done'),
    outcome: z.enum(AGENT_RUN_OUTCOMES),
    confirmationId: uuid.nullable(),
  }),
]);
export type AgentStreamEvent = z.infer<typeof agentStreamEventSchema>;

export const agentRunQuerySchema = z.object({
  after: z.coerce.number().int().min(0).max(1000).default(0).meta({
    description: 'The number of the last event already seen; 0 for all.',
  }),
});

export const agentRunSchema = named(
  'AgentRunEvents',
  z.object({
    runId: uuid,
    status: z.enum(['running', 'waiting', 'succeeded', 'failed', 'cancelled', 'refused']),
    /** True once the run has ended: stop polling. */
    done: z.boolean(),
    events: z.array(
      z.intersection(z.object({ id: z.number().int().min(1) }), agentStreamEventSchema),
    ),
  }),
);

export const agentFeedbackSchema = named(
  'AgentFeedbackRequest',
  z.object({ feedback: z.enum(['up', 'down']).nullable() }),
);
