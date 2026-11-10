import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';

import { REDIS } from '../../infra/redis';

import { agentStreamEventSchema, type AgentStreamEvent } from './agent-chat.schemas';

/** A run's events are readable for an hour: long enough to resume a dropped connection. */
export const RUN_LOG_TTL_SECONDS = 3600;
/** A run writes a handful of status lines, a message and an end. */
const MAX_EVENTS = 200;

const key = (runId: string): string => `agent:run:${runId}:events`;

export type LoggedEvent = AgentStreamEvent & { id: number };

/**
 * What a client may see of a run while it happens (ADR-101): status lines, the answer and the
 * end, in a Redis list every replica reads. A stream and a poll read the same log, so a dropped
 * connection resumes where it stopped, and a run finishes whether or not anyone listens.
 */
@Injectable()
export class AgentRunLog {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  /** Appends an event and returns its number in the run (from 1). */
  async append(runId: string, event: AgentStreamEvent): Promise<number> {
    const length = await this.redis.rpush(key(runId), JSON.stringify(event));
    if (length === 1) await this.redis.expire(key(runId), RUN_LOG_TTL_SECONDS);
    return length;
  }

  /** The events after number `after` (0 for all), in order. */
  async read(runId: string, after: number): Promise<LoggedEvent[]> {
    const raw = await this.redis.lrange(key(runId), Math.max(0, after), MAX_EVENTS - 1);
    return raw.flatMap((entry, index) => {
      try {
        const parsed = agentStreamEventSchema.safeParse(JSON.parse(entry));
        return parsed.success ? [{ ...parsed.data, id: after + index + 1 }] : [];
      } catch {
        return [];
      }
    });
  }
}
