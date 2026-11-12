import { ScrollView, Text } from 'react-native';

import { DealList, useDeals } from '../components/deal-list';
import { Loading, Notice } from '../components/states';
import { useT } from '../providers/app-provider';

/** The latest cheapest fares on the top routes (refreshed by the worker, ADR-011). */
export function DealsScreen() {
  const { t } = useT();
  const deals = useDeals(20);
  if (deals.isPending) return <Loading label={t('mobile.loading')} />;
  if (!deals.data) {
    return (
      <Notice
        body={t('mobile.networkError')}
        action={t('mobile.retry')}
        onAction={() => void deals.refetch()}
      />
    );
  }
  return (
    <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-4 p-4 pb-12">
      <Text className="font-body text-body text-foreground">{t('mobile.deals.body')}</Text>
      {deals.data.length === 0 ? (
        <Notice body={t('mobile.deals.empty')} />
      ) : (
        <DealList deals={deals.data} />
      )}
      <Text className="font-body text-caption text-muted">{t('sections.deals.roundTripNote')}</Text>
    </ScrollView>
  );
}
