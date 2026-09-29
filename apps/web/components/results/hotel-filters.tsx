'use client';

import { useFormatters } from '@suskii/i18n/react';
import { Button } from '@suskii/ui-web';

import type { Schemas } from '../../lib/browser-api';
import { CheckboxField, NativeSelect } from '../search/native-select';

import { useResultsT } from './results-messages';
import { toggle } from './use-url-params';

export const BOARDS = ['room_only', 'breakfast_included', 'half_board', 'full_board'] as const;
export type Board = (typeof BOARDS)[number];
const RATINGS = [9, 8, 7, 6];

export interface HotelFilterState {
  stars: string[];
  minRating: number | undefined;
  freeCancellation: boolean;
  amenities: string[];
  areas: string[];
  board: Board | undefined;
  maxPrice: number | undefined;
}

export const EMPTY_HOTEL_FILTERS: HotelFilterState = {
  stars: [],
  minRating: undefined,
  freeCancellation: false,
  amenities: [],
  areas: [],
  board: undefined,
  maxPrice: undefined,
};

function priceSteps(range: { min: Schemas['Money']; max: Schemas['Money'] }): number[] {
  const { min, max } = range;
  if (max.amountMinor <= min.amountMinor) return [];
  const size = (max.amountMinor - min.amountMinor) / 4;
  return [1, 2, 3, 4].map((step) => Math.ceil(min.amountMinor + size * step));
}

export function HotelFilters({
  facets,
  currency,
  value,
  onChange,
}: {
  facets: Schemas['HotelFacets'];
  currency: string;
  value: HotelFilterState;
  onChange: (next: HotelFilterState) => void;
}) {
  const { t } = useResultsT();
  const format = useFormatters();
  const set = (patch: Partial<HotelFilterState>) => onChange({ ...value, ...patch });
  const amenityLabel = (code: string): string => {
    const key = `results.amenities.${code}`;
    const label = t(key as Parameters<typeof t>[0]);
    return label === key ? code.replaceAll('_', ' ') : label;
  };
  const prices = facets.price ? priceSteps(facets.price) : [];

  return (
    <div className="flex flex-col gap-6">
      {prices.length > 0 ? (
        <NativeSelect
          id="hotel-max-price"
          label={t('results.filters.maxPrice')}
          value={value.maxPrice === undefined ? '' : String(value.maxPrice)}
          onChange={(event) =>
            set({ maxPrice: event.target.value ? Number(event.target.value) : undefined })
          }
          options={[
            { value: '', label: t('results.filters.any') },
            ...prices.map((minor) => ({
              value: String(minor),
              label: t('results.filters.upToPrice', {
                price: format.moneyFrom({ amountMinor: minor, currency }),
              }),
            })),
          ]}
        />
      ) : null}

      {facets.stars.length > 0 ? (
        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 font-heading text-body font-bold text-heading">
            {t('results.filters.stars')}
          </legend>
          {facets.stars.map((entry) => (
            <CheckboxField
              key={entry.stars}
              name="stars"
              label={`${t('results.filters.starOption', { count: entry.stars })} · ${format.money(entry.minPrice)}`}
              checked={value.stars.includes(String(entry.stars))}
              onChange={() => set({ stars: toggle(value.stars, String(entry.stars)) })}
            />
          ))}
        </fieldset>
      ) : null}

      <NativeSelect
        id="hotel-min-rating"
        label={t('results.filters.rating')}
        value={value.minRating === undefined ? '' : String(value.minRating)}
        onChange={(event) =>
          set({ minRating: event.target.value ? Number(event.target.value) : undefined })
        }
        options={[
          { value: '', label: t('results.filters.any') },
          ...RATINGS.map((score) => ({
            value: String(score),
            label: t('results.filters.ratingOption', { score }),
          })),
        ]}
      />

      {facets.boards.length > 1 ? (
        <NativeSelect
          id="hotel-board"
          label={t('results.filters.board')}
          value={value.board ?? ''}
          onChange={(event) =>
            set({
              board: BOARDS.includes(event.target.value as Board)
                ? (event.target.value as Board)
                : undefined,
            })
          }
          options={[
            { value: '', label: t('results.filters.any') },
            ...facets.boards.map((entry) => ({
              value: entry.board,
              label: t(`results.boards.${entry.board}`),
            })),
          ]}
        />
      ) : null}

      {facets.freeCancellation > 0 ? (
        <CheckboxField
          name="freeCancellation"
          label={t('results.filters.freeCancellation')}
          checked={value.freeCancellation}
          onChange={() => set({ freeCancellation: !value.freeCancellation })}
        />
      ) : null}

      {facets.areas.length > 1 ? (
        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 font-heading text-body font-bold text-heading">
            {t('results.filters.areas')}
          </legend>
          {facets.areas.map((entry) => (
            <CheckboxField
              key={entry.area}
              name="areas"
              label={`${entry.area} (${entry.count})`}
              checked={value.areas.includes(entry.area)}
              onChange={() => set({ areas: toggle(value.areas, entry.area) })}
            />
          ))}
        </fieldset>
      ) : null}

      {facets.amenities.length > 0 ? (
        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 font-heading text-body font-bold text-heading">
            {t('results.filters.amenities')}
          </legend>
          {facets.amenities.slice(0, 10).map((entry) => (
            <CheckboxField
              key={entry.amenity}
              name="amenities"
              label={`${amenityLabel(entry.amenity)} (${entry.count})`}
              checked={value.amenities.includes(entry.amenity)}
              onChange={() => set({ amenities: toggle(value.amenities, entry.amenity) })}
            />
          ))}
        </fieldset>
      ) : null}

      <Button variant="ghost" onClick={() => onChange(EMPTY_HOTEL_FILTERS)}>
        {t('results.filters.clear')}
      </Button>
    </div>
  );
}
