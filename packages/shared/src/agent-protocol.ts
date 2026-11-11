import { z } from './zod-setup';

import {
  AGENT_ANSWER_MAX,
  AGENT_AUDIENCES,
  AGENT_CHANNELS,
  AGENT_MESSAGE_MAX,
  AGENT_NAMES,
} from './agent';

/**
 * What the API and the agent service say to each other (ADR-101): one request that starts or
 * resumes a run, and the events the agent streams back as newline-delimited JSON. Both sides
 * parse with these schemas, so neither trusts the other's shape.
 */

/** How a run ended: a code for the run record and the client, never free text. */
export const AGENT_RUN_OUTCOMES = [
  // An answer the guard passed.
  'answered',
  // Handed to a person.
  'handover',
  // Waiting for the traveller's tap on a confirmation (the graph is interrupted).
  'confirmation',
  // The answer held something no tool result supports, twice: a notice went out instead.
  'guard_blocked',
  'step_limit',
  'tool_limit',
  'timeout',
  'model_error',
  'model_refused',
  'paused',
  'cancelled',
  'failed',
] as const;
export type AgentRunOutcome = (typeof AGENT_RUN_OUTCOMES)[number];

/** What an assistant message is: an answer, a handover to people, or a notice it could not answer. */
export const AGENT_MESSAGE_KINDS = ['text', 'handover', 'notice'] as const;
export type AgentMessageKind = (typeof AGENT_MESSAGE_KINDS)[number];

/**
 * What the assistant says without a model: a code the clients show in the traveller's language
 * from their own catalogs. The agent service writes no copy of its own.
 */
export const AGENT_NOTICES = [
  // A greeting answered by rule, before any model call is paid for.
  'greeting',
  // The answer could not be grounded in what the tools returned; a person can help.
  'cannot_answer',
  // The run used its steps or its tool calls.
  'limit',
  'timeout',
  // The model or the agent service failed.
  'unavailable',
  'paused',
] as const;
export type AgentNotice = (typeof AGENT_NOTICES)[number];

export const AGENT_CARD_KINDS = [
  'flight',
  'hotel',
  'car',
  'transfer',
  'tour',
  'package',
  'visa',
  'booking',
  'trip',
  'price',
  'link',
] as const;
export type AgentCardKind = (typeof AGENT_CARD_KINDS)[number];

const uuid = z.uuid();
const currency = z.string().regex(/^[A-Z]{3}$/);
const tokens = z.number().int().min(0).max(100_000_000);

/**
 * A path inside the website or the app, never a host: a card cannot send anyone elsewhere,
 * whatever a tool result or a model says.
 */
export const agentCardPathSchema = z
  .string()
  .max(600)
  .regex(/^\/(?!\/)[A-Za-z0-9\-._~%/?=&+:,@]*$/);

/**
 * What a client draws beside an answer. Tools build cards from the platform's own records and
 * the graph passes them through unchanged: a model never writes one. They hold public trip
 * facts and prices as money, never a name, a contact detail, a document or a booking reference.
 */
export const agentCardSchema = z.object({
  kind: z.enum(AGENT_CARD_KINDS),
  title: z.string().trim().min(1).max(120),
  lines: z.array(z.string().trim().min(1).max(160)).max(4),
  price: z
    .object({ amountMinor: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER), currency })
    .optional(),
  /** A price seen on another site (ADR-104): shown as indicative, never as an offer. */
  indicative: z.boolean().optional(),
  href: agentCardPathSchema.optional(),
  /** The record a card is about, for a client that draws it from the traveller's own data. */
  ref: z.object({ type: z.enum(['booking', 'trip', 'support']), id: uuid }).optional(),
});
export type AgentCard = z.infer<typeof agentCardSchema>;

