import { Injectable, type OnModuleInit } from '@nestjs/common';
import { z } from 'zod';

import {
  CABIN_CLASSES,
  iataCodeSchema,
  isoDateSchema,
  priceAlertInputSchema,
  type PriceAlertInput,
} from '@suskii/shared';

import type { PriceAlertDto } from '../../alerts/alerts.schemas';
import { PriceAlertsService } from '../../alerts/price-alerts.service';
import { CatalogService } from '../../catalog/catalog.service';
import {
  agentTool,
  AgentToolError,
  AgentToolRegistry,
  type AgentConfirmationDraft,
} from '../agent-tool';
import type { AgentGrant } from '../agent-grants';

import {
  AgentToolCallers,
  card,
  cardsOut,
  guarded,
  moneyOut,
  placeText,
  utcTime,
} from './tool-support';

const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

const watchOut = z.object({
  alertId: z.uuid(),
  from: z.string(),
  to: z.string(),
  departureDate: z.string().nullable(),
  departureMonth: z.string().nullable(),
  cabin: z.string(),
  tellMeBelow: moneyOut.nullable(),
  lastPriceSeen: moneyOut.nullable(),
  lastChecked: z.string().nullable(),
  watchState: z.enum(['active', 'ended']),
  watchedUntil: z.string(),
});

const watchInput = z.object({
  origin: iataCodeSchema.meta({ description: 'IATA code of the departure airport.' }),
  destination: iataCodeSchema.meta({ description: 'IATA code of the arrival airport.' }),
  departureDate: isoDateSchema
    .optional()
    .meta({ description: 'One departure date (YYYY-MM-DD). Give this or departureMonth.' }),
  departureMonth: month
    .optional()
    .meta({ description: 'A whole month (YYYY-MM). Give this or departureDate.' }),
  cabinClass: z.enum(CABIN_CLASSES).default('economy'),
  tellMeBelowMinor: z.number().int().positive().max(1_000_000_000_000).optional().meta({
    description:
      "A price in minor units of the conversation's currency: only prices at or below it are announced. Leave out to hear of every drop.",
  }),
});

/**
 * Price watch (ADR-032) for the assistant: a signed-in traveller's own alerts on a route, for
 * a date or a month. Listing reads; starting and stopping a watch change what the traveller is
 * told about later, so each is a confirmation they tap (ADR-107). The watch itself is the
 * ordinary price alert: the worker checks it, at that person's prices, and tells them.
 */
@Injectable()
export class WatchTools implements OnModuleInit {
  constructor(
    private readonly registry: AgentToolRegistry,
    private readonly callers: AgentToolCallers,
    private readonly alerts: PriceAlertsService,
    private readonly catalog: CatalogService,
  ) {}

