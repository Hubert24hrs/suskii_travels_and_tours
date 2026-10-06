'use client';

import { Button, Input } from '@suskii/ui-web';
import { useEffect, useState, type FormEvent } from 'react';

import { browserApi, problemSlug, type Schemas } from '../../lib/browser-api';
import { AppLink } from '../app-link';

import { useAccountT } from './account-messages';
import { ErrorLine, StatusLine } from './account-shell';

type Requirements = Schemas['ReauthRequirements'];
export interface ReauthProof {
  password?: string;
  code?: string;
  mfaCode?: string;
  recoveryCode?: string;
}

/** The API asks for a fresh proof (ADR-029, ASVS V7.5.1): see `ReauthPrompt`. */
export const isReauthRequired = (error: unknown): boolean =>
  problemSlug(error) === 'reauthentication-required';

/** Only the fields the account uses, so the API never sees an empty password. */
export const cleanProof = (proof: ReauthProof): ReauthProof =>
  Object.fromEntries(Object.entries(proof).filter(([, value]) => Boolean(value)));

export function useRequirements(): Requirements | null {
  const [requirements, setRequirements] = useState<Requirements | null>(null);
  useEffect(() => {
    let cancelled = false;
    void browserApi()
      .GET('/v1/me/reauth')
      .then(({ data }) => {
        if (!cancelled && data) setRequirements(data);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return requirements;
}

/** The proof the API asks for: password, a texted code or a recent sign-in, plus MFA. */
export function ReauthFields({
  requirements,
  proof,
  onChange,
  idPrefix,
  returnTo,
}: {
  requirements: Requirements;
  proof: ReauthProof;
  onChange: (proof: ReauthProof) => void;
  idPrefix: string;
  /** Where "sign in again" comes back to. */
  returnTo: string;
}) {
  const { t } = useAccountT();
  const [sent, setSent] = useState(false);
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-2 font-body text-body-sm font-bold text-foreground">
        {t('account.reauth.heading')}
      </legend>
      {requirements.method === 'password' ? (
        <Input
          id={`${idPrefix}-password`}
          label={t('account.reauth.password')}
          type="password"
          autoComplete="current-password"
          value={proof.password ?? ''}
          onChange={(event) => onChange({ ...proof, password: event.target.value })}
          required
          data-testid={`${idPrefix}-password`}
        />
      ) : requirements.method === 'sms_code' ? (
        <div className="flex flex-col gap-2">
          <Button
            type="button"
            variant="ghost"
            className="self-start"
            onClick={() =>
              void browserApi()
                .POST('/v1/me/reauth/code')
                .then(({ response }) => setSent(response.ok))
            }
          >
            {t('account.reauth.sendCode')}
          </Button>
          <StatusLine message={sent ? t('account.reauth.codeSent') : null} />
          <Input
            id={`${idPrefix}-code`}
            label={t('account.reauth.code')}
            inputMode="numeric"
            autoComplete="one-time-code"
            value={proof.code ?? ''}
            onChange={(event) => onChange({ ...proof, code: event.target.value.trim() })}
            required
          />
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="font-body text-body-sm text-muted">
            {t('account.reauth.recent', { minutes: requirements.recentSignInMinutes })}
          </p>
          <AppLink
            href={`/sign-in?next=${encodeURIComponent(returnTo)}`}
            className="font-body text-body-sm text-primary underline"
          >
            {t('account.reauth.signInAgain')}
          </AppLink>
        </div>
      )}
      {requirements.mfa ? (
        <Input
          id={`${idPrefix}-mfa`}
          label={t('account.reauth.mfa')}
          hint={t('account.reauth.recovery')}
          value={proof.mfaCode ?? proof.recoveryCode ?? ''}
          onChange={(event) => {
            const value = event.target.value.trim();
            onChange(
              /^\d{0,6}$/.test(value)
                ? { ...proof, mfaCode: value, recoveryCode: undefined }
                : { ...proof, recoveryCode: value, mfaCode: undefined },
            );
          }}
          required
        />
      ) : null}
    </fieldset>
  );
}

/**
 * Shown when the API answered `reauthentication-required` to a change in how the account signs
 * in; `onConfirm` repeats the request with the proof and resolves to whether it went through.
 */
export function ReauthPrompt({
  idPrefix,
  returnTo,
  onConfirm,
  onCancel,
}: {
  idPrefix: string;
  returnTo: string;
  onConfirm: (proof: ReauthProof) => Promise<boolean>;
  onCancel: () => void;
}) {
  const { t } = useAccountT();
  const requirements = useRequirements();
  const [proof, setProof] = useState<ReauthProof>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!requirements) return null;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const done = await onConfirm(cleanProof(proof));
    setBusy(false);
    if (!done) setError(t('account.reauth.wrong'));
  };
  return (
    <form className="flex flex-col gap-3" onSubmit={(event) => void submit(event)}>
      <ReauthFields
        requirements={requirements}
        proof={proof}
        onChange={setProof}
        idPrefix={idPrefix}
        returnTo={returnTo}
      />
      <ErrorLine message={error} />
      <div className="flex flex-wrap gap-2">
        {requirements.method === 'recent_sign_in' ? null : (
          <Button type="submit" loading={busy}>
            {t('account.reauth.confirm')}
          </Button>
        )}
        <Button type="button" variant="ghost" onClick={onCancel}>
          {t('account.reauth.cancel')}
        </Button>
      </div>
    </form>
  );
}
