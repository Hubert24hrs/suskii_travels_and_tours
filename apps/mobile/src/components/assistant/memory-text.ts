import {
  AGENT_MEMORY_BUDGETS,
  AGENT_MEMORY_SEATS,
  CABIN_CLASSES,
  agentMemoryAirlines,
  type AgentMemoryKey,
} from '@suskii/shared';

import type { useT } from '../../providers/app-provider';

type T = ReturnType<typeof useT>['t'];

const within = <Option extends string>(options: readonly Option[], value: string): Option | null =>
  options.find((option) => option === value) ?? null;

/**
 * A remembered preference's value in the traveller's words (ADR-105): the name of a cabin, a
 * seat or what comes first; an airport or airline code as it is, since a code reads the same
 * in every language. A value this build does not know is shown as stored.
 */
export function memoryValueText(t: T, key: AgentMemoryKey, value: string): string {
  if (key === 'cabin') {
    const cabin = within(CABIN_CLASSES, value);
    return cabin ? t(`cabins.${cabin}`) : value;
  }
  if (key === 'seat') {
    const seat = within(AGENT_MEMORY_SEATS, value);
    return seat ? t(`assistant.memory.seats.${seat}`) : value;
  }
  if (key === 'budget') {
    const budget = within(AGENT_MEMORY_BUDGETS, value);
    return budget ? t(`assistant.memory.budgets.${budget}`) : value;
  }
  return key === 'airlines' ? agentMemoryAirlines(value).join(', ') : value;
}
