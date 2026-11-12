import type { AgentModelUsage } from '@suskii/shared';

import type { AgentModelPrice, AgentModelPrices } from '../../config/env.schema';

const MILLION = 1_000_000;

/** The dearest price listed: what a model without a price of its own is charged at. */
function dearest(prices: AgentModelPrices): AgentModelPrice {
  return Object.values(prices).reduce<AgentModelPrice>(
    (max, price) => ({
      input: Math.max(max.input, price.input),
      output: Math.max(max.output, price.output),
      cacheRead: Math.max(max.cacheRead, price.cacheRead),
      cacheWrite: Math.max(max.cacheWrite, price.cacheWrite),
    }),
    { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  );
}

/**
 * What a run's model calls cost, in micro-dollars, from the usage each call reported and the
 * price list in settings (ADR-106): measured, never estimated. Each line rounds up. A model the
 * list does not know is charged at the dearest price, so a cap is reached early, never late,
 * and is named in `unpriced` for the log.
 */
export function runCostMicroUsd(
  usage: readonly AgentModelUsage[],
  prices: AgentModelPrices,
): { costMicroUsd: number; unpriced: string[] } {
  const unpriced: string[] = [];
  let cost = 0;
  for (const line of usage) {
    let price = prices[line.model];
    if (!price) {
      price = dearest(prices);
      unpriced.push(line.model);
    }
    cost += Math.ceil(
      (line.inputTokens * price.input +
        line.outputTokens * price.output +
        line.cacheReadTokens * price.cacheRead +
        line.cacheWriteTokens * price.cacheWrite) /
        MILLION,
    );
  }
  return { costMicroUsd: cost, unpriced: [...new Set(unpriced)] };
}
