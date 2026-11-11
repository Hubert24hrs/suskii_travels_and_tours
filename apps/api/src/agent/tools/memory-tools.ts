import { Injectable, type OnModuleInit } from '@nestjs/common';
import { z } from 'zod';

import { AGENT_MEMORY_KEYS, agentMemoryAirlines } from '@suskii/shared';

import {
  agentTool,
  AgentToolError,
  AgentToolRegistry,
  type AgentConfirmationDraft,
} from '../agent-tool';
import { AgentMemoryService } from '../memory/agent-memory.service';

import { AgentToolCallers, card, cardsOut, guarded } from './tool-support';

const AGENTS = ['flights', 'hotels', 'cars', 'tours', 'trip_builder', 'concierge'] as const;

/**
 * What the assistant remembers for a traveller who agreed to it (ADR-105). `memory.read` hands
 * a run the short list; `memory.remember` never stores anything itself: it asks the traveller,
 * with a card, and only their tap keeps the preference. Both are the signed-in traveller's
 * own. A value is a code or one of a fixed set, so no sentence of a model's or a traveller's
 * is ever kept, and a meal preference is not on the list.
 */
@Injectable()
export class MemoryTools implements OnModuleInit {
  constructor(
    private readonly registry: AgentToolRegistry,
    private readonly callers: AgentToolCallers,
    private readonly memory: AgentMemoryService,
  ) {}

  onModuleInit(): void {
    this.registry.register(
      agentTool({
        name: 'memory.read',
        description:
          'The travel preferences the signed-in traveller asked the assistant to remember: home airport, cabin, window or aisle, up to three preferred airlines, and whether to weigh price or comfort first. `remembering` is false when they have not agreed to it: then nothing is kept and nothing may be assumed. Use what is here as a starting point and say that you did; the traveller can always choose otherwise. They see and change these on the page the card opens.',
        tier: 'read',
        scope: 'account',
        agents: [...AGENTS],
        input: z.object({}),
        output: z.object({
          remembering: z.boolean(),
          homeAirport: z.string().nullable(),
          cabin: z.string().nullable(),
          seat: z.string().nullable(),
          preferredAirlines: z.array(z.string()),
          weighs: z.string().nullable(),
          cards: cardsOut,
        }),
        run: async (_input, { grant }) => {
          const kept = await this.memory.get(this.callers.userId(grant));
          const value = (key: (typeof AGENT_MEMORY_KEYS)[number]): string | null =>
            kept.items.find((item) => item.key === key)?.value ?? null;
          const airlines = value('airlines');
          return {
            remembering: kept.enabled,
            homeAirport: value('home_airport'),
            cabin: value('cabin'),
            seat: value('seat'),
            preferredAirlines: airlines ? agentMemoryAirlines(airlines) : [],
            weighs: value('budget'),
            cards: card('link', 'Preferences', [], { href: '/account/assistant' }),
          };
        },
      }),
    );

    this.registry.register(
      agentTool({
        name: 'memory.remember',
        description:
          'Asks the signed-in traveller to confirm that the assistant should remember one travel preference. Nothing is kept when you call it: they get a card, and only their tap keeps it. Call it only after the traveller said the preference themselves and asked for it to be remembered, or agreed when you offered. Keys: `home_airport` (an IATA code from catalog.places), `cabin` (economy, premium_economy, business, first), `seat` (window, aisle), `airlines` (one to three IATA airline codes, separated by commas), `budget` (lowest, balanced, comfort). Nothing else can be remembered: never a meal, a health need, a name or a contact. It is refused while the traveller has not switched remembering on; the page that switches it on is the one memory.read links to.',
        tier: 'commit',
        scope: 'account',
        agents: [...AGENTS],
        input: z.object({
          key: z.enum(AGENT_MEMORY_KEYS),
          value: z.string().trim().min(1).max(40),
        }),
        output: z.object({ remembered: z.boolean(), key: z.string(), value: z.string() }),
        prepare: async (input, { grant }) => {
          const userId = this.callers.userId(grant);
          // Checked before the traveller is asked: a card never offers what cannot be kept.
          if (!(await this.memory.enabled(userId))) throw new AgentToolError('refused');
          const value = await guarded(() => this.memory.check(input.key, input.value));
          return {
            // The key and the value are codes; the clients put both into the traveller's words.
            card: { kind: 'link', title: input.key, lines: [value] },
            expected: { key: input.key, value },
          } satisfies AgentConfirmationDraft;
        },
        run: async (input, { grant, expected }) => {
          const userId = this.callers.userId(grant);
          const promised = z
            .object({ key: z.enum(AGENT_MEMORY_KEYS), value: z.string() })
            .safeParse(expected ?? {});
          // Only what the card showed is kept, whatever arrives with the tap.
          if (!promised.success || promised.data.key !== input.key) {
            throw new AgentToolError('refused');
          }
          await guarded(() =>
            this.memory.put(userId, promised.data.key, promised.data.value, 'assistant'),
          );
          return { remembered: true, key: promised.data.key, value: promised.data.value };
        },
      }),
    );
  }
}
