'use client';

import { useFormatters } from '@suskii/i18n/react';
import { Badge, Button, Input } from '@suskii/ui-web';
import { useEffect, useState, type FormEvent } from 'react';
import { renderSVG } from 'uqr';

import { browserApi, isRejectedPassword, problemSlug, type Schemas } from '../../lib/browser-api';
import { useHydrated } from '../../lib/use-hydrated';

import { useAccountT } from './account-messages';
import { isReauthRequired, ReauthPrompt, type ReauthProof } from './reauth';
import { AccountCard, ErrorLine, StatusLine, useAccountUser } from './account-shell';

type SessionSummary = Schemas['SessionList']['sessions'][number];

function PasswordForm() {
  const { t } = useAccountT();
  const { user } = useAccountUser();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!user.hasPassword) {
    return (
      <p className="font-body text-body-sm text-muted">{t('account.security.password.none')}</p>
    );
  }
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setStatus(null);
    setError(null);
    const { error: problem, response } = await browserApi().POST('/v1/me/password', {
      body: { currentPassword: current, newPassword: next },
    });
    setBusy(false);
    if (response.ok) {
      setCurrent('');
      setNext('');
      setStatus(t('account.security.password.changed'));
    } else {
      const slug = problemSlug(problem);
      setError(
        slug === 'invalid-credentials'
          ? t('account.security.password.wrong')
          : isRejectedPassword(problem)
            ? t('auth.register.breached')
            : t('auth.signIn.errors.generic'),
      );
    }
  };
  return (
    <form method="post" className="flex flex-col gap-3" onSubmit={(e) => void submit(e)}>
      <Input
        label={t('account.security.password.current')}
        type="password"
        autoComplete="current-password"
        value={current}
        onChange={(event) => setCurrent(event.target.value)}
        required
      />
      <Input
        label={t('account.security.password.next')}
        hint={t('auth.register.passwordHint')}
        type="password"
        autoComplete="new-password"
        minLength={10}
        value={next}
        onChange={(event) => setNext(event.target.value)}
        required
      />
      <ErrorLine message={error} />
      <StatusLine message={status} />
      <Button type="submit" loading={busy} className="self-start">
        {t('account.security.password.submit')}
      </Button>
    </form>
  );
}

function RecoveryCodes({ codes }: { codes: string[] }) {
  const { t } = useAccountT();
  return (
    <div className="flex flex-col gap-2" data-testid="recovery-codes">
      <h3 className="font-heading text-h4 font-bold text-heading">
        {t('account.security.mfa.recoveryHeading')}
      </h3>
      <p className="font-body text-body-sm text-muted">{t('account.security.mfa.recoveryIntro')}</p>
      <ul className="grid grid-cols-2 gap-2 font-body text-body-sm tracking-wide tabular-nums text-foreground">
        {codes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ul>
    </div>
  );
}

function MfaPanel() {
  const { t } = useAccountT();
  const { user, reload } = useAccountUser();
  const [setup, setSetup] = useState<Schemas['TotpSetup'] | null>(null);
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [disabling, setDisabling] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [needsProof, setNeedsProof] = useState(false);

  const start = async (reauth?: ReauthProof): Promise<boolean> => {
    setError(null);
    const { data, error: problem } = await browserApi().POST('/v1/me/mfa/totp', {
      body: reauth ? { reauth } : {},
    });
    if (data) {
      setSetup(data);
      setNeedsProof(false);
      return true;
    }
    if (isReauthRequired(problem) && !reauth) setNeedsProof(true);
    else if (!reauth) setError(t('auth.signIn.errors.generic'));
    return false;
  };

  const confirm = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const { data } = await browserApi().POST('/v1/me/mfa/totp/confirm', { body: { code } });
    setBusy(false);
    if (data) {
      setCodes(data.recoveryCodes);
      setSetup(null);
      setCode('');
      reload();
    } else {
      setError(t('auth.signIn.errors.code'));
    }
  };

  const disable = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const body = /^\d{6}$/.test(code) ? { code } : { recoveryCode: code };
    const { response } = await browserApi().POST('/v1/me/mfa/totp/disable', { body });
    setBusy(false);
    if (response.ok) {
      setDisabling(false);
      setCode('');
      reload();
    } else {
      setError(t('auth.signIn.errors.code'));
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="font-body text-body text-foreground">
        {user.mfaEnabled ? t('account.security.mfa.on') : t('account.security.mfa.off')}
      </p>
      {codes ? <RecoveryCodes codes={codes} /> : null}
      {setup ? (
        <form method="post" className="flex flex-col gap-3" onSubmit={(e) => void confirm(e)}>
          <p className="font-body text-body-sm text-muted">
            {t('account.security.mfa.setupIntro')}
          </p>
          <div
            className="aspect-square w-full max-w-popover rounded-lg bg-surface p-2 [&>svg]:size-full"
            role="img"
            aria-label={t('account.security.mfa.secret')}
            dangerouslySetInnerHTML={{ __html: renderSVG(setup.otpauthUri, { border: 1 }) }}
          />
          <p className="font-body text-body-sm text-foreground">
            {t('account.security.mfa.secret')}:{' '}
            <code className="font-body tracking-wide break-all" data-testid="totp-secret">
              {setup.secret}
            </code>
          </p>
          <Input
            label={t('account.security.mfa.code')}
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(event) => setCode(event.target.value.trim())}
            required
            data-testid="totp-code"
          />
          <ErrorLine message={error} />
          <Button type="submit" loading={busy} className="self-start">
            {t('account.security.mfa.confirm')}
          </Button>
        </form>
      ) : disabling ? (
        <form method="post" className="flex flex-col gap-3" onSubmit={(e) => void disable(e)}>
          <p className="font-body text-body-sm text-muted">
            {t('account.security.mfa.disableIntro')}
          </p>
          <Input
            label={t('account.security.mfa.code')}
            value={code}
            onChange={(event) => setCode(event.target.value.trim())}
            required
          />
          <ErrorLine message={error} />
          <div className="flex gap-2">
            <Button type="submit" loading={busy}>
              {t('account.security.mfa.disable')}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setDisabling(false)}>
              {t('account.cancel')}
            </Button>
          </div>
        </form>
      ) : user.mfaEnabled ? (
        <Button variant="ghost" className="self-start" onClick={() => setDisabling(true)}>
          {t('account.security.mfa.disable')}
        </Button>
      ) : needsProof ? (
        <ReauthPrompt
          idPrefix="mfa-reauth"
          returnTo="/account/security"
          onConfirm={(proof) => start(proof)}
          onCancel={() => setNeedsProof(false)}
        />
      ) : (
        <>
          <ErrorLine message={error} />
          <Button className="self-start" onClick={() => void start()} data-testid="mfa-enable">
            {t('account.security.mfa.enable')}
          </Button>
        </>
      )}
    </div>
  );
}

