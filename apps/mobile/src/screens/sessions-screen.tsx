import { useFormatters } from '@suskii/i18n/react';
import { Badge, Button, Card, useToast } from '@suskii/ui-native';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';

import { isReauthRequired, ReauthPrompt, type ReauthProof } from '../components/account/reauth';
import { RequireAccount } from '../components/account/require-account';
import { Loading, Notice } from '../components/states';
import { useApp, useT } from '../providers/app-provider';

function Sessions() {
  const { api } = useApp();
  const { t } = useT();
  const format = useFormatters();
  const { toast } = useToast();
  const [pending, setPending] = useState<{ id: string | null } | null>(null);
  const sessions = useQuery({
    queryKey: ['sessions'],
    queryFn: async () => {
      const { data } = await api.GET('/v1/me/sessions');
      if (!data) throw new Error('sessions');
      return data.sessions;
    },
  });

  if (sessions.isPending) return <Loading label={t('mobile.loading')} />;
  if (!sessions.data) {
    return (
      <Notice
        body={t('account.loadError')}
        action={t('account.retry')}
        onAction={() => void sessions.refetch()}
      />
    );
  }

  const done = async (
    ok: boolean,
    target: string | null,
    reauth: ReauthProof | undefined,
    error: unknown,
  ): Promise<boolean> => {
    // Signing out another device asks an older session to confirm it is the owner first.
    if (!ok && !reauth && isReauthRequired(error)) {
      setPending({ id: target });
      return false;
    }
    if (!ok && reauth) return false;
    setPending(null);
    toast({
      title: ok ? t('account.security.sessions.revoked') : t('mobile.auth.error'),
      variant: ok ? 'success' : 'error',
    });
    await sessions.refetch();
    return ok;
  };
  const revoke = async (id: string, reauth?: ReauthProof) => {
    const { response, error } = await api.DELETE('/v1/me/sessions/{id}', {
      params: { path: { id } },
      body: reauth ? { reauth } : {},
    });
    return done(response.ok, id, reauth, error);
  };
  const revokeOthers = async (reauth?: ReauthProof) => {
    const { response, error } = await api.POST('/v1/me/sessions/revoke-others', {
      body: reauth ? { reauth } : {},
    });
    return done(response.ok, null, reauth, error);
  };

  return (
    <ScrollView
      testID="sessions"
      className="flex-1 bg-background"
      contentContainerClassName="gap-4 p-4 pb-12"
    >
      {sessions.data.map((session) => (
        <Card key={session.id} testID="session-card" className="gap-2 p-4">
          <View className="flex-row flex-wrap items-center gap-2">
            <Text className="font-body-bold text-body text-foreground">
              {session.userAgent ?? t('mobile.account.unknownDevice')}
            </Text>
            {session.current ? (
              <Badge variant="info">{t('account.security.sessions.current')}</Badge>
            ) : null}
          </View>
          <Text className="font-body text-body-sm text-muted">
            {t('account.security.sessions.signedIn', {
              time: format.relativeTime(session.createdAt),
              method: t(`account.security.sessions.methods.${session.authMethod}`),
            })}
          </Text>
          <Text className="font-body text-body-sm text-muted">
            {t('account.security.sessions.lastSeen', {
              time: format.relativeTime(session.lastSeenAt),
            })}
          </Text>
          {session.current ? null : (
            <Button variant="ghost" onPress={() => void revoke(session.id)}>
              {t('account.security.sessions.revoke')}
            </Button>
          )}
        </Card>
      ))}
      {sessions.data.length > 1 ? (
        <Button testID="revoke-others" variant="secondary" onPress={() => void revokeOthers()}>
          {t('account.security.sessions.revokeOthers')}
        </Button>
      ) : null}
      {pending ? (
        <ReauthPrompt
          idPrefix="sessions-reauth"
          onConfirm={(proof) => (pending.id ? revoke(pending.id, proof) : revokeOthers(proof))}
          onCancel={() => setPending(null)}
        />
      ) : null}
    </ScrollView>
  );
}

/** Devices signed in to the account, with sign-out for any but this one (ADR-007). */
export function SessionsScreen() {
  return (
    <RequireAccount>
      <Sessions />
    </RequireAccount>
  );
}
