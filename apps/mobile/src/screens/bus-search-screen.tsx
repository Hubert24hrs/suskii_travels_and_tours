import type { Schemas } from '@suskii/api-client';
import { useFormatters } from '@suskii/i18n/react';
import { Badge, Button, Card, DateRangePicker } from '@suskii/ui-native';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { ChoiceChips } from '../components/booking/form-controls';
import { Loading, Notice } from '../components/states';
import { ISO_DAY, routeParam } from '../lib/cars';
import { daysFromToday, fromIso, toIso } from '../lib/dates';
import { useApp, useT } from '../providers/app-provider';

type Trip = Schemas['BusSearchResult']['trips'][number];
interface Search {
  from: string;
  to: string;
  date: string;
  seats: number;
}

const SEAT_CHOICES = ['1', '2', '3', '4', '5', '6'] as const;
/** Amenities the catalog names; anything newer from the API is left out rather than shown raw. */
const AMENITIES = [
  'air_conditioning',
  'usb_charging',
  'reclining_seats',
  'wifi',
  'toilet',
  'snacks',
  'entertainment',
] as const;
type Amenity = (typeof AMENITIES)[number];
const isAmenity = (key: string): key is Amenity => (AMENITIES as readonly string[]).includes(key);
const wall = (local: string): string => local.slice(11, 16);

function TripCard({ trip, seats }: { trip: Trip; seats: number }) {
  const { t } = useT();
  const format = useFormatters();
  const router = useRouter();
  return (
    <Pressable
      testID={`bus-trip-${trip.id}`}
      accessibilityRole="button"
      onPress={() => router.push(`/buses/trips/${trip.id}?seats=${seats}` as Href)}
      className="gap-2 rounded-lg border border-border bg-surface p-4 active:opacity-80"
    >
      <View className="flex-row flex-wrap items-center justify-between gap-2">
        <Text className="font-body-bold text-body text-foreground">{trip.operator.name}</Text>
        {trip.sample ? <Badge variant="neutral">{t('cars.sample')}</Badge> : null}
      </View>
      <Text className="font-body text-body text-foreground">
        {t('cars.buses.departs', { time: wall(trip.departsAtLocal) })} ·{' '}
        {t('cars.buses.duration', {
          hours: Math.floor(trip.durationMinutes / 60),
          minutes: trip.durationMinutes % 60,
        })}
      </Text>
      <Text className="font-body text-body-sm text-foreground">
        {trip.origin.name} → {trip.destination.name}
      </Text>
      <Text className="font-body text-body-sm text-muted">
        {[
          trip.coach,
          ...trip.amenities.filter(isAmenity).map((key) => t(`cars.buses.amenities.${key}`)),
        ].join(' · ')}
      </Text>
      <View className="flex-row flex-wrap items-center justify-between gap-2">
        <Text className="font-heading text-h4 text-heading">
          {t('cars.buses.perSeat', { price: format.money(trip.pricePerSeat) })}
        </Text>
        <Text className="font-body text-caption text-muted">
          {t('cars.buses.seatsLeft', { count: trip.seatsLeft })}
        </Text>
      </View>
    </Pressable>
  );
}

/**
 * Interstate buses (ADR-051): a route between two cities on a day for a number of seats, then the
 * departures with their price per seat. Choosing one opens its seat map.
 */
export function BusSearchScreen() {
  const { api, currency } = useApp();
  const { t, locale } = useT();
  const format = useFormatters();
  // A prefill from a trip suggestion: `/buses?from=<city>&date=<day>`.
  const params = useLocalSearchParams<{ from?: string; date?: string }>();
  const [from, setFrom] = useState(() => routeParam(params.from) ?? '');
  const [to, setTo] = useState('');
  const [date, setDate] = useState(() => {
    const day = routeParam(params.date);
    return day && ISO_DAY.test(day) ? day : daysFromToday(3);
  });
  const [seats, setSeats] = useState(1);
  const [search, setSearch] = useState<Search | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cities = useQuery({
    queryKey: ['bus-cities'],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, response } = await api.GET('/v1/buses/cities');
      if (!data) throw new Error(String(response.status));
      return data.cities;
    },
  });
  const results = useQuery({
    queryKey: ['bus-search', search, currency],
    enabled: search !== null,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      if (!search) return [];
      const { data, response } = await api.GET('/v1/buses/search', {
        params: { query: { ...search, currency } },
      });
      if (!data) throw new Error(String(response.status));
      return data.trips;
    },
  });

  if (cities.isPending) return <Loading label={t('mobile.loading')} />;
  if (!cities.data)
    return (
      <Notice
        body={t('mobile.networkError')}
        action={t('mobile.retry')}
        onAction={() => void cities.refetch()}
      />
    );
  const options = cities.data.map((city) => ({ value: city.name, label: city.name }));

  const submit = () => {
    if (!from || !to || from === to || !date) {
      setError(t('cars.buses.anyCity'));
      return;
    }
    setError(null);
    setSearch({ from, to, date, seats });
  };

  return (
    <ScrollView
      testID="bus-search"
      className="flex-1 bg-background"
      contentContainerClassName="gap-4 p-4 pb-12"
      keyboardShouldPersistTaps="handled"
    >
      <Stack.Screen options={{ title: t('cars.buses.title') }} />
      <Text className="font-body text-body text-foreground">{t('cars.buses.body')}</Text>
      {options.length === 0 ? (
        <Notice body={t('cars.buses.noCities')} />
      ) : (
        <Card className="gap-4 p-4">
          <ChoiceChips
            testID="bus-from"
            label={t('cars.buses.from')}
            options={options}
            value={from}
            onChange={setFrom}
          />
          <ChoiceChips
            testID="bus-to"
            label={t('cars.buses.to')}
            options={options.filter((option) => option.value !== from)}
            value={to}
            onChange={setTo}
          />
          <DateRangePicker
            mode="single"
            label={t('cars.buses.date')}
            value={{ from: fromIso(date), to: undefined }}
            onChange={(range) => setDate(range.from ? toIso(range.from) : '')}
            formatValue={(range) =>
              range.from ? format.date(toIso(range.from), 'weekday') : undefined
            }
            placeholder={t('cars.buses.date')}
            locale={locale}
            labels={{ done: t('search.datePicker.done'), close: t('search.datePicker.close') }}
          />
          <ChoiceChips
            testID="bus-seats"
            label={t('cars.buses.seats')}
            options={SEAT_CHOICES.map((value) => ({ value, label: value }))}
            value={String(seats) as (typeof SEAT_CHOICES)[number]}
            onChange={(value) => setSeats(Number(value))}
          />
          {error ? (
            <Text accessibilityRole="alert" className="font-body text-body-sm text-danger">
              {error}
            </Text>
          ) : null}
          <Button testID="bus-search-submit" fullWidth onPress={submit}>
            {t('cars.buses.search')}
          </Button>
        </Card>
      )}
      {search === null ? null : results.isPending ? (
        <Loading label={t('mobile.loading')} />
      ) : !results.data ? (
        <Notice
          body={t('mobile.networkError')}
          action={t('mobile.retry')}
          onAction={() => void results.refetch()}
        />
      ) : results.data.length === 0 ? (
        <Notice body={t('cars.buses.noResults')} />
      ) : (
        <View testID="bus-trips" className="gap-3">
          <Text accessibilityRole="header" className="font-heading text-h4 text-heading">
            {t('cars.buses.results', { count: results.data.length })}
          </Text>
          {results.data.map((trip) => (
            <TripCard key={trip.id} trip={trip} seats={search.seats} />
          ))}
        </View>
      )}
    </ScrollView>
  );
}
