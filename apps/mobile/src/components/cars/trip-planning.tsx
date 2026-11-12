import type { Schemas } from '@suskii/api-client';
import { useFormatters } from '@suskii/i18n/react';
import { isSupportedCurrency, type BookingStatus } from '@suskii/shared';
import { Button, Card } from '@suskii/ui-native';
import { useQuery } from '@tanstack/react-query';
import { useRouter, type Href } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';

import { kilometres, useCarsFeatures } from '../../lib/cars';
import { tripStore, type Booking } from '../../lib/trips';
import { useApp, useT } from '../../providers/app-provider';
import { ChoiceChips } from '../booking/form-controls';

type Place = Schemas['RidePlaces']['places'][number];
type Plan = Schemas['DeparturePlan'];

/** Bookings that are going ahead: paid, being ticketed or confirmed, or on a payment plan. */
const GOING_AHEAD: readonly BookingStatus[] = [
  'PAID',
  'TICKETING',
  'CONFIRMED',
  'HELD',
  'PARTIALLY_PAID',
];

/** The flight's or bus's departure: its city, the zone its times are shown in, and when. */
function departureOf(booking: Booking): { city: string; zone: string; departsAt: string } | null {
  const slice = booking.flight?.slices[0];
  if (slice) {
    return slice.origin.cityName
      ? { city: slice.origin.cityName, zone: slice.origin.timeZone, departsAt: slice.departureUtc }
      : null;
  }
  if (booking.bus) {
    return {
      city: booking.bus.origin.cityName,
      zone: booking.bus.timeZone,
      departsAt: booking.bus.departsAt,
    };
  }
  return null;
}

/** A query string by hand: React Native only partly implements `URLSearchParams`. */
const query = (params: Record<string, string>): string =>
  Object.entries(params)
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('&');

/**
 * Cars help on a trip that is going ahead (P9, flags `CARS_DEPARTURE_PLANNER` and
 * `CARS_BUNDLES`): when to leave for a flight or bus, with a ride booked for that time, and the
 * rides, cars and buses that fit the trip as prefilled searches. Nothing is booked or held until
 * the traveller checks out. Needs the network, so the trip screen hides it offline.
 */
export function TripPlanning({ booking }: { booking: Booking }) {
  const features = useCarsFeatures();
  if (!features || !GOING_AHEAD.includes(booking.status)) return null;
  return (
    <>
      {features.departurePlanner && features.rides ? <DeparturePlanner booking={booking} /> : null}
      {features.bundles ? <TripSuggestions booking={booking} /> : null}
    </>
  );
}

