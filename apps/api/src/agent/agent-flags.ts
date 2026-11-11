import { Inject, Injectable, NotFoundException } from '@nestjs/common';

import { APP_CONFIG, type AppConfig } from '../config/config';

/** On when set; unset means on outside production and off in production (ADR-101). */
export const agentEnabled = (config: AppConfig): boolean =>
  config.AGENT_ENABLED ?? config.NODE_ENV !== 'production';

/** Price intelligence follows the same rule under its own switch (ADR-102). */
export const priceIntelEnabled = (config: AppConfig): boolean =>
  config.PRICE_INTEL_ENABLED ?? config.NODE_ENV !== 'production';

/**
 * The assistant's switches. Search, booking and payment never ask these: with the assistant off,
 * paused or unreachable the ordinary screens work as before.
 */
@Injectable()
export class AgentFlags {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  enabled(): boolean {
    return agentEnabled(this.config);
  }

  priceIntel(): boolean {
    return priceIntelEnabled(this.config);
  }

  /** True when the API knows where the agent service is and holds both of its tokens. */
  configured(): boolean {
    // The mock assistant runs inside the API and needs no address.
    if (this.config.AGENT_SERVICE === 'mock') return true;
    return Boolean(
      this.config.AGENT_URL && this.config.AGENT_RUN_TOKEN && this.config.AGENT_TOOLS_TOKEN,
    );
  }

  /** Throws 404 while the assistant is off, as if its routes did not exist. */
  require(): void {
    if (!this.enabled()) throw new NotFoundException();
  }
}
