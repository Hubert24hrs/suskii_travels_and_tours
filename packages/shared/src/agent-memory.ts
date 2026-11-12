import { CABIN_CLASSES } from './search-limits';

/**
 * What the assistant may remember about a traveller (ADR-105): a short list of named travel
 * preferences, kept only after the traveller agreed, shown to them, changeable and erasable.
 * No free text, so nothing personal can be written into it; and no sensitive category: a meal
 * preference can show a religion or a health condition (ADR-093) and is not on the list.
 * Kept free of schemas so the website's small entry (`@suskii/shared/lite`) can carry it.
 */
export const AGENT_MEMORY_KEYS = ['home_airport', 'cabin', 'seat', 'airlines', 'budget'] as const;
export type AgentMemoryKey = (typeof AGENT_MEMORY_KEYS)[number];

export const AGENT_MEMORY_SEATS = ['window', 'aisle'] as const;
/** How the traveller likes results weighed: the lowest price, a balance, or comfort first. */
export const AGENT_MEMORY_BUDGETS = ['lowest', 'balanced', 'comfort'] as const;
/** Airlines one traveller may name as preferred. */
export const AGENT_MEMORY_AIRLINES_MAX = 3;

export const isAgentMemoryKey = (value: string): value is AgentMemoryKey =>
  (AGENT_MEMORY_KEYS as readonly string[]).includes(value);

const oneOf = (options: readonly string[], value: string): string | null =>
  options.includes(value) ? value : null;

/**
 * The value as it is stored, or null when it is not one this key takes: an airport or airline
 * code in capitals, one of the listed choices otherwise. Whether a code names a real airport
 * or airline is the API's check against the catalog, not this one.
 */
export function agentMemoryValue(key: AgentMemoryKey, raw: string): string | null {
  const value = raw.trim();
  switch (key) {
    case 'home_airport': {
      const code = value.toUpperCase();
      return /^[A-Z]{3}$/.test(code) ? code : null;
    }
    case 'cabin':
      return oneOf(CABIN_CLASSES, value.toLowerCase());
    case 'seat':
      return oneOf(AGENT_MEMORY_SEATS, value.toLowerCase());
    case 'budget':
      return oneOf(AGENT_MEMORY_BUDGETS, value.toLowerCase());
    case 'airlines': {
      const codes = [
        ...new Set(
          value
            .toUpperCase()
            .split(/[\s,]+/)
            .filter(Boolean),
        ),
      ];
      const valid =
        codes.length >= 1 &&
        codes.length <= AGENT_MEMORY_AIRLINES_MAX &&
        codes.every((code) => /^[A-Z0-9]{2}$/.test(code));
      return valid ? codes.join(',') : null;
    }
  }
}

/** The airline codes of a stored `airlines` value. */
export const agentMemoryAirlines = (stored: string): string[] => stored.split(',').filter(Boolean);
