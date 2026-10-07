'use client';

import { Button, Input } from '@suskii/ui-web';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';

import { forgetBookingTokens } from '../../lib/booking-token';
import { browserApi, type Schemas } from '../../lib/browser-api';
import { forgetSession } from '../../lib/session';

import { useAccountT } from './account-messages';
import { AccountCard, ErrorLine, StatusLine } from './account-shell';
import { cleanProof, ReauthFields, useRequirements, type ReauthProof } from './reauth';

type Requirements = Schemas['ReauthRequirements'];

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
      <form method="post" className="flex flex-col gap-4" onSubmit={(e) => void submit(e)}>
        <ReauthFields
          requirements={requirements}
          proof={proof}
          onChange={setProof}
          returnTo="/account/privacy"
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
      forgetBookingTokens();
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
        <form method="post" className="flex flex-col gap-4" onSubmit={(e) => void submit(e)}>
          <ReauthFields
            requirements={requirements}
            proof={proof}
            onChange={setProof}
            returnTo="/account/privacy"
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
