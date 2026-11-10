import type { Schemas } from '@suskii/api-client';
import { useFormatters } from '@suskii/i18n/react';
import {
  TRIP_COMPONENTS,
  TRIP_MAX_ADULTS,
  TRIP_MAX_CHILDREN,
  TRIP_MAX_NIGHTS,
  daysBetween,
  tripTitle,
  type TripComponent,
} from '@suskii/shared';
import { Badge, Button, Card, DateRangePicker } from '@suskii/ui-native';
import { useQuery } from '@tanstack/react-query';
import { useFocusEffect, useRouter, type Href } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';

import { RequireAccount } from '../components/account/require-account';
import { Checkbox } from '../components/booking/form-controls';
import { PlaceField, type PlaceOption } from '../components/search/place-field';
import { Stepper } from '../components/search/rooms-picker';
import { problemSlug } from '../lib/api';
import { useCarsFeaturesQuery } from '../lib/cars';
import { daysFromToday, fromIso, toIso } from '../lib/dates';
import { useApp, useT } from '../providers/app-provider';

type Trip = Schemas['Trip'];

interface Plan {
  origin: PlaceOption | null;
  destination: PlaceOption | null;
  departDate: string;
  returnDate: string;
  adults: number;
  children: number;
  components: TripComponent[];
}

type Field = 'origin' | 'destination' | 'dates' | 'components' | 'form';

export const TRIP_STATE_VARIANT = {
  empty: 'neutral',
  open: 'info',
  awaiting_payment: 'warning',
  paid: 'success',
  closed: 'neutral',
} as const;

