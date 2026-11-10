import type { Schemas } from '@suskii/api-client';
import { useFormatters } from '@suskii/i18n/react';
import { Badge, Button, Card } from '@suskii/ui-native';
import { useQuery } from '@tanstack/react-query';
import { useRouter, type Href } from 'expo-router';
import { Text, View } from 'react-native';

import { daysFromToday } from '../lib/dates';
import { useApp, useT } from '../providers/app-provider';
import { ProductRow, type CatalogKind, type Product } from '../screens/catalog-screen';

import { DealList } from './deal-list';

type Deal = Schemas['FlightDeal'];
type Destination = Schemas['HotelDestination'];
type Car = Schemas['RentalSearchResult']['vehicles'][number];

/** How many of each Home lists; the full lists are one tap or one search away. */
const HOME_PICKS = 3;
const HOME_DESTINATIONS = 4;
const FIVE_MINUTES = 5 * 60_000;

function Heading({ children }: { children: string }) {
  return (
    <Text accessibilityRole="header" className="font-heading text-h3 text-heading">
      {children}
    </Text>
  );
}

/** Flights: the freshest fares; tapping one searches it. */
export function FlightDeals({ deals }: { deals: readonly Deal[] | undefined }) {
  const { t } = useT();
  const router = useRouter();
  if (!deals || deals.length === 0) return null;
  return (
    <View testID="home-flight-deals" className="gap-3">
      <Heading>{t('mobile.home.dealsHeading')}</Heading>
      <DealList deals={deals} />
      <Button variant="ghost" onPress={() => router.push('/deals')}>
        {t('mobile.home.seeAllDeals')}
      </Button>
    </View>
  );
}

/**
 * Hotels: the destinations with the most to offer and a nightly "from" price. Tapping one opens
 * the search the form itself starts with: two nights, two weeks from today, two adults.
 */
function HotelDestinations() {
  const { api, currency } = useApp();
  const { t } = useT();
  const format = useFormatters();
  const router = useRouter();
  const destinations = useQuery({
    queryKey: ['hotel-destinations', currency],
    staleTime: FIVE_MINUTES,
    queryFn: async (): Promise<Destination[]> => {
      const { data } = await api.GET('/v1/destinations/hotels', {
        params: { query: { currency } },
      });
      return data?.destinations ?? [];
    },
  });
  if (!destinations.data || destinations.data.length === 0) return null;
  const open = (destination: Destination) => {
    const params = new URLSearchParams({
      dest: destination.city.id,
      checkin: daysFromToday(14),
      checkout: daysFromToday(16),
      room: '2',
    });
    router.push(`/search/hotels?${params.toString()}` as Href);
  };
  return (
    <View testID="home-hotel-destinations" className="gap-3">
      <Heading>{t('sections.destinations.heading')}</Heading>
      {destinations.data.slice(0, HOME_DESTINATIONS).map((destination) => {
        const facts = [
          destination.hotelCount !== null
            ? t('common.hotels', { count: destination.hotelCount })
            : t('sections.destinations.noPrice'),
          ...(destination.fromPricePerNight
            ? [
                t('common.fromPricePerNight', {
                  price: format.moneyFrom(destination.fromPricePerNight),
                }),
              ]
            : []),
        ].join(' · ');
        return (
          <View key={destination.id} testID={`home-destination-${destination.slug}`}>
            <Card
              onPress={() => open(destination)}
              accessibilityLabel={`${destination.city.name}, ${destination.country.name}. ${facts}`}
              className="gap-1 p-4"
            >
              <View className="flex-row flex-wrap items-center gap-2">
                <Text className="font-heading text-h4 text-heading">{destination.city.name}</Text>
                {destination.sample ? (
                  <Badge variant="neutral">{t('common.sampleRate')}</Badge>
                ) : null}
              </View>
              <Text className="font-body text-body-sm text-foreground">
                {destination.country.name}
              </Text>
              <Text className="font-body-bold text-body-sm text-heading">{facts}</Text>
            </Card>
          </View>
        );
      })}
    </View>
  );
}

/**
 * Cars: cars free to rent for the days the rental search starts with (two days, five days from
 * today), with the daily rate. Tapping one opens the car for those days.
 */
