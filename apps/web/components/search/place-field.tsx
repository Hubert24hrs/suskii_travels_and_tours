'use client';

import { Combobox } from '@suskii/ui-web';
import { History, MapPin } from 'lucide-react';
import { useMemo, useState } from 'react';

import {
  loadPopularPlaces,
  mergePlaces,
  remotePlaces,
  searchPlaces,
  type PlaceOption,
} from './places';
import { useDebouncedEffect } from './use-debounced-effect';
import { useSearchT } from './use-search-t';

export interface PlaceFieldProps {
  id: string;
  label: string;
  value: PlaceOption | null;
  onChange: (value: PlaceOption | null) => void;
  /** Recent places, shown when the field is opened empty. */
  recent: readonly PlaceOption[];
  apiBaseUrl: string;
  locale: string;
  error?: string | undefined;
  icon?: React.ReactNode;
}

/**
 * Airport autocomplete: the popular index answers instantly on the device; queries it cannot
 * answer well fall back to the API. Matches IATA codes, cities, airport names and countries.
 */
export function PlaceField({
  id,
  label,
  value,
  onChange,
  recent,
  apiBaseUrl,
  locale,
  error,
  icon,
}: PlaceFieldProps) {
  const { t } = useSearchT();
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<PlaceOption[]>([]);
  const [loading, setLoading] = useState(false);
  const regions = useMemo(() => new Intl.DisplayNames([locale], { type: 'region' }), [locale]);
  const recentCodes = useMemo(() => new Set(recent.map((place) => place.code)), [recent]);

  useDebouncedEffect(
    (signal) => {
      const text = query.trim();
      if (text.length === 0 || (value && text === `${value.city} (${value.code})`)) {
        setItems([...recent]);
        return;
      }
      setLoading(true);
      void loadPopularPlaces(apiBaseUrl)
        .then(async (places) => {
          const local = searchPlaces(places, text);
          setItems(local);
          if (text.length >= 3 && local.length < 5) {
            const remote = await remotePlaces(apiBaseUrl, text, signal);
            if (!signal.aborted) setItems(mergePlaces(local, remote).slice(0, 8));
          }
        })
        .catch(() => undefined)
        .finally(() => {
          if (!signal.aborted) setLoading(false);
        });
    },
    [query, recent],
    120,
  );

  return (
    <Combobox<PlaceOption>
      id={id}
      label={label}
      items={items}
      itemToString={(place) => (place ? `${place.city} (${place.code})` : '')}
      itemToKey={(place) => place.code}
      renderItem={(place) => (
        <span className="flex items-start gap-3">
          <span aria-hidden="true" className="mt-1 flex text-muted">
            {recentCodes.has(place.code) && query.trim() === '' ? (
              <History className="size-4" />
            ) : (
              <MapPin className="size-4" />
            )}
          </span>
          <span className="flex flex-col">
            <span>
              <span className="font-bold">{place.city}</span>{' '}
              <span className="text-muted">{place.code}</span>
            </span>
            <span className="text-caption text-muted">
              {place.name}, {regions.of(place.countryCode) ?? place.countryCode}
            </span>
          </span>
        </span>
      )}
      selectedItem={value}
      onSelectedItemChange={onChange}
      onInputValueChange={setQuery}
      placeholder={t('search.flights.placePlaceholder')}
      icon={icon}
      loading={loading}
      loadingLabel={t('search.places.searching')}
      emptyLabel={t('search.places.noResults')}
      error={error}
    />
  );
}
