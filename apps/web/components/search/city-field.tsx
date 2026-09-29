'use client';

import { Combobox } from '@suskii/ui-web';
import { Building2 } from 'lucide-react';
import { useState } from 'react';

import { useDebouncedEffect } from './use-debounced-effect';
import { useSearchT } from './use-search-t';

export interface CityOption {
  id: string;
  name: string;
  countryName: string;
}

export interface CityFieldProps {
  id: string;
  label: string;
  placeholder: string;
  value: CityOption | null;
  onChange: (value: CityOption | null) => void;
  /** Featured destinations offered before typing. */
  suggestions: readonly CityOption[];
  apiBaseUrl: string;
  error?: string | undefined;
}

interface ApiCity {
  type: 'airport' | 'city';
  id?: string;
  name: string;
  countryName: string;
}

/** City autocomplete for hotels, packages and add-ons (API search, featured cities first). */
export function CityField({
  id,
  label,
  placeholder,
  value,
  onChange,
  suggestions,
  apiBaseUrl,
  error,
}: CityFieldProps) {
  const { t } = useSearchT();
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<CityOption[]>([...suggestions]);
  const [loading, setLoading] = useState(false);

  useDebouncedEffect(
    (signal) => {
      const text = query.trim();
      if (text.length < 2 || (value && text === `${value.name}, ${value.countryName}`)) {
        setItems([...suggestions]);
        return;
      }
      setLoading(true);
      fetch(`${apiBaseUrl}/v1/catalog/places?q=${encodeURIComponent(text)}&types=city&limit=8`, {
        signal,
      })
        .then((response) =>
          response.ok ? (response.json() as Promise<{ items: ApiCity[] }>) : { items: [] },
        )
        .then(({ items: found }) => {
          setItems(
            found
              .filter(
                (item): item is ApiCity & { id: string } =>
                  item.type === 'city' && Boolean(item.id),
              )
              .map((item) => ({ id: item.id, name: item.name, countryName: item.countryName })),
          );
        })
        .catch(() => undefined)
        .finally(() => {
          if (!signal.aborted) setLoading(false);
        });
    },
    [query, suggestions],
    200,
  );

  return (
    <Combobox<CityOption>
      id={id}
      label={label}
      items={items}
      itemToString={(city) => (city ? `${city.name}, ${city.countryName}` : '')}
      itemToKey={(city) => city.id}
      renderItem={(city) => (
        <span className="flex flex-col">
          <span className="font-bold">{city.name}</span>
          <span className="text-caption text-muted">{city.countryName}</span>
        </span>
      )}
      selectedItem={value}
      onSelectedItemChange={onChange}
      onInputValueChange={setQuery}
      placeholder={placeholder}
      icon={<Building2 className="size-5" />}
      loading={loading}
      loadingLabel={t('search.places.searching')}
      emptyLabel={t('search.places.noResults')}
      error={error}
    />
  );
}
