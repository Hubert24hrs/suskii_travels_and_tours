'use client';

import { Button, Card, Input } from '@suskii/ui-web';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';

import { browserApi, isRejectedPassword, problemSlug, type Schemas } from '../../lib/browser-api';
import { rememberSession } from '../../lib/session';
import { AppLink } from '../app-link';

import { useAccountT } from './account-messages';
import { safeNext } from './use-account';
import { useTurnstile } from './use-turnstile';

type SignInResult = Schemas['AuthSession'] | Schemas['MfaChallenge'];

function FormError({ message }: { message: string | null }) {
  return message ? (
    <p role="alert" className="font-body text-body-sm text-danger">
      {message}
    </p>
  ) : null;
}

function Notice({ children, testId }: { children: string; testId?: string }) {
  return (
    <p
      role="status"
      data-testid={testId}
      className="rounded-md bg-primary-subtle p-4 font-body text-body-sm text-foreground"
    >
      {children}
    </p>
  );
}

/** Reads `#token=…` once and strips it from the address bar (it never reaches a server log). */
function useFragmentToken(): string | null | undefined {
  const [token, setToken] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    const match = /(?:^|[#&])token=([A-Za-z0-9_-]+)/.exec(window.location.hash);
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
    // A microtask keeps the state change out of the effect body (React Compiler rule).
    void Promise.resolve().then(() => setToken(match?.[1] ?? null));
  }, []);
  return token;
}

export function SignInForm({ next }: { next: string | null }) {
  const { t } = useAccountT();
  const router = useRouter();
  const [mode, setMode] = useState<'email' | 'phone'>('email');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [useRecovery, setUseRecovery] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const failure = (response: Response, slug: string | null): string =>
    response.status === 429
      ? t('auth.signIn.errors.locked')
      : slug === 'invalid-credentials'
        ? t('auth.signIn.errors.invalid')
        : slug === 'invalid-code'
          ? t('auth.signIn.errors.code')
          : t('auth.signIn.errors.generic');

  const finish = (result: SignInResult) => {
    if (result.status === 'mfa_required') {
      setMfaToken(result.mfaToken);
      setCode('');
      return;
    }
    rememberSession(result.accessTokenExpiresAt);
    router.replace(safeNext(next));
    router.refresh();
  };

  const run = async (
    request: () => Promise<{ data?: SignInResult; error?: unknown; response: Response }>,
  ) => {
    setBusy(true);
    setError(null);
    try {
      const { data, error: problem, response } = await request();
      if (data) finish(data);
      else setError(failure(response, problemSlug(problem)));
    } catch {
      setError(t('auth.signIn.errors.generic'));
    } finally {
      setBusy(false);
    }
  };

  const submitPassword = (event: FormEvent) => {
    event.preventDefault();
    void run(() =>
      browserApi().POST('/v1/auth/login', { body: { email, password, transport: 'cookie' } }),
    );
  };

  const sendCode = async () => {
    setBusy(true);
    setError(null);
    const { response } = await browserApi().POST('/v1/auth/otp/request', { body: { phone } });
    setBusy(false);
    if (response.ok) setCodeSent(true);
    else setError(failure(response, null));
  };

  const submitCode = (event: FormEvent) => {
    event.preventDefault();
    if (!codeSent) {
      void sendCode();
      return;
    }
    void run(() =>
      browserApi().POST('/v1/auth/otp/verify', { body: { phone, code, transport: 'cookie' } }),
    );
  };

  const submitMfa = (event: FormEvent) => {
    event.preventDefault();
    if (!mfaToken) return;
    void run(() =>
      browserApi().POST('/v1/auth/mfa/verify', {
        body: useRecovery
          ? { mfaToken, recoveryCode: code, transport: 'cookie' }
          : { mfaToken, code, transport: 'cookie' },
      }),
    );
  };

  if (mfaToken) {
    return (
      <Card className="flex flex-col gap-4 p-6">
        <h2 className="font-heading text-h4 font-bold text-heading">
          {t('auth.signIn.mfaHeading')}
        </h2>
        <p className="font-body text-body-sm text-muted">{t('auth.signIn.mfaIntro')}</p>
        <form className="flex flex-col gap-4" onSubmit={submitMfa}>
          <Input
            label={useRecovery ? t('auth.signIn.recoveryCode') : t('auth.signIn.mfaCode')}
            value={code}
            onChange={(event) => setCode(event.target.value.trim())}
            inputMode={useRecovery ? 'text' : 'numeric'}
            autoComplete="one-time-code"
            required
            data-testid="mfa-code"
          />
          <FormError message={error} />
          <Button type="submit" loading={busy}>
            {t('auth.signIn.submitMfa')}
          </Button>
          <Button type="button" variant="ghost" onClick={() => setUseRecovery((value) => !value)}>
            {useRecovery ? t('auth.signIn.useAuthenticator') : t('auth.signIn.useRecovery')}
          </Button>
        </form>
      </Card>
    );
  }

  return (
    <Card className="flex flex-col gap-4 p-6">
      <div className="grid grid-cols-2 gap-2" role="group">
        {(['email', 'phone'] as const).map((value) => (
          <Button
            key={value}
            type="button"
            variant={mode === value ? 'primary' : 'ghost'}
            aria-pressed={mode === value}
            onClick={() => {
              setMode(value);
              setError(null);
            }}
          >
            {value === 'email' ? t('auth.signIn.emailTab') : t('auth.signIn.phoneTab')}
          </Button>
        ))}
      </div>
      {mode === 'email' ? (
        <form className="flex flex-col gap-4" onSubmit={submitPassword}>
          <Input
            label={t('auth.signIn.email')}
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
            data-testid="sign-in-email"
          />
          <Input
            label={t('auth.signIn.password')}
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            data-testid="sign-in-password"
          />
          <FormError message={error} />
          <Button type="submit" loading={busy} data-testid="sign-in-submit">
            {t('auth.signIn.submit')}
          </Button>
          <AppLink
            href="/forgot-password"
            className="font-body text-body-sm text-primary underline focus-visible:focus-ring"
          >
            {t('auth.signIn.forgot')}
          </AppLink>
        </form>
      ) : (
        <form className="flex flex-col gap-4" onSubmit={submitCode}>
          <Input
            label={t('auth.signIn.phone')}
            hint={t('auth.signIn.phoneHint')}
            type="tel"
            autoComplete="tel"
            value={phone}
            onChange={(event) => setPhone(event.target.value.replace(/[\s-]/g, ''))}
            required
            data-testid="sign-in-phone"
          />
          <p className="font-body text-body-sm text-muted">{t('auth.signIn.smsNote')}</p>
          {codeSent ? (
            <>
              <p role="status" className="font-body text-body-sm text-muted">
                {t('auth.signIn.codeSent', { phone })}
              </p>
              <Input
                label={t('auth.signIn.code')}
                inputMode="numeric"
                autoComplete="one-time-code"
                value={code}
                onChange={(event) => setCode(event.target.value.trim())}
                required
                data-testid="sign-in-code"
              />
            </>
          ) : null}
          <FormError message={error} />
          <Button type="submit" loading={busy}>
            {codeSent ? t('auth.signIn.verifyCode') : t('auth.signIn.sendCode')}
          </Button>
          {codeSent ? (
            <Button type="button" variant="ghost" onClick={() => void sendCode()}>
              {t('auth.signIn.resend')}
            </Button>
          ) : null}
        </form>
      )}
      <AppLink
        href={next ? `/register?next=${encodeURIComponent(next)}` : '/register'}
        className="font-body text-body-sm text-primary underline focus-visible:focus-ring"
      >
        {t('auth.signIn.toRegister')}
      </AppLink>
    </Card>
  );
}

