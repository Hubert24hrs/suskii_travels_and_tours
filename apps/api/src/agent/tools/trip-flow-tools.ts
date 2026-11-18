import { Injectable, type OnModuleInit } from '@nestjs/common';
import { z } from 'zod';

import { agentTool, AgentToolRegistry } from '../agent-tool';

import { AgentPreparedParts } from './prepared-parts';
import { cardsOut, problemsSchema } from './tool-support';
import { AgentTripFlow, TRIP_FLOW_PARTS, tripFlowNextOut } from './trip-flow';

/**
 * `trips.next_part` (ADR-123): in a trip planned part by part, the part to choose now with its
 * options, after passing over one the traveller does not want. The order and the searches are
 * `AgentTripFlow`'s; this tool only lets the traveller say "not this one" and see what comes
 * next, or see the current part's options again.
 */
@Injectable()
export class TripFlowTools implements OnModuleInit {
  constructor(
    private readonly registry: AgentToolRegistry,
    private readonly flow: AgentTripFlow,
    private readonly prepared: AgentPreparedParts,
  ) {}

  onModuleInit(): void {
    this.registry.register(
      agentTool({
        name: 'trips.next_part',
        description:
          "In a trip being planned part by part (the flight, then a place to stay, a car, an airport transfer and travel insurance, then the checkout): the next part to choose, with its options. Pass skip with the part the traveller does not want (also one already prepared, which is then left out), and the part after it is shown; call it without skip to show the current part's options again. When next.part is checkout, the trip's summary and its checkout card are in the answer. 'no_trip_planned' in problems means no trip is being planned: start with flights.search.",
        tier: 'propose',
        scope: 'quotes',
        agents: ['trip_builder'],
        input: z.object({
          skip: z
            .enum(TRIP_FLOW_PARTS)
            .optional()
            .meta({ description: 'The part the traveller does not want for this trip.' }),
        }),
        output: z.object({
          problems: problemsSchema,
          next: tripFlowNextOut.nullable(),
          cards: cardsOut,
        }),
        run: async (input, { grant }) => {
          if (!(await this.flow.isPlanning(grant))) {
            return { problems: ['no_trip_planned'], next: null, cards: [] };
          }
          if (input.skip) {
            await this.flow.skip(grant, input.skip);
            // A part the traveller no longer wants is not paid with the trip.
            await this.prepared.forget(grant, [input.skip]);
          }
          const { problems, cards, ...next } = await this.flow.next(grant);
          return { problems, next, cards };
        },
      }),
    );
  }
}
