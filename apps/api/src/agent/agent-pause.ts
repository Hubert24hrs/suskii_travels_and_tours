import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { z } from 'zod';

import { AGENT_PAUSE_REASONS, type AgentPauseReason } from '@suskii/shared';

import { REDIS } from '../infra/redis';

export const AGENT_PAUSE_KEY = 'agent:pause';
/** A pause must be answered quickly or the answer is "paused". */
const CHECK_TIMEOUT_MS = 1500;

const stored = z.object({
  reason: z.enum(AGENT_PAUSE_REASONS),
  at: z.iso.datetime(),
});

export interface AgentPauseState {
  paused: boolean;
  reason: AgentPauseReason | null;
  since: string | null;
  /** False when Redis could not answer: the assistant then counts as paused. */
  known: boolean;
}

const withTimeout = <T>(work: Promise<T>): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('pause check timed out')), CHECK_TIMEOUT_MS);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error('pause check failed'));
      },
    );
  });

/**
 * The stop button (ADR-107): one Redis key every instance reads before a run starts and before
 * every tool call, so a pause takes effect within seconds and without a deploy. It fails closed:
 * when Redis cannot say, the assistant is treated as paused, which costs a chat answer and never
 * a booking.
 */
@Injectable()
export class AgentPause {
  private readonly logger = new Logger(AgentPause.name);

  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async state(): Promise<AgentPauseState> {
    let raw: string | null;
    try {
      raw = await withTimeout(this.redis.get(AGENT_PAUSE_KEY));
    } catch {
      this.logger.warn('The pause switch could not be read; treating the assistant as paused');
      return { paused: true, reason: null, since: null, known: false };
    }
    if (raw === null) return { paused: false, reason: null, since: null, known: true };
    const parsed = stored.safeParse(safeJson(raw));
    // A value nobody can read still means someone set the key: stay paused.
    if (!parsed.success) return { paused: true, reason: 'other', since: null, known: true };
    return { paused: true, reason: parsed.data.reason, since: parsed.data.at, known: true };
  }

  async paused(): Promise<boolean> {
    return (await this.state()).paused;
  }

  /** Pauses the assistant. Returns false when it was paused already (the first reason stays). */
  async pause(reason: AgentPauseReason, now = new Date()): Promise<boolean> {
    const set = await this.redis.set(
      AGENT_PAUSE_KEY,
      JSON.stringify({ reason, at: now.toISOString() }),
      'NX',
    );
    return set === 'OK';
  }

  /** Lifts the pause. Returns false when nothing was paused. */
  async resume(): Promise<boolean> {
    return (await this.redis.del(AGENT_PAUSE_KEY)) === 1;
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}
