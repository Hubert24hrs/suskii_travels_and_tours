import { Button, Card, Tabs } from '@suskii/ui-native';
import { useRouter, type Href } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DealList, useDeals } from '../components/deal-list';
import { FlightSearchForm } from '../components/search/flight-search-form';
import { HotelSearchForm } from '../components/search/hotel-search-form';
import { ServerUnreachable } from '../components/server-unreachable';
import { anyCarsProduct, useCarsFeaturesQuery, type CarsFeatures } from '../lib/cars';
import { useT } from '../providers/app-provider';

type Vertical = 'flights' | 'hotels' | 'packages' | 'tours' | 'cars';

/** Packages and tours are browsed rather than searched: a short pitch and the way in. */
function Browse({ vertical }: { vertical: 'packages' | 'tours' }) {
  const { t } = useT();
  const router = useRouter();
  return (
    <View className="gap-3">
      <Text className="font-body text-body text-foreground">
        {vertical === 'packages' ? t('mobile.home.packagesBody') : t('mobile.home.toursBody')}
      </Text>
      <Button
        testID={`browse-${vertical}`}
        fullWidth
        onPress={() => router.push(`/${vertical}` as Href)}
      >
        {vertical === 'packages' ? t('mobile.home.browsePackages') : t('mobile.home.browseTours')}
      </Button>
    </View>
  );
}

/**
 * The Cars products as direct ways in. `null` means the API could not say which are on (it
 * cannot be reached), so every product is listed and its screen explains what failed.
 */
function CarsProducts({ features }: { features: CarsFeatures | null }) {
  const { t } = useT();
  const router = useRouter();
  const products = [
    { key: 'buses', on: features?.buses ?? true, label: t('mobile.home.carsBuses') },
    { key: 'rides', on: features?.rides ?? true, label: t('mobile.home.carsRides') },
    { key: 'rentals', on: features?.rentals ?? true, label: t('mobile.home.carsRentals') },
  ] as const;
  return (
    <View testID="home-cars-products" className="gap-3">
      <Text className="font-body text-body text-foreground">{t('mobile.home.carsBody')}</Text>
      {products
        .filter((product) => product.on)
        .map((product) => (
          <Button
            key={product.key}
            testID={`home-cars-${product.key}`}
            fullWidth
            onPress={() => router.push(`/${product.key}` as Href)}
          >
            {product.label}
          </Button>
        ))}
    </View>
  );
}

/**
 * Home: the search card (flights, hotels, packages, tours and Cars), the Cars products and the
 * freshest deals. Cars shows while a product is on, and while the API cannot be reached, so it is
 * never silently missing.
 */
export function HomeScreen() {
  const { t } = useT();
  const router = useRouter();
  const [vertical, setVertical] = useState<Vertical>('flights');
  const deals = useDeals(4);
  const cars = useCarsFeaturesQuery();
  const unreachable = cars.isError || deals.isError;
  const carsFeatures = cars.data ?? null;
  const showCars = cars.isError || anyCarsProduct(carsFeatures);
  const current: Vertical = vertical === 'cars' && !showCars ? 'flights' : vertical;
  const retry = () => {
    void cars.refetch();
    void deals.refetch();
  };
  return (
    <SafeAreaView edges={['top']} className="flex-1 bg-background">
      <ScrollView contentContainerClassName="gap-6 p-4 pb-12" keyboardShouldPersistTaps="handled">
        <View className="gap-2">
          <Text
            accessibilityRole="header"
            className="font-heading-extrabold text-hero-mobile text-heading"
          >
            {t('hero.headline')}
          </Text>
          <Text className="font-body text-body text-foreground">{t('hero.subheadline')}</Text>
        </View>
        {unreachable ? <ServerUnreachable onRetry={retry} /> : null}
        <Card className="gap-4 p-4">
          <Tabs
            label={t('search.label')}
            items={[
              { value: 'flights', label: t('search.tabs.flights'), testID: 'search-tab-flights' },
              { value: 'hotels', label: t('search.tabs.hotels'), testID: 'search-tab-hotels' },
              // Third, so it shows without scrolling the tabs on a narrow phone.
              ...(showCars
                ? [
                    {
                      value: 'cars' as const,
                      label: t('mobile.home.carsTab'),
                      testID: 'search-tab-cars',
                    },
                  ]
                : []),
              {
                value: 'packages',
                label: t('search.tabs.packages'),
                testID: 'search-tab-packages',
              },
              { value: 'tours', label: t('search.tabs.tours'), testID: 'search-tab-tours' },
            ]}
            value={current}
            onValueChange={setVertical}
          />
          {current === 'flights' ? (
            <FlightSearchForm />
          ) : current === 'hotels' ? (
            <HotelSearchForm />
          ) : current === 'cars' ? (
            <CarsProducts features={carsFeatures} />
          ) : (
            <Browse vertical={current} />
          )}
        </Card>
        {showCars ? (
          <Card className="gap-3 p-4">
            <Text accessibilityRole="header" className="font-heading text-h4 text-heading">
              {t('mobile.home.carsHeading')}
            </Text>
            <Text className="font-body text-body-sm text-foreground">
              {t('mobile.home.carsBody')}
            </Text>
            <Button testID="home-cars" variant="secondary" onPress={() => router.push('/cars')}>
              {t('mobile.home.carsCta')}
            </Button>
          </Card>
        ) : null}
        {deals.data && deals.data.length > 0 ? (
          <View className="gap-3">
            <Text accessibilityRole="header" className="font-heading text-h3 text-heading">
              {t('mobile.home.dealsHeading')}
            </Text>
            <DealList deals={deals.data} />
            <Button variant="ghost" onPress={() => router.push('/deals')}>
              {t('mobile.home.seeAllDeals')}
            </Button>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
