import type { Schemas } from '@suskii/api-client';
import { useFormatters } from '@suskii/i18n/react';
import { Badge, Card } from '@suskii/ui-native';
import { useQuery } from '@tanstack/react-query';
import { useRouter, type Href } from 'expo-router';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { Loading, Notice } from '../components/states';
import { useApp, useT } from '../providers/app-provider';

type Kind = 'package' | 'tour';
type Product = Schemas['PackageCard'] | Schemas['TourCard'];

const isPackage = (item: Product): item is Schemas['PackageCard'] => 'nights' in item;

/** One product: title, place, length, next date and the "from" price per adult. */
function ProductRow({ item, kind }: { item: Product; kind: Kind }) {
  const { t } = useT();
  const format = useFormatters();
  const router = useRouter();
  const facts = [
    `${item.cityName}, ${format.country(item.countryCode)}`,
    isPackage(item)
      ? t('inhouse.nights', { count: item.nights })
      : t('inhouse.duration', {
          hours: Math.floor(item.durationMinutes / 60),
          minutes: item.durationMinutes % 60,
        }),
    t('inhouse.nextDate', { date: format.date(item.nextDeparture.slice(0, 10), 'medium') }),
  ];
  return (
    <Pressable
      testID={`product-${item.slug}`}
      accessibilityRole="button"
      accessibilityLabel={`${item.title}. ${t('inhouse.fromPerAdult', { price: format.moneyFrom(item.fromPrice) })}`}
      onPress={() =>
        router.push(`/${kind === 'package' ? 'packages' : 'tours'}/${item.slug}` as Href)
      }
    >
      <Card className="gap-2 p-4">
        <View className="flex-row flex-wrap items-center gap-2">
          <Text className="font-heading text-h4 text-heading">{item.title}</Text>
          {item.sample ? <Badge variant="neutral">{t('inhouse.sample')}</Badge> : null}
        </View>
        <Text className="font-body text-body-sm text-foreground">{item.summary}</Text>
        <Text className="font-body text-caption text-muted">{facts.join(' · ')}</Text>
        <Text className="font-body-bold text-body text-heading">
          {t('inhouse.fromPerAdult', { price: format.moneyFrom(item.fromPrice) })}
        </Text>
      </Card>
    </Pressable>
  );
}

/** Packages or tours on sale (ADR-025), newest prices from the API; tap one to book. */
function CatalogList({ kind }: { kind: Kind }) {
  const { api, currency } = useApp();
  const { t } = useT();
  const list = useQuery({
    queryKey: ['catalog', kind, currency],
    queryFn: async (): Promise<Product[]> => {
      if (kind === 'package') {
        const { data, response } = await api.GET('/v1/packages', {
          params: { query: { currency } },
        });
        if (!data) throw new Error(String(response.status));
        return data.packages;
      }
      const { data, response } = await api.GET('/v1/tours', { params: { query: { currency } } });
      if (!data) throw new Error(String(response.status));
      return data.tours;
    },
  });
  if (list.isPending) return <Loading label={t('mobile.loading')} />;
  if (!list.data)
    return (
      <Notice
        body={t('mobile.networkError')}
        action={t('mobile.retry')}
        onAction={() => void list.refetch()}
      />
    );
  if (list.data.length === 0) return <Notice body={t('mobile.catalog.empty')} />;
  return (
    <ScrollView
      testID={`catalog-${kind}`}
      className="flex-1 bg-background"
      contentContainerClassName="gap-3 p-4 pb-12"
    >
      {list.data.map((item) => (
        <ProductRow key={item.id} item={item} kind={kind} />
      ))}
    </ScrollView>
  );
}

export function PackagesScreen() {
  return <CatalogList kind="package" />;
}

export function ToursScreen() {
  return <CatalogList kind="tour" />;
}