function SessionsPanel() {
  const { t } = useAccountT();
  const format = useFormatters();
  const hydrated = useHydrated();
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  const [version, setVersion] = useState(0);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void browserApi()
      .GET('/v1/me/sessions')
      .then(({ data }) => {
        if (!cancelled && data) setSessions(data.sessions);
      });
    return () => {
      cancelled = true;
    };
  }, [version]);

  // Signing out another device asks an older session to confirm it is the owner.
  const [pending, setPending] = useState<{ id: string | null } | null>(null);

  const finish = (ok: boolean, target: string | null, reauth?: ReauthProof, problem?: unknown) => {
    if (ok) {
      setPending(null);
      setStatus(t('account.security.sessions.revoked'));
      setVersion((n) => n + 1);
    } else if (!reauth && isReauthRequired(problem)) {
      setPending({ id: target });
    }
    return ok;
  };
  const revoke = async (id: string, reauth?: ReauthProof): Promise<boolean> => {
    const { response, error } = await browserApi().DELETE('/v1/me/sessions/{id}', {
      params: { path: { id } },
      body: reauth ? { reauth } : {},
    });
    return finish(response.ok, id, reauth, error);
  };
  const revokeOthers = async (reauth?: ReauthProof): Promise<boolean> => {
    const { response, error } = await browserApi().POST('/v1/me/sessions/revoke-others', {
      body: reauth ? { reauth } : {},
    });
    return finish(response.ok, null, reauth, error);
  };

  if (!sessions) return null;
  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col divide-y divide-border">
        {sessions.map((session) => (
          <li key={session.id} className="flex items-center justify-between gap-3 py-3">
            <div className="flex flex-col gap-1">
              <p className="font-body text-body text-foreground">
                {session.userAgent ?? t('account.security.sessions.unknownDevice')}{' '}
                {session.current ? (
                  <Badge variant="info">{t('account.security.sessions.current')}</Badge>
                ) : null}
              </p>
              {hydrated ? (
                <p className="font-body text-body-sm text-muted">
                  {t('account.security.sessions.signedIn', {
                    time: format.relativeTime(session.createdAt),
                    method: t(`account.security.sessions.methods.${session.authMethod}`),
                  })}
                  {' · '}
                  {t('account.security.sessions.lastSeen', {
                    time: format.relativeTime(session.lastSeenAt),
                  })}
                </p>
              ) : null}
            </div>
            {session.current ? null : (
              <Button variant="ghost" onClick={() => void revoke(session.id)}>
                {t('account.security.sessions.revoke')}
              </Button>
            )}
          </li>
        ))}
      </ul>
      {sessions.length > 1 ? (
        <Button variant="ghost" className="self-start" onClick={() => void revokeOthers()}>
          {t('account.security.sessions.revokeOthers')}
        </Button>
      ) : null}
      {pending ? (
        <ReauthPrompt
          idPrefix="sessions-reauth"
          returnTo="/account/security"
          onConfirm={(proof) => (pending.id ? revoke(pending.id, proof) : revokeOthers(proof))}
          onCancel={() => setPending(null)}
        />
      ) : null}
      <StatusLine message={status} />
    </div>
  );
}

export function SecuritySection() {
  const { t } = useAccountT();
  return (
    <>
      <AccountCard heading={t('account.security.password.heading')}>
        <PasswordForm />
      </AccountCard>
      <AccountCard heading={t('account.security.mfa.heading')} testId="account-mfa">
        <MfaPanel />
      </AccountCard>
      <AccountCard heading={t('account.security.sessions.heading')} testId="account-sessions">
        <SessionsPanel />
      </AccountCard>
    </>
  );
}
