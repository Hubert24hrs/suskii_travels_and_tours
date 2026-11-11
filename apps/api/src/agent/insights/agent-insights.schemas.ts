import { z } from 'zod';

import {
  AGENT_AUDIENCES,
  AGENT_CHANNELS,
  AGENT_MESSAGE_KINDS,
  AGENT_NAMES,
  AGENT_NOTICES,
  AGENT_TOOL_TIERS,
} from '@suskii/shared';

import { named } from '../../contract/contract';

const timestamp = z.iso.datetime();
const uuid = z.uuid();
const count = z.number().int().min(0);
/** Millionths of a US dollar: what the spend caps count in. */
const microUsd = z.number().int().min(0);

const RUN_STATUSES = ['running', 'waiting', 'succeeded', 'failed', 'cancelled', 'refused'] as const;

// --- Runs and their traces ----------------------------------------------------------------------

const runFields = {
  id: uuid,
  conversationId: uuid.nullable(),
  audience: z.enum(AGENT_AUDIENCES),
  channel: z.enum(AGENT_CHANNELS),
  agent: z.string(),
  agents: z.array(z.string()),
  trigger: z.string(),
  status: z.enum(RUN_STATUSES),
  outcome: z.string().nullable().meta({ description: 'Why it ended as it did, as a code.' }),
  model: z.string().nullable(),
  promptVersion: z.string().nullable(),
  inputTokens: count,
  outputTokens: count,
  costMicroUsd: microUsd,
  steps: count,
  toolCallCount: count,
  startedAt: timestamp,
  finishedAt: timestamp.nullable(),
  durationMs: count.nullable(),
};

export const adminAgentRunSchema = named('AdminAgentRun', z.object(runFields));
export type AdminAgentRun = z.infer<typeof adminAgentRunSchema>;

export const adminAgentRunPageSchema = named(
  'AdminAgentRunPage',
  z.object({ items: z.array(adminAgentRunSchema), nextCursor: uuid.nullable() }),
);

