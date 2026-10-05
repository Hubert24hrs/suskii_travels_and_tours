import { Button, Card, Tabs } from '@suskii/ui-native';
import { useRouter, type Href } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DealList, useDeals } from '../components/deal-list';
import { FlightSearchForm } from '../components/search/flight-search-form';
import { HotelSearchForm } from '../components/search/hotel-search-form';
import { useT } from '../providers/app-provider';

type Vertical = 'flights' | 'hotels' | 'packages' | 'tours';

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

/** Home: the search card (flights, hotels, packages and tours) and the freshest deals. */
export function HomeScreen() {
  const { t } = useT();
  const router = useRouter();
  const [vertical, setVertical] = useState<Vertical>('flights');
  const deals = useDeals(4);
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
        <Card className="gap-4 p-4">
          <Tabs
            label={t('search.label')}
            items={[
              { value: 'flights', label: t('search.tabs.flights') },
              { value: 'hotels', label: t('search.tabs.hotels') },
              { value: 'packages', label: t('search.tabs.packages') },
              { value: 'tours', label: t('search.tabs.tours') },
            ]}
            value={vertical}
            onValueChange={setVertical}
          />
          {vertical === 'flights' ? (
            <FlightSearchForm />
          ) : vertical === 'hotels' ? (
            <HotelSearchForm />
          ) : (
            <Browse vertical={vertical} />
          )}
        </Card>
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
