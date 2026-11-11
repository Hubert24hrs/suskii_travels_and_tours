import { z } from 'zod';

import {
  AGENT_CARD_KINDS,
  AGENT_CONFIRMATION_AMOUNTS,
  AGENT_CONFIRMATION_STATUSES,
  AGENT_TOOL_DENIALS,
} from '@suskii/shared';

import { named } from '../../contract/contract';
import { moneySchema } from '../../pricing/pricing.schemas';

const uuid = z.uuid();

export const agentConfirmationParamsSchema = z.object({ confirmationId: uuid });

/** What a confirmation card shows, as the API built it (ADR-107). */
export const confirmationCardSchema = z.object({
  kind: z.enum(AGENT_CARD_KINDS),
  title: z.string().min(1).max(160),
  lines: z.array(z.string().min(1).max(200)).max(6),
  /** `refund`: what comes back to the traveller; `kept`: what the terms they booked on keep. */
  amounts: z
    .array(z.object({ code: z.enum(AGENT_CONFIRMATION_AMOUNTS), amount: moneySchema }))
    .max(4)
    .default([]),
  ref: z.object({ type: z.enum(['booking', 'trip', 'support']), id: uuid }).optional(),
});
export type ConfirmationCard = z.infer<typeof confirmationCardSchema>;

export const agentConfirmationSchema = named(
  'AgentConfirmation',
  z.object({
    id: uuid,
    conversationId: uuid,
    /** What will be done, as a code the clients put into words (`bookings.cancel`). */
    action: z.string(),
    status: z.enum(AGENT_CONFIRMATION_STATUSES),
    /** Why it failed at the tap, as a code; null otherwise. */
    reason: z.enum(AGENT_TOOL_DENIALS).nullable(),
    card: confirmationCardSchema,
    expiresAt: z.iso.datetime(),
    decidedAt: z.iso.datetime().nullable(),
  }),
);
export type AgentConfirmationDto = z.infer<typeof agentConfirmationSchema>;

export const decidedAgentConfirmationSchema = named(
  'DecidedAgentConfirmation',
  z.object({
    confirmation: agentConfirmationSchema,
    /** The run in which the assistant says what the records now hold; read it as after chat. */
    runId: uuid.nullable(),
  }),
);
