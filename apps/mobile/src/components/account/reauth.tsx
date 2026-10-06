import type { Schemas } from '@suskii/api-client';
import { Button, Card, Input } from '@suskii/ui-native';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';

import { useApp, useT } from '../../providers/app-provider';

type Requirements = Schemas['ReauthRequirements'];
export interface ReauthProof {
  password?: string;
  code?: string;
  mfaCode?: string;
  recoveryCode?: string;
}

/** The API asks for a fresh proof (ADR-029, ASVS V7.5.1): see `ReauthPrompt`. */
export const isReauthRequired = (error: unknown): boolean =>
  (error as { type?: unknown } | undefined)?.type ===
  'urn:suskii:problem:reauthentication-required';

/** Only the fields the account uses, so the API never sees an empty password. */
export const cleanProof = (proof: ReauthProof): ReauthProof =>
  Object.fromEntries(Object.entries(proof).filter(([, value]) => Boolean(value)));

/** The proof the API asks for: password, a texted code or a recent sign-in, plus MFA. */
export function ReauthFields({
  requirements,
  proof,
  onChange,
  idPrefix,
}: {
  requirements: Requirements;
  proof: ReauthProof;
  onChange: (proof: ReauthProof) => void;
  idPrefix: string;
}) {
  const { api } = useApp();
  const { t } = useT();
  const router = useRouter();
  const [sent, setSent] = useState(false);
  return (
    <View className="gap-3">
      <Text className="font-body-bold text-body-sm text-foreground">
        {t('account.reauth.heading')}
      </Text>
      {requirements.method === 'password' ? (
        <Input
          testID={`${idPrefix}-password`}
          label={t('account.reauth.password')}
          value={proof.password ?? ''}
          onChangeText={(password) => onChange({ ...proof, password })}
          secureTextEntry
          autoComplete="current-password"
          textContentType="password"
        />
      ) : requirements.method === 'sms_code' ? (
        <>
          <Button
            variant="ghost"
            onPress={() =>
              void api.POST('/v1/me/reauth/code').then(({ response }) => setSent(response.ok))
            }
          >
            {t('account.reauth.sendCode')}
          </Button>
          {sent ? (
            <Text className="font-body text-body-sm text-success">
              {t('account.reauth.codeSent')}
            </Text>
          ) : null}
          <Input
            testID={`${idPrefix}-code`}
            label={t('account.reauth.code')}
            value={proof.code ?? ''}
            onChangeText={(code) => onChange({ ...proof, code: code.trim() })}
            keyboardType="number-pad"
            autoComplete="one-time-code"
            textContentType="oneTimeCode"
            maxLength={6}
          />
        </>
      ) : (
        <>
          <Text className="font-body text-body-sm text-muted">
            {t('account.reauth.recent', { minutes: requirements.recentSignInMinutes })}
          </Text>
          <Button variant="ghost" onPress={() => router.push('/sign-in')}>
            {t('account.reauth.signInAgain')}
          </Button>
        </>
      )}
      {requirements.mfa ? (
        <Input
          testID={`${idPrefix}-mfa`}
          label={t('account.reauth.mfa')}
          hint={t('account.reauth.recovery')}
          value={proof.mfaCode ?? proof.recoveryCode ?? ''}
          autoCapitalize="none"
          onChangeText={(text) => {
            const value = text.trim();
            onChange(
              /^\d{0,6}$/.test(value)
                ? { ...proof, mfaCode: value, recoveryCode: undefined }
                : { ...proof, recoveryCode: value, mfaCode: undefined },
            );
          }}
        />
      ) : null}
    </View>
  );
}

/**
 * Shown when the API answered `reauthentication-required` to a change in how the account signs
 * in; `onConfirm` repeats the request with the proof and resolves to whether it went through.
 */
export function ReauthPrompt({
  idPrefix,
  onConfirm,
  onCancel,
}: {
  idPrefix: string;
  onConfirm: (proof: ReauthProof) => Promise<boolean>;
  onCancel: () => void;
}) {
  const { api } = useApp();
  const { t } = useT();
  const [proof, setProof] = useState<ReauthProof>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requirements = useQuery({
    queryKey: ['reauth-requirements'],
    queryFn: async () => {
      const { data } = await api.GET('/v1/me/reauth');
      if (!data) throw new Error('reauth');
      return data;
    },
  });
  if (!requirements.data) return null;
  const confirm = async () => {
    setBusy(true);
    setError(null);
    const done = await onConfirm(cleanProof(proof));
    setBusy(false);
    if (!done) setError(t('account.reauth.wrong'));
  };
  return (
    <Card testID={idPrefix} className="gap-3 p-4">
      <ReauthFields
        requirements={requirements.data}
        proof={proof}
        onChange={setProof}
        idPrefix={idPrefix}
      />
      {error ? (
        <Text accessibilityRole="alert" className="font-body text-body-sm text-danger">
          {error}
        </Text>
      ) : null}
      {requirements.data.method === 'recent_sign_in' ? null : (
        <Button testID={`${idPrefix}-confirm`} loading={busy} onPress={() => void confirm()}>
          {t('account.reauth.confirm')}
        </Button>
      )}
      <Button variant="ghost" onPress={onCancel}>
        {t('account.reauth.cancel')}
      </Button>
    </Card>
  );
}
