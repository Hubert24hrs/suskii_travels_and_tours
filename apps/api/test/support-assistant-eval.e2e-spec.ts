import { MockLlmProvider } from '../src/ai-search/mock-llm-provider';
import { SupportAnswerer } from '../src/support/assistant/support-answerer';

import {
  loadAssistantEvalSuite,
  recordAssistantAnswers,
  runAssistantEval,
  summarise,
} from './helpers/support-assistant-eval';

/**
 * The after-hours assistant eval (ADR-085) with recorded model answers: the whole pipeline
 * around the model (scrubbing, structured output, validation, the grounding checks and the
 * grading) on every change. The recorded answers include wrong ones that the checks must turn
 * into handovers. `pnpm --filter @suskii/api eval:support-assistant` grades the real model.
 */
describe('support assistant eval (recorded answers)', () => {
  const suite = loadAssistantEvalSuite();

  it('covers answers, handovers and the cases in between', () => {
    expect(suite.cases).toHaveLength(40);
    const expected = new Set(suite.cases.map((evalCase) => evalCase.expect));
    expect([...expected].sort()).toEqual(['answer', 'either', 'handover']);
    expect(new Set(suite.cases.map((evalCase) => evalCase.id)).size).toBe(suite.cases.length);
  });

  it('passes every case, and the checks catch every wrong recorded answer', async () => {
    const mock = new MockLlmProvider();
    recordAssistantAnswers(mock, suite);
    const results = await runAssistantEval(new SupportAnswerer(mock), suite);
    const failures = results.filter((result) => !result.passed);
    expect(failures.map((result) => `${result.id}: ${result.problem ?? ''}`)).toEqual([]);
    expect(summarise(results)).toMatchObject({ passed: 40, unsafe: 0, ok: true });

    // Recorded answers that claim to answer a handover case are the deliberately wrong ones:
    // each must have been stopped by a check, not passed through.
    const caught = suite.cases.filter(
      (evalCase) => evalCase.expect === 'handover' && evalCase.recorded.answerable,
    );
    expect(caught.length).toBeGreaterThanOrEqual(6);
    for (const evalCase of caught) {
      const result = results.find((candidate) => candidate.id === evalCase.id);
      expect(result?.outcome.kind).toBe('handover');
    }
  });
});
