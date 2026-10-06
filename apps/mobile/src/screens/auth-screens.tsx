import type { Schemas } from '@suskii/api-client';
import { normalisePhone, parseReferralCode, phoneSchema } from '@suskii/shared';
import { Button, Input } from '@suskii/ui-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text } from 'react-native';

import { useT } from '../providers/app-provider';
import { useAuth, type SignInOutcome } from '../providers/auth';

function useOutcomeText() {
  const { t } = useT();
  return (outcome: SignInOutcome, method: 'password' | 'code'): string | null =>
    outcome.status === 'invalid'
      ? method === 'code'
        ? t('mobile.auth.codeInvalid')
        : t('mobile.auth.invalid')
      : outcome.status === 'locked'
        ? t('mobile.auth.locked')
        : outcome.status === 'error'
          ? t('mobile.auth.error')
          : null;
}

/** A referral code from an invite link (`?ref=`), only when it is well formed (ADR-031). */
function useReferralParam(): string {
  const { ref } = useLocalSearchParams<{ ref?: string }>();
  return (typeof ref === 'string' ? parseReferralCode(ref) : null) ?? '';
}

function Form({ children }: { children: ReactNode }) {
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      className="flex-1 bg-background"
    >
      <ScrollView contentContainerClassName="gap-4 p-4" keyboardShouldPersistTaps="handled">
        {children}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function ErrorText({ message }: { message: string | null }) {
  return message ? (
    <Text accessibilityRole="alert" className="font-body text-body-sm text-danger">
      {message}
    </Text>
  ) : null;
}

/**
 * Sign-in with an email and password or with a code texted to a mobile number (which also
 * creates the account), then TOTP or a recovery code when MFA is on (ADR-007, ADR-020).
 */
export function SignInScreen() {
  const { t } = useT();
  const router = useRouter();
  const { signIn, verifyMfa, requestCode, verifyCode } = useAuth();
  const describe = useOutcomeText();
  const referral = useReferralParam();
  const [method, setMethod] = useState<'password' | 'code'>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [codeSentTo, setCodeSentTo] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [mfaCode, setMfaCode] = useState('');
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
    setError(challenge ? t('mobile.auth.mfaInvalid') : describe(outcome, method));
  };

  const run = async (step: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await step();
    } catch {
      setError(t('mobile.networkError'));
    } finally {
      setBusy(false);
    }
  };

  const sendCode = () =>
    run(async () => {
      const parsed = phoneSchema.safeParse(normalisePhone(phone));
      if (!parsed.success) {
        setError(t('mobile.auth.phoneInvalid'));
        return;
      }
      const sent = await requestCode(parsed.data);
      if (sent.status === 'sent') setCodeSentTo(parsed.data);
      else
        setError(
          sent.status === 'invalid'
            ? t('mobile.auth.phoneInvalid')
            : sent.status === 'locked'
              ? t('mobile.auth.locked')
              : t('mobile.auth.error'),
        );
    });

  const submit = () =>
    run(async () => {
      if (challenge) finish(await verifyMfa(challenge.mfaToken, mfaCode.trim()));
      else if (method === 'password') finish(await signIn(email.trim(), password));
      else if (codeSentTo) finish(await verifyCode(codeSentTo, code.trim(), referral || undefined));
    });

  const switchMethod = () => {
    setMethod(method === 'password' ? 'code' : 'password');
    setCodeSentTo(null);
    setCode('');
    setError(null);
  };

  if (challenge) {
    return (
      <Form>
        <Text accessibilityRole="header" className="font-heading text-h3 text-heading">
          {t('mobile.auth.mfaTitle')}
        </Text>
        <Text className="font-body text-body text-foreground">{t('mobile.auth.mfaBody')}</Text>
        <Input
          testID="mfa-code"
          label={t('mobile.auth.mfaCode')}
          value={mfaCode}
          onChangeText={setMfaCode}
          autoComplete="one-time-code"
          textContentType="oneTimeCode"
          autoCapitalize="none"
        />
        <ErrorText message={error} />
        <Button testID="sign-in-submit" fullWidth loading={busy} onPress={() => void submit()}>
          {t('mobile.auth.mfaSubmit')}
        </Button>
      </Form>
    );
  }

  return (
    <Form>
      {method === 'password' ? (
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
      ) : (
        <>
          <Input
            testID="sign-in-phone"
            label={t('auth.signIn.phone')}
            hint={t('auth.signIn.phoneHint')}
            value={phone}
            onChangeText={(value) => {
              setPhone(value);
              setCodeSentTo(null);
            }}
            keyboardType="phone-pad"
            autoComplete="tel"
            textContentType="telephoneNumber"
          />
          {codeSentTo ? (
            <>
              <Text
                accessibilityLiveRegion="polite"
                className="font-body text-body-sm text-foreground"
              >
                {t('auth.signIn.codeSent', { phone: codeSentTo })}
              </Text>
              <Input
                testID="sign-in-code"
                label={t('auth.signIn.code')}
                value={code}
                onChangeText={setCode}
                keyboardType="number-pad"
                autoComplete="one-time-code"
                textContentType="oneTimeCode"
                maxLength={6}
              />
            </>
          ) : null}
        </>
      )}
      <ErrorText message={error} />
      {method === 'code' && !codeSentTo ? (
        <Button testID="sign-in-send-code" fullWidth loading={busy} onPress={() => void sendCode()}>
          {t('auth.signIn.sendCode')}
        </Button>
      ) : (
        <Button testID="sign-in-submit" fullWidth loading={busy} onPress={() => void submit()}>
          {method === 'code' ? t('auth.signIn.verifyCode') : t('mobile.auth.submitSignIn')}
        </Button>
      )}
      {method === 'code' && codeSentTo ? (
        <Button variant="ghost" disabled={busy} onPress={() => void sendCode()}>
          {t('auth.signIn.resend')}
        </Button>
      ) : null}
      <Button testID="sign-in-switch" variant="ghost" onPress={switchMethod}>
        {method === 'password' ? t('mobile.auth.usePhone') : t('mobile.auth.useEmail')}
      </Button>
      <Button variant="ghost" onPress={() => router.replace('/register')}>
        {t('mobile.auth.toRegister')}
      </Button>
    </Form>
  );
}