function RentalCars() {
  const { api } = useApp();
  const { t } = useT();
  const format = useFormatters();
  const router = useRouter();
  const pickupAt = `${daysFromToday(5)}T10:00`;
  const returnAt = `${daysFromToday(7)}T10:00`;
  const cars = useQuery({
    queryKey: ['home-rental-cars', pickupAt, returnAt],
    staleTime: FIVE_MINUTES,
    queryFn: async (): Promise<Car[]> => {
      const { data } = await api.GET('/v1/rentals/vehicles', {
        params: { query: { pickupAt, returnAt } },
      });
      return data?.vehicles ?? [];
    },
  });
  if (!cars.data || cars.data.length === 0) return null;
  const query = `pickupAt=${encodeURIComponent(pickupAt)}&returnAt=${encodeURIComponent(returnAt)}`;
  return (
    <View testID="home-rental-cars" className="gap-3">
      <Heading>{t('cars.hub.rentals.title')}</Heading>
      {cars.data.slice(0, HOME_PICKS).map((car) => {
        const name = `${car.make} ${car.model} (${car.year})`;
        const rate = t('cars.rentals.perDay', { price: format.money(car.daily) });
        return (
          <View key={car.id} testID={`home-rental-car-${car.slug}`}>
            <Card
              onPress={() => router.push(`/rentals/${car.slug}?${query}` as Href)}
              accessibilityLabel={`${name}. ${rate}`}
              className="gap-1 p-4"
            >
              <View className="flex-row flex-wrap items-center gap-2">
                <Text className="font-heading text-h4 text-heading">{name}</Text>
                {car.sample ? <Badge variant="neutral">{t('cars.sample')}</Badge> : null}
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
              <Text className="font-body-bold text-body-sm text-heading">{rate}</Text>
            </Card>
          </View>
        );
      })}
    </View>
  );
}

/** Packages or tours: the first few on sale, and the way to the rest. */
function CatalogPicks({ kind }: { kind: CatalogKind }) {
  const { api, currency } = useApp();
  const { t } = useT();
  const router = useRouter();
  const picks = useQuery({
    queryKey: ['home-catalog', kind, currency],
    staleTime: FIVE_MINUTES,
    queryFn: async (): Promise<Product[]> => {
      const query = { currency, limit: HOME_PICKS };
      if (kind === 'package') {
        return (await api.GET('/v1/packages', { params: { query } })).data?.packages ?? [];
      }
      return (await api.GET('/v1/tours', { params: { query } })).data?.tours ?? [];
    },
  });
  if (!picks.data || picks.data.length === 0) return null;
  return (
    <View testID={`home-${kind}s`} className="gap-3">
      <Heading>
        {kind === 'package' ? t('sections.teaser.packagesTitle') : t('sections.teaser.toursTitle')}
      </Heading>
      {picks.data.slice(0, HOME_PICKS).map((item) => (
        <ProductRow key={item.id} item={item} kind={kind} testIDPrefix="home-product" />
      ))}
      <Button
        variant="ghost"
        onPress={() => router.push(kind === 'package' ? '/packages' : '/tours')}
      >
        {kind === 'package' ? t('inhouse.noResults.packages') : t('inhouse.noResults.tours')}
      </Button>
    </View>
  );
}

export type HomeVertical = 'flights' | 'hotels' | 'packages' | 'tours' | 'cars';

/**
 * What Home shows under the search card follows the tab: flight deals under Flights, hotel
 * destinations under Hotels, cars to rent under Cars, and the first packages and tours under
 * theirs. A tab with nothing to show leaves the space empty; another tab's content never fills it.
 */
export function HomeSection({
  vertical,
  deals,
  rentals,
}: {
  vertical: HomeVertical;
  deals: readonly Deal[] | undefined;
  /** Car rental is on (or the API cannot say, ADR-049). */
  rentals: boolean;
}) {
  switch (vertical) {
    case 'flights':
      return <FlightDeals deals={deals} />;
    case 'hotels':
      return <HotelDestinations />;
    case 'cars':
      return rentals ? <RentalCars /> : null;
    case 'packages':
      return <CatalogPicks kind="package" />;
    case 'tours':
      return <CatalogPicks kind="tour" />;
  }
}
