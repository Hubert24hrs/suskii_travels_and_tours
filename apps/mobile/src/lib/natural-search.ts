import { NATURAL_SEARCH_PROBLEMS } from '@suskii/shared';
import { useQuery } from '@tanstack/react-query';
import { getCalendars } from 'expo-localization';

import { useApp } from '../providers/app-provider';

import { problemSlug, type ApiClient, type Schemas } from './api';

export type NaturalSearchResult = Schemas['NaturalSearchResult'];
export type NaturalSearchStatus = Schemas['NaturalSearchStatus'];

/** What the box does next: fill the form, or keep the text and point to the form. */
export type DescribeOutcome =
  | { kind: 'filled'; result: NaturalSearchResult }
  | { kind: 'notUnderstood' | 'overLimit' | 'unavailable' };

/**
 * Whether the API offers AI trip search (ADR-061). The box is optional: until the API answers,
 * or when it cannot be reached, it stays hidden and the form works as always.
 */
export function useNaturalSearchStatus(): NaturalSearchStatus | null {
  const { api } = useApp();
  const query = useQuery({
    queryKey: ['natural-search-status'],
    staleTime: 60_000,
    queryFn: async (): Promise<NaturalSearchStatus> => {
      const { data } = await api.GET('/v1/flights/natural-search');
      if (!data) throw new Error('AI trip search status unavailable');
      return data;
    },
  });
  return query.data?.enabled ? query.data : null;
}

/** The phone's IANA zone, so "next Friday" means the traveller's Friday. */
function deviceTimeZone(): string | undefined {
  try {
    return getCalendars()[0]?.timeZone ?? undefined;
  } catch {
    return undefined;
  }
}

/** Turns a description into a draft of the flight form; every failure is an outcome, never a throw. */
export async function describeTrip(api: ApiClient, text: string): Promise<DescribeOutcome> {
  const timeZone = deviceTimeZone();
  try {
    const { data, error, response } = await api.POST('/v1/flights/natural-search', {
      body: { text, ...(timeZone ? { timeZone } : {}) },
    });
    if (data) return { kind: 'filled', result: data };
    const slug = problemSlug(error);
    if (slug === NATURAL_SEARCH_PROBLEMS.notUnderstood) return { kind: 'notUnderstood' };
    if (slug === NATURAL_SEARCH_PROBLEMS.budgetExceeded || response.status === 429) {
      return { kind: 'overLimit' };
    }
    return { kind: 'unavailable' };
  } catch {
    return { kind: 'unavailable' };
  }
}
