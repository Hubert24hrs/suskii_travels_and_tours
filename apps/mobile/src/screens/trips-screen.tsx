import { useFormatters } from '@suskii/i18n/react';
import { Badge, Button, Card } from '@suskii/ui-native';
import { useQuery } from '@tanstack/react-query';
import { useFocusEffect, useRouter, type Href } from 'expo-router';
import { useCallback } from 'react';
import { ScrollView, Text, View } from 'react-native';

import { Loading, Notice, OfflineBanner } from '../components/states';
import { isNetworkError } from '../lib/api';
import { todayIso } from '../lib/dates';
import { summaryOf, tripStore, type BookingSummary } from '../lib/trips';
import { useApp, useT } from '../providers/app-provider';

const CLOSED = new Set(['CANCELLED', 'EXPIRED', 'FAILED', 'REFUNDED']);

interface TripList {
  trips: BookingSummary[];
  offline: boolean;
}

function TripCard({ trip, onPress }: { trip: BookingSummary; onPress: () => void }) {
  const { t } = useT();
  const format = useFormatters();
  const place = (point: { code: string; cityName: string | null }) => point.cityName ?? point.code;
  const title = trip.flight
    ? t(
        trip.flight.tripType === 'round_trip'
          ? 'mobile.trips.roundTrip'
          : trip.flight.tripType === 'multi_city'
            ? 'mobile.trips.multiCity'
            : 'mobile.trips.oneWay',
        { origin: place(trip.flight.origin), destination: place(trip.flight.destination) },
      )
    : trip.hotel
      ? t('mobile.trips.hotel', { name: trip.hotel.name, city: trip.hotel.cityName })
      : trip.reference;
  return (
    <View testID="trip-card">
      <Card
        onPress={onPress}
        accessibilityLabel={`${title}, ${trip.reference}`}
        className="gap-2 p-4"
      >
        <Text className="font-heading text-h4 text-heading">{title}</Text>
        <Text className="font-body text-body-sm text-foreground">
          {trip.endsOn && trip.startsOn
            ? format.dateRange(trip.startsOn, trip.endsOn, 'medium')
            : trip.startsOn
              ? format.date(trip.startsOn, 'medium')
              : ''}
          {' · '}
          {trip.reference}
        </Text>
        <Badge
          variant={
            trip.status === 'CONFIRMED' ? 'success' : CLOSED.has(trip.status) ? 'neutral' : 'info'
          }
        >
          {t(`booking.status.${trip.status}`)}
        </Badge>
      </Card>
    </View>
  );
}

/**
 * Trips (ADR-020): the account's bookings plus guest bookings made on this phone, newest first,
 * split into upcoming and past. Everything shown is also cached for offline use.
 */
export function TripsScreen() {
  const { api, user } = useApp();
  const { t } = useT();
  const router = useRouter();

  const trips = useQuery({
    queryKey: ['trips', user?.id ?? null],
    queryFn: async (): Promise<TripList> => {
      let offline = false;
      let account: BookingSummary[] = [];
      if (user) {
        try {
          const { data } = await api.GET('/v1/me/bookings', { params: { query: { limit: 50 } } });
          account = data?.bookings ?? tripStore.accountTrips();
          if (data) tripStore.saveAccountTrips(data.bookings);
        } catch (error) {
          if (!isNetworkError(error)) throw error;
          offline = true;
          account = tripStore.accountTrips();
        }
      }
      const guest = await Promise.all(
        tripStore.deviceTripIds().map(async (id): Promise<BookingSummary | null> => {
          try {
            const { data } = await api.GET('/v1/bookings/{bookingId}', {
              params: { path: { bookingId: id }, header: await tripStore.bookingHeaders(id) },
            });
            if (data) {
              tripStore.saveBooking(data);
              return summaryOf(data);
            }
          } catch (error) {
            if (!isNetworkError(error)) throw error;
            offline = true;
          }
          const cached = tripStore.cachedBooking(id);
          return cached ? summaryOf(cached.booking) : null;
        }),
      );
      const byId = new Map<string, BookingSummary>();
      for (const trip of [...account, ...guest])
        if (trip && !byId.has(trip.id)) byId.set(trip.id, trip);
      return {
        trips: [...byId.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
        offline,
      };
    },
  });

  // Coming back from checkout or a trip shows the latest state.
  const { refetch } = trips;
  useFocusEffect(
    useCallback(() => {
      void refetch();
    }, [refetch]),
  );

  if (trips.isPending) return <Loading label={t('mobile.loading')} />;
  if (!trips.data) {
    return (
      <Notice
        body={t('mobile.networkError')}
        action={t('mobile.retry')}
        onAction={() => void trips.refetch()}
      />
    );
  }

  const today = todayIso();
  const upcoming = trips.data.trips.filter(
    (trip) => !CLOSED.has(trip.status) && (trip.endsOn ?? trip.startsOn) >= today,
  );
  const past = trips.data.trips.filter((trip) => !upcoming.includes(trip));
  const open = (trip: BookingSummary) => router.push(`/trips/${trip.id}` as Href);

  return (
    <View className="flex-1 bg-background">
      {trips.data.offline ? <OfflineBanner label={t('mobile.offline')} /> : null}
      <ScrollView testID="trips" contentContainerClassName="gap-4 p-4 pb-12">
        {trips.data.trips.length === 0 ? (
          <Card className="gap-2 p-4">
            <Text accessibilityRole="header" className="font-heading text-h4 text-heading">
              {t('mobile.trips.empty')}
            </Text>
            <Text className="font-body text-body text-foreground">
              {t('mobile.trips.emptyBody')}
            </Text>
          </Card>
        ) : null}
        {upcoming.length > 0 ? (
          <View className="gap-3">
            <Text accessibilityRole="header" className="font-heading text-h4 text-heading">
              {t('mobile.trips.upcoming')}
            </Text>
            {upcoming.map((trip) => (
              <TripCard key={trip.id} trip={trip} onPress={() => open(trip)} />
            ))}
          </View>
        ) : null}
        {past.length > 0 ? (
          <View className="gap-3">
            <Text accessibilityRole="header" className="font-heading text-h4 text-heading">
              {t('mobile.trips.past')}
            </Text>
            {past.map((trip) => (
              <TripCard key={trip.id} trip={trip} onPress={() => open(trip)} />
            ))}
          </View>
        ) : null}
        {!user ? (
          <Card className="gap-3 p-4">
            <Text className="font-body text-body text-foreground">
              {t('mobile.trips.signInHint')}
            </Text>
            <Button variant="ghost" onPress={() => router.push('/sign-in')}>
              {t('mobile.account.signIn')}
            </Button>
          </Card>
        ) : null}
      </ScrollView>
    </View>
  );
}
