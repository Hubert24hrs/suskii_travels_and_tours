import type { AgentModelUsage } from '@suskii/shared';

import { DEFAULT_AGENT_MODEL_PRICES, type AgentModelPrices } from '../../config/env.schema';

import { runCostMicroUsd } from './agent-pricing';

const line = (over: Partial<AgentModelUsage> = {}): AgentModelUsage => ({
  role: 'specialist',
  provider: 'anthropic',
  model: 'claude-sonnet-5-5',
  calls: 1,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  ...over,
});

describe('runCostMicroUsd', () => {
  it('prices every kind of token of every line from the list', () => {
    const { costMicroUsd, unpriced } = runCostMicroUsd(
      [
        // 400 * $0.10 + 20 * $0.50 per million tokens = 50 micro-dollars.
        line({ role: 'router', model: 'claude-haiku-5-5', inputTokens: 400, outputTokens: 20 }),
        // 3000 * $2 + 500 * $10 + 10,000 * $0.10 + 1000 * $2.50 = 14,500 micro-dollars.
        line({
          inputTokens: 3000,
          outputTokens: 500,
          cacheReadTokens: 10_000,
          cacheWriteTokens: 1000,
        }),
      ],
      DEFAULT_AGENT_MODEL_PRICES,
    );
    expect(costMicroUsd).toBe(50 + 14_500);
    expect(unpriced).toEqual([]);
  });

  it('rounds each line up, so a part of a micro-dollar is never free', () => {
    // One input token of the small model is a tenth of a micro-dollar.
    const one = line({ model: 'claude-haiku-5-5', inputTokens: 1 });
    expect(runCostMicroUsd([one], DEFAULT_AGENT_MODEL_PRICES).costMicroUsd).toBe(1);
    expect(runCostMicroUsd([one, one, one], DEFAULT_AGENT_MODEL_PRICES).costMicroUsd).toBe(3);
  });

  it('charges a model the list does not know at the dearest price, and names it once', () => {
    const prices: AgentModelPrices = {
      small: { input: 100, output: 900, cacheRead: 10, cacheWrite: 50 },
      large: { input: 2_000_000, output: 400, cacheRead: 5, cacheWrite: 3_000_000 },
    };
    const unknown = line({
      model: 'someone-elses-model',
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      cacheReadTokens: 1_000_000,
      cacheWriteTokens: 1_000_000,
    });
    const { costMicroUsd, unpriced } = runCostMicroUsd([unknown, unknown], prices);
    // The dearest of each column, whichever model it belongs to.
    expect(costMicroUsd).toBe(2 * (2_000_000 + 900 + 10 + 3_000_000));
    expect(unpriced).toEqual(['someone-elses-model']);
  });

  it('costs nothing for a run that called no model, or only the mock', () => {
    expect(runCostMicroUsd([], DEFAULT_AGENT_MODEL_PRICES)).toEqual({
      costMicroUsd: 0,
      unpriced: [],
    });
    const mock = line({ provider: 'mock', model: 'mock-specialist', inputTokens: 5000 });
    expect(runCostMicroUsd([mock], DEFAULT_AGENT_MODEL_PRICES).costMicroUsd).toBe(0);
  });
});
