'use client';

import { Button, Card } from '@suskii/ui-web';
import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { encode } from 'uqr';

import { adminApi, problemOf, type Schemas } from '../lib/api';
import { t } from '../lib/i18n';
import { expireSession, rememberSession } from '../lib/session';

import { useStaffSession } from './staff-session';
import { ProblemAlert, TextField } from './ui';

type SignInResult = Schemas['AuthSession'] | Schemas['MfaChallenge'];

function ErrorLine({ message }: { message: string | null }) {
  return message ? (
    <p role="alert" className="font-body text-body-sm text-danger">
      {message}
    </p>
  ) : null;
}

function signInError(response: Response, error: unknown): string {
  const { slug } = problemOf(error);
  if (response.status === 429 || slug === 'too-many-attempts') return t('auth.errors.locked');
  if (slug === 'invalid-credentials') return t('auth.errors.invalid');
  if (slug === 'invalid-code') return t('auth.errors.code');
  return t('auth.errors.generic');
}

/** Email and password, then the authenticator code (or a recovery code). */
export function SignInForm({ onSignedIn }: { onSignedIn: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [useRecovery, setUseRecovery] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (
    request: () => Promise<{ data?: SignInResult; error?: unknown; response: Response }>,
  ) => {
    setBusy(true);
    setError(null);
    try {
      const { data, error: problem, response } = await request();
      if (!data) {
        setError(signInError(response, problem));
      } else if (data.status === 'mfa_required') {
        setMfaToken(data.mfaToken);
        setCode('');
      } else {
        rememberSession(data.accessTokenExpiresAt);
        onSignedIn();
      }
    } catch {
      setError(t('auth.errors.generic'));
    } finally {
      setBusy(false);
    }
  };

  const submitPassword = (event: FormEvent) => {
    event.preventDefault();
    void run(() =>
      adminApi.POST('/v1/auth/login', { body: { email, password, transport: 'cookie' } }),
    );
  };

  const submitMfa = (event: FormEvent) => {
    event.preventDefault();
    if (!mfaToken) return;
    void run(() =>
      adminApi.POST('/v1/auth/mfa/verify', {
        body: useRecovery
          ? { mfaToken, recoveryCode: code, transport: 'cookie' }
          : { mfaToken, code, transport: 'cookie' },
      }),
    );
  };

  if (mfaToken) {
    return (
      <Card className="flex flex-col gap-4 p-6">
        <h2 className="font-heading text-h4 font-bold text-heading">{t('auth.mfaHeading')}</h2>
        <p className="font-body text-body-sm text-muted">{t('auth.mfaIntro')}</p>
        <form method="post" className="flex flex-col gap-4" onSubmit={submitMfa}>
          <TextField
            label={useRecovery ? t('auth.recoveryCode') : t('auth.mfaCode')}
            name={useRecovery ? 'recoveryCode' : 'code'}
            value={code}
            onChange={(event) => setCode(event.target.value.trim())}
            inputMode={useRecovery ? 'text' : 'numeric'}
            autoComplete="one-time-code"
            required
            data-testid="mfa-code"
          />
          <ErrorLine message={error} />
          <Button type="submit" loading={busy}>
            {t('auth.verify')}
          </Button>
          <Button type="button" variant="ghost" onClick={() => setUseRecovery((value) => !value)}>
            {useRecovery ? t('auth.useAuthenticator') : t('auth.useRecovery')}
          </Button>
        </form>
      </Card>
    );
  }

  return (
    <Card className="flex flex-col gap-4 p-6">
      <form method="post" className="flex flex-col gap-4" onSubmit={submitPassword}>
        <TextField
          label={t('auth.email')}
          name="email"
          type="email"
          autoComplete="username"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
          data-testid="sign-in-email"
        />
        <TextField
          label={t('auth.password')}
          name="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
          data-testid="sign-in-password"
        />
        <ErrorLine message={error} />
        <Button type="submit" loading={busy}>
          {t('auth.submit')}
        </Button>
      </form>
    </Card>
  );
}

/** A QR code drawn as SVG squares: no innerHTML, no image request. */
function QrCode({ value, label }: { value: string; label: string }) {
  const { size, data } = useMemo(() => encode(value, { border: 1 }), [value]);
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${size} ${size}`}
      className="aspect-square w-full max-w-popover rounded-lg bg-surface"
      shapeRendering="crispEdges"
    >
      {data.flatMap((row, y) =>
        row.map((dark, x) =>
          dark ? <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} /> : null,
        ),
      )}
    </svg>
  );
}

/**
 * First sign-in of a staff account without an authenticator: enrol TOTP, show the recovery codes
 * once, then refresh the session so its access token carries the MFA verification.
 */
export function MfaEnrolment() {
  const { reload } = useStaffSession();
  const [setup, setSetup] = useState<Schemas['TotpSetup'] | null>(null);
  const [code, setCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const start = async () => {
    setBusy(true);
    setError(null);
    const { data, error: problem } = await adminApi.POST('/v1/me/mfa/totp', { body: {} });
    setBusy(false);
    if (data) setSetup(data);
    else setError(problem);
  };

  const confirm = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const { data, error: problem } = await adminApi.POST('/v1/me/mfa/totp/confirm', {
      body: { code },
    });
    setBusy(false);
    if (data) setRecoveryCodes(data.recoveryCodes);
    else setError(problem);
  };

  const finish = async () => {
    // The session is now MFA-verified; a refresh issues an access token that says so.
    expireSession();
    await reload();
  };

  if (recoveryCodes) {
    return (
      <Card className="flex flex-col gap-4 p-6">
        <h2 className="font-heading text-h4 font-bold text-heading">
          {t('auth.enrol.recoveryHeading')}
        </h2>
        <p className="font-body text-body-sm text-muted">{t('auth.enrol.recoveryIntro')}</p>
        <ul className="grid grid-cols-2 gap-2 font-body text-body-sm" data-testid="recovery-codes">
          {recoveryCodes.map((recovery) => (
            <li key={recovery}>
              <code className="tracking-wide">{recovery}</code>
            </li>
          ))}
        </ul>
        <Button onClick={() => void finish()}>{t('auth.enrol.continue')}</Button>
      </Card>
    );
  }

  return (
    <Card className="flex flex-col gap-4 p-6">
      <h2 className="font-heading text-h4 font-bold text-heading">{t('auth.enrol.heading')}</h2>
      <p className="font-body text-body-sm text-muted">{t('auth.enrol.intro')}</p>
      {setup ? (
        <form
          method="post"
          className="flex flex-col gap-4"
          onSubmit={(event) => void confirm(event)}
        >
          <QrCode value={setup.otpauthUri} label={t('auth.enrol.qrLabel')} />
          <p className="font-body text-body-sm text-foreground">
            {t('auth.enrol.key')}:{' '}
            <code className="tracking-wide break-all" data-testid="totp-secret">
              {setup.secret}
            </code>
          </p>
          <TextField
            label={t('auth.enrol.code')}
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(event) => setCode(event.target.value.trim())}
            required
            data-testid="totp-code"
          />
          <ProblemAlert error={error} />
          <Button type="submit" loading={busy}>
            {t('auth.enrol.submit')}
          </Button>
        </form>
      ) : (
        <>
          <ProblemAlert error={error} />
          <Button loading={busy} onClick={() => void start()}>
            {t('auth.enrol.start')}
          </Button>
        </>
      )}
    </Card>
  );
}

export function NotStaff() {
  const { signOut } = useStaffSession();
  return (
    <Card className="flex flex-col gap-4 p-6">
      <h2 className="font-heading text-h4 font-bold text-heading">{t('auth.notStaff.heading')}</h2>
      <p className="font-body text-body-sm text-muted">{t('auth.notStaff.body')}</p>
      <Button variant="ghost" onClick={() => void signOut()}>
        {t('auth.signOut')}
      </Button>
    </Card>
  );
}

/** Centred card layout for sign-in and set-up screens. */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main
      id="main"
      className="mx-auto flex min-h-dvh w-full max-w-dialog flex-col justify-center gap-6 px-4 py-12"
    >
      <div className="flex flex-col gap-2">
        <p className="font-heading text-h4 font-extrabold text-primary">{t('common.appName')}</p>
        <h1 className="font-heading text-h2 font-extrabold text-heading">{t('auth.title')}</h1>
        <p className="font-body text-body-sm text-muted">{t('auth.intro')}</p>
      </div>
      {children}
    </main>
  );
}