function DeparturePlanner({ booking }: { booking: Booking }) {
  const { api, user } = useApp();
  const { t } = useT();
  const format = useFormatters();
  const router = useRouter();
  const departure = departureOf(booking);
  const [openedAt] = useState(() => Date.now());
  const [from, setFrom] = useState('');
  const [plan, setPlan] = useState<Plan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Nothing to plan once the flight or bus has left.
  const upcoming = departure !== null && Date.parse(departure.departsAt) > openedAt;

  const places = useQuery({
    queryKey: ['ride-places'],
    staleTime: 5 * 60_000,
    enabled: upcoming,
    queryFn: async (): Promise<Place[]> => {
      const { data, response } = await api.GET('/v1/rides/places');
      if (!data) throw new Error(String(response.status));
      return data.places;
    },
  });

  if (!departure || !upcoming || !places.data) return null;
  const zone = departure.zone;
  const options = places.data
    .filter((place) => place.cityName === departure.city)
    .map((place) => ({ value: place.id, label: place.name }));
  const ride = plan?.ride ?? null;

  const work = async () => {
    if (!from) return;
    setError(null);
    setBusy(true);
    try {
      const { data, response } = await api.GET('/v1/bookings/{bookingId}/departure-plan', {
        params: {
          path: { bookingId: booking.id },
          query: { from },
          header: await tripStore.bookingHeaders(booking.id),
        },
      });
      setPlan(data ?? null);
      if (!data) {
        setError(
          response.status === 422
            ? t('booking.cars.plan.errors.unavailable')
            : response.status === 429
              ? t('booking.cars.plan.errors.tooMany')
              : t('booking.cars.plan.errors.generic'),
        );
      }
    } catch {
      setError(t('mobile.networkError'));
    } finally {
      setBusy(false);
    }
  };

  const bookRide = async (chosen: NonNullable<Plan['ride']>) => {
    setError(null);
    setBusy(true);
    try {
      const currency = booking.price.total.currency;
      const { data } = await api.POST('/v1/inhouse-quotes', {
        body: {
          kind: 'ride',
          category: 'standard',
          pickup: chosen.pickup,
          dropoff: chosen.dropoff,
          scheduledFor: chosen.scheduledFor,
          ...(isSupportedCurrency(currency) ? { currency } : {}),
        },
      });
      if (data) {
        router.push(`/checkout/${data.quoteId}` as Href);
        return;
      }
      setError(t('booking.cars.plan.errors.generic'));
    } catch {
      setError(t('mobile.networkError'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card testID="departure-plan" className="gap-3 p-4">
      <Text accessibilityRole="header" className="font-heading text-h4 text-heading">
        {t('booking.cars.plan.heading')}
      </Text>
      {options.length === 0 ? (
        <Text className="font-body text-body-sm text-foreground">
          {t('booking.cars.plan.noPlaces', { city: departure.city })}
        </Text>
      ) : (
        <>
          <Text className="font-body text-body-sm text-foreground">
            {t('booking.cars.plan.intro')}
          </Text>
          <ChoiceChips
            testID="plan-from"
            label={t('booking.cars.plan.from')}
            options={options}
            value={from}
            onChange={(value) => {
              setFrom(value);
              setPlan(null);
            }}
          />
          <Button
            testID="plan-submit"
            variant="secondary"
            disabled={!from}
            loading={busy && !plan}
            onPress={() => void work()}
          >
            {t('booking.cars.plan.submit')}
          </Button>
        </>
      )}
      {error ? (
        <Text accessibilityRole="alert" className="font-body text-body-sm text-danger">
          {error}
        </Text>
      ) : null}
      {plan ? (
        <View className="gap-2">
          <Text testID="plan-leave-by" className="font-heading text-h3 text-heading">
            {t('booking.cars.plan.leaveBy', { time: format.dateTime(plan.leaveBy, zone) })}
          </Text>
          <Text className="font-body text-body text-foreground">
            {t('booking.cars.plan.arriveBy', {
              place: plan.destination.label,
              time: format.dateTime(plan.arriveBy, zone),
            })}
          </Text>
          <Text className="font-body text-body-sm text-foreground">
            {t(`booking.cars.plan.buffer.${plan.kind}`, { minutes: plan.bufferMinutes })}{' '}
            {t('booking.cars.plan.travel', {
              minutes: Math.ceil(plan.travel.durationSeconds / 60),
              km: format.number(kilometres(plan.travel.distanceMetres)),
              margin: plan.marginMinutes,
            })}
            {plan.travel.estimate === 'straight_line' ? ` ${t('booking.cars.plan.estimate')}` : ''}
          </Text>
          {!ride ? (
            <Text className="font-body text-body-sm text-foreground">
              {t('booking.cars.plan.noRide')}
            </Text>
          ) : user ? (
            <Button testID="plan-book-ride" loading={busy} onPress={() => void bookRide(ride)}>
              {t('booking.cars.plan.book', { time: format.dateTime(ride.scheduledFor, zone) })}
            </Button>
          ) : (
            <Button
              testID="plan-sign-in"
              variant="secondary"
              onPress={() => router.push('/sign-in')}
            >
              {t('booking.cars.plan.signIn')}
            </Button>
          )}
        </View>
      ) : null}
    </Card>
  );
}

function TripSuggestions({ booking }: { booking: Booking }) {
  const { api } = useApp();
  const { t } = useT();
  const format = useFormatters();
  const router = useRouter();
  const suggestions = useQuery({
    queryKey: ['cars-suggestions', booking.id],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data } = await api.GET('/v1/bookings/{bookingId}/cars-suggestions', {
        params: {
          path: { bookingId: booking.id },
          header: await tripStore.bookingHeaders(booking.id),
        },
      });
      return data ?? null;
    },
  });

  const found = suggestions.data;
  if (!found || (!found.ride && !found.rental && !found.bus)) return null;
  const { ride, rental, bus } = found;
  const arrivalZone = booking.flight?.slices[0]?.destination.timeZone;
  const local = (value: string) =>
    `${format.date(value.slice(0, 10), 'medium')} ${value.slice(11, 16)}`;

  return (
    <Card testID="cars-suggestions" className="gap-4 p-4">
      <Text accessibilityRole="header" className="font-heading text-h4 text-heading">
        {t('booking.cars.suggest.heading')}
      </Text>
      {ride ? (
        <View className="gap-1">
          <Text className="font-body-bold text-body text-foreground">
            {t('booking.cars.suggest.ride', { place: ride.pickupLabel })}
          </Text>
          {ride.scheduledFor ? (
            <Text className="font-body text-body-sm text-foreground">
              {t('booking.cars.suggest.rideAt', {
                time: format.dateTime(ride.scheduledFor, arrivalZone),
              })}
            </Text>
          ) : null}
          <Button
            testID="suggest-ride"
            variant="secondary"
            onPress={() =>
              router.push(
                `/rides?${query({
                  pickup: ride.pickupPlaceId,
                  ...(ride.scheduledFor ? { at: ride.scheduledFor } : {}),
                })}` as Href,
              )
            }
          >
            {t('booking.cars.suggest.rideAction')}
          </Button>
        </View>
      ) : null}
      {rental ? (
        <View className="gap-1">
          <Text className="font-body-bold text-body text-foreground">
            {t('booking.cars.suggest.rental', { city: rental.cityName })}
          </Text>
          <Text className="font-body text-body-sm text-foreground">
            {t('booking.cars.suggest.rentalPeriod', {
              from: local(rental.pickupAtLocal),
              until: local(rental.returnAtLocal),
            })}
          </Text>
          <Button
            testID="suggest-rental"
            variant="secondary"
            onPress={() =>
              router.push(
                `/rentals?${query({
                  city: rental.cityName,
                  pickupAt: rental.pickupAtLocal,
                  returnAt: rental.returnAtLocal,
                })}` as Href,
              )
            }
          >
            {t('booking.cars.suggest.rentalAction')}
          </Button>
        </View>
      ) : null}
      {bus ? (
        <View className="gap-1">
          <Text className="font-body-bold text-body text-foreground">
            {t('booking.cars.suggest.bus', { city: bus.from })}
          </Text>
          <Button
            testID="suggest-bus"
            variant="secondary"
            onPress={() =>
              router.push(`/buses?${query({ from: bus.from, date: bus.date })}` as Href)
            }
          >
            {t('booking.cars.suggest.busAction')}
          </Button>
        </View>
      ) : null}
    </Card>
  );
}
