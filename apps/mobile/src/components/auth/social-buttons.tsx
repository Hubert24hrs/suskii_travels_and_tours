import { Button, Input, Modal } from '@suskii/ui-native';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Text, View } from 'react-native';

import { useApp, useT } from '../../providers/app-provider';
import { useAuth, type SignInOutcome } from '../../providers/auth';
import {
  mockProviderToken,
  providerToken,
  type ProviderToken,
  type SocialProvider,
} from '../../lib/social-sign-in';

const PROVIDERS: readonly SocialProvider[] = ['google', 'apple'];

/**
 * "Continue with Google" and "Continue with Apple" (ADR-067), shown when the API offers them. On
 * the test server the API's mock stands in: the button asks which email to sign in as, and the
 * same email always opens the same account.
 */
export function SocialButtons({
  referralCode,
  onOutcome,
}: {
  referralCode?: string | undefined;
  onOutcome: (outcome: SignInOutcome) => void;
}) {
  const { t } = useT();
  const { api } = useApp();
  const { socialProviders, socialSignIn } = useAuth();
  const providers = useQuery({
    queryKey: ['auth', 'social-providers'],
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: socialProviders,
  });
  const [busy, setBusy] = useState<SocialProvider | null>(null);
  const [mock, setMock] = useState<SocialProvider | null>(null);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const offered = PROVIDERS.filter((provider) => providers.data?.[provider]);
  if (offered.length === 0) return null;

  const complete = async (provider: SocialProvider, token: ProviderToken) => {
    if (token.status === 'cancelled') return;
    if (token.status === 'error') {
      setError(t('auth.social.failed'));
      return;
    }
    const outcome = await socialSignIn(provider, token, referralCode);
    if (outcome.status === 'signed-in' || outcome.status === 'mfa') {
      setMock(null);
      onOutcome(outcome);
    } else {
      setError(t('auth.social.failed'));
    }
  };

  const start = async (provider: SocialProvider) => {
    setError(null);
    if (providers.data?.mock) {
      setMock(provider);
      return;
    }
    setBusy(provider);
    try {
      await complete(provider, await providerToken(api, provider));
    } catch {
      setError(t('mobile.networkError'));
    } finally {
      setBusy(null);
    }
  };

  const submitMock = async () => {
    if (!mock) return;
    setBusy(mock);
    setError(null);
    try {
      await complete(mock, await mockProviderToken(api, mock, email.trim(), name.trim()));
    } catch {
      setError(t('mobile.networkError'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <View testID="social-sign-in" className="gap-3">
      <Text className="text-center font-body text-body-sm text-muted">{t('auth.social.or')}</Text>
      {offered.map((provider) => (
        <Button
          key={provider}
          testID={`social-${provider}`}
          variant="secondary"
          fullWidth
          loading={busy === provider && !mock}
          onPress={() => void start(provider)}
        >
          {t(provider === 'google' ? 'auth.social.google' : 'auth.social.apple')}
        </Button>
      ))}
      {error && !mock ? (
        <Text accessibilityRole="alert" className="font-body text-body-sm text-danger">
          {error}
        </Text>
      ) : null}
      <Modal
        open={mock !== null}
        onOpenChange={(open) => {
          if (!open) setMock(null);
        }}
        title={t('auth.social.mockTitle')}
        description={t('auth.social.mockIntro')}
        closeLabel={t('common.close')}
        footer={
          <Button
            testID="social-mock-submit"
            fullWidth
            loading={busy !== null}
            onPress={() => void submitMock()}
          >
            {t('auth.social.mockSubmit')}
          </Button>
        }
      >
        <Input
          testID="social-mock-email"
          label={t('auth.social.mockEmail')}
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
        />
        <Input
          testID="social-mock-name"
          label={t('auth.social.mockName')}
          value={name}
          onChangeText={setName}
          autoComplete="name"
        />
        {error ? (
          <Text accessibilityRole="alert" className="font-body text-body-sm text-danger">
            {error}
          </Text>
        ) : null}
      </Modal>
    </View>
  );
}
