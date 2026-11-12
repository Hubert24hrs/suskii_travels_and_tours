import type { Schemas } from '@suskii/api-client';
import { BRAND, normalisePhone, parseReferralCode, phoneSchema } from '@suskii/shared';
import { Button, Card, Input, iconColor, iconSize } from '@suskii/ui-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { openBrowserAsync } from 'expo-web-browser';
import { Eye, EyeOff, Fingerprint } from 'lucide-react-native';
import { useEffect, useState, type ReactNode } from 'react';
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';

import logo from '../../assets/logo.png';
import { FingerprintOffer } from '../components/auth/fingerprint-offer';
import { SocialButtons } from '../components/auth/social-buttons';
import { Checkbox } from '../components/booking/form-controls';
import { appConfig } from '../config';
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
  // The button always shows; until it is set up, a press says how to turn it on.
  const [fingerprintHint, setFingerprintHint] = useState<string | null>(null);
  const [method, setMethod] = useState<'password' | 'code'>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [codeSentTo, setCodeSentTo] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  // "Remember me" (ADR-108): on unless unticked; off, the session ends when the app closes.
  const [remember, setRemember] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
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
      if (challenge) finish(await verifyMfa(challenge.mfaToken, mfaCode.trim(), remember));
      else if (method === 'password') finish(await signIn(email.trim(), password, remember));
      else if (codeSentTo)
        finish(await verifyCode(codeSentTo, code.trim(), referral || undefined, remember));
    });

  const withFingerprint = () =>
    run(async () => {
      if (!fingerprint) {
        const available = await biometrics.available();
        setFingerprintHint(
          t(available ? 'mobile.auth.fingerprint.notSetUp' : 'mobile.auth.fingerprint.phoneSetup'),
        );
        return;
      }
      const outcome = await fingerprintSignIn(t('mobile.auth.fingerprint.prompt'), remember);
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

  const rememberRow = (
    <View className="gap-1">
      <View className="flex-row items-center justify-between gap-3">
        <View className="flex-1">
          <Checkbox
            testID="sign-in-remember"
            label={t('auth.signIn.remember')}
            checked={remember}
            onChange={setRemember}
          />
        </View>
        {method === 'password' ? (
          <Pressable
            testID="sign-in-forgot"
            accessibilityRole="link"
            // The reset link is emailed and opens on the website, so the request starts there too.
            onPress={() => void openBrowserAsync(`${appConfig.webBaseUrl}/forgot-password`)}
            className="min-h-12 justify-center"
          >
            <Text className="font-body-medium text-body-sm text-primary">
              {t('auth.signIn.forgot')}
            </Text>
          </Pressable>
        ) : null}
      </View>
      {remember ? null : (
        <Text
          testID="sign-in-remember-off"
          accessibilityLiveRegion="polite"
          className="font-body text-caption text-muted"
        >
          {t('mobile.auth.rememberOff')}
        </Text>
      )}
    </View>
  );

  return (
    <Form>
      <Card className="gap-5 p-6">
        <View className="gap-4">
          {/* Decorative: the line under the heading names the brand. */}
          <Image
            source={logo}
            accessibilityIgnoresInvertColors
            accessibilityElementsHidden
            importantForAccessibility="no"
            className="size-12 rounded-md"
          />
          <View className="gap-1">
            <Text
              accessibilityRole="header"
              className="font-heading-extrabold text-h2 text-heading"
            >
              {t('auth.signIn.welcome')}
            </Text>
            <Text className="font-body text-body text-muted">
              {t('auth.signIn.welcomeBody', { brand: BRAND.shortName })}
            </Text>
          </View>
        </View>
        {method === 'password' ? (
          <>
            <Input
              testID="sign-in-email"
              label={t('mobile.auth.email')}
              placeholder={t('auth.signIn.emailPlaceholder')}
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
              secureTextEntry={!showPassword}
              autoCapitalize="none"
              autoComplete="current-password"
              textContentType="password"
              trailing={
                <Pressable
                  testID="sign-in-show-password"
                  accessibilityRole="button"
                  accessibilityLabel={t(
                    showPassword ? 'auth.signIn.hidePassword' : 'auth.signIn.showPassword',
                  )}
                  onPress={() => setShowPassword((shown) => !shown)}
                  hitSlop={8}
                  className="size-10 items-center justify-center"
                >
                  {showPassword ? (
                    <EyeOff color={iconColor.muted} size={iconSize.md} />
                  ) : (
                    <Eye color={iconColor.muted} size={iconSize.md} />
                  )}
                </Pressable>
              }
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
        {rememberRow}
        <ErrorText message={error} />
        {method === 'code' && !codeSentTo ? (
          <Button
            testID="sign-in-send-code"
            fullWidth
            loading={busy}
            onPress={() => void sendCode()}
          >
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
        {/* Fingerprint sign-in (ADR-067): always shown; until it is set up, a press says how. */}
        <Button
          testID="sign-in-fingerprint"
          variant="ghost"
          fullWidth
          loading={busy && fingerprint}
          icon={<Fingerprint color={iconColor.primary} size={iconSize.md} />}
          onPress={() => void withFingerprint()}
          className="border border-primary"
        >
          {t('mobile.auth.fingerprint.signIn')}
        </Button>
        {fingerprintHint ? (
          <Text
            testID="fingerprint-hint"
            accessibilityLiveRegion="polite"
            className="font-body text-body-sm text-foreground"
          >
            {fingerprintHint}
          </Text>
        ) : null}
        <SocialButtons
          layout="row"
          referralCode={referral || undefined}
          remember={remember}
          divider={t('auth.social.orContinue')}
          onOutcome={finish}
        />
        <View className="flex-row flex-wrap items-center justify-center gap-1">
          <Text className="font-body text-body-sm text-muted">
            {t('auth.signIn.newHere', { brand: BRAND.shortName })}
          </Text>
          <Pressable
            testID="sign-in-to-register"
            accessibilityRole="link"
            onPress={() => router.replace('/register')}
            className="min-h-12 justify-center"
          >
            <Text className="font-body-bold text-body-sm text-primary">
              {t('auth.signIn.createAccount')}
            </Text>
          </Pressable>
        </View>
        <Button testID="sign-in-switch" variant="ghost" onPress={switchMethod}>
          {method === 'password' ? t('mobile.auth.usePhone') : t('mobile.auth.useEmail')}
        </Button>
      </Card>
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
      <SocialButtons
        referralCode={referral.trim() ? (parseReferralCode(referral) ?? undefined) : undefined}
        divider={t('mobile.auth.orRegister')}
        onOutcome={socialOutcome}
      />
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
      <Text className="font-body text-body-sm text-muted">
        {t('mobile.auth.fingerprint.afterRegister')}
      </Text>
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
