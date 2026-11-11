import { beforeAll, describe, expect, it } from 'vitest';

import { EVAL_SUITE_TIMEOUT_MS } from './eval-kit.js';

import {
  loadRoutingSuite,
  ROUTING_PASS_RATE,
  runRoutingEval,
  summariseRouting,
} from './routing.js';

describe('routing eval, recorded', () => {
  const cases = loadRoutingSuite();
  let results: Awaited<ReturnType<typeof runRoutingEval>>['results'] = [];

  // The suite is replayed once for every test here: the tests read what came of it.
  beforeAll(async () => {
    ({ results } = await runRoutingEval(cases));
  }, EVAL_SUITE_TIMEOUT_MS);

  it('routes at least 95% of the suite, and the grader sees every miss', () => {
    const summary = summariseRouting(results);
    // Three recorded answers are wrong on purpose: an eval that cannot fail measures nothing.
    const wrong = cases.filter((entry) => !entry.expect.includes(entry.recorded)).map((c) => c.id);
    expect(wrong).toHaveLength(3);
    expect(
      results.filter((result) => !result.passed).map((result) => [result.id, result.agent]),
    ).toEqual(
      cases.filter((entry) => wrong.includes(entry.id)).map((entry) => [entry.id, entry.recorded]),
    );
    expect(summary.passed).toBe(cases.length - 3);
    expect(summary.rate).toBeGreaterThanOrEqual(ROUTING_PASS_RATE);
    expect(summary.ok).toBe(true);
  });

  it('covers every customer agent and every language the assistant answers in', () => {
    const agents = new Set(cases.map((entry) => entry.expect[0]));
    expect([...agents].sort()).toEqual(
      [
        'bookings',
        'cars',
        'concierge',
        'disruption',
        'flights',
        'hotels',
        'payments',
        'support',
        'tours',
        'trip_builder',
      ].sort(),
    );
    const locales = new Set(cases.map((entry) => entry.locale.slice(0, 2)));
    expect([...locales].sort()).toEqual(['ar', 'en', 'fr', 'pt', 'sw']);
    expect(new Set(cases.map((entry) => entry.id)).size).toBe(cases.length);
  });

  it('sends the plainest requests by rule, without a model call, and never wrongly', () => {
    const byRule = results.filter((result) => result.byRule);
    expect(byRule.length).toBeGreaterThanOrEqual(10);
    expect(byRule.filter((result) => !result.passed)).toEqual([]);
  });
});
