import { color } from '@suskii/design-tokens';
import { Combobox, iconSize } from '@suskii/ui-native';
import { useQuery } from '@tanstack/react-query';
import { Check } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { useApp, useT } from '../../providers/app-provider';

/** A labelled checkbox with a 48pt target (terms, filters). */
export function Checkbox({
  label,
  checked,
  onChange,
  error,
  testID,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  error?: string | undefined;
  testID?: string;
}) {
  return (
    <View className="gap-1">
      <Pressable
        testID={testID}
        accessibilityRole="checkbox"
        accessibilityState={{ checked }}
        accessibilityLabel={label}
        onPress={() => onChange(!checked)}
        className="min-h-12 flex-row items-start gap-3 py-2"
      >
        <View
          className={
            checked
              ? 'size-6 items-center justify-center rounded-sm bg-primary'
              : 'size-6 items-center justify-center rounded-sm border-2 border-border-strong bg-surface'
          }
        >
          {checked ? <Check color={color['on-primary']} size={iconSize.sm} /> : null}
        </View>
        <Text className="flex-1 font-body text-body-sm text-foreground">{label}</Text>
      </Pressable>
      {error ? (
        <Text accessibilityLiveRegion="polite" className="font-body text-caption text-danger">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

/** Single choice among a few options (title, gender), as a row of chips (`{testID}-{value}`). */
export function ChoiceChips<T extends string>({
  label,
  options,
  value,
  onChange,
  error,
  testID,
}: {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T | '';
  onChange: (value: T) => void;
  error?: string | undefined;
  testID?: string;
}) {
  return (
    <View className="gap-1">
      <Text className="font-body-medium text-body-sm text-foreground">{label}</Text>
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel={label}
        className="flex-row flex-wrap gap-2"
      >
        {options.map((option) => {
          const checked = option.value === value;
          return (
            <Pressable
              key={option.value}
              testID={testID ? `${testID}-${option.value}` : undefined}
              accessibilityRole="radio"
              accessibilityState={{ checked }}
              onPress={() => onChange(option.value)}
              className={
                checked
                  ? 'min-h-12 justify-center rounded-pill bg-primary px-4'
                  : 'min-h-12 justify-center rounded-pill border border-border-strong px-4'
              }
            >
              <Text
                className={
                  checked
                    ? 'font-body-bold text-body-sm text-on-primary'
                    : 'font-body text-body-sm text-foreground'
                }
              >
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {error ? <Text className="font-body text-caption text-danger">{error}</Text> : null}
    </View>
  );
}

interface Country {
  code: string;
  name: string;
}

/** Country by name or ISO code, from the catalog (loaded once). */
export function CountryField({
  label,
  value,
  onChange,
  error,
  testID,
}: {
  label: string;
  value: string;
  onChange: (code: string) => void;
  error?: string | undefined;
  testID?: string;
}) {
  const { api } = useApp();
  const { t } = useT();
  const [query, setQuery] = useState('');
  const countries = useQuery({
    queryKey: ['countries'],
    staleTime: Infinity,
    queryFn: async () => (await api.GET('/v1/catalog/countries')).data?.items ?? [],
  });
  const selected = useMemo(
    () => countries.data?.find((country) => country.code === value) ?? null,
    [countries.data, value],
  );
  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle.length === 0) return [];
    return (countries.data ?? [])
      .filter(
        (country) =>
          country.code.toLowerCase() === needle || country.name.toLowerCase().includes(needle),
      )
      .slice(0, 8);
  }, [countries.data, query]);
  return (
    <Combobox<Country>
      key={selected?.code ?? 'none'}
      testID={testID}
      label={label}
      items={matches}
      itemToString={(country) => country?.name ?? ''}
      itemToKey={(country) => country.code}
      selectedItem={selected}
      onSelectedItemChange={(country) => onChange(country?.code ?? '')}
      onInputValueChange={setQuery}
      placeholder={t('checkout.fields.choose')}
      loading={countries.isFetching}
      loadingLabel={t('search.places.searching')}
      emptyLabel={t('search.visa.noCountries')}
      error={error}
    />
  );
}
