import { z } from 'zod';

import {
  AGENT_AUTONOMY_LEVELS,
  AGENT_AUTONOMY_SUBJECTS,
  AGENT_NAMES,
  AGENT_PAUSE_REASONS,
  AGENT_SCOPES,
  AGENT_TOOL_DENIALS,
  AGENT_TOOL_TIERS,
} from '@suskii/shared';

import { named } from '../contract/contract';

// --- What clients ask before they show the assistant ----------------------------------------

export const agentStatusSchema = named(
  'AgentStatus',
  z.object({
    enabled: z
      .boolean()
      .meta({ description: 'False while the assistant is switched off: hide every entry to it.' }),
    paused: z
      .boolean()
      .meta({ description: 'Staff paused it; show the ordinary screens and say so if asked.' }),
    available: z
      .boolean()
      .meta({ description: 'On, not paused and the agent service is configured.' }),
  }),
);

// --- The tool gateway (agent service only) --------------------------------------------------

export const agentToolParamsSchema = z.object({
  tool: z.string().min(3).max(64),
});

export const agentToolCallSchema = named(
  'AgentToolCall',
  z.object({
    grant: z
      .string()
      .min(1)
      .max(4096)
      .meta({ description: 'The sealed grant the API issued for the run, passed back unchanged.' }),
    agent: z.string().min(1).max(32).meta({ description: 'The agent that is calling.' }),
    arguments: z.record(z.string(), z.unknown()).default({}),
  }),
);

export const agentToolAnswerSchema = named(
  'AgentToolAnswer',
  z.object({
    status: z.enum(['ok', 'denied', 'error', 'timeout']),
    reason: z.enum(AGENT_TOOL_DENIALS).nullable(),
    result: z
      .unknown()
      .meta({ description: "The tool's answer: only fields its output schema names." }),
    issues: z
      .array(z.object({ path: z.string(), code: z.string() }))
      .optional()
      .meta({ description: 'With `invalid`: which arguments did not fit. Names only.' }),
  }),
);

export const agentToolDescriptionSchema = named(
  'AgentToolDescription',
  z.object({
    name: z.string(),
    description: z.string(),
    tier: z.enum(AGENT_TOOL_TIERS),
    scope: z.enum(AGENT_SCOPES),
    agents: z.array(z.enum(AGENT_NAMES)),
    parameters: z.record(z.string(), z.unknown()),
  }),
);

export const agentToolListSchema = named(
  'AgentToolList',
  z.object({ tools: z.array(agentToolDescriptionSchema) }),
);

// --- The console ------------------------------------------------------------------------------

export const agentAutonomySettingSchema = named(
  'AgentAutonomySetting',
  z.object({
    subject: z.enum(AGENT_AUTONOMY_SUBJECTS),
    name: z.string(),
    level: z.enum(AGENT_AUTONOMY_LEVELS),
    set: z.boolean().meta({ description: 'False while the default applies.' }),
  }),
);

export const agentAutonomyInputSchema = named(
  'AgentAutonomyInput',
  z.object({
    subject: z.enum(AGENT_AUTONOMY_SUBJECTS),
    name: z.string().min(1).max(64),
    level: z.enum(AGENT_AUTONOMY_LEVELS),
  }),
);
export type AgentAutonomyInput = z.infer<typeof agentAutonomyInputSchema>;

export const agentPauseInputSchema = named(
  'AgentPauseInput',
  z.object({ reason: z.enum(AGENT_PAUSE_REASONS) }),
);
export type AgentPauseInput = z.infer<typeof agentPauseInputSchema>;

export const adminAgentOverviewSchema = named(
  'AdminAgentOverview',
  z.object({
    enabled: z.boolean(),
    priceIntelEnabled: z.boolean(),
    serviceConfigured: z.boolean(),
    pause: z.object({
      paused: z.boolean(),
      reason: z.enum(AGENT_PAUSE_REASONS).nullable(),
      since: z.iso.datetime().nullable(),
      known: z.boolean().meta({
        description: 'False when the switch could not be read; it then counts as paused.',
      }),
    }),
    spend: z.object({
      todayMicroUsd: z.number().int().min(0),
      dailyCapMicroUsd: z.number().int().min(0),
    }),
    runs: z.object({
      today: z.number().int().min(0),
      waiting: z.number().int().min(0),
      failedToday: z.number().int().min(0),
    }),
    autonomy: z.array(agentAutonomySettingSchema),
    tools: z.array(agentToolDescriptionSchema.omit({ parameters: true })),
  }),
);
export type AdminAgentOverview = z.infer<typeof adminAgentOverviewSchema>;
