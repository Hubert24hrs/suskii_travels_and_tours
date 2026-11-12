import type { Schemas } from '@suskii/api-client';
import { useFormatters } from '@suskii/i18n/react';
import { Badge, Button, Card } from '@suskii/ui-native';
import { useQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { CancellationTiers } from '../components/inhouse/inhouse-summary';
import { Loading, Notice } from '../components/states';
import { problemSlug } from '../lib/api';
import { useApp, useT } from '../providers/app-provider';

type Trip = Schemas['BusTripDetail'];
type SeatState = 'available' | 'selected' | 'held' | 'sold' | 'blocked';

const MAX_SEATS = 6;
const wall = (local: string): string => local.slice(11, 16);

const SEAT_CLASSES: Record<SeatState, string> = {
  available: 'border-border-strong bg-surface',
  selected: 'border-primary bg-primary',
  held: 'border-dashed border-border-strong bg-background',
  sold: 'border-border bg-skeleton',
  blocked: 'border-border bg-background',
};
const SEAT_LABEL: Record<SeatState, string> = {
  available: 'text-foreground',
  selected: 'text-on-primary',
  held: 'text-muted',
  sold: 'text-muted',
  blocked: 'text-muted line-through',
};

function SeatMap({
  trip,
  selected,
  onToggle,
  open,
}: {
  trip: Trip;
  selected: readonly string[];
  onToggle: (seat: string) => void;
  open: boolean;
}) {
  const { t } = useT();
  return (
    <View className="items-center gap-2 self-center rounded-lg border border-border bg-surface p-4">
      <Text className="font-body text-caption text-muted">{t('cars.buses.trip.front')}</Text>
      <View accessibilityLabel={t('cars.buses.trip.seatMap')} className="gap-2">
        {trip.seatMap.rows.map((row, rowIndex) => (
          <View key={rowIndex} className="flex-row gap-2">
            {row.map((seat, index) => {
              if (!seat) return <View key={`aisle-${index}`} className="size-12" />;
              const state: SeatState = selected.includes(seat.seatNumber) ? 'selected' : seat.state;
              const disabled = !open || seat.state !== 'available';
              return (
                <Pressable
                  key={seat.seatNumber}
                  testID={`seat-${seat.seatNumber}`}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: state === 'selected', disabled }}
                  accessibilityLabel={`${t('cars.buses.trip.seat', { seat: seat.seatNumber })}, ${t(
                    `cars.buses.trip.legend.${state}`,
                  )}`}
                  disabled={disabled}
                  onPress={() => onToggle(seat.seatNumber)}
                  className={`size-12 items-center justify-center rounded-md border ${SEAT_CLASSES[state]}`}
                >
                  <Text className={`font-body-bold text-caption ${SEAT_LABEL[state]}`}>
                    {seat.seatNumber}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        ))}
      </View>
    </View>
  );
}

/**
 * A departure's seat map (ADR-051): pick up to six free seats, hold them for 10 minutes (each seat
 * is granted once), then a quote for the hold and checkout. A seat someone else took in the
 * meantime answers 409 `seat-taken` and the map reloads.
 */
export function BusTripScreen() {
  const { tripId } = useLocalSearchParams<{ tripId: string }>();
  const { api, currency } = useApp();
  const { t } = useT();
  const format = useFormatters();
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ['bus-trip', tripId, currency],
    queryFn: async (): Promise<Trip | null> => {
      const { data, response } = await api.GET('/v1/buses/trips/{tripId}', {
        params: { path: { tripId }, query: { currency } },
      });
      if (data) return data;
      if (response.status === 404) return null;
      throw new Error(String(response.status));
    },
  });

  if (query.isPending) return <Loading label={t('mobile.loading')} />;
  if (query.data === null) return <Notice body={t('cars.buses.trip.errors.closed')} />;
  if (!query.data)
    return (
      <Notice
        body={t('mobile.networkError')}
        action={t('mobile.retry')}
        onAction={() => void query.refetch()}
      />
    );
  const trip = query.data;
  const open = trip.status === 'scheduled';

  const toggle = (seat: string) => {
    setError(null);
    setSelected((current) =>
      current.includes(seat)
        ? current.filter((value) => value !== seat)
        : current.length >= MAX_SEATS
          ? current
          : [...current, seat],
    );
  };

  const hold = async () => {
    if (selected.length === 0) {
      setError(t('cars.buses.trip.errors.choose'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const held = await api.POST('/v1/buses/trips/{tripId}/holds', {
        params: { path: { tripId } },
        body: { seats: selected },
      });
      if (!held.data) {
        const slug = problemSlug(held.error);
        setError(
          slug === 'seat-taken'
            ? t('cars.buses.trip.errors.taken')
            : slug === 'trip-closed'
              ? t('cars.buses.trip.errors.closed')
              : held.response.status === 429 || slug === 'hold-limit'
                ? t('cars.buses.trip.errors.tooMany')
                : t('cars.buses.trip.errors.generic'),
        );
        if (slug === 'seat-taken') {
          setSelected([]);
          void query.refetch();
        }
        return;
      }
      const quote = await api.POST('/v1/inhouse-quotes', {
        body: {
          kind: 'bus',
          holdId: held.data.holdId,
          holdToken: held.data.holdToken,
          currency,
        },
      });
      if (quote.data) {
        router.push(`/checkout/${quote.data.quoteId}` as Href);
        return;
      }
      setError(t('cars.buses.trip.errors.generic'));
    } catch {
      setError(t('mobile.networkError'));
    } finally {
      setBusy(false);
    }
  };

  const legend = ['available', 'selected', 'held', 'sold'] as const;

  return (
    <ScrollView
      testID="bus-trip"
      className="flex-1 bg-background"
      contentContainerClassName="gap-4 p-4 pb-12"
    >
      <Stack.Screen options={{ title: t('mobile.cars.busTripTitle') }} />
      <View className="gap-1">
        <View className="flex-row flex-wrap items-center gap-2">
          <Text accessibilityRole="header" className="font-heading text-h3 text-heading">
            {t('cars.buses.trip.heading', {
              origin: trip.origin.cityName,
              destination: trip.destination.cityName,
            })}
          </Text>
          {trip.sample ? <Badge variant="neutral">{t('cars.sample')}</Badge> : null}
        </View>
        <Text className="font-body text-body-sm text-foreground">
          {format.date(trip.departsAtLocal.slice(0, 10), 'weekday')} ·{' '}
          {t('cars.buses.departs', { time: wall(trip.departsAtLocal) })}
        </Text>
        <Text className="font-body text-body-sm text-foreground">
          {t('cars.buses.trip.operator', { operator: trip.operator.name })} ·{' '}
          {t('cars.buses.trip.coach', { coach: trip.coach })}
        </Text>
        <Text className="font-body text-body-sm text-foreground">
          {t('cars.buses.trip.terminal', {
            name: trip.origin.name,
            address: trip.origin.address,
          })}
        </Text>
        {trip.sample ? (
          <Text className="font-body text-caption text-muted">{t('cars.sampleNote')}</Text>
        ) : null}
      </View>

      {trip.status === 'cancelled' ? (
        <Notice body={t('cars.buses.trip.cancelled')} />
      ) : !open ? (
        <Notice body={t('cars.buses.trip.closed')} />
      ) : null}

      <Card className="gap-3 p-4">
        <Text accessibilityRole="header" className="font-heading text-h4 text-heading">
          {t('cars.buses.trip.seatMap')}
        </Text>
        <View className="flex-row flex-wrap gap-3">
          {legend.map((state) => (
            <View key={state} className="flex-row items-center gap-1">
              <View className={`size-4 rounded-sm border ${SEAT_CLASSES[state]}`} />
              <Text className="font-body text-caption text-foreground">
                {t(`cars.buses.trip.legend.${state}`)}
              </Text>
            </View>
          ))}
        </View>
        <SeatMap trip={trip} selected={selected} onToggle={toggle} open={open} />
        <Text
          testID="seats-chosen"
          accessibilityLiveRegion="polite"
          className="font-body text-body text-foreground"
        >
          {t('cars.buses.trip.selected', { count: selected.length })}
          {selected.length > 0
            ? ` (${selected.join(', ')}) · ${t('cars.buses.perSeat', {
                price: format.money(trip.pricePerSeat),
              })}`
            : ''}
        </Text>
        <Text className="font-body text-caption text-muted">
          {t('cars.buses.trip.maxSeats', { count: MAX_SEATS })} {t('cars.buses.trip.holdNote')}
        </Text>
        {error ? (
          <Text accessibilityRole="alert" className="font-body text-body-sm text-danger">
            {error}
          </Text>
        ) : null}
        <Button
          testID="hold-seats"
          fullWidth
          loading={busy}
          disabled={!open}
          onPress={() => void hold()}
        >
          {busy ? t('cars.buses.trip.holding') : t('cars.buses.trip.hold')}
        </Button>
      </Card>
      <Card className="gap-2 p-4">
        <CancellationTiers tiers={trip.cancellationPolicy} />
      </Card>
    </ScrollView>
  );
}
