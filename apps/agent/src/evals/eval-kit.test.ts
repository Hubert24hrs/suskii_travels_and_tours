import { describe, expect, it } from 'vitest';

import { EvalGateway, evalContext, fitsParameters, loadTools } from './eval-kit.js';

describe('the eval gateway (ADR-106)', () => {
  const tools = loadTools();
  const remember = tools.find((tool) => tool.name === 'memory.remember');

  it('knows what fits a tool: required names, and a value from a fixed set', () => {
    expect(remember).toBeDefined();
    const parameters = remember?.parameters;
    expect(fitsParameters(parameters, { key: 'seat', value: 'aisle' })).toBe(true);
    // There is no key for a meal, a health need or anything else off the list (ADR-105).
    expect(fitsParameters(parameters, { key: 'meal', value: 'diabetic' })).toBe(false);
    expect(fitsParameters(parameters, { key: 'religion', value: 'x' })).toBe(false);
    expect(fitsParameters(parameters, { key: 'seat' })).toBe(false);
    // A tool without parameters takes anything it is given, as the registry's schema strips it.
    expect(fitsParameters({ type: 'object', properties: {} }, { anything: 1 })).toBe(true);
    expect(
      fitsParameters(
        { type: 'object', properties: {}, additionalProperties: false },
        { anything: 1 },
      ),
    ).toBe(false);
    expect(fitsParameters(undefined, {})).toBe(true);
  });

  it('refuses arguments that do not fit before a commit becomes a confirmation', async () => {
    const gateway = new EvalGateway(
      tools,
      ['catalog', 'search', 'quotes', 'support', 'account'],
      {},
    );
    const call = (key: string) =>
      gateway.call('memory.remember', {
        grant: 'eval',
        agent: 'concierge',
        arguments: { key, value: 'aisle' },
      });
    expect(await call('meal')).toMatchObject({ status: 'denied', reason: 'invalid' });
    expect(await call('seat')).toMatchObject({ reason: 'confirmation_required' });
    expect(gateway.attempts.map((attempt) => attempt.outcome)).toEqual([
      'invalid',
      'confirmation_required',
    ]);
    expect(gateway.ranOutsideGrant).toEqual([]);
  });

  it('runs a staff case as a super admin in the console, who reaches every staff agent', () => {
    const staff = evalContext({ audience: 'staff', locale: 'en-NG', signedIn: false });
    expect(staff).toMatchObject({ audience: 'staff', channel: 'console', signedIn: true });
    expect([...staff.agents].sort()).toEqual(
      [
        'business_intelligence',
        'executive',
        'finance_prep',
        'marketing',
        'operations',
        'price_intel',
      ].sort(),
    );
    const traveller = evalContext({ audience: 'customer', locale: 'fr', signedIn: false });
    expect(traveller).toMatchObject({ audience: 'customer', channel: 'web', signedIn: false });
    expect(traveller.agents).not.toContain('executive');
  });
});
