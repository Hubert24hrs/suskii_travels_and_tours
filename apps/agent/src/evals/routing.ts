import { CUSTOMER_AGENTS, type AgentModelUsage, type AgentName } from '@suskii/shared';
import { z } from 'zod';

import { addUsage, loadSuite, loadTools, routeTo, runMessage, type LiveModel } from './eval-kit.js';

/**
 * The routing eval (ADR-106): does a traveller's message reach the specialist who should answer
 * it, in the languages the assistant answers in? Graded by rule: the specialist that answered
 * must be one of the case's acceptable ones.
 */
export const ROUTING_PASS_RATE = 0.95;

const agent = z.enum(CUSTOMER_AGENTS);
const routingCase = z.object({
  id: z.string(),
  message: z.string().min(1),
  locale: z.string().default('en-NG'),
  signedIn: z.boolean().default(true),
  /** The specialists that would be right; the first is the best. */
  expect: z.array(agent).min(1),
  /** A hand-written router answer for CI; a few are wrong on purpose. */
  recorded: agent,
});
export type RoutingCase = z.infer<typeof routingCase>;

export const loadRoutingSuite = (): RoutingCase[] =>
  loadSuite('routing.json', z.object({ cases: z.array(routingCase).min(40) })).cases;

export interface RoutingResult {
  id: string;
  message: string;
  expect: AgentName[];
  agent: AgentName;
  /** A rule sent it there without asking the model. */
  byRule: boolean;
  passed: boolean;
}

export async function runRoutingEval(
  cases: readonly RoutingCase[],
  live?: LiveModel,
): Promise<{ results: RoutingResult[]; usage: Map<string, AgentModelUsage> }> {
  const tools = loadTools();
  const usage = new Map<string, AgentModelUsage>();
  const results: RoutingResult[] = [];
  for (const entry of cases) {
    const { end, routerAsked } = await runMessage({
      text: entry.message,
      tools,
      results: {},
      signedIn: entry.signedIn,
      locale: entry.locale,
      recorded: {
        router: [routeTo(entry.recorded)],
        // Routing is what is measured: the specialist says one line that needs no tool.
        specialist: [{ text: 'Recorded answer for the routing eval.' }],
      },
      live: live ? { role: 'router', model: live } : undefined,
      maxSteps: 3,
    });
    addUsage(
      usage,
      end.usage.filter((line) => line.role === 'router'),
    );
    results.push({
      id: entry.id,
      message: entry.message,
      expect: entry.expect,
      agent: end.agent,
      byRule: !routerAsked,
      passed: (entry.expect as readonly AgentName[]).includes(end.agent),
    });
  }
  return { results, usage };
}

export function summariseRouting(results: readonly RoutingResult[]): {
  passed: number;
  rate: number;
  byRule: number;
  ok: boolean;
} {
  const passed = results.filter((result) => result.passed).length;
  const rate = results.length === 0 ? 0 : passed / results.length;
  return {
    passed,
    rate,
    byRule: results.filter((result) => result.byRule).length,
    ok: rate >= ROUTING_PASS_RATE,
  };
}
