'use client';

import { Combobox } from '@suskii/ui-web';
import { Globe } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { useSearchT } from './use-search-t';

export interface Country {
  code: string;
  name: string;
}

let countries: Promise<Country[]> | null = null;

function loadCountries(apiBaseUrl: string): Promise<Country[]> {
  countries ??= fetch(`${apiBaseUrl}/v1/catalog/countries`)
    .then((response) =>
      response.ok ? (response.json() as Promise<{ items: Country[] }>) : { items: [] },
    )
    .then(({ items }) => items.map(({ code, name }) => ({ code, name })))
    .catch(() => {
      countries = null;
      return [];
    });
  return countries;
}

const fold = (value: string) => value.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();

export interface CountryFieldProps {
  id: string;
  label: string;
  /** ISO 3166-1 alpha-2 code, or empty. */
  value: string;
  onChange: (code: string) => void;
  apiBaseUrl: string;
  error?: string | undefined;
}

/** Country picker for the visa form (the 249-country list, filtered on the device). */
export function CountryField({ id, label, value, onChange, apiBaseUrl, error }: CountryFieldProps) {
  const { t } = useSearchT();
  const [all, setAll] = useState<Country[]>([]);
  const [query, setQuery] = useState('');
  useEffect(() => {
    void loadCountries(apiBaseUrl).then(setAll);
  }, [apiBaseUrl]);
  const selected = all.find((country) => country.code === value) ?? null;
  const items = useMemo(() => {
    const needle = fold(query.trim());
    if (!needle || selected?.name === query) return all.slice(0, 50);
    return all
      .filter(
        (country) => fold(country.name).includes(needle) || country.code.toLowerCase() === needle,
      )
      .slice(0, 50);
  }, [all, query, selected]);
  return (
    <Combobox<Country>
      id={id}
      label={label}
      items={items}
      itemToString={(country) => country?.name ?? ''}
      itemToKey={(country) => country.code}
      selectedItem={selected}
      onSelectedItemChange={(country) => onChange(country?.code ?? '')}
      onInputValueChange={setQuery}
      placeholder={t('search.visa.countryPlaceholder')}
      icon={<Globe className="size-5" />}
      loading={all.length === 0}
      loadingLabel={t('search.visa.searchingCountries')}
      emptyLabel={t('search.visa.noCountries')}
      error={error}
    />
  );
}
