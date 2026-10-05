import { useFormatters } from '@suskii/i18n/react';
import { Button, Card } from '@suskii/ui-native';
import { useQuery } from '@tanstack/react-query';
import { ScrollView, Text, View } from 'react-native';

import { RequireAccount } from '../components/account/require-account';
import { Loading, Notice } from '../components/states';
import { useApp, useT } from '../providers/app-provider';

function Alerts() {
  const { api } = useApp();
  const { t } = useT();
  const format = useFormatters();
  const alerts = useQuery({
    queryKey: ['price-alerts'],
    queryFn: async () => {
      const { data } = await api.GET('/v1/me/price-alerts');
      if (!data) throw new Error('price-alerts');
      return data;
    },
  });

  if (alerts.isPending) return <Loading label={t('mobile.loading')} />;
  if (!alerts.data) {
    return (
      <Notice
        body={t('account.loadError')}
        action={t('account.retry')}
        onAction={() => void alerts.refetch()}
      />
    );
  }

  const remove = async (id: string) => {
    await api.DELETE('/v1/me/price-alerts/{id}', { params: { path: { id } } });
    await alerts.refetch();
  };
  // "October 2026" from a YYYY-MM month: the long date of its first day without the day.
  const month = (value: string) => format.date(`${value}-01`, 'long').replace(/^\d+\s/, '');

  return (
    <ScrollView
      testID="price-alerts"
      className="flex-1 bg-background"
      contentContainerClassName="gap-4 p-4 pb-12"
    >
      <Text className="font-body text-body text-foreground">{t('account.alerts.intro')}</Text>
      {alerts.data.alerts.length === 0 ? (
        <Card className="p-4">
          <Text className="font-body text-body text-muted">{t('account.alerts.empty')}</Text>
        </Card>
      ) : (
        alerts.data.alerts.map((alert) => {
          const route = t('account.alerts.route', {
            origin: alert.origin,
            destination: alert.destination,
          });
          return (
            <Card key={alert.id} testID="alert-card" className="gap-2 p-4">
              <Text className="font-body-bold text-body text-foreground">{route}</Text>
              <Text className="font-body text-body-sm text-muted">
                {alert.departureDate
                  ? t('account.alerts.on', { date: format.date(alert.departureDate) })
                  : t('account.alerts.inMonth', { month: month(alert.departureMonth ?? '') })}
                {alert.target
                  ? ` · ${t('account.alerts.target', { price: format.money(alert.target) })}`
                  : ''}
              </Text>
              <Text className="font-body text-body-sm text-foreground">
                {!alert.active
                  ? t('account.alerts.ended')
                  : alert.lastPrice
                    ? t('account.alerts.lastPrice', { price: format.money(alert.lastPrice) })
                    : t('account.alerts.notChecked')}
              </Text>
              <View className="items-start">
                <Button
                  variant="ghost"
                  accessibilityLabel={t('account.alerts.remove', { route })}
                  onPress={() => void remove(alert.id)}
                >
                  {t('account.remove')}
                </Button>
              </View>
            </Card>
          );
        })
      )}
      <Text className="font-body text-body-sm text-muted">
        {t('account.alerts.limit', { count: alerts.data.limit })}
      </Text>
    </ScrollView>
  );
}

/** Watched routes and their latest prices (ADR-032). */
export function PriceAlertsScreen() {
  return (
    <RequireAccount>
      <Alerts />
    </RequireAccount>
  );
}
