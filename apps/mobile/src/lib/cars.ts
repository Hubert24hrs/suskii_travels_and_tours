import type { Schemas } from '@suskii/api-client';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { useApp } from '../providers/app-provider';

export type CarsFeatures = Schemas['CarsFeatures'];

/**
 * Which Cars products and features the API has switched on (ADR-049). The query fails when the
 * API cannot be reached or does not answer, so screens can tell "off" from "unknown".
 */
export function useCarsFeaturesQuery(): UseQueryResult<CarsFeatures> {
  const { api } = useApp();
  return useQuery({
    queryKey: ['cars-features'],
    staleTime: 60_000,
    queryFn: async (): Promise<CarsFeatures> => {
      const { data } = await api.GET('/v1/cars/features');
      if (!data) throw new Error('Cars features unavailable');
      return data;
    },
  });
}

/**
 * The switched-on Cars features. Until the API answers, or when it cannot be reached, everything
 * counts as off: the app never offers what the API would 404.
 */
export function useCarsFeatures(): CarsFeatures | null {
  return useCarsFeaturesQuery().data ?? null;
}

export const anyCarsProduct = (features: CarsFeatures | null): boolean =>
  Boolean(features && (features.buses || features.rides || features.rentals));

/** Kilometres with one decimal for offers and summaries (metres in, rounded to 100 m). */
export const kilometres = (metres: number): number => Math.round(metres / 100) / 10;

/** A wall-clock date and time typed as YYYY-MM-DDTHH:mm. */
export const LOCAL_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
export const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** One value of a route parameter (Expo Router gives arrays for repeated keys). */
export const routeParam = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

/** An instant as the phone's wall time (YYYY-MM-DDTHH:mm), or '' when it is not one. */
export function deviceLocalTime(instant: string | undefined): string {
  const date = instant ? new Date(instant) : null;
  if (!date || Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
