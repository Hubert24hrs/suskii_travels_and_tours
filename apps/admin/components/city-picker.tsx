'use client';

import { Button } from '@suskii/ui-web';
import { useState } from 'react';

import { adminApi, type Schemas } from '../lib/api';
import { t } from '../lib/i18n';

import { TextField } from './ui';

type City = Extract<Schemas['PlaceSuggestion'], { type: 'city' }>;

export interface PickedCity {
  id: string;
  name: string;
  countryCode: string;
  timeZone: string | null;
}

/** Finds a city in the reference data (the public place search) and returns its id. */
export function CityPicker({
  value,
  onChange,
  error,
}: {
  value: PickedCity | null;
  onChange: (city: PickedCity | null) => void;
  error?: string;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<City[] | null>(null);
  const [busy, setBusy] = useState(false);

  const search = async () => {
    if (query.trim().length < 2) return;
    setBusy(true);
    const { data } = await adminApi.GET('/v1/catalog/places', {
      params: { query: { q: query.trim(), types: 'city', limit: 8 } },
    });
    setBusy(false);
    setResults((data?.items ?? []).filter((item): item is City => item.type === 'city'));
  };

  if (value) {
    return (
      <div className="flex flex-col gap-1">
        <p className="font-body text-body-sm text-foreground" data-testid="picked-city">
          {t('form.selectedCity', { name: value.name, country: value.countryCode })}
        </p>
        <div>
          <Button type="button" variant="ghost" onClick={() => onChange(null)}>
            {t('form.change')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-2 md:flex-row md:items-end">
        <div className="flex-1">
          <TextField
            label={t('form.cityQuery')}
            name="cityQuery"
            value={query}
            error={error}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void search();
              }
            }}
            data-testid="city-query"
          />
        </div>
        <Button type="button" variant="ghost" loading={busy} onClick={() => void search()}>
          {t('form.findCity')}
        </Button>
      </div>
      {results ? (
        results.length === 0 ? (
          <p className="font-body text-body-sm text-muted">{t('form.noCities')}</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {results.map((city) => (
              <li key={city.id}>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() =>
                    onChange({
                      id: city.id,
                      name: city.name,
                      countryCode: city.countryCode,
                      timeZone: city.timeZone,
                    })
                  }
                >
                  {`${city.name}, ${city.countryName}`}
                </Button>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </div>
  );
}
