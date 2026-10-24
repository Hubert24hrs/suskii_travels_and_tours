'use client';

import type { CurrencyCode } from '@suskii/shared/lite';
import { Button, Card, Input, SegmentedControl } from '@suskii/ui-web';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { browserApi, problemSlug, type Schemas } from '../../lib/browser-api';
import { useAccount } from '../account/use-account';
import { AppLink } from '../app-link';
import { NativeSelect } from '../search/native-select';

import { useCarsT } from './use-cars-t';

type Place = Schemas['RidePlaces']['places'][number];
const CATEGORIES = ['standard', 'comfort', 'xl'] as const;
type Category = (typeof CATEGORIES)[number];

type IssueKey = 'outsideArea' | 'samePlace' | 'tooFar' | 'schedule' | 'unavailable';
const ISSUE_KEYS: Record<string, IssueKey> = {
  outside_service_area: 'outsideArea',
  too_short: 'samePlace',
  too_long: 'tooFar',
  pickup_time_invalid: 'schedule',
  category_unavailable: 'unavailable',
};

/**
 * Requesting a ride (ADR-051): curated pick-up and drop-off places (no external geocoder,
 * ADR-053), a ride type and now or later, then a quote with the upfront fare and checkout.
 * Rides are booked from an account, so signed-out visitors are sent to sign in first.
 */
export function RideRequest({
  places,
  currency,
}: {
  places: readonly Place[];
  currency: CurrencyCode;
}) {
  const { t } = useCarsT();
  const router = useRouter();
  const { phase } = useAccount();
  const cities = [...new Set(places.map((place) => place.cityName))].sort();
  const [city, setCity] = useState(cities[0] ?? '');
  const inCity = places.filter((place) => place.cityName === city);
  const [pickup, setPickup] = useState('');
  const [dropoff, setDropoff] = useState('');
  const [category, setCategory] = useState<Category>('standard');
  const [when, setWhen] = useState<'now' | 'later'>('now');
  const [at, setAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (phase.kind === 'loading') return null;
  if (phase.kind !== 'ready') {
    return (
      <Card className="flex flex-col items-start gap-3 p-6">
        <p className="font-body text-body text-foreground">{t('cars.signInNote')}</p>
        <AppLink
          href={`/sign-in?next=${encodeURIComponent('/rides')}`}
          className="inline-flex min-h-12 items-center justify-center rounded-md bg-accent px-6 font-body text-body font-bold text-on-accent focus-visible:focus-ring"
        >
          {t('cars.signInFirst')}
        </AppLink>
      </Card>
    );
  }

  const stop = (id: string) => {
    const place = inCity.find((item) => item.id === id);
    return place ? { label: place.name, lat: place.lat, lng: place.lng } : null;
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    const from = stop(pickup);
    const to = stop(dropoff);
    if (!from || !to || pickup === dropoff) {
      setError(t('cars.rides.errors.samePlace'));
      return;
    }
    if (when === 'later' && !at) {
      setError(t('cars.rides.errors.schedule'));
      return;
    }
    setBusy(true);
    try {
      const {
        data,
        error: problem,
        response,
      } = await browserApi().POST('/v1/inhouse-quotes', {
        body: {
          kind: 'ride',
          category,
          pickup: from,
          dropoff: to,
          // The browser reads the wall time in the visitor's own zone.
          scheduledFor: when === 'later' ? new Date(at).toISOString() : null,
          currency,
        },
      });
      if (data) {
        router.push(`/checkout/${data.quoteId}`);
        return;
      }
      const code = (problem as { code?: string } | undefined)?.code;
      const key = code ? ISSUE_KEYS[code] : undefined;
      setError(
        problemSlug(problem) === 'quote-invalid' && key
          ? t(`cars.rides.errors.${key}`)
          : response.status === 429
            ? t('cars.rides.errors.tooMany')
            : response.status === 404
              ? t('cars.rides.errors.unavailable')
              : t('cars.rides.errors.generic'),
      );
    } catch {
      setError(t('cars.rides.errors.generic'));
    } finally {
      setBusy(false);
    }
  };

  if (places.length === 0)
    return <p className="font-body text-body text-foreground">{t('cars.rides.noPlaces')}</p>;

  const placeOptions = [
    { value: '', label: t('cars.rides.choosePlace') },
    ...inCity.map((place) => ({ value: place.id, label: place.name })),
  ];

  return (
    <Card asChild className="flex flex-col gap-4 p-4">
      <form method="post" noValidate onSubmit={(event) => void submit(event)}>
        {cities.length > 1 ? (
          <NativeSelect
            id="ride-city"
            label={t('cars.rentals.city')}
            options={cities.map((name) => ({ value: name, label: name }))}
            value={city}
            onChange={(event) => {
              setCity(event.target.value);
              setPickup('');
              setDropoff('');
            }}
          />
        ) : null}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <NativeSelect
            id="ride-pickup"
            data-testid="ride-pickup"
            label={t('cars.rides.pickup')}
            options={placeOptions}
            value={pickup}
            onChange={(event) => setPickup(event.target.value)}
          />
          <NativeSelect
            id="ride-dropoff"
            data-testid="ride-dropoff"
            label={t('cars.rides.dropoff')}
            options={placeOptions}
            value={dropoff}
            onChange={(event) => setDropoff(event.target.value)}
          />
        </div>
        <SegmentedControl
          label={t('cars.rides.category')}
          value={category}
          onValueChange={setCategory}
          options={CATEGORIES.map((value) => ({
            value,
            label: t(`cars.rides.categories.${value}`),
          }))}
        />
        <SegmentedControl
          label={t('cars.rides.when')}
          value={when}
          onValueChange={setWhen}
          options={[
            { value: 'now' as const, label: t('cars.rides.now') },
            { value: 'later' as const, label: t('cars.rides.later') },
          ]}
        />
        {when === 'later' ? (
          <Input
            id="ride-at"
            type="datetime-local"
            label={t('cars.rides.scheduledFor')}
            value={at}
            onChange={(event) => setAt(event.target.value)}
          />
        ) : null}
        {error ? (
          <p role="alert" className="font-body text-body-sm text-danger">
            {error}
          </p>
        ) : null}
        <Button type="submit" className="self-start" loading={busy} data-testid="ride-quote">
          {busy ? t('cars.rides.quoting') : t('cars.rides.quote')}
        </Button>
      </form>
    </Card>
  );
}
