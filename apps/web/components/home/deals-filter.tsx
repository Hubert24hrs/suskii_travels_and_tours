'use client';

import { FilterChip } from '@suskii/ui-web';
import { useState, type ReactNode } from 'react';

export interface DealsFilterProps {
  label: string;
  allLabel: string;
  origins: { code: string; cityName: string }[];
  /** Cards rendered on the server; the client only chooses which to show. */
  items: { key: string; origin: string; card: ReactNode }[];
  /** How many cards to show at once (two rows of four on desktop). */
  limit: number;
}

/**
 * Origin chips over the deal cards: a swipeable carousel on mobile, a four-column grid on
 * desktop. Filtering happens on the client over server-rendered cards.
 */
export function DealsFilter({ label, allLabel, origins, items, limit }: DealsFilterProps) {
  const [origin, setOrigin] = useState<string | null>(null);
  const visible = items.filter((item) => !origin || item.origin === origin).slice(0, limit);
  return (
    <div className="flex flex-col gap-4">
      <div
        role="group"
        aria-label={label}
        className="relative -mx-4 flex gap-2 overflow-x-auto px-4 pb-1"
      >
        <FilterChip selected={origin === null} onClick={() => setOrigin(null)}>
          {allLabel}
        </FilterChip>
        {origins.map((entry) => (
          <FilterChip
            key={entry.code}
            selected={origin === entry.code}
            onClick={() => setOrigin(entry.code)}
          >
            {entry.cityName}
          </FilterChip>
        ))}
      </div>
      <ul
        aria-live="polite"
        className="relative -mx-4 flex snap-x snap-mandatory scroll-px-4 gap-4 overflow-x-auto px-4 pb-2 lg:mx-0 lg:grid lg:grid-cols-4 lg:overflow-visible lg:px-0"
      >
        {visible.map((item) => (
          <li
            key={item.key}
            data-origin={item.origin}
            className="flex w-4/5 shrink-0 snap-start sm:w-1/2 md:w-1/3 lg:w-auto"
          >
            {item.card}
          </li>
        ))}
      </ul>
    </div>
  );
}