export const adminAgentRunQuerySchema = z.object({
  status: z.enum(RUN_STATUSES).optional(),
  agent: z.enum(AGENT_NAMES).optional(),
  audience: z.enum(AGENT_AUDIENCES).optional(),
  cursor: uuid.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
export type AdminAgentRunQuery = z.infer<typeof adminAgentRunQuerySchema>;

export const adminAgentRunParamsSchema = z.object({ runId: uuid });

export const adminAgentRunTraceSchema = named(
  'AdminAgentRunTrace',
  z.object({
    ...runFields,
    toolCalls: z.array(
      z.object({
        id: uuid,
        agent: z.string(),
        tool: z.string(),
        tier: z.enum(AGENT_TOOL_TIERS).or(z.literal('none')),
        status: z.enum(['ok', 'denied', 'error', 'timeout']),
        reason: z.string().nullable(),
        argumentKeys: z
          .array(z.string())
          .meta({ description: 'The names of the arguments. Their values are never stored.' }),
        durationMs: count,
        createdAt: timestamp,
      }),
    ),
  }),
);
export type AdminAgentRunTrace = z.infer<typeof adminAgentRunTraceSchema>;

// --- The conversation monitor -------------------------------------------------------------------

const conversationFields = {
  id: uuid,
  reference: z.string(),
  channel: z.enum(AGENT_CHANNELS),
  locale: z.string(),
  userId: uuid.nullable().meta({ description: 'The account it belongs to; null for a guest.' }),
  status: z.enum(['open', 'closed']),
  messageCount: count,
  handedOver: z.boolean(),
  lastMessageAt: timestamp,
  createdAt: timestamp,
};

export const adminAgentConversationSummarySchema = named(
  'AdminAgentConversationSummary',
  z.object(conversationFields),
);
export type AdminAgentConversationSummary = z.infer<typeof adminAgentConversationSummarySchema>;

export const adminAgentConversationPageSchema = named(
  'AdminAgentConversationPage',
  z.object({ items: z.array(adminAgentConversationSummarySchema), nextCursor: uuid.nullable() }),
);

export const adminAgentConversationQuerySchema = z.object({
  cursor: uuid.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

export const adminAgentConversationParamsSchema = z.object({ conversationId: uuid });

export const adminAgentConversationSchema = named(
  'AdminAgentConversation',
  z.object({
    ...conversationFields,
    messages: z.array(
      z.object({
        id: uuid,
        role: z.enum(['user', 'assistant']),
        kind: z.enum(AGENT_MESSAGE_KINDS),
        agent: z.string().nullable(),
        text: z.string().meta({
          description:
            'The words with contact details, card-like and document-like numbers removed, as the model saw them.',
        }),
        notice: z.enum(AGENT_NOTICES).nullable(),
        cards: count,
        feedback: z.enum(['up', 'down']).nullable(),
        runId: uuid.nullable(),
        createdAt: timestamp,
      }),
    ),
  }),
);
export type AdminAgentConversation = z.infer<typeof adminAgentConversationSchema>;

// --- Cost ---------------------------------------------------------------------------------------

export const adminAgentWindowQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(90).default(30),
});

const spend = { runs: count, inputTokens: count, outputTokens: count, costMicroUsd: microUsd };

export const adminAgentCostSchema = named(
  'AdminAgentCost',
  z.object({
    from: z.iso.date(),
    to: z.iso.date(),
    basis: z.literal('usage_at_configured_prices').meta({
      description:
        "Every figure is an estimate: the tokens the models reported, at the prices configured in AGENT_MODEL_PRICES. The provider's invoice is the actual cost.",
    }),
    total: z.object(spend),
    byDay: z.array(z.object({ day: z.iso.date(), runs: count, costMicroUsd: microUsd })),
    byAgent: z.array(z.object({ agent: z.string(), ...spend })),
    byModel: z.array(z.object({ model: z.string(), ...spend })),
    byChannel: z.array(
      z.object({
        channel: z.enum(AGENT_CHANNELS),
        audience: z.enum(AGENT_AUDIENCES),
        runs: count,
        costMicroUsd: microUsd,
      }),
    ),
    topAccounts: z
      .array(z.object({ userId: uuid, runs: count, costMicroUsd: microUsd }))
      .max(10)
      .meta({ description: 'The accounts whose conversations cost most in the period.' }),
    month: z.object({
      toDateMicroUsd: microUsd,
      forecastMicroUsd: microUsd.meta({
        description: 'The month so far, carried to its end at the same daily rate.',
      }),
      daysElapsed: count,
      daysInMonth: count,
    }),
    caps: z.object({
      globalDailyMicroUsd: microUsd,
      userDailyMicroUsd: microUsd,
      guestDailyMicroUsd: microUsd,
    }),
  }),
);
export type AdminAgentCost = z.infer<typeof adminAgentCostSchema>;

// --- Quality ------------------------------------------------------------------------------------

export const adminAgentQualitySchema = named(
  'AdminAgentQuality',
  z.object({
    from: z.iso.date(),
    to: z.iso.date(),
    runs: count,
    answered: count,
    handovers: count,
    guardBlocked: count.meta({
      description:
        'Runs whose answer the guard refused twice (a figure, a contact or an outcome no tool result supports): a notice went out instead.',
    }),
    failed: count,
    outcomes: z.array(z.object({ outcome: z.string(), runs: count })),
    feedback: z.object({ up: count, down: count }),
    ratings: z
      .object({
        rated: count,
        /** The mean score times ten (43 is 4.3), so nothing here is a float; null when unrated. */
        averageTenths: count.nullable(),
        scores: z.array(z.object({ score: count, conversations: count })),
      })
      .meta({ description: "Travellers' own scores of a conversation, 1 to 5." }),
    funnel: z
      .object({
        conversations: count,
        answered: count,
        searched: count,
        askedForAPrice: count,
        askedToConfirm: count,
        confirmed: count,
        handedOver: count,
      })
      .meta({
        description:
          "Travellers' conversations started in the period, and how many of them reached each step. A conversation counts once per step.",
      }),
    prompts: z.array(
      z.object({
        promptVersion: z.string(),
        runs: count,
        answered: count,
        guardBlocked: count,
        up: count,
        down: count,
      }),
    ),
    shadow: z
      .object({
        /** The candidates named in the settings, and the share of turns they are tried on. */
        candidates: z.array(z.string()),
        samplePercent: count,
        dailyCapMicroUsd: microUsd,
        spentTodayMicroUsd: microUsd,
        prompts: z.array(
          z.object({
            prompt: z.string(),
            /** Turns it was asked for on, and those it actually took part in. */
            turns: count,
            compared: count,
            answered: count,
            guardBlocked: count,
            /** Compared turns that ended with the agent that answered the traveller. */
            sameAgent: count,
            replayedCalls: count,
            missedCalls: count,
            costMicroUsd: microUsd,
          }),
        ),
      })
      .meta({
        description:
          'Candidate prompt versions tried in the shadow of travellers’ turns (ADR-106). Every turn they were tried on was answered by the live prompt, so `answered` out of `compared` is how the candidate did where the live one succeeded. A candidate answers nobody: what it wrote is never kept. Costs are estimates.',
      }),
  }),
);
export type AdminAgentQuality = z.infer<typeof adminAgentQualitySchema>;

// --- The limits in force ------------------------------------------------------------------------

export const adminAgentLimitsSchema = named(
  'AdminAgentLimits',
  z.object({
    runMaxSteps: count,
    runMaxToolCalls: count,
    runTimeoutMs: count,
    grantTtlSeconds: count,
    maxOutputTokens: count,
    runReserveMicroUsd: microUsd,
    userDailyMicroUsd: microUsd,
    guestDailyMicroUsd: microUsd,
    globalDailyMicroUsd: microUsd,
    shadowSamplePercent: count,
    shadowDailyMicroUsd: microUsd,
    confirmationMinutes: count,
    approvalDays: count,
    messageMax: count,
    conversationMessageLimit: count,
    models: z.array(
      z.object({
        model: z.string(),
        inputPerMillion: microUsd,
        outputPerMillion: microUsd,
        cacheReadPerMillion: microUsd,
        cacheWritePerMillion: microUsd,
      }),
    ),
  }),
);
export type AdminAgentLimits = z.infer<typeof adminAgentLimitsSchema>;

// --- One agent's switch -------------------------------------------------------------------------

export const adminAgentParamsSchema = z.object({ agent: z.enum(AGENT_NAMES) });

export const adminAgentSwitchInputSchema = named(
  'AdminAgentSwitchInput',
  z.object({ enabled: z.boolean() }),
);

export const adminAgentSwitchSchema = named(
  'AdminAgentSwitch',
  z.object({ agent: z.enum(AGENT_NAMES), enabled: z.boolean() }),
);
