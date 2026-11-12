import { useFormatters } from '@suskii/i18n/react';
import { Button, Card } from '@suskii/ui-native';
import { useQuery } from '@tanstack/react-query';
import { ScrollView, Share, Text, View } from 'react-native';

import { RequireAccount } from '../components/account/require-account';
import { Loading, Notice } from '../components/states';
import { useApp, useT } from '../providers/app-provider';

const COUNTED = ['pending', 'qualified', 'rewarded', 'review', 'rejected'] as const;

function Referrals() {
  const { api } = useApp();
  const { t } = useT();
  const format = useFormatters();
  const referrals = useQuery({
    queryKey: ['referrals'],
    queryFn: async () => {
      const { data } = await api.GET('/v1/me/referrals');
      if (!data) throw new Error('referrals');
      return data;
    },
  });

  if (referrals.isPending) return <Loading label={t('mobile.loading')} />;
  if (!referrals.data) {
    return (
      <Notice
        body={t('account.loadError')}
        action={t('account.retry')}
        onAction={() => void referrals.refetch()}
      />
    );
  }
  const { code, shareUrl, rewards, counts, referredBy } = referrals.data;

  // The system share sheet: the traveller picks the app; nothing is sent by Suskii.
  const share = () =>
    Share.share({ message: t('mobile.account.referralMessage', { code, url: shareUrl }) });

  return (
    <ScrollView
      testID="referrals"
      className="flex-1 bg-background"
      contentContainerClassName="gap-4 p-4 pb-12"
    >
      <Card className="gap-3 p-4">
        <Text className="font-body text-body text-foreground">{t('account.referrals.intro')}</Text>
        <Text className="font-body text-body-sm text-muted">{t('account.referrals.code')}</Text>
        <Text
          testID="referral-code"
          selectable
          className="font-heading text-h2 tracking-wide text-heading"
        >
          {code}
        </Text>
        <Button testID="referral-share" onPress={() => void share()}>
          {t('mobile.account.referralShare')}
        </Button>
        <Text className="font-body text-body text-foreground">
          {rewards.referrer && rewards.referee
            ? t('account.referrals.rewards', {
                referrer: format.money(rewards.referrer),
                referee: format.money(rewards.referee),
              })
            : t('account.referrals.noRewards')}
        </Text>
        {rewards.minSpend ? (
          <Text className="font-body text-body-sm text-muted">
            {t('account.referrals.minSpend', { amount: format.money(rewards.minSpend) })}
          </Text>
        ) : null}
      </Card>
      <Card className="gap-2 p-4">
        {COUNTED.map((status) => (
          <View key={status} className="flex-row justify-between py-1">
            <Text className="font-body text-body text-foreground">
              {t(`account.referrals.counts.${status}`)}
            </Text>
            <Text testID={`referrals-${status}`} className="font-body-bold text-body text-heading">
              {format.number(counts[status])}
            </Text>
          </View>
        ))}
      </Card>
      {referredBy ? (
        <Text className="font-body text-body-sm text-muted">
          {t('account.referrals.referredBy', {
            status: t(`account.referrals.counts.${referredBy.status}`),
          })}
        </Text>
      ) : null}
    </ScrollView>
  );
}

/** The account's invite code, shared through the system share sheet (ADR-031). */
export function ReferralsScreen() {
  return (
    <RequireAccount>
      <Referrals />
    </RequireAccount>
  );
}
