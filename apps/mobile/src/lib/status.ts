import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { useApp } from '../providers/app-provider';

import type { Schemas } from './api';

export type StatusPage = Schemas['StatusPage'];
export type StatusIncident = StatusPage['incidents'][number];

/**
 * The service status (ADR-087), measured by the API every 30 s. Read again every minute while a
 * screen shows it; a failure is not news (the API may be the thing that is down).
 */
export function useStatusQuery(): UseQueryResult<StatusPage> {
  const { api } = useApp();
  return useQuery({
    queryKey: ['status'],
    staleTime: 60_000,
    refetchInterval: 60_000,
    queryFn: async (): Promise<StatusPage> => {
      const { data } = await api.GET('/v1/status');
      if (!data) throw new Error('Status unavailable');
      return data;
    },
  });
}

/** The open incident to show first: major before minor, then the newest. */
export function leadingIncident(incidents: readonly StatusIncident[]): StatusIncident | null {
  const open = incidents.filter((incident) => incident.resolvedAt === null);
  return open.find((incident) => incident.impact === 'major') ?? open[0] ?? null;
}
