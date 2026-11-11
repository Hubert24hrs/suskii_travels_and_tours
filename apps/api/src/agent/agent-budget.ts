import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';

import {
  AiSearchBudget,
  type BudgetRefusal,
  type BudgetReservation,
} from '../ai-search/ai-search-budget';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { REDIS } from '../infra/redis';

/** The counters' prefix: the assistant's spend is separate from AI trip search's (ADR-061). */
export const AGENT_BUDGET_SCOPE = 'agent';
/** Shadow turns (ADR-106) are counted apart: trying a candidate never eats a traveller's cap. */
export const AGENT_SHADOW_BUDGET_SCOPE = 'agent-shadow';

export type AgentBudgetCaller = { userId: string } | { guestKey: string };

/**
 * What the assistant may spend on models in a UTC day (ADR-107): per signed-in person, per guest
 * (an HMAC of their address, never the address) and in total. A run reserves
 * `AGENT_RUN_RESERVE_MICROUSD` before its first model call and settles to what was billed; a run
 * that cannot reserve does not start.
 */
@Injectable()
export class AgentBudget {
  constructor(
    private readonly budget: AiSearchBudget,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  reserve(
    caller: AgentBudgetCaller,
    now: Date = new Date(),
  ): Promise<BudgetReservation | BudgetRefusal> {
    const signedIn = 'userId' in caller;
    return this.budget.reserve(
      signedIn ? `user:${caller.userId}` : `guest:${caller.guestKey}`,
      this.config.AGENT_RUN_RESERVE_MICROUSD,
      now,
      {
        scope: AGENT_BUDGET_SCOPE,
        callerCap: signedIn
          ? this.config.AGENT_USER_DAILY_MICROUSD
          : this.config.AGENT_GUEST_DAILY_MICROUSD,
        globalCap: this.config.AGENT_GLOBAL_DAILY_MICROUSD,
      },
    );
  }

  /** Holds the worst case of one shadow turn against the day's shadow cap, or refuses. */
  reserveShadow(now: Date = new Date()): Promise<BudgetReservation | BudgetRefusal> {
    // One caller for every shadow turn: the cap is on the day, not on a person.
    return this.budget.reserve('turns', this.config.AGENT_RUN_RESERVE_MICROUSD, now, {
      scope: AGENT_SHADOW_BUDGET_SCOPE,
      callerCap: this.config.AGENT_SHADOW_DAILY_MICROUSD,
      globalCap: this.config.AGENT_SHADOW_DAILY_MICROUSD,
    });
  }

  /** Replaces a run's reservation with what its model calls cost. */
  settle(reservation: BudgetReservation, actualMicroUsd: number): Promise<void> {
    return this.budget.settle(reservation, actualMicroUsd);
  }

  /** Today's total, reservations of running runs included; 0 when Redis cannot say. */
  spentToday(now: Date = new Date()): Promise<number> {
    return this.spent(AGENT_BUDGET_SCOPE, now);
  }

  /** Today's spend on shadow turns, held reservations included. */
  shadowSpentToday(now: Date = new Date()): Promise<number> {
    return this.spent(AGENT_SHADOW_BUDGET_SCOPE, now);
  }

  private async spent(scope: string, now: Date): Promise<number> {
    const key = `${scope}:spend:${now.toISOString().slice(0, 10)}:all`;
    const value = Number(await this.redis.get(key).catch(() => null));
    return Number.isSafeInteger(value) && value > 0 ? value : 0;
  }
}
