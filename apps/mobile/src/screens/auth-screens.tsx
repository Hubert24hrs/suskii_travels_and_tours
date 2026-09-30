import type { Schemas } from '@suskii/api-client';
import { Button, Input } from '@suskii/ui-native';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text } from 'react-native';

import { useT } from '../providers/app-provider';
import { useAuth, type SignInOutcome } from '../providers/auth';

function useOutcomeText() {
  const { t } = useT();
  return (outcome: SignInOutcome): string | null =>
    outcome.status === 'invalid'
      ? t('mobile.auth.invalid')
      : outcome.status === 'locked'
        ? t('mobile.auth.locked')
        : outcome.status === 'error'
          ? t('mobile.auth.error')
          : null;
}

/** Email and password sign-in, then TOTP or a recovery code when MFA is on (ADR-020). */
export function SignInScreen() {
  const { t } = useT();
  const router = useRouter();
  const { signIn, verifyMfa } = useAuth();
  const describe = useOutcomeText();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [challenge, setChallenge] = useState<Schemas['MfaChallenge'] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const finish = (outcome: SignInOutcome) => {
    if (outcome.status === 'signed-in') {
      router.back();
      return;
    }
    if (outcome.status === 'mfa') {
      setChallenge(outcome.challenge);
      return;
    }
    setError(challenge ? t('mobile.auth.mfaInvalid') : describe(outcome));
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      finish(
        challenge
          ? await verifyMfa(challenge.mfaToken, code.trim())
          : await signIn(email.trim(), password),
      );
    } catch {
      setError(t('mobile.networkError'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      className="flex-1 bg-background"
    >
      <ScrollView contentContainerClassName="gap-4 p-4" keyboardShouldPersistTaps="handled">
        {challenge ? (
          <>
            <Text accessibilityRole="header" className="font-heading text-h3 text-heading">
              {t('mobile.auth.mfaTitle')}
            </Text>
            <Text className="font-body text-body text-foreground">{t('mobile.auth.mfaBody')}</Text>
            <Input
              label={t('mobile.auth.mfaCode')}
              value={code}
              onChangeText={setCode}
              autoComplete="one-time-code"
              textContentType="oneTimeCode"
              autoCapitalize="none"
            />
          </>
        ) : (
          <>
            <Input
              testID="sign-in-email"
              label={t('mobile.auth.email')}
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
              textContentType="username"
            />
            <Input
              testID="sign-in-password"
              label={t('mobile.auth.password')}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoComplete="current-password"
              textContentType="password"
            />
          </>
        )}
        {error ? (
          <Text accessibilityRole="alert" className="font-body text-body-sm text-danger">
            {error}
          </Text>
        ) : null}
        <Button testID="sign-in-submit" fullWidth loading={busy} onPress={() => void submit()}>
          {challenge ? t('mobile.auth.mfaSubmit') : t('mobile.auth.submitSignIn')}
        </Button>
        {!challenge ? (
          <Button variant="ghost" onPress={() => router.replace('/register')}>
            {t('mobile.auth.toRegister')}
          </Button>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/** Registration always answers the same way, so it never reveals whether an email exists. */
export function RegisterScreen() {
  const { t } = useT();
  const router = useRouter();
  const { register } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  const submit = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const result = await register(email.trim(), password);
      setMessage(
        result === 'accepted'
          ? { text: t('mobile.auth.registered'), ok: true }
          : {
              text:
                result === 'invalid' ? t('mobile.auth.registerInvalid') : t('mobile.auth.error'),
              ok: false,
            },
      );
    } catch {
      setMessage({ text: t('mobile.networkError'), ok: false });
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      className="flex-1 bg-background"
    >
      <ScrollView contentContainerClassName="gap-4 p-4" keyboardShouldPersistTaps="handled">
        <Input
          label={t('mobile.auth.email')}
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
          textContentType="username"
        />
        <Input
          label={t('mobile.auth.password')}
          hint={t('mobile.auth.passwordHint')}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete="new-password"
          textContentType="newPassword"
        />
        {message ? (
          <Text
            accessibilityRole="alert"
            className={
              message.ok
                ? 'font-body text-body-sm text-success'
                : 'font-body text-body-sm text-danger'
            }
          >
            {message.text}
          </Text>
        ) : null}
        <Button fullWidth loading={busy} onPress={() => void submit()}>
          {t('mobile.auth.submitRegister')}
        </Button>
        <Button variant="ghost" onPress={() => router.replace('/sign-in')}>
          {t('mobile.auth.toSignIn')}
        </Button>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
