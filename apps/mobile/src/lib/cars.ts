import type { Schemas } from '@suskii/api-client';
import { addDays, RENTAL_MAX_DAYS } from '@suskii/shared';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { useApp } from '../providers/app-provider';

import type { DateBounds } from './dates';

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

/** A wall-clock date and time as the API takes it, YYYY-MM-DDTHH:mm. */
export const LOCAL_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
export const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The time a rental's pickup and return take until another is chosen. */
export const RENTAL_DEFAULT_TIME = '10:00';

/**
 * How far ahead a pickup can be: the API's default `RENTAL_MAX_ADVANCE_DAYS`. The API checks its
 * own setting; the picker offers no day after this one.
 */
const RENTAL_ADVANCE_DAYS = 180;

/**
 * How far ahead a ride can be booked: the API's default `RIDE_SCHEDULE_MAX_DAYS`, the "7 days"
 * its message names. The API checks its own setting.
 */
const RIDE_SCHEDULE_DAYS = 7;

/**
 * The days a rental's pickup and return can fall on, from `today` where the car is (ADR-114):
 * a pickup within the API's horizon, a return from the pickup's day to the longest rental after
 * the last pickup day. The API checks the period again (lead time, horizon, length).
 */
export function rentalDates(
  today: string,
  pickupAt: string,
): { pickup: DateBounds; return: DateBounds } {
  const lastPickup = addDays(today, RENTAL_ADVANCE_DAYS);
  const lastReturn = addDays(lastPickup, RENTAL_MAX_DAYS);
  const pickupDay = LOCAL_DATE_TIME.test(pickupAt) ? pickupAt.slice(0, 10) : today;
  const firstReturn = pickupDay < today ? today : pickupDay > lastReturn ? lastReturn : pickupDay;
  return {
    pickup: { min: today, max: lastPickup },
    return: { min: firstReturn, max: lastReturn },
  };
}

/**
 * The days a ride can be booked for. The time is the phone's wall time (the request sends the
 * instant it names), so today is the phone's.
 */
export const rideDates = (today: string): DateBounds => ({
  min: today,
  max: addDays(today, RIDE_SCHEDULE_DAYS),
});

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

/** A driver's age as typed, when it is a whole number a rental can take (18 to 99). */
export function driverAgeOf(text: string): number | null {
  const age = Number(text);
  return /^\d{2}$/.test(text.trim()) && age >= 18 && age <= 99 ? age : null;
}
