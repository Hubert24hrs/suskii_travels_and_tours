import { type AgentConfig } from '../config.js';

import { AnthropicAgentModel } from './anthropic-model.js';
import { GeminiAgentModel } from './gemini-model.js';
import { MockAgentModel } from './mock-model.js';
import {
  ModelError,
  type AgentModel,
  type ModelRequest,
  type ModelRole,
  type ModelTurn,
} from './model.js';

export interface ModelNames {
  router: string;
  specialist: string;
  fallback: string;
}

/**
 * A chat model for a role, from settings (ADR-106): a small one routes, a stronger one answers,
 * and a failure that can pass on a second try (a timeout, an overloaded provider) gets exactly
 * one more, on the fallback model. A request the provider rejected is not tried again.
 */
export class AgentModelFactory {
  constructor(
    readonly model: AgentModel,
    private readonly names: ModelNames,
  ) {}

  get provider(): string {
    return this.model.provider;
  }

  nameFor(role: ModelRole): string {
    return role === 'router' ? this.names.router : this.names.specialist;
  }

  async complete(request: ModelRequest): Promise<ModelTurn> {
    try {
      return await this.model.complete(request, this.nameFor(request.role));
    } catch (error) {
      if (!(error instanceof ModelError) || error.reason === 'rejected') throw error;
      if (request.signal.aborted) throw error;
      return this.model.complete(request, this.names.fallback);
    }
  }
}

export function createModelFactory(
  config: Pick<
    AgentConfig,
    | 'AGENT_MODEL_PROVIDER'
    | 'LLM_API_KEY'
    | 'AGENT_MODEL_ROUTER'
    | 'AGENT_MODEL_SPECIALIST'
    | 'AGENT_MODEL_FALLBACK'
    | 'AGENT_MODEL_TIMEOUT_MS'
    | 'AGENT_MODEL_THINKING_LEVEL'
  >,
): AgentModelFactory {
  const names: ModelNames = {
    router: config.AGENT_MODEL_ROUTER,
    specialist: config.AGENT_MODEL_SPECIALIST,
    fallback: config.AGENT_MODEL_FALLBACK,
  };
  if (config.AGENT_MODEL_PROVIDER === 'anthropic' && config.LLM_API_KEY) {
    return new AgentModelFactory(
      new AnthropicAgentModel({
        apiKey: config.LLM_API_KEY,
        timeoutMs: config.AGENT_MODEL_TIMEOUT_MS,
      }),
      names,
    );
  }
  if (config.AGENT_MODEL_PROVIDER === 'gemini' && config.LLM_API_KEY) {
    return new AgentModelFactory(
      new GeminiAgentModel({
        apiKey: config.LLM_API_KEY,
        timeoutMs: config.AGENT_MODEL_TIMEOUT_MS,
        thinkingLevel: config.AGENT_MODEL_THINKING_LEVEL,
      }),
      names,
    );
  }
  return new AgentModelFactory(new MockAgentModel(), {
    router: 'mock-router',
    specialist: 'mock-specialist',
    fallback: 'mock-fallback',
  });
}