  onModuleInit(): void {
    const agents = ['flights', 'concierge', 'trip_builder'] as const;

    this.registry.register(
      agentTool({
        name: 'alerts.list',
        description:
          "The signed-in traveller's own price watches on flight routes: the route, the date or month, the price they asked to be told below, the last price seen and whether the watch still runs.",
        tier: 'read',
        scope: 'account',
        agents,
        input: z.object({}),
        output: z.object({ found: z.number().int(), watches: z.array(watchOut).max(20) }),
        run: async (_input, { grant }) => {
          const rows = await this.alerts.list(this.callers.userId(grant));
          const watches = await Promise.all(rows.slice(0, 20).map((row) => this.watch(row)));
          return { found: rows.length, watches };
        },
      }),
    );

    this.registry.register(
      agentTool({
        name: 'alerts.watch',
        description:
          'Asks the signed-in traveller to confirm watching the price of a flight route for one date or one month. Nothing is watched when you call it: the traveller gets a card and only their tap starts the watch, after which they are told when the price drops. Call it only after they asked to be told about a price.',
        tier: 'commit',
        scope: 'account',
        agents,
        input: watchInput,
        output: z.object({ watchStatus: z.string(), watch: watchOut, cards: cardsOut }),
        prepare: async (input, { grant }) => {
          this.callers.userId(grant);
          const alert = this.alertOf(input, grant);
          const route = await this.route(alert.origin, alert.destination);
          return {
            card: {
              kind: 'flight',
              title: route,
              lines: [alert.departureDate ?? alert.departureMonth ?? '', alert.cabinClass],
              ...(alert.targetMinor !== null
                ? {
                    amounts: [
                      {
                        code: 'target',
                        amount: { amountMinor: alert.targetMinor, currency: alert.currency },
                      },
                    ],
                  }
                : {}),
            },
          } satisfies AgentConfirmationDraft;
        },
        run: async (input, { grant }) => {
          const userId = this.callers.userId(grant);
          const created = await guarded(() =>
            this.alerts.create(userId, this.alertOf(input, grant)),
          );
          const watch = await this.watch(created);
          return {
            watchStatus: 'active',
            watch,
            cards: card('flight', `${watch.from} \u2192 ${watch.to}`, [
              watch.departureDate ?? watch.departureMonth,
            ]),
          };
        },
      }),
    );

    this.registry.register(
      agentTool({
        name: 'alerts.stop',
        description:
          'Asks the signed-in traveller to confirm ending one of their own price watches. Nothing ends when you call it: only their tap on the card does. Use the alertId from alerts.list.',
        tier: 'commit',
        scope: 'account',
        agents,
        input: z.object({ alertId: z.uuid() }),
        output: z.object({ alertId: z.uuid(), watchStatus: z.string() }),
        prepare: async (input, { grant }) => {
          const watch = await this.owned(input.alertId, grant);
          return {
            card: {
              kind: 'flight',
              title: `${watch.from} \u2192 ${watch.to}`,
              lines: [watch.departureDate ?? watch.departureMonth ?? ''],
            },
          } satisfies AgentConfirmationDraft;
        },
        run: async (input, { grant }) => {
          await guarded(() => this.alerts.remove(this.callers.userId(grant), input.alertId));
          return { alertId: input.alertId, watchStatus: 'ended' };
        },
      }),
    );
  }

  /** The alert the ordinary service takes, in the conversation's currency; never the model's. */
  private alertOf(input: z.infer<typeof watchInput>, grant: AgentGrant): PriceAlertInput {
    const parsed = priceAlertInputSchema.safeParse({
      origin: input.origin,
      destination: input.destination,
      departureDate: input.departureDate ?? null,
      departureMonth: input.departureMonth ?? null,
      cabinClass: input.cabinClass,
      currency: this.callers.currency(grant),
      targetMinor: input.tellMeBelowMinor ?? null,
    });
    // Both a date and a month, neither, or the same airport twice: nothing to watch.
    if (!parsed.success) throw new AgentToolError('refused');
    return parsed.data;
  }

  /** The route as a card's title; an airport the catalog does not know cannot be watched. */
  private async route(origin: string, destination: string): Promise<string> {
    const airports = await this.catalog.airportInfo([origin, destination]);
    const from = airports.get(origin);
    const to = airports.get(destination);
    if (!from || !to) throw new AgentToolError('refused');
    return `${placeText(from)} \u2192 ${placeText(to)}`;
  }

  private async owned(alertId: string, grant: AgentGrant): Promise<z.infer<typeof watchOut>> {
    const rows = await this.alerts.list(this.callers.userId(grant));
    const row = rows.find((candidate) => candidate.id === alertId);
    // Someone else's watch does not exist here.
    if (!row) throw new AgentToolError('not_found');
    return this.watch(row);
  }

  private async watch(alert: PriceAlertDto): Promise<z.infer<typeof watchOut>> {
    const airports = await this.catalog.airportInfo([alert.origin, alert.destination]);
    const from = airports.get(alert.origin);
    const to = airports.get(alert.destination);
    return {
      alertId: alert.id,
      from: placeText({ code: alert.origin, cityName: from?.cityName ?? null }),
      to: placeText({ code: alert.destination, cityName: to?.cityName ?? null }),
      departureDate: alert.departureDate,
      departureMonth: alert.departureMonth,
      cabin: alert.cabinClass,
      tellMeBelow: alert.target,
      lastPriceSeen: alert.lastPrice,
      lastChecked: alert.lastCheckedAt ? utcTime(alert.lastCheckedAt) : null,
      watchState: alert.active ? 'active' : 'ended',
      watchedUntil: alert.endsOn,
    };
  }
}
