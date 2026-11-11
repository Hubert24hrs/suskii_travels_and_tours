import { z } from 'zod';

import { AGENT_MEMORY_KEYS } from '@suskii/shared';

import { named } from '../../contract/contract';

const key = z.enum(AGENT_MEMORY_KEYS);

export const agentMemoryItemSchema = z.object({
  key,
  /** An airport code, airline codes separated by commas, or one of the listed choices. */
  value: z.string(),
  /** Who set it: the traveller on this page, or the assistant after a tap in a chat. */
  source: z.enum(['traveller', 'assistant']),
  updatedAt: z.iso.datetime(),
});

export const agentMemorySchema = named(
  'AssistantMemory',
  z.object({
    /** Whether the traveller agreed that the assistant may remember preferences. */
    enabled: z.boolean(),
    enabledAt: z.iso.datetime().nullable(),
    items: z.array(agentMemoryItemSchema),
  }),
);
export type AgentMemoryDto = z.infer<typeof agentMemorySchema>;

export const agentMemorySwitchSchema = named(
  'AssistantMemorySwitch',
  z.object({ enabled: z.boolean() }),
);

export const agentMemoryKeyParamsSchema = z.object({ key });

export const agentMemoryValueSchema = named(
  'AssistantMemoryValue',
  z.object({ value: z.string().trim().min(1).max(40) }),
);
