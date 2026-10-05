'use client';

import { Button, Input } from '@suskii/ui-web';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';

import { browserApi, type Schemas } from '../../lib/browser-api';
import { forgetSession } from '../../lib/session';
import { AppLink } from '../app-link';

import { useAccountT } from './account-messages';
import { AccountCard, ErrorLine, StatusLine } from './account-shell';

type Requirements = Schemas['ReauthRequirements'];
export interface ReauthProof {
  password?: string;
  code?: string;
  mfaCode?: string;
  recoveryCode?: string;
}

function useRequirements(): Requirements | null {
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
function ReauthFields({
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
            href="/sign-in?next=/account/privacy"
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

/** Only the fields the account uses, so the API never sees an empty password. */
const cleanProof = (proof: ReauthProof): ReauthProof =>
  Object.fromEntries(Object.entries(proof).filter(([, value]) => Boolean(value)));

function ExportCard({ requirements }: { requirements: Requirements }) {
  const { t } = useAccountT();
  const [proof, setProof] = useState<ReauthProof>({});
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setStatus(null);
    const { data, response } = await browserApi().POST('/v1/me/data-export', {
      body: cleanProof(proof),
      parseAs: 'blob',
    });
    setBusy(false);
    if (!data) {
      setError(
        response.status === 429 ? t('auth.signIn.errors.locked') : t('account.reauth.wrong'),
      );
      return;
    }
    const disposition = response.headers.get('content-disposition') ?? '';
    const name = /filename="([^"]+)"/.exec(disposition)?.[1] ?? 'suskii-data-export.json';
    const url = URL.createObjectURL(data);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.click();
    URL.revokeObjectURL(url);
    setProof({});
    setStatus(t('account.privacy.exportReady'));
  };

  return (
    <AccountCard
      heading={t('account.privacy.exportHeading')}
      intro={t('account.privacy.exportIntro')}
      testId="account-export"
    >
      <form className="flex flex-col gap-4" onSubmit={(e) => void submit(e)}>
        <ReauthFields
          requirements={requirements}
          proof={proof}
          onChange={setProof}
          idPrefix="export"
        />
        <ErrorLine message={error} />
        <StatusLine message={status} />
        <Button type="submit" loading={busy} className="self-start" data-testid="export-submit">
          {t('account.privacy.exportButton')}
        </Button>
      </form>
    </AccountCard>
  );
}

function DeleteCard({ requirements }: { requirements: Requirements }) {
  const { t } = useAccountT();
  const router = useRouter();
  const [check, setCheck] = useState<Schemas['AccountDeletionCheck'] | null>(null);
  const [proof, setProof] = useState<ReauthProof>({});
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleted, setDeleted] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void browserApi()
      .GET('/v1/me/deletion')
      .then(({ data }) => {
        if (!cancelled && data) setCheck(data);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!check) return null;
  if (deleted) {
    return (
      <AccountCard heading={t('account.privacy.deleteHeading')} testId="account-delete">
        <StatusLine message={t('account.privacy.deleted')} />
      </AccountCard>
    );
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (confirm !== 'DELETE') return;
    setBusy(true);
    setError(null);
    const {
      data,
      error: problem,
      response,
    } = await browserApi().POST('/v1/me/deletion', {
      body: { ...cleanProof(proof), confirm: 'DELETE' },
    });
    setBusy(false);
    if (data) {
      forgetSession();
      setDeleted(true);
      setTimeout(() => {
        router.replace('/');
        router.refresh();
      }, 2500);
      return;
    }
    if (response.status === 409) {
      const blockers = (problem as { blockers?: Schemas['AccountDeletionCheck']['blockers'] })
        .blockers;
      setCheck({ ...check, allowed: false, blockers: blockers ?? check.blockers });
      return;
    }
    setError(response.status === 429 ? t('auth.signIn.errors.locked') : t('account.reauth.wrong'));
  };

  return (
    <AccountCard
      heading={t('account.privacy.deleteHeading')}
      intro={t('account.privacy.deleteIntro')}
      testId="account-delete"
    >
      <p className="font-body text-body-sm text-muted">
        {t('account.privacy.retention', { years: check.retentionYears })}
      </p>
      {check.allowed ? (
        <form className="flex flex-col gap-4" onSubmit={(e) => void submit(e)}>
          <ReauthFields
            requirements={requirements}
            proof={proof}
            onChange={setProof}
            idPrefix="delete"
          />
          <Input
            label={t('account.privacy.confirmLabel')}
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            autoComplete="off"
            required
            data-testid="delete-confirm"
          />
          <ErrorLine message={error} />
          <Button
            type="submit"
            loading={busy}
            disabled={confirm !== 'DELETE'}
            className="self-start"
            data-testid="delete-submit"
          >
            {t('account.privacy.deleteButton')}
          </Button>
        </form>
      ) : (
        <div className="flex flex-col gap-2" data-testid="delete-blockers">
          <p className="font-body text-body text-foreground">{t('account.privacy.blockedIntro')}</p>
          <ul className="list-disc pl-6 font-body text-body-sm text-foreground">
            {check.blockers.map((blocker) => (
              <li key={blocker}>{t(`account.privacy.blockers.${blocker}`)}</li>
            ))}
          </ul>
        </div>
      )}
    </AccountCard>
  );
}

export function PrivacySection() {
  const requirements = useRequirements();
  if (!requirements) return null;
  return (
    <>
      <ExportCard requirements={requirements} />
      <DeleteCard requirements={requirements} />
    </>
  );
}
