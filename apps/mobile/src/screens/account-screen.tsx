import { useFormatters } from '@suskii/i18n/react';
import { SUPPORTED_CURRENCIES } from '@suskii/shared';
import { Button, Card, SegmentedControl, useToast } from '@suskii/ui-native';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';

import { appConfig } from '../config';
import { followAccount } from '../lib/push';
import { useApp, useT } from '../providers/app-provider';
import { useAuth } from '../providers/auth';

/** Account: sign-in state, wallet balance, notifications, currency and sign-out. */
export function AccountScreen() {
  const { api, currency, setCurrency } = useApp();
  const { user, signOut } = useAuth();
  const { t } = useT();
  const format = useFormatters();
  const router = useRouter();
  const { toast } = useToast();
  const [signingOut, setSigningOut] = useState(false);

  const wallet = useQuery({
    queryKey: ['wallet', user?.id],
    enabled: Boolean(user),
    queryFn: async () => (await api.GET('/v1/me/wallet')).data ?? null,
  });
  const balance =
    wallet.data?.balances.find((item) => item.currency === currency) ?? wallet.data?.balances[0];

  const notifications = async () => {
    const ok = await followAccount(api, true);
    toast({
      title: ok ? t('mobile.account.notificationsOn') : t('mobile.trip.notifyOff'),
      variant: ok ? 'success' : 'info',
    });
  };

  return (
    <ScrollView
      testID="account"
      className="flex-1 bg-background"
      contentContainerClassName="gap-4 p-4 pb-12"
    >
      {user ? (
        <Card className="gap-3 p-4">
          <Text testID="signed-in-as" className="font-body text-body text-foreground">
            {t('mobile.account.signedInAs', { email: user.email ?? user.phone ?? '' })}
          </Text>
          {balance ? (
            <View>
              <Text className="font-body text-body-sm text-muted">
                {t('mobile.account.wallet')}
              </Text>
              <Text className="font-heading text-h3 text-heading">{format.money(balance)}</Text>
            </View>
          ) : null}
          <Button
            variant="ghost"
            loading={signingOut}
            onPress={() => {
              setSigningOut(true);
              void signOut().finally(() => setSigningOut(false));
            }}
          >
            {t('mobile.account.signOut')}
          </Button>
        </Card>
      ) : (
        <Card className="gap-3 p-4">
          <Text className="font-body text-body text-foreground">
            {t('mobile.account.signedOutBody')}
          </Text>
          <Button testID="account-sign-in" onPress={() => router.push('/sign-in')}>
            {t('mobile.account.signIn')}
          </Button>
          <Button variant="ghost" onPress={() => router.push('/register')}>
            {t('mobile.account.register')}
          </Button>
        </Card>
      )}

      {user ? (
        <Card className="gap-3 p-4">
          <Text accessibilityRole="header" className="font-heading text-h4 text-heading">
            {t('mobile.account.notifications')}
          </Text>
          <Text className="font-body text-body-sm text-foreground">
            {t('mobile.account.notificationsHint')}
          </Text>
          <Button variant="secondary" onPress={() => void notifications()}>
            {t('mobile.account.turnOn')}
          </Button>
        </Card>
      ) : null}

      <Card className="gap-3 p-4">
        <Text accessibilityRole="header" className="font-heading text-h4 text-heading">
          {t('mobile.account.currency')}
        </Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <SegmentedControl
            label={t('mobile.account.currency')}
            options={SUPPORTED_CURRENCIES.map((code) => ({ value: code, label: code }))}
            value={currency}
            onValueChange={setCurrency}
          />
        </ScrollView>
      </Card>

      <Text className="font-body text-caption text-muted">{t('mobile.account.privacy')}</Text>
      <Text className="font-body text-caption text-muted">
        {t('mobile.account.version', { version: appConfig.version })}
      </Text>
    </ScrollView>
  );
}
