import type { Schemas } from '@suskii/api-client';
import { useFormatters } from '@suskii/i18n/react';
import { seatsFor, type TravellerCounts } from '@suskii/shared';
import { Badge, Button, Card, PassengerPicker } from '@suskii/ui-native';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { CancellationTiers } from '../components/inhouse/inhouse-summary';
import { passengerLabels, travellerSummary } from '../components/search/traveller-labels';
import { Loading, Notice } from '../components/states';
import { problemSlug } from '../lib/api';
import { useApp, useT } from '../providers/app-provider';

type Kind = 'package' | 'tour';
type Detail = Schemas['PackageDetail'] | Schemas['TourDetail'];
type Departure = Schemas['PackageDeparture'] | Schemas['TourDeparture'];
type Blocker = 'full' | 'notEnoughRoom' | 'childrenNotAllowed' | 'infantsNotAllowed';

const DEFAULT_GROUP: TravellerCounts = { adults: 2, children: 0, infants: 0 };

const isPackage = (item: Detail): item is Schemas['PackageDetail'] => 'nights' in item;

function blocker(departure: Departure, travellers: TravellerCounts): Blocker | null {
  if (departure.seatsLeft === 0) return 'full';
  if (departure.seatsLeft < seatsFor(travellers)) return 'notEnoughRoom';
  if (travellers.children > 0 && departure.prices.child === null) return 'childrenNotAllowed';
  if (travellers.infants > 0 && departure.prices.infant === null) return 'infantsNotAllowed';
  return null;
}

function List({ title, items }: { title: string; items: readonly string[] }) {
  if (items.length === 0) return null;
  return (
    <View className="gap-1">
      <Text accessibilityRole="header" className="font-body-bold text-body text-heading">
        {title}
      </Text>
      {items.map((item) => (
        <Text key={item} className="font-body text-body-sm text-foreground">
          • {item}
        </Text>
      ))}
    </View>
  );
}

/**
 * A package or tour (ADR-025): details, then a date for the group, checked for room and who may
 * book before the quote; checkout shows the exact total.
 */