function Planner() {
  const { api, user, currency } = useApp();
  const { t, locale } = useT();
  const format = useFormatters();
  const router = useRouter();
  const cars = useCarsFeaturesQuery();
  // Car rental can be switched off (ADR-049); unknown (the API cannot say) still offers it.
  const offered = TRIP_COMPONENTS.filter((part) => part !== 'car' || cars.data?.rentals !== false);
  const [plan, setPlan] = useState<Plan>(() => ({
    origin: null,
    destination: null,
    departDate: daysFromToday(14),
    returnDate: daysFromToday(21),
    adults: 1,
    children: 0,
    components: [...TRIP_COMPONENTS],
  }));
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [busy, setBusy] = useState(false);
  const update = (patch: Partial<Plan>) => setPlan((current) => ({ ...current, ...patch }));
  const wanted = plan.components.filter((part) => offered.includes(part));

  const trips = useQuery({
    queryKey: ['built-trips', user?.id ?? null],
    queryFn: async (): Promise<Trip[]> => {
      const { data } = await api.GET('/v1/me/trips');
      return data?.trips ?? [];
    },
  });
  const { refetch } = trips;
  // A trip changed on its own screen shows its new state when the traveller comes back.
  useFocusEffect(
    useCallback(() => {
      void refetch();
    }, [refetch]),
  );

  const check = (): Partial<Record<Field, string>> => {
    const found: Partial<Record<Field, string>> = {};
    if (!plan.origin) found.origin = t('trips.plan.errors.origin');
    if (!plan.destination) found.destination = t('trips.plan.errors.destination');
    else if (plan.origin?.code === plan.destination.code)
      found.destination = t('trips.plan.errors.same');
    if (!plan.departDate || !plan.returnDate || plan.returnDate <= plan.departDate)
      found.dates = t('trips.plan.errors.dates');
    else if (daysBetween(plan.departDate, plan.returnDate) > TRIP_MAX_NIGHTS)
      found.dates = t('trips.plan.errors.tooLong', { nights: TRIP_MAX_NIGHTS });
    if (wanted.length === 0) found.components = t('trips.plan.errors.parts');
    return found;
  };

  const submit = async () => {
    const found = check();
    setErrors(found);
    if (Object.keys(found).length > 0 || !plan.origin || !plan.destination) return;
    setBusy(true);
    try {
      // The destination's catalog city, for the hotel and add-on searches.
      const airport = await api.GET('/v1/catalog/airports/{iataCode}', {
        params: { path: { iataCode: plan.destination.code } },
      });
      const { data, error } = await api.POST('/v1/trips', {
        body: {
          plan: {
            origin: {
              code: plan.origin.code,
              name: plan.origin.name,
              cityName: plan.origin.city || null,
              countryCode: plan.origin.countryCode,
            },
            destination: {
              code: plan.destination.code,
              name: plan.destination.name,
              cityName: plan.destination.city || null,
              countryCode: plan.destination.countryCode,
              cityId: airport.data?.cityId ?? null,
            },
            departDate: plan.departDate,
            returnDate: plan.returnDate,
            adults: plan.adults,
            children: plan.children,
            components: wanted,
          },
          currency,
        },
      });
      if (data) {
        router.push(`/trips/built/${data.id}` as Href);
        return;
      }
      setErrors({
        form:
          problemSlug(error) === 'too-many-trips'
            ? t('trips.plan.errors.tooMany')
            : t('trips.plan.errors.generic'),
      });
    } catch {
      setErrors({ form: t('mobile.networkError') });
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView
      testID="trip-plan"
      className="flex-1 bg-background"
      contentContainerClassName="gap-4 p-4 pb-12"
      keyboardShouldPersistTaps="handled"
    >
      <Text className="font-body text-body text-foreground">{t('trips.intro')}</Text>
      <Card className="gap-4 p-4">
        <Text accessibilityRole="header" className="font-heading text-h4 text-heading">
          {t('trips.plan.heading')}
        </Text>
        <PlaceField
          testID="plan-from"
          label={t('trips.plan.from')}
          value={plan.origin}
          onChange={(origin) => update({ origin })}
          error={errors.origin}
        />
        <PlaceField
          testID="plan-to"
          label={t('trips.plan.to')}
          value={plan.destination}
          onChange={(destination) => update({ destination })}
          error={errors.destination}
        />
        <DateRangePicker
          testID="plan-dates"
          mode="range"
          label={t('trips.plan.dates')}
          value={{ from: fromIso(plan.departDate), to: fromIso(plan.returnDate) }}
          onChange={(range) =>
            update({
              departDate: range.from ? toIso(range.from) : '',
              returnDate: range.to ? toIso(range.to) : '',
            })
          }
          formatValue={(range) =>
            range.from && range.to
              ? format.dateRange(toIso(range.from), toIso(range.to), 'weekday')
              : range.from
                ? format.date(toIso(range.from), 'weekday')
                : undefined
          }
          placeholder={t('trips.plan.datesPlaceholder')}
          locale={locale}
          labels={{ done: t('search.datePicker.done'), close: t('search.datePicker.close') }}
        />
        {errors.dates ? (
          <Text accessibilityLiveRegion="polite" className="font-body text-caption text-danger">
            {errors.dates}
          </Text>
        ) : null}
        <Stepper
          label={t('trips.plan.adults')}
          value={plan.adults}
          min={1}
          max={TRIP_MAX_ADULTS}
          onChange={(adults) => update({ adults })}
          incrementLabel={t('trips.plan.addAdult')}
          decrementLabel={t('trips.plan.removeAdult')}
        />
        <Stepper
          label={`${t('trips.plan.children')} (${t('trips.plan.childrenHint')})`}
          value={plan.children}
          min={0}
          max={TRIP_MAX_CHILDREN}
          onChange={(children) => update({ children })}
          incrementLabel={t('trips.plan.addChild')}
          decrementLabel={t('trips.plan.removeChild')}
        />
        <View className="gap-1">
          <Text className="font-body-bold text-body text-foreground">{t('trips.plan.parts')}</Text>
          <Text className="font-body text-body-sm text-muted">{t('trips.plan.partsHint')}</Text>
          {offered.map((part) => (
            <Checkbox
              key={part}
              testID={`plan-part-${part}`}
              label={t(`trips.components.${part}`)}
              checked={plan.components.includes(part)}
              onChange={(on) =>
                update({
                  // Kept in the order parts are added to a trip.
                  components: TRIP_COMPONENTS.filter((item) =>
                    item === part ? on : plan.components.includes(item),
                  ),
                })
              }
            />
          ))}
          {errors.components ? (
            <Text accessibilityLiveRegion="polite" className="font-body text-caption text-danger">
              {errors.components}
            </Text>
          ) : null}
        </View>
        {errors.form ? (
          <Text accessibilityRole="alert" className="font-body text-body-sm text-danger">
            {errors.form}
          </Text>
        ) : null}
        <Button testID="plan-submit" fullWidth loading={busy} onPress={() => void submit()}>
          {t('trips.plan.submit')}
        </Button>
      </Card>

      {trips.data && trips.data.length > 0 ? (
        <View className="gap-3">
          <Text accessibilityRole="header" className="font-heading text-h4 text-heading">
            {t('trips.list.heading')}
          </Text>
          {trips.data.map((trip) => {
            const live = trip.parts.filter((part) => part.state !== 'closed').length;
            const title = t('trips.route', tripTitle(trip.plan));
            return (
              <View key={trip.id} testID="built-trip-card">
                <Card
                  onPress={() => router.push(`/trips/built/${trip.id}` as Href)}
                  accessibilityLabel={`${title}, ${trip.reference}`}
                  className="gap-2 p-4"
                >
                  <Text className="font-heading text-h4 text-heading">{title}</Text>
                  <Text className="font-body text-body-sm text-foreground">
                    {format.dateRange(trip.plan.departDate, trip.plan.returnDate, 'medium')}
                    {' · '}
                    {live > 0 ? t('trips.list.parts', { count: live }) : t('trips.list.none')}
                  </Text>
                  <View className="flex-row items-center justify-between gap-3">
                    <Badge variant={TRIP_STATE_VARIANT[trip.state]}>
                      {t(`trips.states.${trip.state}`)}
                    </Badge>
                    {trip.total.amountMinor > 0 ? (
                      <Text className="font-body-bold text-body text-heading">
                        {format.money(trip.total)}
                      </Text>
                    ) : null}
                  </View>
                </Card>
              </View>
            );
          })}
        </View>
      ) : null}
    </ScrollView>
  );
}

/**
 * Where a combined trip starts (ADR-099): where from and to, the dates, the travellers and the
 * parts wanted. Nothing is searched or priced here; the trip's screen sends the traveller to the
 * ordinary search for each part. A trip belongs to an account, so this screen asks for sign-in.
 */
export function TripPlanScreen() {
  return (
    <RequireAccount>
      <Planner />
    </RequireAccount>
  );
}
