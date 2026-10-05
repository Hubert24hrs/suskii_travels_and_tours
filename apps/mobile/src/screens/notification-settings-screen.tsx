import type { Schemas } from '@suskii/api-client';
import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CHANNELS,
  type NotificationCategory,
  type NotificationChannel,
} from '@suskii/shared';
import { Card, useToast } from '@suskii/ui-native';
import { useQuery } from '@tanstack/react-query';
import { ScrollView, Text, View } from 'react-native';

import { RequireAccount } from '../components/account/require-account';
import { Checkbox } from '../components/booking/form-controls';
import { Loading, Notice } from '../components/states';
import { useApp, useT } from '../providers/app-provider';

type Settings = Schemas['NotificationPreferences'];
const QUERY_KEY = ['notification-preferences'];

function Matrix() {
  const { api, queryClient } = useApp();
  const { t } = useT();
  const { toast } = useToast();
  const settings = useQuery({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      const { data } = await api.GET('/v1/me/notification-preferences');
      if (!data) throw new Error('notification-preferences');
      return data;
    },
  });

  if (settings.isPending) return <Loading label={t('mobile.loading')} />;
  if (!settings.data) {
    return (
      <Notice
        body={t('account.loadError')}
        action={t('account.retry')}
        onAction={() => void settings.refetch()}
      />
    );
  }
  const current = settings.data;

  const toggle = async (
    category: NotificationCategory,
    channel: NotificationChannel,
    enabled: boolean,
  ) => {
    // Show the change at once; the API's answer (or the previous state) replaces it.
    queryClient.setQueryData<Settings>(QUERY_KEY, {
      ...current,
      preferences: current.preferences.map((row) =>
        row.category === category && row.channel === channel ? { ...row, enabled } : row,
      ),
    });
    try {
      const { data } = await api.PATCH('/v1/me/notification-preferences', {
        body: { changes: [{ category, channel, enabled }] },
      });
      if (!data) throw new Error('notification-preferences');
      queryClient.setQueryData(QUERY_KEY, data);
    } catch {
      queryClient.setQueryData(QUERY_KEY, current);
      toast({ title: t('mobile.auth.error'), variant: 'error' });
    }
  };

  return (
    <ScrollView
      testID="notification-settings"
      className="flex-1 bg-background"
      contentContainerClassName="gap-4 p-4 pb-12"
    >
      <Text className="font-body text-body text-foreground">
        {t('account.notifications.intro')}
      </Text>
      {NOTIFICATION_CATEGORIES.map((category) => (
        <Card key={category} className="gap-1 p-4">
          <Text accessibilityRole="header" className="font-heading text-h4 text-heading">
            {t(`account.notifications.categories.${category}`)}
          </Text>
          <View>
            {NOTIFICATION_CHANNELS.map((channel) => {
              const row = current.preferences.find(
                (item) => item.category === category && item.channel === channel,
              );
              if (!row) return null;
              const label = t(`account.notifications.channels.${channel}`);
              return (
                <Checkbox
                  key={channel}
                  testID={`notify-${category}-${channel}`}
                  label={
                    row.mandatory ? `${label} (${t('account.notifications.mandatory')})` : label
                  }
                  checked={row.enabled}
                  onChange={(enabled) => {
                    if (!row.mandatory) void toggle(category, channel, enabled);
                  }}
                />
              );
            })}
          </View>
        </Card>
      ))}
      {current.phoneVerified ? null : (
        <Text className="font-body text-body-sm text-muted">
          {t('account.notifications.phoneNeeded')}
        </Text>
      )}
      <Text className="font-body text-body-sm text-muted">
        {t('account.notifications.pushHint')}
      </Text>
      <Text className="font-body text-body-sm text-muted">
        {t('account.notifications.marketingNote')}
      </Text>
    </ScrollView>
  );
}

/** Which categories reach the account on which channel; booking email stays on (ADR-032). */
export function NotificationSettingsScreen() {
  return (
    <RequireAccount>
      <Matrix />
    </RequireAccount>
  );
}
