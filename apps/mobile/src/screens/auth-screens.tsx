import type { Schemas } from '@suskii/api-client';
import { normalisePhone, parseReferralCode, phoneSchema } from '@suskii/shared';
import { Button, Input } from '@suskii/ui-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text } from 'react-native';

import { FingerprintOffer } from '../components/auth/fingerprint-offer';
import { SocialButtons } from '../components/auth/social-buttons';
import { biometrics } from '../lib/biometric';
import { useT } from '../providers/app-provider';
import {
  clearMfaHandOff,
  handOffMfa,
  mfaHandOff,
  useAuth,
  type SignInOutcome,
} from '../providers/auth';

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

/**
 * After signing in: offers fingerprint sign-in once when the phone can use it and it is off
 * (ADR-067), otherwise closes the sign-in screen.
 */
function useSignedIn(): { offer: boolean; signedIn: () => void; done: () => void } {
  const router = useRouter();
  const [offer, setOffer] = useState(false);
  const done = () => router.back();
  const signedIn = () => {
    if (biometrics.enabled()) {
      done();
      return;
    }
    void biometrics.available().then((available) => (available ? setOffer(true) : done()));
  };
  return { offer, signedIn, done };
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
  const { signIn, verifyMfa, requestCode, verifyCode, fingerprintSignIn } = useAuth();
  const describe = useOutcomeText();
  const referral = useReferralParam();
  const { offer, signedIn, done } = useSignedIn();
  const [fingerprint] = useState(() => biometrics.enabled());
  const [method, setMethod] = useState<'password' | 'code'>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [codeSentTo, setCodeSentTo] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  // A second factor started on Register (by password, Google or Apple) continues here.
  const [challenge, setChallenge] = useState<Schemas['MfaChallenge'] | null>(mfaHandOff);
  useEffect(clearMfaHandOff, []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const finish = (outcome: SignInOutcome) => {
    if (outcome.status === 'signed-in') {
      signedIn();
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

  const withFingerprint = () =>
    run(async () => {
      const outcome = await fingerprintSignIn(t('mobile.auth.fingerprint.prompt'));
      if (outcome.status === 'cancelled') return;
      if (outcome.status === 'expired') {
        setError(t('mobile.auth.fingerprint.expired'));
        return;
      }
      if (outcome.status === 'signed-in') {
        done();
        return;
      }
      finish(outcome);
    });

  const switchMethod = () => {
    setMethod(method === 'password' ? 'code' : 'password');
    setCodeSentTo(null);
    setCode('');
    setError(null);
  };

  if (offer) {
    return (
      <Form>
        <FingerprintOffer onDone={done} />
      </Form>
    );
  }

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
      {fingerprint ? (
        <Button
          testID="sign-in-fingerprint"
          fullWidth
          loading={busy}
          onPress={() => void withFingerprint()}
        >
          {t('mobile.auth.fingerprint.signIn')}
        </Button>
      ) : null}
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
          <Text className="font-body text-body-sm text-muted">{t('auth.signIn.smsNote')}</Text>
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
      <SocialButtons referralCode={referral || undefined} onOutcome={finish} />
      <Button
        testID="sign-in-to-register"
        variant="ghost"
        onPress={() => router.replace('/register')}
      >
        {t('mobile.auth.toRegister')}
      </Button>
    </Form>
  );
}

/**
 * Registration always answers the same way, so it never reveals whether an email exists; the app
 * then signs straight in. Google and Apple create the account in one step (ADR-067).
 */
export function RegisterScreen() {
  const { t } = useT();
  const router = useRouter();
  const { register } = useAuth();
  const { offer, signedIn, done } = useSignedIn();
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
      if (result.status === 'signed-in') {
        signedIn();
        return;
      }
      if (result.status === 'mfa') {
        // The email already had an account with this password and MFA: finish on Sign in.
        handOffMfa(result.challenge);
        router.replace('/sign-in');
        return;
      }
      setMessage({
        text:
          result.status === 'existing'
            ? t('mobile.auth.registeredExisting')
            : result.status === 'weak'
              ? t('auth.register.breached')
              : result.status === 'invalid'
                ? t('mobile.auth.registerInvalid')
                : result.status === 'locked'
                  ? t('mobile.auth.locked')
                  : t('mobile.auth.error'),
        ok: false,
      });
    } catch {
      setMessage({ text: t('mobile.networkError'), ok: false });
    } finally {
      setBusy(false);
    }
  };

  const socialOutcome = (outcome: SignInOutcome) => {
    if (outcome.status === 'signed-in') signedIn();
    else if (outcome.status === 'mfa') {
      handOffMfa(outcome.challenge);
      router.replace('/sign-in');
    }
  };

  if (offer) {
    return (
      <Form>
        <FingerprintOffer onDone={done} />
      </Form>
    );
  }

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
      <SocialButtons
        referralCode={referral.trim() ? (parseReferralCode(referral) ?? undefined) : undefined}
        onOutcome={socialOutcome}
      />
      <Button
        testID="register-to-sign-in"
        variant="ghost"
        onPress={() => router.replace('/sign-in')}
      >
        {t('mobile.auth.toSignIn')}
      </Button>
    </Form>
  );
}
