'use client';

import { useSearchParams } from 'next/navigation';
import { useCallback } from 'react';

/**
 * Result filters and sort live in the URL, so a filtered list can be shared and survives a
 * reload. Updates use `history.replaceState`, which Next.js syncs into `useSearchParams` without
 * re-rendering the server page.
 */
export function useUrlParams(): [
  URLSearchParams,
  (changes: Record<string, string | null | undefined>) => void,
] {
  const params = useSearchParams();
  const update = useCallback((changes: Record<string, string | null | undefined>) => {
    const next = new URLSearchParams(window.location.search);
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === undefined || value === '') next.delete(key);
      else next.set(key, value);
    }
    const query = next.toString();
    window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}`);
  }, []);
  return [new URLSearchParams(params.toString()), update];
}

/** Comma-separated list parameter; unknown values are dropped. */
export function listParam<T extends string>(
  params: URLSearchParams,
  key: string,
  allowed?: readonly T[],
): T[] {
  const values = (params.get(key) ?? '').split(',').filter(Boolean);
  return (
    allowed ? values.filter((value) => (allowed as readonly string[]).includes(value)) : values
  ) as T[];
}

export function numberParam(params: URLSearchParams, key: string): number | undefined {
  const value = params.get(key);
  return value && /^\d{1,12}$/.test(value) ? Number(value) : undefined;
}

export const toggle = <T>(list: readonly T[], value: T): T[] =>
  list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
