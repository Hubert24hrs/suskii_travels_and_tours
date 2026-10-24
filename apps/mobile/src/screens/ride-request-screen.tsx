import type { Schemas } from '@suskii/api-client';
import { Button, Card, Input, SegmentedControl } from '@suskii/ui-native';
import { useQuery } from '@tanstack/react-query';
import { Stack, useRouter, type Href } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Text } from 'react-native';

import { RequireAccount } from '../components/account/require-account';
import { ChoiceChips } from '../components/booking/form-controls';
import { Loading, Notice } from '../components/states';
import { problemSlug } from '../lib/api';
import { LOCAL_DATE_TIME } from '../lib/cars';
import { useApp, useT } from '../providers/app-provider';

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

function RideRequest() {
  const { api, currency } = useApp();
  const { t } = useT();
  const router = useRouter();
  const [city, setCity] = useState('');
  const [pickup, setPickup] = useState('');
  const [dropoff, setDropoff] = useState('');
  const [category, setCategory] = useState<Category>('standard');
  const [when, setWhen] = useState<'now' | 'later'>('now');
  const [at, setAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const places = useQuery({
    queryKey: ['ride-places'],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<Place[]> => {
      const { data, response } = await api.GET('/v1/rides/places');
      if (!data) throw new Error(String(response.status));
      return data.places;
    },
  });

  if (places.isPending) return <Loading label={t('mobile.loading')} />;
  if (!places.data)
    return (
      <Notice
        body={t('mobile.networkError')}
        action={t('mobile.retry')}
        onAction={() => void places.refetch()}
      />
    );
  if (places.data.length === 0) return <Notice body={t('cars.rides.noPlaces')} />;
  const cities = [...new Set(places.data.map((place) => place.cityName))].sort();
  const chosenCity = city.length > 0 ? city : (cities[0] ?? '');
  const inCity = places.data
    .filter((place) => place.cityName === chosenCity)
    .map((place) => ({ value: place.id, label: place.name }));

  const stop = (id: string) => {
    const place = places.data.find((item) => item.id === id);
    return place ? { label: place.name, lat: place.lat, lng: place.lng } : null;
  };

  const submit = async () => {
    setError(null);
    const from = stop(pickup);
    const to = stop(dropoff);
    if (!from || !to || pickup === dropoff) {
      setError(t('cars.rides.errors.samePlace'));
      return;
    }
    if (when === 'later' && !LOCAL_DATE_TIME.test(at)) {
      setError(t('cars.rides.errors.schedule'));
      return;
    }
    setBusy(true);
    try {
      const {
        data,
        error: problem,
        response,
      } = await api.POST('/v1/inhouse-quotes', {
        body: {
          kind: 'ride',
          category,
          pickup: from,
          dropoff: to,
          // The wall time is read in the phone's own time zone.
          scheduledFor: when === 'later' ? new Date(at).toISOString() : null,
          currency,
        },
      });
      if (data) {
        router.push(`/checkout/${data.quoteId}` as Href);
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
      setError(t('mobile.networkError'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="gap-4 p-4">
      {cities.length > 1 ? (
        <ChoiceChips
          testID="ride-city"
          label={t('cars.rentals.city')}
          options={cities.map((name) => ({ value: name, label: name }))}
          value={chosenCity}
          onChange={(value) => {
            setCity(value);
            setPickup('');
            setDropoff('');
          }}
        />
      ) : null}
      <ChoiceChips
        testID="ride-pickup"
        label={t('cars.rides.pickup')}
        options={inCity}
        value={pickup}
        onChange={setPickup}
      />
      <ChoiceChips
        testID="ride-dropoff"
        label={t('cars.rides.dropoff')}
        options={inCity.filter((option) => option.value !== pickup)}
        value={dropoff}
        onChange={setDropoff}
      />
      <ChoiceChips
        testID="ride-category"
        label={t('cars.rides.category')}
        options={CATEGORIES.map((value) => ({
          value,
          label: t(`cars.rides.categories.${value}`),
        }))}
        value={category}
        onChange={setCategory}
      />
      <SegmentedControl
        label={t('cars.rides.when')}
        options={[
          { value: 'now', label: t('cars.rides.now') },
          { value: 'later', label: t('cars.rides.later') },
        ]}
        value={when}
        onValueChange={setWhen}
      />
      {when === 'later' ? (
        <Input
          testID="ride-at"
          label={t('cars.rides.scheduledFor')}
          hint={t('mobile.cars.dateTimeHint')}
          value={at}
          onChangeText={setAt}
          keyboardType="numbers-and-punctuation"
          maxLength={16}
        />
      ) : null}
      {error ? (
        <Text accessibilityRole="alert" className="font-body text-body-sm text-danger">
          {error}
        </Text>
      ) : null}
      <Button testID="ride-quote" fullWidth loading={busy} onPress={() => void submit()}>
        {busy ? t('cars.rides.quoting') : t('cars.rides.quote')}
      </Button>
    </Card>
  );
}

/**
 * Requesting a ride (ADR-051): curated pick-up and drop-off places (no external geocoder,
 * ADR-053), a ride type and now or later, then a quote with the upfront fare and checkout. Rides
 * are booked from an account.
 */
export function RideRequestScreen() {
  const { t } = useT();
  return (
    <ScrollView
      testID="ride-request"
      className="flex-1 bg-background"
      contentContainerClassName="gap-4 p-4 pb-12"
      keyboardShouldPersistTaps="handled"
    >
      <Stack.Screen options={{ title: t('cars.rides.title') }} />
      <Text className="font-body text-body text-foreground">{t('cars.rides.body')}</Text>
      <RequireAccount>
        <RideRequest />
      </RequireAccount>
    </ScrollView>
  );
}
