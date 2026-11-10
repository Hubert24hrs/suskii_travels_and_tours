import type { Schemas } from '@suskii/api-client';
import { useFormatters } from '@suskii/i18n/react';
import { Badge, Button, Card, Input } from '@suskii/ui-native';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { Checkbox, ChoiceChips } from '../components/booking/form-controls';
import { Loading, Notice } from '../components/states';
import { driverAgeOf, LOCAL_DATE_TIME, routeParam } from '../lib/cars';
import { daysFromToday } from '../lib/dates';
import { useApp, useT } from '../providers/app-provider';

type Car = Schemas['RentalSearchResult']['vehicles'][number];
const CATEGORIES = ['economy', 'compact', 'suv', 'luxury', 'van'] as const;
type Category = (typeof CATEGORIES)[number];
const TRANSMISSIONS = ['automatic', 'manual'] as const;
type Transmission = (typeof TRANSMISSIONS)[number];
interface Search {
  /** Only from a prefilled link; the form itself searches every city. */
  city?: string;
  pickupAt: string;
  returnAt: string;
  category: Category | 'any';
  transmission: Transmission | 'any';
  /** Only cars whose branch is at an airport (ADR-098). */
  airport: boolean;
  /** The driver's age for a self-drive rental; null when not given. */
  driverAge: number | null;
  chauffeur: boolean;
}

/** A complete, ordered period from a link (a trip suggestion), searched straight away. */
function prefilledSearch(params: {
  city?: string | string[];
  pickupAt?: string | string[];
  returnAt?: string | string[];
}): Search | null {
  const city = routeParam(params.city);
  const pickupAt = routeParam(params.pickupAt) ?? '';
  const returnAt = routeParam(params.returnAt) ?? '';
  if (!LOCAL_DATE_TIME.test(pickupAt) || !LOCAL_DATE_TIME.test(returnAt) || returnAt <= pickupAt) {
    return null;
  }
  return {
    ...(city ? { city } : {}),
    pickupAt,
    returnAt,
    category: 'any',
    transmission: 'any',
    airport: false,
    driverAge: null,
    chauffeur: false,
  };
}

function CarCard({ car, search, days }: { car: Car; search: Search; days: number }) {
  const { t } = useT();
  const format = useFormatters();
  const router = useRouter();
  const query = `pickupAt=${encodeURIComponent(search.pickupAt)}&returnAt=${encodeURIComponent(search.returnAt)}${search.chauffeur ? '&chauffeur=true' : ''}${search.driverAge === null ? '' : `&driverAge=${search.driverAge}`}`;
  const { blocks } = car.estimate;
  // "1 week and 3 days": shown only when a weekly or monthly rate made the price.
  const pricedAs =
    blocks.months + blocks.weeks === 0
      ? null
      : t('cars.rentals.pricedAs', {
          parts: format.list(
            [
              blocks.months > 0 ? t('cars.rentals.blocks.months', { count: blocks.months }) : '',
              blocks.weeks > 0 ? t('cars.rentals.blocks.weeks', { count: blocks.weeks }) : '',
              blocks.days > 0 ? t('cars.rentals.days', { count: blocks.days }) : '',
            ].filter((part) => part !== ''),
          ),
        });
  return (
    <Pressable
      testID={`rental-car-${car.slug}`}
      accessibilityRole="button"
      onPress={() => router.push(`/rentals/${car.slug}?${query}` as Href)}
      className="gap-2 rounded-lg border border-border bg-surface p-4 active:opacity-80"
    >
      <View className="flex-row flex-wrap items-center justify-between gap-2">
        <Text className="font-body-bold text-body text-foreground">
          {car.make} {car.model} ({car.year})
        </Text>
        {car.sample ? <Badge variant="neutral">{t('cars.sample')}</Badge> : null}
        {car.branch.airportCode ? (
          <Badge variant="neutral">
            {t('cars.rentals.atAirport', { code: car.branch.airportCode })}
          </Badge>
        ) : null}
      </View>
      <Text className="font-body text-body-sm text-foreground">
        {[
          t(`cars.rentals.categories.${car.category}`),
          t(`cars.rentals.transmissions.${car.transmission}`),
          t('cars.rentals.seats', { count: car.seats }),
        ].join(' · ')}
      </Text>
      <Text className="font-body text-body-sm text-muted">
        {car.branch.name}, {car.cityName}
      </Text>
      <Text className="font-body text-body-sm text-foreground">
        {[
          t('cars.rentals.perDay', { price: format.money(car.daily) }),
          car.weekly ? t('cars.rentals.perWeek', { price: format.money(car.weekly) }) : '',
        ]
          .filter((part) => part !== '')
          .join(' · ')}
      </Text>
      <Text className="font-body text-caption text-muted">
        {t('cars.rentals.minAge', { age: car.minDriverAge })}
      </Text>
      <Text className="font-heading text-h4 text-heading">
        {t('cars.rentals.estimate', {
          price: format.money(car.estimate.rental),
          days: t('cars.rentals.days', { count: days }),
        })}
      </Text>
      {pricedAs ? (
        <Text testID="rental-priced-as" className="font-body text-caption text-muted">
          {pricedAs}
        </Text>
      ) : null}
      {car.deposit.amountMinor > 0 ? (
        <Text className="font-body text-caption text-muted">
          {t('cars.rentals.deposit', { price: format.money(car.deposit) })}
        </Text>
      ) : null}
    </Pressable>
  );
}

/**
 * Car rental (ADR-051): pick-up and return times, a car type and whether to add a chauffeur, then
 * the free cars with the price for the whole period and the refundable deposit.
 */