/** Registration always answers the same way, so it never reveals whether an email exists. */
export function RegisterScreen() {
  const { t } = useT();
  const router = useRouter();
  const { register } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const invited = useReferralParam();
  const [referral, setReferral] = useState(invited);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  const submit = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const code = referral.trim() ? parseReferralCode(referral) : null;
      if (referral.trim() && !code) {
        setMessage({ text: t('mobile.auth.referralInvalid'), ok: false });
        return;
      }
      const result = await register(email.trim(), password, code ?? undefined);
      setMessage(
        result === 'accepted'
          ? { text: t('mobile.auth.registered'), ok: true }
          : {
              text:
                result === 'weak'
                  ? t('auth.register.breached')
                  : result === 'invalid'
                    ? t('mobile.auth.registerInvalid')
                    : t('mobile.auth.error'),
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
    <Form>
      <Input
        testID="register-email"
        label={t('mobile.auth.email')}
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
        autoComplete="email"
        textContentType="username"
      />
      <Input
        testID="register-password"
        label={t('mobile.auth.password')}
        hint={t('mobile.auth.passwordHint')}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="new-password"
        textContentType="newPassword"
      />
      <Input
        testID="register-referral"
        label={t('auth.register.referralCode')}
        hint={t('auth.register.referralHint')}
        value={referral}
        onChangeText={setReferral}
        autoCapitalize="characters"
        autoCorrect={false}
        maxLength={12}
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
      <Button testID="register-submit" fullWidth loading={busy} onPress={() => void submit()}>
        {t('mobile.auth.submitRegister')}
      </Button>
      <Button variant="ghost" onPress={() => router.replace('/sign-in')}>
        {t('mobile.auth.toSignIn')}
      </Button>
    </Form>
  );
}
