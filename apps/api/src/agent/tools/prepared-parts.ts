import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';

import { REDIS } from '../../infra/redis';
import { ErrorReporter } from '../../telemetry/error-reporter';
import type { AgentGrant } from '../agent-grants';

/**
 * The kinds of part a conversation can prepare (ADR-117): the five a combined trip takes
 * (ADR-099) and the products that are booked on their own page. A bus trip is not here: its
 * seats are chosen on the seat map, so the assistant prepares no quote for one (ADR-109).
 */
export const PREPARED_PARTS = [
  'flight',
  'hotel',
  'car',
  'transfer',
  'insurance',
  'package',
  'tour',
  'visa',
  'esim',
  'lounge',
] as const;
export type PreparedPart = (typeof PREPARED_PARTS)[number];

/** Longer than any quote lives (30 minutes) and than a conversation about one trip lasts. */
const TTL_SECONDS = 6 * 60 * 60;
const TRIP_FIELD = 'trip';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const key = (conversationId: string): string => `agent:prepared:${conversationId}`;

const isPart = (value: string): value is PreparedPart =>
  (PREPARED_PARTS as readonly string[]).includes(value);

export interface PreparedInConversation {
  /** The newest quote of each kind the conversation prepared. */
  parts: Partial<Record<PreparedPart, string>>;
  /** The combined trip the conversation built or planned, if any. */
  tripId: string | null;
}

/**
 * What one conversation has prepared, so `trips.prepare_checkout` can put it together without
 * a model repeating ids (ADR-117): the newest quote per kind of part and the trip it built. Ids
 * only, in Redis, for six hours; nothing about a person. Only the prepare tools and the trip
 * tools write it, and only for the grant's own conversation. A run without a conversation keeps
 * nothing.
 */
@Injectable()
export class AgentPreparedParts {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly errors: ErrorReporter,
  ) {}

  /** Notes a prepared quote. The traveller already has its card: a failure here only reports. */
  async remember(grant: AgentGrant, part: PreparedPart, quoteId: string): Promise<void> {
    await this.write(grant, part, quoteId);
  }

  /** Notes the combined trip the conversation built, for the next summary to add to. */
  async rememberTrip(grant: AgentGrant, tripId: string): Promise<void> {
    await this.write(grant, TRIP_FIELD, tripId);
  }

  /** Drops parts the traveller no longer wants, so a later summary leaves them out too. */
  async forget(grant: AgentGrant, parts: readonly PreparedPart[]): Promise<void> {
    if (!grant.conversationId || parts.length === 0) return;
    await this.redis.hdel(key(grant.conversationId), ...parts);
  }

  async read(grant: AgentGrant): Promise<PreparedInConversation> {
    if (!grant.conversationId) return { parts: {}, tripId: null };
    const stored = await this.redis.hgetall(key(grant.conversationId));
    const parts: Partial<Record<PreparedPart, string>> = {};
    for (const [field, value] of Object.entries(stored)) {
      if (isPart(field) && UUID.test(value)) parts[field] = value.toLowerCase();
    }
    const trip = stored[TRIP_FIELD];
    return { parts, tripId: trip && UUID.test(trip) ? trip.toLowerCase() : null };
  }

  private async write(grant: AgentGrant, field: string, id: string): Promise<void> {
    if (!grant.conversationId || !UUID.test(id)) return;
    const name = key(grant.conversationId);
    try {
      await this.redis.multi().hset(name, field, id.toLowerCase()).expire(name, TTL_SECONDS).exec();
    } catch (error) {
      void this.errors.capture(error, { task: 'agent.prepared_parts' });
    }
  }
}