export function RegisterForm({
  referralCode,
  turnstileSiteKey,
}: {
  referralCode: string | null;
  turnstileSiteKey: string;
}) {
  const { t } = useAccountT();
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState(referralCode ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const {
    containerRef: turnstileRef,
    ensure: ensureTurnstile,
    reset: resetTurnstile,
    currentToken,
  } = useTurnstile(turnstileSiteKey, 'register', () => setError(t('auth.register.botCheck')));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const turnstileToken = currentToken();
    if (!turnstileToken) {
      // The widget is still checking (or needs a click).
      ensureTurnstile();
      setError(t('auth.register.botCheck'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { error: problem, response } = await browserApi().POST('/v1/auth/register', {
        body: {
          email,
          password,
          turnstileToken,
          ...(displayName.trim() ? { displayName: displayName.trim() } : {}),
          ...(code.trim() ? { referralCode: code.trim() } : {}),
        },
      });
      if (response.ok) {
        setDone(true);
        return;
      }
      resetTurnstile();
      const slug = problemSlug(problem);
      setError(
        isRejectedPassword(problem)
          ? t('auth.register.breached')
          : slug === 'bot-check-failed'
            ? t('auth.register.botCheck')
            : response.status === 400
              ? t('auth.register.invalid')
              : t('auth.signIn.errors.generic'),
      );
    } catch {
      setError(t('auth.signIn.errors.generic'));
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <Card className="flex flex-col gap-4 p-6">
        <Notice testId="register-done">{t('auth.register.done')}</Notice>
        <AppLink href="/sign-in" className="font-body text-body text-primary underline">
          {t('auth.signIn.submit')}
        </AppLink>
      </Card>
    );
  }

  return (
    <Card className="flex flex-col gap-4 p-6">
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => void submit(event)}
        onFocus={ensureTurnstile}
      >
        <Input
          label={t('auth.register.displayName')}
          autoComplete="name"
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
        />
        <Input
          label={t('auth.register.email')}
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
          data-testid="register-email"
        />
        <Input
          label={t('auth.register.password')}
          hint={t('auth.register.passwordHint')}
          type="password"
          autoComplete="new-password"
          minLength={10}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
          data-testid="register-password"
        />
        <Input
          label={t('auth.register.referralCode')}
          hint={t('auth.register.referralHint')}
          autoCapitalize="characters"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          data-testid="register-referral"
        />
        <div ref={turnstileRef} />
        <FormError message={error} />
        <Button type="submit" loading={busy} data-testid="register-submit">
          {t('auth.register.submit')}
        </Button>
      </form>
      <AppLink href="/sign-in" className="font-body text-body-sm text-primary underline">
        {t('auth.register.toSignIn')}
      </AppLink>
    </Card>
  );
}

export function VerifyEmail() {
  const { t } = useAccountT();
  const token = useFragmentToken();
  const [result, setResult] = useState<'verified' | 'failed' | null>(null);

  useEffect(() => {
    if (token === undefined) return;
    let cancelled = false;
    const verify = async () => {
      const ok = token
        ? (await browserApi().POST('/v1/auth/email/verify', { body: { token } })).response.ok
        : false;
      if (!cancelled) setResult(ok ? 'verified' : 'failed');
    };
    void verify();
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <Card className="flex flex-col gap-4 p-6" aria-live="polite">
      {result === null ? (
        <p className="font-body text-body text-muted">{t('auth.verifyEmail.verifying')}</p>
      ) : result === 'verified' ? (
        <Notice testId="email-verified">{t('auth.verifyEmail.verified')}</Notice>
      ) : (
        <p role="alert" className="font-body text-body text-danger">
          {t('auth.verifyEmail.failed')}
        </p>
      )}
      {result ? (
        <AppLink href="/account" className="font-body text-body text-primary underline">
          {t('auth.verifyEmail.continue')}
        </AppLink>
      ) : null}
    </Card>
  );
}

export function ForgotPasswordForm() {
  const { t } = useAccountT();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    await browserApi().POST('/v1/auth/password/forgot', { body: { email } });
    setBusy(false);
    // The answer is the same whether or not the address has an account.
    setSent(true);
  };

  return (
    <Card className="flex flex-col gap-4 p-6">
      {sent ? (
        <Notice>{t('auth.forgot.sent')}</Notice>
      ) : (
        <form className="flex flex-col gap-4" onSubmit={(event) => void submit(event)}>
          <p className="font-body text-body-sm text-muted">{t('auth.forgot.intro')}</p>
          <Input
            label={t('auth.forgot.email')}
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
          <Button type="submit" loading={busy}>
            {t('auth.forgot.submit')}
          </Button>
        </form>
      )}
    </Card>
  );
}

export function ResetPasswordForm() {
  const { t } = useAccountT();
  const token = useFragmentToken();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<'idle' | 'done' | 'failed' | 'breached'>('idle');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!token) {
      setState('failed');
      return;
    }
    setBusy(true);
    const { error, response } = await browserApi().POST('/v1/auth/password/reset', {
      body: { token, password },
    });
    setBusy(false);
    setState(response.ok ? 'done' : isRejectedPassword(error) ? 'breached' : 'failed');
  };

  if (state === 'done') {
    return (
      <Card className="flex flex-col gap-4 p-6">
        <Notice>{t('auth.reset.done')}</Notice>
        <AppLink href="/sign-in" className="font-body text-body text-primary underline">
          {t('auth.signIn.submit')}
        </AppLink>
      </Card>
    );
  }
  return (
    <Card className="flex flex-col gap-4 p-6">
      <form className="flex flex-col gap-4" onSubmit={(event) => void submit(event)}>
        <Input
          label={t('auth.reset.password')}
          hint={t('auth.register.passwordHint')}
          type="password"
          autoComplete="new-password"
          minLength={10}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />
        <FormError
          message={
            state === 'failed'
              ? t('auth.reset.failed')
              : state === 'breached'
                ? t('auth.register.breached')
                : null
          }
        />
        <Button type="submit" loading={busy} disabled={token === null}>
          {t('auth.reset.submit')}
        </Button>
      </form>
    </Card>
  );
}
