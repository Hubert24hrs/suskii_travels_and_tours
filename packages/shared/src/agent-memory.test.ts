import { describe, expect, it } from 'vitest';

import {
  AGENT_MEMORY_KEYS,
  agentMemoryAirlines,
  agentMemoryValue,
  isAgentMemoryKey,
} from './agent-memory';

describe('agentMemoryValue', () => {
  it('takes codes in any case and stores them in capitals', () => {
    expect(agentMemoryValue('home_airport', ' los ')).toBe('LOS');
    expect(agentMemoryValue('home_airport', 'Lagos')).toBeNull();
    expect(agentMemoryValue('home_airport', 'LO')).toBeNull();
    expect(agentMemoryValue('airlines', 'kq, et')).toBe('KQ,ET');
    expect(agentMemoryValue('airlines', 'P4 KQ P4')).toBe('P4,KQ');
    expect(agentMemoryAirlines('KQ,ET')).toEqual(['KQ', 'ET']);
  });

  it('keeps to the listed choices, and to three airlines', () => {
    expect(agentMemoryValue('cabin', 'Business')).toBe('business');
    expect(agentMemoryValue('cabin', 'upper')).toBeNull();
    expect(agentMemoryValue('seat', 'window')).toBe('window');
    expect(agentMemoryValue('seat', 'middle')).toBeNull();
    expect(agentMemoryValue('budget', 'comfort')).toBe('comfort');
    expect(agentMemoryValue('budget', '500 dollars')).toBeNull();
    expect(agentMemoryValue('airlines', 'KQ,ET,QR,EK')).toBeNull();
    expect(agentMemoryValue('airlines', '')).toBeNull();
    expect(agentMemoryValue('airlines', 'Kenya Airways')).toBeNull();
  });

  it('has no place for free text: nothing personal can be written into a preference', () => {
    for (const key of AGENT_MEMORY_KEYS) {
      for (const text of ['ada@example.com', '+234 801 234 5678', 'vegetarian', 'A1234567']) {
        expect(agentMemoryValue(key, text)).toBeNull();
      }
    }
    // A meal is not something the assistant remembers (ADR-093, ADR-105).
    expect(isAgentMemoryKey('meal')).toBe(false);
    expect(isAgentMemoryKey('seat')).toBe(true);
  });
});
