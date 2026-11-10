import { Injectable, type OnModuleInit } from '@nestjs/common';
import { z } from 'zod';

import { AGENT_NAMES, COMPONENT_STATES, STATUS_COMPONENTS } from '@suskii/shared';

import { StatusService } from '../../status/status.service';
import { agentTool, AgentToolRegistry } from '../agent-tool';

/**
 * `platform.status`: what the public status page says, so an agent can tell a traveller that
 * search, bookings, payments, accounts or support have a problem right now instead of guessing
 * why something failed. Public information only.
 */
@Injectable()
export class PlatformTools implements OnModuleInit {
  constructor(
    private readonly registry: AgentToolRegistry,
    private readonly status: StatusService,
  ) {}

  onModuleInit(): void {
    this.registry.register(
      agentTool({
        name: 'platform.status',
        description:
          'How Suskii is working right now: the state of search, bookings, payments, accounts and support, and the titles of open incidents. Use it when something failed or the person asks whether there is a problem.',
        tier: 'read',
        scope: 'catalog',
        agents: AGENT_NAMES,
        input: z.object({}),
        output: z.object({
          state: z.enum(COMPONENT_STATES),
          components: z.array(
            z.object({ id: z.enum(STATUS_COMPONENTS), state: z.enum(COMPONENT_STATES) }),
          ),
          openIncidents: z.array(
            z.object({ title: z.string(), impact: z.string(), startedAt: z.string() }),
          ),
        }),
        run: async () => {
          const page = await this.status.current();
          return {
            state: page.state,
            components: page.components,
            openIncidents: page.incidents
              .filter((incident) => incident.resolvedAt === null)
              .map((incident) => ({
                title: incident.title,
                impact: incident.impact,
                startedAt: incident.startedAt,
              })),
          };
        },
      }),
    );
  }
}