/** Shapes prompts and routing. It grants nothing: the sealed grant does (ADR-101). */
export const agentRunContextSchema = z.object({
  audience: z.enum(AGENT_AUDIENCES),
  channel: z.enum(AGENT_CHANNELS),
  locale: z.string().min(2).max(12),
  currency,
  country: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .nullable(),
  /** The agents switched on for this caller; the supervisor routes only to these. */
  agents: z.array(z.enum(AGENT_NAMES)).min(1).max(AGENT_NAMES.length),
  /** Whether the caller has an account: what the assistant may offer, not what it may reach. */
  signedIn: z.boolean(),
  /** Today in the traveller's market, so "next Friday" means the same to the model and to us. */
  today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
export type AgentRunContext = z.infer<typeof agentRunContextSchema>;

export const agentRunLimitsSchema = z.object({
  /** Model turns one run may take, the router's included. */
  maxSteps: z.number().int().min(1).max(40),
  timeoutMs: z.number().int().min(1000).max(600_000),
  maxOutputTokens: z.number().int().min(64).max(8192),
});
export type AgentRunLimits = z.infer<typeof agentRunLimitsSchema>;

export const agentRunInputSchema = z.discriminatedUnion('kind', [
  /** The traveller's message, already scrubbed of contact details and document numbers. */
  z.object({ kind: z.literal('message'), text: z.string().trim().min(1).max(AGENT_MESSAGE_MAX) }),
  /**
   * What happened to a confirmation the run was waiting for. `facts` is what the API's records
   * say after the traveller's tap, under keys: the only thing the assistant may report.
   */
  z.object({
    kind: z.literal('resume'),
    confirmationId: uuid,
    decision: z.enum(['confirmed', 'declined', 'expired', 'failed']),
    facts: z.record(z.string(), z.unknown()).optional(),
  }),
]);
export type AgentRunInput = z.infer<typeof agentRunInputSchema>;

export const agentRunRequestSchema = z.object({
  runId: uuid,
  /** The conversation: one thread of checkpoints (ADR-103). */
  threadId: uuid,
  /** Sealed by the API; the agent service passes it back with each tool call and cannot read it. */
  grant: z.string().min(1).max(4096),
  context: agentRunContextSchema,
  limits: agentRunLimitsSchema,
  input: agentRunInputSchema,
});
export type AgentRunRequest = z.infer<typeof agentRunRequestSchema>;

/** What one model billed in a run: the API prices it from its own table (ADR-106). */
export const agentModelUsageSchema = z.object({
  role: z.enum(['router', 'specialist']),
  provider: z.string().min(1).max(32),
  model: z.string().min(1).max(64),
  calls: z.number().int().min(0).max(100),
  inputTokens: tokens,
  outputTokens: tokens,
  cacheReadTokens: tokens,
  cacheWriteTokens: tokens,
});
export type AgentModelUsage = z.infer<typeof agentModelUsageSchema>;

export const agentAnswerSchema = z.object({
  kind: z.enum(AGENT_MESSAGE_KINDS),
  text: z.string().trim().min(1).max(AGENT_ANSWER_MAX),
  cards: z.array(agentCardSchema).max(6),
  /** The tool results an answer rests on (`flights.search#2`): names and counters only. */
  sources: z.array(z.string().regex(/^[a-z_.]{3,64}#\d{1,3}$/)).max(24),
});
export type AgentAnswer = z.infer<typeof agentAnswerSchema>;

const agentName = z.enum(AGENT_NAMES);

/**
 * One line of the agent's answer stream. `status` lines say what it is doing; the answer comes
 * whole in `end`, after the guard has read it, so nothing unchecked is ever shown.
 */
export const agentRunEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('status'),
    agent: agentName,
    phase: z.enum(['routing', 'thinking', 'tool', 'checking']),
    /** With `tool`: which one. A name, never its arguments. */
    tool: z
      .string()
      .regex(/^[a-z_.]{3,64}$/)
      .optional(),
  }),
  z.object({
    type: z.literal('end'),
    outcome: z.enum(AGENT_RUN_OUTCOMES),
    /** The agent that answered, and every one that worked on the run. */
    agent: agentName,
    agents: z.array(agentName).max(AGENT_NAMES.length),
    /** An answer the model wrote and the guard passed; null when a notice stands in for it. */
    answer: agentAnswerSchema.nullable(),
    notice: z.enum(AGENT_NOTICES).nullable(),
    /** With `confirmation`: the pending confirmation the API created for the traveller's tap. */
    confirmationId: uuid.nullable(),
    /** The prompts that produced the answer (`flights@3`), so a bad one can be traced. */
    prompts: z.array(z.string().regex(/^[a-z_]{2,32}@\d{1,4}$/)).max(8),
    steps: z.number().int().min(0).max(100),
    usage: z.array(agentModelUsageSchema).max(4),
  }),
]);
export type AgentRunEvent = z.infer<typeof agentRunEventSchema>;
export type AgentRunEnd = Extract<AgentRunEvent, { type: 'end' }>;
