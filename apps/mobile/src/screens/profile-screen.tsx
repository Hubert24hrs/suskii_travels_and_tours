import type { Schemas } from '@suskii/api-client';
import { Button, Card, Input, useToast } from '@suskii/ui-native';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ScrollView, Text } from 'react-native';

import { RequireAccount } from '../components/account/require-account';
import { Checkbox } from '../components/booking/form-controls';
import { Loading, Notice } from '../components/states';
import { useApp, useT } from '../providers/app-provider';

type Preferences = Schemas['AccountPreferences'];

function ProfileForm({ preferences }: { preferences: Preferences }) {
  const { api, session, user, queryClient } = useApp();
  const { t } = useT();
  const { toast } = useToast();
  const [name, setName] = useState(user?.displayName ?? '');
  const [homeAirport, setHomeAirport] = useState(preferences.homeAirport ?? '');
  const [marketing, setMarketing] = useState(preferences.marketingConsent);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const displayName = name.trim();
      if (displayName && displayName !== (user?.displayName ?? '')) {
        const { data } = await api.PATCH('/v1/me', { body: { displayName } });
        if (!data) throw new Error('profile');
        session.replaceUser(data);
      }
      const airport = homeAirport.trim().toUpperCase();
      const { data } = await api.PATCH('/v1/me/preferences', {
        body: { homeAirport: airport || null, marketingConsent: marketing },
      });
      if (!data) throw new Error('preferences');
      queryClient.setQueryData(['preferences'], data);
      toast({ title: t('account.saved'), variant: 'success' });
    } catch {
      setError(t('auth.register.invalid'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView
      testID="profile"
      className="flex-1 bg-background"
      contentContainerClassName="gap-4 p-4 pb-12"
    >
      <Card className="gap-3 p-4">
        <Text className="font-body text-body-sm text-muted">{t('account.profile.email')}</Text>
        <Text className="font-body text-body text-foreground">{user?.email ?? '—'}</Text>
        {user?.email && !user.emailVerified ? (
          <Text className="font-body text-caption text-muted">
            {t('account.profile.emailUnverified')}
          </Text>
        ) : null}
        <Text className="font-body text-body-sm text-muted">{t('account.profile.phone')}</Text>
        <Text className="font-body text-body text-foreground">
          {user?.phone ?? t('account.profile.phoneNone')}
        </Text>
      </Card>
      <Card className="gap-3 p-4">
        <Input
          testID="profile-name"
          label={t('account.profile.displayName')}
          value={name}
          onChangeText={setName}
          autoComplete="name"
          textContentType="name"
          maxLength={80}
        />
        <Input
          testID="profile-home-airport"
          label={t('account.profile.homeAirport')}
          hint={t('account.profile.homeAirportHint')}
          value={homeAirport}
          onChangeText={setHomeAirport}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={3}
        />
        <Checkbox
          testID="profile-marketing"
          label={t('account.notifications.categories.marketing')}
          checked={marketing}
          onChange={setMarketing}
        />
        <Text className="font-body text-caption text-muted">
          {t('account.notifications.marketingNote')}
        </Text>
        {error ? (
          <Text accessibilityRole="alert" className="font-body text-body-sm text-danger">
            {error}
          </Text>
        ) : null}
        <Button testID="profile-save" loading={busy} onPress={() => void save()}>
          {t('account.save')}
        </Button>
      </Card>
    </ScrollView>
  );
}

function Profile() {
  const { api } = useApp();
  const { t } = useT();
  const preferences = useQuery({
    queryKey: ['preferences'],
    queryFn: async () => {
      const { data } = await api.GET('/v1/me/preferences');
      if (!data) throw new Error('preferences');
      return data;
    },
  });
  if (preferences.isPending) return <Loading label={t('mobile.loading')} />;
  if (!preferences.data) {
    return (
      <Notice
        body={t('account.loadError')}
        action={t('account.retry')}
        onAction={() => void preferences.refetch()}
      />
    );
  }
  return <ProfileForm preferences={preferences.data} />;
}

/** Name, home airport and marketing consent (ADR-029); email and phone are shown read-only. */
export function ProfileScreen() {
  return (
    <RequireAccount>
      <Profile />
    </RequireAccount>
  );
}
