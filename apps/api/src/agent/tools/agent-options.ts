import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';

import { REDIS } from '../../infra/redis';
import { ErrorReporter } from '../../telemetry/error-reporter';
import type { AgentGrant } from '../agent-grants';

/** What a traveller can choose by its number in a conversation (ADR-123). */
export const OPTION_KINDS = ['flight', 'hotel', 'car', 'addon'] as const;
export type OptionKind = (typeof OPTION_KINDS)[number];

/** One option as the tool that prepares it needs it: the search's id and what goes with it. */
export interface StoredOption {
  id: string;
  /** For a car, the pick-up and return times its price is for; for an add-on, its type. */
  extra?: Record<string, string>;
}

/** As long as search results last: an option older than that is searched again. */
const TTL_SECONDS = 30 * 60;
const MAX_OPTIONS = 10;
const ID = /^[A-Za-z0-9_.:-]{1,200}$/;

const key = (grant: AgentGrant): string =>
  grant.conversationId
    ? `agent:options:${grant.conversationId}`
    : `agent:options:run:${grant.runId}`;

const isStored = (value: unknown): value is StoredOption => {
  if (typeof value !== 'object' || value === null) return false;
  const { id, extra } = value as { id?: unknown; extra?: unknown };
  if (typeof id !== 'string' || !ID.test(id)) return false;
  return (
    extra === undefined ||
    (typeof extra === 'object' &&
      extra !== null &&
      Object.values(extra).every((item) => typeof item === 'string'))
  );
};

/**
 * The options a conversation was last shown, per kind (ADR-123): "option 2" of the hotels is
 * the second hotel the traveller saw, whichever tool showed it. A model chooses by number and
 * never has to carry an id from one turn to the next (the conversation's history keeps words,
 * not tool results); the ids stay here, as the search issued them, for as long as its results
 * last. Ids only, nothing about a person.
 */
@Injectable()
export class AgentOptions {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly errors: ErrorReporter,
  ) {}

  /** The options just shown, in order. Choosing by number still works by id if this fails. */
  async remember(
    grant: AgentGrant,
    kind: OptionKind,
    options: readonly StoredOption[],
  ): Promise<void> {
    const hash = key(grant);
    try {
      await this.redis
        .multi()
        .hset(hash, kind, JSON.stringify(options.slice(0, MAX_OPTIONS)))
        .expire(hash, TTL_SECONDS)
        .exec();
    } catch (error) {
      void this.errors.capture(error, { task: 'agent.options' });
    }
  }

  /** Option `option` (from 1) of the kind last shown, or null when there is no such option. */
  async get(grant: AgentGrant, kind: OptionKind, option: number): Promise<StoredOption | null> {
    if (!Number.isInteger(option) || option < 1 || option > MAX_OPTIONS) return null;
    const raw = await this.redis.hget(key(grant), kind);
    if (!raw) return null;
    try {
      const list = JSON.parse(raw) as unknown;
      if (!Array.isArray(list)) return null;
      const found: unknown = list[option - 1];
      return isStored(found) ? found : null;
    } catch {
      return null;
    }
  }
}
