'use client';

import { useInfiniteQuery } from '@tanstack/react-query';

import { ApiProblem } from './api';

/** The data of an openapi-fetch result, or the problem it failed with (thrown for TanStack). */
export function unwrap<T>(result: { data?: T; error?: unknown }): T {
  if (result.error !== undefined || result.data === undefined) throw new ApiProblem(result.error);
  return result.data;
}

/**
 * Keyset pages (`?cursor=` + `nextCursor`). The key starts with the method and path, like the
 * $api hooks, so invalidating a path refreshes these lists too.
 */
export function useCursorPages<T extends { nextCursor: string | null }>(
  key: readonly unknown[],
  fetchPage: (cursor: string | undefined) => Promise<T>,
) {
  return useInfiniteQuery({
    queryKey: key,
    queryFn: ({ pageParam }) => fetchPage(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}
