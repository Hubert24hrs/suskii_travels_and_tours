import type { Schemas } from '@suskii/api-client';
import { useQuery } from '@tanstack/react-query';

import { useApp } from '../providers/app-provider';

export type CarsFeatures = Schemas['CarsFeatures'];

/**
 * Which Cars products and features the API has switched on (ADR-049). Until it answers, or when
 * it cannot be reached, everything counts as off: the app never offers what the API would 404.
 */
export function useCarsFeatures(): CarsFeatures | null {
  const { api } = useApp();
  const query = useQuery({
    queryKey: ['cars-features'],
    staleTime: 60_000,
    queryFn: async (): Promise<CarsFeatures | null> => {
      const { data } = await api.GET('/v1/cars/features');
      return data ?? null;
    },
  });
  return query.data ?? null;
}

export const anyCarsProduct = (features: CarsFeatures | null): boolean =>
  Boolean(features && (features.buses || features.rides || features.rentals));

/** Kilometres with one decimal for offers and summaries (metres in, rounded to 100 m). */
export const kilometres = (metres: number): number => Math.round(metres / 100) / 10;

/** A wall-clock date and time typed as YYYY-MM-DDTHH:mm. */
export const LOCAL_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
export const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
