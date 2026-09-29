'use client';

import { useFormatters } from '@suskii/i18n/react';
import { Button } from '@suskii/ui-web';

import type { Schemas } from '../../lib/browser-api';
import { CheckboxField, NativeSelect } from '../search/native-select';

import { useResultsT } from './results-messages';
import { toggle } from './use-url-params';

export const WINDOWS = ['night', 'morning', 'afternoon', 'evening'] as const;
export type DepartureWindow = (typeof WINDOWS)[number];

export interface FlightFilterState {
  stops: string[];
  airlines: string[];
  windows: DepartureWindow[];
  maxPrice: number | undefined;
  maxDuration: number | undefined;
  refundable: boolean;
  checkedBag: boolean;
}

export const EMPTY_FLIGHT_FILTERS: FlightFilterState = {
  stops: [],
  airlines: [],
  windows: [],
  maxPrice: undefined,
  maxDuration: undefined,
  refundable: false,
  checkedBag: false,
};

/** Price steps between the cheapest and the dearest result, rounded up to whole units. */
function priceSteps(range: { min: Schemas['Money']; max: Schemas['Money'] }): number[] {
  const { min, max } = range;
  if (max.amountMinor <= min.amountMinor) return [];
  const steps = 4;
  const size = (max.amountMinor - min.amountMinor) / steps;
  return Array.from({ length: steps }, (_, index) =>
    Math.ceil(min.amountMinor + size * (index + 1)),
  );
}

function hourSteps(range: { min: number; max: number }): number[] {
  const first = Math.ceil(range.min / 60);
  const last = Math.ceil(range.max / 60);
  if (last <= first) return [];
  const step = Math.max(1, Math.ceil((last - first) / 4));
  const hours: number[] = [];
  for (let value = first; value < last; value += step) hours.push(value);
  return hours;
}

export function FlightFilters({
  facets,
  currency,
  value,
  onChange,
}: {
  facets: Schemas['FlightFacets'];
  currency: string;
  value: FlightFilterState;
  onChange: (next: FlightFilterState) => void;
}) {
  const { t } = useResultsT();
  const format = useFormatters();
  const set = (patch: Partial<FlightFilterState>) => onChange({ ...value, ...patch });
  const stopLabel = (stops: number) =>
    stops === 0
      ? t('results.filters.stopOptions.direct')
      : stops === 1
        ? t('results.filters.stopOptions.one')
        : t('results.filters.stopOptions.twoPlus');
  const prices = facets.price ? priceSteps(facets.price) : [];
  const hours = facets.durationMinutes ? hourSteps(facets.durationMinutes) : [];

  return (
    <div className="flex flex-col gap-6">
      {facets.stops.length > 0 ? (
        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 font-heading text-body font-bold text-heading">
            {t('results.filters.stops')}
          </legend>
          {facets.stops.map((entry) => (
            <CheckboxField
              key={entry.stops}
              name="stops"
              label={`${stopLabel(entry.stops)} · ${format.money(entry.minPrice)}`}
              checked={value.stops.includes(String(entry.stops))}
              onChange={() => set({ stops: toggle(value.stops, String(entry.stops)) })}
            />
          ))}
        </fieldset>
      ) : null}

      {facets.airlines.length > 1 ? (
        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 font-heading text-body font-bold text-heading">
            {t('results.filters.airlines')}
          </legend>
          {facets.airlines.map((airline) => (
            <CheckboxField
              key={airline.code}
              name="airlines"
              label={`${airline.name} · ${format.money(airline.minPrice)}`}
              checked={value.airlines.includes(airline.code)}
              onChange={() => set({ airlines: toggle(value.airlines, airline.code) })}
            />
          ))}
        </fieldset>
      ) : null}

      {facets.departureWindows.length > 0 ? (
        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 font-heading text-body font-bold text-heading">
            {t('results.filters.departure')}
          </legend>
          {WINDOWS.filter((window) =>
            facets.departureWindows.some((entry) => entry.window === window && entry.count > 0),
          ).map((window) => (
            <CheckboxField
              key={window}
              name="windows"
              label={t(`results.filters.windows.${window}`)}
              checked={value.windows.includes(window)}
              onChange={() => set({ windows: toggle(value.windows, window) })}
            />
          ))}
        </fieldset>
      ) : null}

      {prices.length > 0 ? (
        <NativeSelect
          id="filter-max-price"
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

      {hours.length > 0 ? (
        <NativeSelect
          id="filter-max-duration"
          label={t('results.filters.maxDuration')}
          value={value.maxDuration === undefined ? '' : String(value.maxDuration)}
          onChange={(event) =>
            set({ maxDuration: event.target.value ? Number(event.target.value) : undefined })
          }
          options={[
            { value: '', label: t('results.filters.any') },
            ...hours.map((hour) => ({
              value: String(hour * 60),
              label: t('results.filters.upToHours', { hours: hour }),
            })),
          ]}
        />
      ) : null}

      <fieldset className="flex flex-col gap-1">
        <legend className="sr-only">{t('results.filters.title')}</legend>
        {facets.refundable > 0 ? (
          <CheckboxField
            name="refundable"
            label={t('results.filters.refundable')}
            checked={value.refundable}
            onChange={() => set({ refundable: !value.refundable })}
          />
        ) : null}
        {facets.withCheckedBag > 0 ? (
          <CheckboxField
            name="checkedBag"
            label={t('results.filters.checkedBag')}
            checked={value.checkedBag}
            onChange={() => set({ checkedBag: !value.checkedBag })}
          />
        ) : null}
      </fieldset>

      <Button variant="ghost" onClick={() => onChange(EMPTY_FLIGHT_FILTERS)}>
        {t('results.filters.clear')}
      </Button>
    </div>
  );
}
