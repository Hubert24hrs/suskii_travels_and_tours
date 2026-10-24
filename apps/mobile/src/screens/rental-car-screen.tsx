import type { Schemas } from '@suskii/api-client';
import { useFormatters } from '@suskii/i18n/react';
import { Badge, Button, Card, Input } from '@suskii/ui-native';
import { useQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { ScrollView, Text, View } from 'react-native';

import { RequireAccount } from '../components/account/require-account';
import { Checkbox, ChoiceChips } from '../components/booking/form-controls';
import { CancellationTiers } from '../components/inhouse/inhouse-summary';
import { Loading, Notice } from '../components/states';
import { problemSlug } from '../lib/api';
import { LOCAL_DATE_TIME } from '../lib/cars';
import { daysFromToday } from '../lib/dates';
import { useApp, useT } from '../providers/app-provider';

type Vehicle = Schemas['RentalVehicle'];
type Place = Schemas['RidePlaces']['places'][number];
type IssueKey = 'period' | 'tooLong' | 'unavailable' | 'chauffeur' | 'delivery';
const ISSUE_KEYS: Record<string, IssueKey> = {
  period_invalid: 'period',
  too_long: 'tooLong',
  not_available: 'unavailable',
  chauffeur_unavailable: 'chauffeur',
  delivery_unavailable: 'delivery',
  delivery_too_far: 'delivery',
};
const NO_DELIVERY = 'branch';

function Fact({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View className="gap-1">
      <Text className="font-body-bold text-body-sm text-foreground">{title}</Text>
      <Text className="font-body text-body-sm text-foreground">{children}</Text>
    </View>
  );
}

function BookRental({
  vehicle,
  initial,
}: {
  vehicle: Vehicle;
  initial: { pickupAt: string; returnAt: string; chauffeur: boolean };
}) {
  const { api } = useApp();
  const { t } = useT();
  const router = useRouter();
  const [pickupAt, setPickupAt] = useState(initial.pickupAt);
  const [returnAt, setReturnAt] = useState(initial.returnAt);
  const [chauffeur, setChauffeur] = useState(initial.chauffeur && vehicle.chauffeurDaily !== null);
  const [delivery, setDelivery] = useState(NO_DELIVERY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const places = useQuery({
    queryKey: ['ride-places', vehicle.cityName],
    enabled: vehicle.delivery !== null,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<Place[]> => {
      const { data } = await api.GET('/v1/rides/places', {
        params: { query: { city: vehicle.cityName } },
      });
      return data?.places ?? [];
    },
  });

  const submit = async () => {
    setError(null);
    if (
      !LOCAL_DATE_TIME.test(pickupAt) ||
      !LOCAL_DATE_TIME.test(returnAt) ||
      returnAt <= pickupAt
    ) {
      setError(t('cars.rentals.book.errors.period'));
      return;
    }
    const place = places.data?.find((item) => item.id === delivery);
    setBusy(true);
    try {
      const {
        data,
        error: problem,
        response,
      } = await api.POST('/v1/inhouse-quotes', {
        body: {
          kind: 'rental',
          vehicleId: vehicle.id,
          pickupAtLocal: pickupAt,
          returnAtLocal: returnAt,
          chauffeur,
          delivery: place ? { label: place.name, lat: place.lat, lng: place.lng } : null,
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
          ? t(`cars.rentals.book.errors.${key}`)
          : response.status === 429
            ? t('cars.rentals.book.errors.tooMany')
            : t('cars.rentals.book.errors.generic'),
      );
    } catch {
      setError(t('mobile.networkError'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="gap-3 p-4">
      <Text accessibilityRole="header" className="font-heading text-h4 text-heading">
        {t('cars.rentals.book.heading')}
      </Text>
      <Input
        testID="book-pickup"
        label={t('cars.rentals.book.pickupAt')}
        hint={t('mobile.cars.dateTimeHint')}
        value={pickupAt}
        onChangeText={setPickupAt}
        keyboardType="numbers-and-punctuation"
        maxLength={16}
      />
      <Input
        testID="book-return"
        label={t('cars.rentals.book.returnAt')}
        hint={t('mobile.cars.dateTimeHint')}
        value={returnAt}
        onChangeText={setReturnAt}
        keyboardType="numbers-and-punctuation"
        maxLength={16}
      />
      {vehicle.chauffeurDaily ? (
        <Checkbox
          testID="book-chauffeur"
          label={t('cars.rentals.book.chauffeur')}
          checked={chauffeur}
          onChange={setChauffeur}
        />
      ) : null}
      {vehicle.delivery && (places.data ?? []).length > 0 ? (
        <ChoiceChips
          testID="book-delivery"
          label={t('cars.rentals.book.delivery')}
          options={[
            { value: NO_DELIVERY, label: t('cars.rentals.book.noDelivery') },
            ...(places.data ?? []).map((place) => ({ value: place.id, label: place.name })),
          ]}
          value={delivery}
          onChange={setDelivery}
        />
      ) : null}
      {error ? (
        <Text accessibilityRole="alert" className="font-body text-body-sm text-danger">
          {error}
        </Text>
      ) : null}
      <Button testID="book-rental" fullWidth loading={busy} onPress={() => void submit()}>
        {busy ? t('cars.rentals.book.submitting') : t('cars.rentals.book.submit')}
      </Button>
    </Card>
  );
}

/**
 * A rental car (ADR-051): what is included, the deposit and the licence rule, then the booking
 * form (signed in) whose quote and checkout price the exact period.
 */
export function RentalCarScreen() {
  const params = useLocalSearchParams<{
    slug: string;
    pickupAt?: string;
    returnAt?: string;
    chauffeur?: string;
  }>();
  const { api } = useApp();
  const { t } = useT();
  const format = useFormatters();
  const query = useQuery({
    queryKey: ['rental-vehicle', params.slug],
    queryFn: async (): Promise<Vehicle | null> => {
      const { data, response } = await api.GET('/v1/rentals/vehicles/{slug}', {
        params: { path: { slug: params.slug } },
      });
      if (data) return data;
      if (response.status === 404) return null;
      throw new Error(String(response.status));
    },
  });
  if (query.isPending) return <Loading label={t('mobile.loading')} />;
  if (query.data === null) return <Notice body={t('cars.rentals.noResults')} />;
  if (!query.data)
    return (
      <Notice
        body={t('mobile.networkError')}
        action={t('mobile.retry')}
        onAction={() => void query.refetch()}
      />
    );
  const vehicle = query.data;
  const initial = {
    pickupAt:
      params.pickupAt && LOCAL_DATE_TIME.test(params.pickupAt)
        ? params.pickupAt
        : `${daysFromToday(5)}T10:00`,
    returnAt:
      params.returnAt && LOCAL_DATE_TIME.test(params.returnAt)
        ? params.returnAt
        : `${daysFromToday(7)}T10:00`,
    chauffeur: params.chauffeur === 'true',
  };
  const title = `${vehicle.make} ${vehicle.model} (${vehicle.year})`;

  return (
    <ScrollView
      testID="rental-car"
      className="flex-1 bg-background"
      contentContainerClassName="gap-4 p-4 pb-12"
      keyboardShouldPersistTaps="handled"
    >
      <Stack.Screen options={{ title }} />
      <View className="gap-2">
        <View className="flex-row flex-wrap items-center gap-2">
          <Text accessibilityRole="header" className="font-heading text-h2 text-heading">
            {title}
          </Text>
          {vehicle.sample ? <Badge variant="neutral">{t('cars.sample')}</Badge> : null}
        </View>
        <Text className="font-body-bold text-body-sm text-muted">
          {[
            t(`cars.rentals.categories.${vehicle.category}`),
            t(`cars.rentals.transmissions.${vehicle.transmission}`),
            t('cars.rentals.seats', { count: vehicle.seats }),
          ].join(' · ')}
        </Text>
        <Text className="font-body text-body text-foreground">
          {t('cars.rentals.perDay', { price: format.money(vehicle.daily) })}
        </Text>
        {vehicle.sample ? (
          <Text className="font-body text-caption text-muted">{t('cars.sampleNote')}</Text>
        ) : null}
      </View>
      <RequireAccount>
        <BookRental vehicle={vehicle} initial={initial} />
      </RequireAccount>
      <Card className="gap-3 p-4">
        <Fact title={t('cars.rentals.detail.branch')}>
          {vehicle.branch.name}, {vehicle.branch.address}
        </Fact>
        {vehicle.features.length > 0 ? (
          <Fact title={t('cars.rentals.detail.features')}>{vehicle.features.join(', ')}</Fact>
        ) : null}
        <Fact title={t('cars.rentals.detail.mileage')}>
          {vehicle.mileage.kmPerDay === null || !vehicle.mileage.excessKm
            ? t('cars.rentals.detail.unlimited')
            : t('cars.rentals.detail.kmPerDay', {
                km: vehicle.mileage.kmPerDay,
                price: format.money(vehicle.mileage.excessKm),
              })}
        </Fact>
        <Fact title={t('cars.rentals.detail.fuel')}>
          {t(`cars.rentals.detail.fuelPolicies.${vehicle.fuelPolicy}`)}
        </Fact>
        <Fact title={t('cars.rentals.detail.insurance')}>{vehicle.insuranceSummary}</Fact>
        <Text className="font-body text-body-sm text-foreground">
          {vehicle.chauffeurDaily
            ? t('cars.rentals.detail.chauffeurDaily', {
                price: format.money(vehicle.chauffeurDaily),
              })
            : t('cars.rentals.detail.noChauffeur')}
        </Text>
        {vehicle.delivery ? (
          <Text className="font-body text-body-sm text-foreground">
            {t('cars.rentals.detail.delivery', {
              km: vehicle.delivery.maxKm,
              price: format.money(vehicle.delivery.perKm),
            })}
          </Text>
        ) : null}
        {vehicle.deposit.amountMinor > 0 ? (
          <Text className="font-body text-body-sm text-foreground">
            {t('cars.rentals.deposit', { price: format.money(vehicle.deposit) })} ·{' '}
            {t('cars.rentals.detail.depositNote')}
          </Text>
        ) : null}
        <Text className="font-body text-body-sm text-foreground">
          {t('cars.rentals.detail.licenceNote')}
        </Text>
        <CancellationTiers tiers={vehicle.cancellationPolicy} />
      </Card>
    </ScrollView>
  );
}
