import { Injectable, type OnModuleInit } from '@nestjs/common';
import { z } from 'zod';

import { AGENT_NAMES } from '@suskii/shared';

import { CatalogService } from '../../catalog/catalog.service';
import { agentTool, AgentToolRegistry } from '../agent-tool';

const place = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('airport'),
    code: z.string(),
    name: z.string(),
    cityName: z.string().nullable(),
    countryCode: z.string(),
    countryName: z.string(),
    timeZone: z.string(),
  }),
  z.object({
    type: z.literal('city'),
    id: z.string(),
    name: z.string(),
    countryCode: z.string(),
    countryName: z.string(),
    airports: z.array(z.object({ code: z.string(), name: z.string() })),
  }),
]);

/**
 * `catalog.places`: the place search behind every search form. An agent resolves "Lagos" or
 * "LHR" to an airport code or a city id here and never invents one: a search tool only accepts
 * codes and ids that exist in the catalog.
 */
@Injectable()
export class CatalogTools implements OnModuleInit {
  constructor(
    private readonly registry: AgentToolRegistry,
    private readonly catalog: CatalogService,
  ) {}

  onModuleInit(): void {
    this.registry.register(
      agentTool({
        name: 'catalog.places',
        description:
          'Find airports and cities by name, IATA code or country. Returns airport codes (for flights) and city ids (for hotels and cars). Always resolve a place here before searching; never guess a code.',
        tier: 'read',
        scope: 'catalog',
        agents: AGENT_NAMES,
        input: z.object({
          query: z
            .string()
            .trim()
            .min(2)
            .max(64)
            .meta({ description: 'A city, an airport, a country or an IATA code.' }),
          types: z
            .array(z.enum(['airport', 'city']))
            .min(1)
            .max(2)
            .default(['airport', 'city']),
          limit: z.number().int().min(1).max(10).default(5),
        }),
        output: z.object({ places: z.array(place) }),
        run: async (input) => ({
          places: await this.catalog.suggest(input.query, input.types, input.limit),
        }),
      }),
    );
  }
}
