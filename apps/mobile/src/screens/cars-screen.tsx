import { Button, Card } from '@suskii/ui-native';
import { Stack, useRouter, type Href } from 'expo-router';
import { ScrollView, Text, View } from 'react-native';

import { ServerUnreachable } from '../components/server-unreachable';
import { Loading, Notice } from '../components/states';
import { useCarsFeaturesQuery, type CarsFeatures } from '../lib/cars';
import { useApp, useT } from '../providers/app-provider';

function Entry({
  testID,
  title,
  body,
  cta,
  href,
}: {
  testID: string;
  title: string;
  body: string;
  cta: string;
  href: Href;
}) {
  const router = useRouter();
  return (
    <Card className="gap-2 p-4">
      <Text accessibilityRole="header" className="font-heading text-h4 text-heading">
        {title}
      </Text>
      <Text className="font-body text-body-sm text-foreground">{body}</Text>
      <Button testID={testID} variant="secondary" onPress={() => router.push(href)}>
        {cta}
      </Button>
    </Card>
  );
}

/** While the API cannot be reached the products are listed; their screens say what failed. */
const UNKNOWN: Pick<CarsFeatures, 'buses' | 'rides' | 'rentals'> = {
  buses: true,
  rides: true,
  rentals: true,
};

/**
 * Buses, rides and car rental (ADR-049): the products the API has switched on, plus driver mode
 * for anyone who wants to drive and ticket scanning for bus operator agents. When the API cannot
 * be reached the screen says so, with a retry, instead of loading forever.
 */
export function CarsScreen() {
  const { t } = useT();
  const { user } = useApp();
  const query = useCarsFeaturesQuery();
  if (query.isPending) return <Loading label={t('mobile.loading')} />;
  const unreachable = query.isError;
  const features = query.data ?? UNKNOWN;
  const none = !features.buses && !features.rides && !features.rentals;
  return (
    <ScrollView
      testID="cars-hub"
      className="flex-1 bg-background"
      contentContainerClassName="gap-4 p-4 pb-12"
    >
      <Stack.Screen options={{ title: t('mobile.cars.title') }} />
      <View className="gap-2">
        <Text accessibilityRole="header" className="font-heading text-h2 text-heading">
          {t('cars.hub.heading')}
        </Text>
        <Text className="font-body text-body text-foreground">{t('cars.hub.body')}</Text>
      </View>
      {unreachable ? <ServerUnreachable onRetry={() => void query.refetch()} /> : null}
      {none ? <Notice body={t('cars.buses.noCities')} /> : null}
      {features.buses ? (
        <Entry
          testID="cars-buses"
          title={t('cars.hub.buses.title')}
          body={t('cars.hub.buses.body')}
          cta={t('cars.hub.buses.cta')}
          href="/buses"
        />
      ) : null}
      {features.rides ? (
        <Entry
          testID="cars-rides"
          title={t('cars.hub.rides.title')}
          body={t('cars.hub.rides.body')}
          cta={t('cars.hub.rides.cta')}
          href="/rides"
        />
      ) : null}
      {features.rentals ? (
        <Entry
          testID="cars-rentals"
          title={t('cars.hub.rentals.title')}
          body={t('cars.hub.rentals.body')}
          cta={t('cars.hub.rentals.cta')}
          href="/rentals"
        />
      ) : null}
      {!unreachable && features.rides ? (
        <Entry
          testID="cars-drive"
          title={t('mobile.cars.drive.title')}
          body={t('mobile.cars.drive.body')}
          cta={t('mobile.cars.drive.cta')}
          href="/driver"
        />
      ) : null}
      {!unreachable && features.buses && user?.roles.includes('operator_agent') ? (
        <Entry
          testID="cars-scan"
          title={t('mobile.cars.scan.title')}
          body={t('mobile.cars.scan.body')}
          cta={t('mobile.cars.scan.cta')}
          href="/operator/scan"
        />
      ) : null}
    </ScrollView>
  );
}
