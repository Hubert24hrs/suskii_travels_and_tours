import type { Schemas } from '@suskii/api-client';
import { color } from '@suskii/design-tokens';
import { Combobox, iconSize } from '@suskii/ui-native';
import { useQuery } from '@tanstack/react-query';
import { MapPin } from 'lucide-react-native';
import { useState } from 'react';
import { Text, View } from 'react-native';

import { useDebounced } from '../../hooks/use-debounced';
import { useApp, useT } from '../../providers/app-provider';

/** An airport option in the flight form. */
export interface PlaceOption {
  code: string;
  name: string;
  city: string;
  countryCode: string;
}

/** Cities expand to the airports serving them, so the form always holds an IATA airport code. */
export function toAirportOptions(items: readonly Schemas['PlaceSuggestion'][]): PlaceOption[] {
  const options = new Map<string, PlaceOption>();
  for (const item of items) {
    if (item.type === 'airport') {
      options.set(item.code, {
        code: item.code,
        name: item.name,
        city: item.cityName ?? item.name,
        countryCode: item.countryCode,
      });
    } else {
      for (const airport of item.airports) {
        options.set(airport.code, {
          code: airport.code,
          name: airport.name,
          city: item.name,
          countryCode: item.countryCode,
        });
      }
    }
  }
  return [...options.values()];
}

export const placeLabel = (place: PlaceOption | null): string =>
  place ? `${place.city} (${place.code})` : '';

export function PlaceField({
  label,
  value,
  onChange,
  error,
  testID,
}: {
  label: string;
  value: PlaceOption | null;
  onChange: (place: PlaceOption | null) => void;
  error?: string | undefined;
  testID?: string;
}) {
  const { api } = useApp();
  const { t } = useT();
  const [query, setQuery] = useState('');
  const term = useDebounced(query.trim());
  const places = useQuery({
    queryKey: ['places', 'airports', term],
    enabled: term.length >= 2,
    staleTime: 10 * 60_000,
    queryFn: async ({ signal }) => {
      const { data } = await api.GET('/v1/catalog/places', {
        params: { query: { q: term, limit: 8 } },
        signal,
      });
      return toAirportOptions(data?.items ?? []);
    },
  });
  return (
    <View testID={testID}>
      <Combobox
        label={label}
        items={term.length >= 2 ? (places.data ?? []) : []}
        itemToString={placeLabel}
        itemToKey={(place) => place.code}
        renderItem={(place) => (
          <View className="gap-1">
            <Text className="font-body-bold text-body text-foreground">{placeLabel(place)}</Text>
            <Text className="font-body text-caption text-muted">{place.name}</Text>
          </View>
        )}
        selectedItem={value}
        onSelectedItemChange={onChange}
        onInputValueChange={setQuery}
        placeholder={t('search.flights.placePlaceholder')}
        icon={<MapPin color={color.muted} size={iconSize.md} />}
        loading={places.isFetching}
        loadingLabel={t('search.places.searching')}
        emptyLabel={t('search.places.noResults')}
        error={error}
      />
    </View>
  );
}

export interface CityOption {
  id: string;
  name: string;
  countryName: string;
}

export function CityField({
  label,
  value,
  onChange,
  error,
  testID,
}: {
  label: string;
  value: CityOption | null;
  onChange: (city: CityOption | null) => void;
  error?: string | undefined;
  testID?: string;
}) {
  const { api } = useApp();
  const { t } = useT();
  const [query, setQuery] = useState('');
  const term = useDebounced(query.trim());
  const cities = useQuery({
    queryKey: ['places', 'cities', term],
    enabled: term.length >= 2,
    staleTime: 10 * 60_000,
    queryFn: async ({ signal }) => {
      const { data } = await api.GET('/v1/catalog/places', {
        params: { query: { q: term, types: 'city', limit: 8 } },
        signal,
      });
      return (data?.items ?? []).flatMap((item): CityOption[] =>
        item.type === 'city'
          ? [{ id: item.id, name: item.name, countryName: item.countryName }]
          : [],
      );
    },
  });
  return (
    <View testID={testID}>
      <Combobox
        label={label}
        items={term.length >= 2 ? (cities.data ?? []) : []}
        itemToString={(city) => (city ? `${city.name}, ${city.countryName}` : '')}
        itemToKey={(city) => city.id}
        selectedItem={value}
        onSelectedItemChange={onChange}
        onInputValueChange={setQuery}
        placeholder={t('search.hotels.destinationPlaceholder')}
        icon={<MapPin color={color.muted} size={iconSize.md} />}
        loading={cities.isFetching}
        loadingLabel={t('search.places.searching')}
        emptyLabel={t('search.places.noResults')}
        error={error}
      />
    </View>
  );
}