export function RentalSearchScreen() {
  const { api } = useApp();
  const { t } = useT();
  const params = useLocalSearchParams<{ city?: string; pickupAt?: string; returnAt?: string }>();
  const [prefill] = useState(() => prefilledSearch(params));
  const [pickupAt, setPickupAt] = useState(() => prefill?.pickupAt ?? `${daysFromToday(5)}T10:00`);
  const [returnAt, setReturnAt] = useState(() => prefill?.returnAt ?? `${daysFromToday(7)}T10:00`);
  const [category, setCategory] = useState<Category | 'any'>('any');
  const [transmission, setTransmission] = useState<Transmission | 'any'>('any');
  const [airport, setAirport] = useState(false);
  const [driverAge, setDriverAge] = useState('');
  const [chauffeur, setChauffeur] = useState(false);
  const [search, setSearch] = useState<Search | null>(prefill);
  const [error, setError] = useState<string | null>(null);

  const results = useQuery({
    queryKey: ['rental-search', search],
    enabled: search !== null,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      if (!search) return null;
      const { data, response } = await api.GET('/v1/rentals/vehicles', {
        params: {
          query: {
            ...(search.city ? { city: search.city } : {}),
            pickupAt: search.pickupAt,
            returnAt: search.returnAt,
            ...(search.category === 'any' ? {} : { category: search.category }),
            ...(search.transmission === 'any' ? {} : { transmission: search.transmission }),
            ...(search.airport ? { airport: 'true' as const } : {}),
            ...(search.driverAge === null ? {} : { driverAge: search.driverAge }),
            ...(search.chauffeur ? { chauffeur: 'true' as const } : {}),
          },
        },
      });
      if (!data) throw new Error(String(response.status));
      return data;
    },
  });

  const submit = () => {
    if (
      !LOCAL_DATE_TIME.test(pickupAt) ||
      !LOCAL_DATE_TIME.test(returnAt) ||
      returnAt <= pickupAt
    ) {
      setError(t('cars.rentals.book.errors.period'));
      return;
    }
    setError(null);
    setSearch({
      ...(prefill?.city ? { city: prefill.city } : {}),
      pickupAt,
      returnAt,
      category,
      transmission,
      airport,
      driverAge: driverAgeOf(driverAge),
      chauffeur,
    });
  };

  return (
    <ScrollView
      testID="rental-search"
      className="flex-1 bg-background"
      contentContainerClassName="gap-4 p-4 pb-12"
      keyboardShouldPersistTaps="handled"
    >
      <Stack.Screen options={{ title: t('cars.rentals.title') }} />
      <Text className="font-body text-body text-foreground">{t('cars.rentals.body')}</Text>
      <Card className="gap-4 p-4">
        <Input
          testID="rental-pickup"
          label={t('cars.rentals.pickupAt')}
          hint={t('mobile.cars.dateTimeHint')}
          value={pickupAt}
          onChangeText={setPickupAt}
          keyboardType="numbers-and-punctuation"
          maxLength={16}
        />
        <Input
          testID="rental-return"
          label={t('cars.rentals.returnAt')}
          hint={t('mobile.cars.dateTimeHint')}
          value={returnAt}
          onChangeText={setReturnAt}
          keyboardType="numbers-and-punctuation"
          maxLength={16}
        />
        <ChoiceChips
          testID="rental-category"
          label={t('cars.rentals.category')}
          options={[
            { value: 'any' as const, label: t('cars.rentals.anyCategory') },
            ...CATEGORIES.map((value) => ({
              value,
              label: t(`cars.rentals.categories.${value}`),
            })),
          ]}
          value={category}
          onChange={setCategory}
        />
        <ChoiceChips
          testID="rental-transmission"
          label={t('cars.rentals.transmission')}
          options={[
            { value: 'any' as const, label: t('cars.rentals.anyTransmission') },
            ...TRANSMISSIONS.map((value) => ({
              value,
              label: t(`cars.rentals.transmissions.${value}`),
            })),
          ]}
          value={transmission}
          onChange={setTransmission}
        />
        <Input
          testID="rental-driver-age"
          label={t('cars.rentals.driverAge')}
          value={driverAge}
          onChangeText={setDriverAge}
          keyboardType="number-pad"
          maxLength={2}
        />
        <Checkbox
          testID="rental-airport-only"
          label={t('cars.rentals.airportOnly')}
          checked={airport}
          onChange={setAirport}
        />
        <Checkbox
          testID="rental-chauffeur"
          label={t('cars.rentals.chauffeur')}
          checked={chauffeur}
          onChange={setChauffeur}
        />
        {error ? (
          <Text accessibilityRole="alert" className="font-body text-body-sm text-danger">
            {error}
          </Text>
        ) : null}
        <Button testID="rental-search-submit" fullWidth onPress={submit}>
          {t('cars.rentals.search')}
        </Button>
      </Card>
      {search === null ? null : results.isPending ? (
        <Loading label={t('mobile.loading')} />
      ) : !results.data ? (
        <Notice
          body={t('mobile.networkError')}
          action={t('mobile.retry')}
          onAction={() => void results.refetch()}
        />
      ) : results.data.vehicles.length === 0 ? (
        <Notice body={t('cars.rentals.noResults')} />
      ) : (
        <View testID="rental-cars" className="gap-3">
          <Text accessibilityRole="header" className="font-heading text-h4 text-heading">
            {t('cars.rentals.results', { count: results.data.vehicles.length })}
          </Text>
          {results.data.vehicles.map((car) => (
            <CarCard key={car.id} car={car} search={search} days={results.data?.days ?? 1} />
          ))}
        </View>
      )}
    </ScrollView>
  );
}
