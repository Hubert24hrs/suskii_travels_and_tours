import { describe, expect, it } from 'vitest';

import {
  GROUNDED_PASS_RATE,
  loadGroundingSuite,
  runGroundingEval,
  summariseGrounding,
} from './grounding.js';

describe('grounding eval, recorded', () => {
  it('shows no invention and at least 90% of the grounded answers', async () => {
    const cases = loadGroundingSuite();
    const { results } = await runGroundingEval(cases);
    const summary = summariseGrounding(results);
    // Nothing a tool did not return reached the traveller, in any language.
    expect(results.filter((result) => result.invented.length > 0)).toEqual([]);
    expect(summary.invented).toBe(0);
    // One grounded case is a known limit kept in view: arithmetic the tools did not do.
    expect(
      results
        .filter((result) => result.expect === 'grounded' && !result.passed)
        .map((result) => [result.id, result.outcome]),
    ).toEqual([['g16', 'guard_blocked']]);
    expect(summary.rate).toBeGreaterThanOrEqual(GROUNDED_PASS_RATE);
    expect(summary.ok).toBe(true);
  });

  it('lets a model put an invention right, and sends a notice when it will not', async () => {
    const cases = loadGroundingSuite();
    const { results } = await runGroundingEval(cases);
    const byId = new Map(results.map((result) => [result.id, result]));
    for (const entry of cases.filter((candidate) => candidate.expect === 'fabricated')) {
      const result = byId.get(entry.id);
      if (entry.recorded.rewrite === undefined) {
        // A model that repeats itself: the traveller gets a notice, not the invention.
        expect([entry.id, result?.outcome, result?.shown]).toEqual([entry.id, 'guard_blocked', '']);
      } else {
        expect([entry.id, result?.outcome, result?.shown]).toEqual([
          entry.id,
          'answered',
          entry.recorded.rewrite,
        ]);
      }
    }
  });

  it('holds both kinds of case in every language the assistant answers in', () => {
    const cases = loadGroundingSuite();
    expect(cases.filter((entry) => entry.expect === 'grounded').length).toBeGreaterThanOrEqual(15);
    expect(cases.filter((entry) => entry.expect === 'fabricated').length).toBeGreaterThanOrEqual(
      15,
    );
    const locales = new Set(
      cases
        .filter((entry) => entry.expect === 'fabricated')
        .map((entry) => entry.locale.slice(0, 2)),
    );
    expect([...locales].sort()).toEqual(['ar', 'en', 'fr', 'pt', 'sw']);
    expect(new Set(cases.map((entry) => entry.id)).size).toBe(cases.length);
  });
});