function Product({ kind, slug }: { kind: Kind; slug: string }) {
  const { api, currency } = useApp();
  const { t } = useT();
  const format = useFormatters();
  const router = useRouter();
  const [travellers, setTravellers] = useState<TravellerCounts>(DEFAULT_GROUP);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const detail = useQuery({
    queryKey: ['product', kind, slug, currency],
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<Detail | null> => {
      const query = { currency };
      const { data, response } =
        kind === 'package'
          ? await api.GET('/v1/packages/{slug}', { params: { path: { slug }, query } })
          : await api.GET('/v1/tours/{slug}', { params: { path: { slug }, query } });
      if (data) return data;
      if (response.status === 404) return null;
      throw new Error(String(response.status));
    },
  });

  if (detail.isPending) return <Loading label={t('mobile.loading')} />;
  if (detail.data === null) return <Notice body={t('inhouse.book.errors.unavailable')} />;
  if (!detail.data)
    return (
      <Notice
        body={t('mobile.networkError')}
        action={t('mobile.retry')}
        onAction={() => void detail.refetch()}
      />
    );
  const item = detail.data;
  const departures: Departure[] = item.departures;
  const choice =
    departures.find((departure) => departure.id === selected) ??
    departures.find((departure) => blocker(departure, travellers) === null) ??
    null;
  const chosenOk = choice !== null && blocker(choice, travellers) === null;

  const label = (departure: Departure): string =>
    'startDate' in departure
      ? format.dateRange(departure.startDate, departure.endDate, 'medium')
      : `${format.date(departure.startsAtLocal.slice(0, 10), 'weekday')} · ${departure.startsAtLocal.slice(11, 16)}`;

  const book = async () => {
    if (!choice || !chosenOk) {
      setError(t('inhouse.book.choose'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const {
        data,
        error: problem,
        response,
      } = await api.POST('/v1/inhouse-quotes', {
        body: { kind, departureId: choice.id, travellers, currency },
      });
      if (data) {
        router.push(`/checkout/${data.quoteId}` as Href);
        return;
      }
      setError(
        problemSlug(problem) === 'sold-out'
          ? t('inhouse.book.errors.soldOut')
          : response.status === 410 || response.status === 404
            ? t('inhouse.book.errors.unavailable')
            : response.status === 422
              ? t('inhouse.book.errors.travellers')
              : t('inhouse.book.errors.generic'),
      );
    } catch {
      setError(t('mobile.networkError'));
    } finally {
      setBusy(false);
    }
  };

  const facts = [
    `${item.cityName}, ${format.country(item.countryCode)}`,
    isPackage(item)
      ? t('inhouse.nights', { count: item.nights })
      : t('inhouse.duration', {
          hours: Math.floor(item.durationMinutes / 60),
          minutes: item.durationMinutes % 60,
        }),
  ];

  return (
    <ScrollView
      testID={`product-${kind}`}
      className="flex-1 bg-background"
      contentContainerClassName="gap-4 p-4 pb-12"
    >
      <Stack.Screen options={{ title: item.title }} />
      <View className="gap-2">
        <View className="flex-row flex-wrap items-center gap-2">
          <Text accessibilityRole="header" className="font-heading text-h2 text-heading">
            {item.title}
          </Text>
          {item.sample ? <Badge variant="neutral">{t('inhouse.sample')}</Badge> : null}
        </View>
        <Text className="font-body-bold text-body-sm text-muted">{facts.join(' · ')}</Text>
        <Text className="font-body text-body text-foreground">{item.summary}</Text>
        {item.sample ? (
          <Text className="font-body text-body-sm text-foreground">{t('inhouse.sampleNote')}</Text>
        ) : null}
        {isPackage(item) && item.passportRequired ? (
          <Text className="font-body text-body-sm text-foreground">
            {t('inhouse.detail.passportRequired')}
          </Text>
        ) : null}
      </View>

      <Card className="gap-3 p-4">
        <Text accessibilityRole="header" className="font-heading text-h4 text-heading">
          {t('inhouse.book.heading')}
        </Text>
        <PassengerPicker
          label={t('inhouse.book.travellers')}
          summary={travellerSummary(t, travellers)}
          value={travellers}
          onChange={setTravellers}
          labels={passengerLabels(t)}
        />
        {departures.length === 0 ? (
          <Text className="font-body text-body text-foreground">{t('inhouse.book.noDates')}</Text>
        ) : (
          <View accessibilityRole="radiogroup" className="gap-2">
            {departures.map((departure) => {
              const blocked = blocker(departure, travellers);
              const checked = choice?.id === departure.id;
              return (
                <Pressable
                  key={departure.id}
                  testID={`departure-${departure.id}`}
                  accessibilityRole="radio"
                  accessibilityState={{ checked, disabled: blocked !== null }}
                  disabled={blocked !== null}
                  onPress={() => setSelected(departure.id)}
                  className={`gap-1 rounded-md border p-3 ${checked ? 'border-primary' : 'border-border-strong'}`}
                >
                  <Text className="font-body-bold text-body text-foreground">
                    {label(departure)}
                  </Text>
                  <Text className="font-body text-body-sm text-foreground">
                    {t('inhouse.book.perAdult', { price: format.money(departure.prices.adult) })}
                    {departure.prices.child
                      ? ` · ${t('inhouse.book.perChild', { price: format.money(departure.prices.child) })}`
                      : ''}
                  </Text>
                  <Text
                    className={`font-body text-caption ${blocked ? 'text-danger' : 'text-muted'}`}
                  >
                    {blocked
                      ? t(`inhouse.book.${blocked}`)
                      : t('inhouse.book.seatsLeft', { count: departure.seatsLeft })}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        )}
        {error ? (
          <Text accessibilityRole="alert" className="font-body text-body-sm text-danger">
            {error}
          </Text>
        ) : null}
        <Button
          testID="product-book"
          fullWidth
          loading={busy}
          disabled={departures.length === 0}
          onPress={() => void book()}
        >
          {busy ? t('inhouse.book.submitting') : t('inhouse.book.submit')}
        </Button>
        <Text className="font-body text-caption text-muted">{t('inhouse.detail.priceNote')}</Text>
      </Card>

      <Card className="gap-4 p-4">
        <List title={t('inhouse.detail.highlights')} items={item.highlights} />
        {isPackage(item) && item.itinerary.length > 0 ? (
          <View className="gap-2">
            <Text accessibilityRole="header" className="font-body-bold text-body text-heading">
              {t('inhouse.detail.itinerary')}
            </Text>
            {item.itinerary.map((day) => (
              <View key={day.day} className="gap-1">
                <Text className="font-body-bold text-caption text-muted">
                  {t('inhouse.detail.day', { day: day.day })} · {day.title}
                </Text>
                <Text className="font-body text-body-sm text-foreground">{day.body}</Text>
              </View>
            ))}
          </View>
        ) : null}
        {!isPackage(item) ? (
          <View className="gap-1">
            <Text accessibilityRole="header" className="font-body-bold text-body text-heading">
              {t('inhouse.detail.meetingPoint')}
            </Text>
            <Text className="font-body text-body-sm text-foreground">
              {item.meetingPoint.name}, {item.meetingPoint.address}
            </Text>
            {item.meetingPoint.notes ? (
              <Text className="font-body text-body-sm text-foreground">
                {item.meetingPoint.notes}
              </Text>
            ) : null}
          </View>
        ) : null}
        <List title={t('inhouse.detail.included')} items={item.inclusions} />
        <List title={t('inhouse.detail.excluded')} items={item.exclusions} />
        <CancellationTiers tiers={item.cancellationPolicy} />
      </Card>
    </ScrollView>
  );
}

export function PackageScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  return <Product kind="package" slug={slug} />;
}

export function TourScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  return <Product kind="tour" slug={slug} />;
}
