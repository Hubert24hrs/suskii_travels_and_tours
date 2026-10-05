import type { Schemas } from '@suskii/api-client';
import { Button, Card, Input, useToast } from '@suskii/ui-native';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';

import { RequireAccount } from '../components/account/require-account';
import { Loading, Notice } from '../components/states';
import { attachmentName, shareDataExport } from '../lib/data-export';
import { useApp, useT } from '../providers/app-provider';
import { useAuth } from '../providers/auth';

type Requirements = Schemas['ReauthRequirements'];
interface Proof {
  password?: string;
  code?: string;
  mfaCode?: string;
  recoveryCode?: string;
}

/** Only the fields the account uses, so the API never sees an empty password. */
const cleanProof = (proof: Proof): Proof =>
  Object.fromEntries(Object.entries(proof).filter(([, value]) => Boolean(value)));

/** The proof the API asks for: password, a texted code or a recent sign-in, plus MFA. */
function ReauthFields({
  requirements,
  proof,
  onChange,
  idPrefix,
}: {
  requirements: Requirements;
  proof: Proof;
  onChange: (proof: Proof) => void;
  idPrefix: string;
}) {
  const { api } = useApp();
  const { t } = useT();
  const router = useRouter();
  const [sent, setSent] = useState(false);
  return (
    <View className="gap-3">
      <Text className="font-body-bold text-body-sm text-foreground">
        {t('account.reauth.heading')}
      </Text>
      {requirements.method === 'password' ? (
        <Input
          testID={`${idPrefix}-password`}
          label={t('account.reauth.password')}
          value={proof.password ?? ''}
          onChangeText={(password) => onChange({ ...proof, password })}
          secureTextEntry
          autoComplete="current-password"
          textContentType="password"
        />
      ) : requirements.method === 'sms_code' ? (
        <>
          <Button
            variant="ghost"
            onPress={() =>
              void api.POST('/v1/me/reauth/code').then(({ response }) => setSent(response.ok))
            }
          >
            {t('account.reauth.sendCode')}
          </Button>
          {sent ? (
            <Text className="font-body text-body-sm text-success">
              {t('account.reauth.codeSent')}
            </Text>
          ) : null}
          <Input
            testID={`${idPrefix}-code`}
            label={t('account.reauth.code')}
            value={proof.code ?? ''}
            onChangeText={(code) => onChange({ ...proof, code: code.trim() })}
            keyboardType="number-pad"
            autoComplete="one-time-code"
            textContentType="oneTimeCode"
            maxLength={6}
          />
        </>
      ) : (
        <>
          <Text className="font-body text-body-sm text-muted">
            {t('account.reauth.recent', { minutes: requirements.recentSignInMinutes })}
          </Text>
          <Button variant="ghost" onPress={() => router.push('/sign-in')}>
            {t('account.reauth.signInAgain')}
          </Button>
        </>
      )}
      {requirements.mfa ? (
        <Input
          testID={`${idPrefix}-mfa`}
          label={t('account.reauth.mfa')}
          hint={t('account.reauth.recovery')}
          value={proof.mfaCode ?? proof.recoveryCode ?? ''}
          autoCapitalize="none"
          onChangeText={(text) => {
            const value = text.trim();
            onChange(
              /^\d{0,6}$/.test(value)
                ? { ...proof, mfaCode: value, recoveryCode: undefined }
                : { ...proof, recoveryCode: value, mfaCode: undefined },
            );
          }}
        />
      ) : null}
    </View>
  );
}

function ExportCard({ requirements }: { requirements: Requirements }) {
  const { api } = useApp();
  const { t } = useT();
  const { toast } = useToast();
  const [proof, setProof] = useState<Proof>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const download = async () => {
    setBusy(true);
    setError(null);
    try {
      const { data, response } = await api.POST('/v1/me/data-export', {
        body: cleanProof(proof),
        parseAs: 'text',
      });
      if (typeof data !== 'string') {
        setError(response.status === 429 ? t('mobile.auth.locked') : t('account.reauth.wrong'));
        return;
      }
      setProof({});
      await shareDataExport(
        data,
        attachmentName(response.headers.get('content-disposition')),
        t('account.privacy.exportHeading'),
      );
      toast({ title: t('mobile.account.exportShared'), variant: 'success' });
    } catch {
      setError(t('mobile.networkError'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card testID="export-card" className="gap-3 p-4">
      <Text accessibilityRole="header" className="font-heading text-h4 text-heading">
        {t('account.privacy.exportHeading')}
      </Text>
      <Text className="font-body text-body-sm text-foreground">
        {t('account.privacy.exportIntro')}
      </Text>
      <ReauthFields
        requirements={requirements}
        proof={proof}
        onChange={setProof}
        idPrefix="export"
      />
      {error ? (
        <Text accessibilityRole="alert" className="font-body text-body-sm text-danger">
          {error}
        </Text>
      ) : null}
      <Button testID="export-submit" loading={busy} onPress={() => void download()}>
        {t('account.privacy.exportButton')}
      </Button>
      <Text className="font-body text-caption text-muted">{t('mobile.account.exportHint')}</Text>
    </Card>
  );
}

function DeleteCard({
  requirements,
  onDeleted,
}: {
  requirements: Requirements;
  onDeleted: () => void;
}) {
  const { api } = useApp();
  const { forgetAccount } = useAuth();
  const { t } = useT();
  const [proof, setProof] = useState<Proof>({});
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const check = useQuery({
    queryKey: ['deletion-check'],
    queryFn: async () => {
      const { data } = await api.GET('/v1/me/deletion');
      if (!data) throw new Error('deletion');
      return data;
    },
  });

  if (!check.data) return null;
  const { allowed, blockers, retentionYears } = check.data;

  const remove = async () => {
    if (confirm.trim() !== 'DELETE') return;
    setBusy(true);
    setError(null);
    try {
      const { data, response } = await api.POST('/v1/me/deletion', {
        body: { ...cleanProof(proof), confirm: 'DELETE' },
      });
      if (data) {
        // The API has revoked every session; only local state is left to clear.
        await forgetAccount();
        onDeleted();
        return;
      }
      if (response.status === 409) {
        await check.refetch();
        return;
      }
      setError(response.status === 429 ? t('mobile.auth.locked') : t('account.reauth.wrong'));
    } catch {
      setError(t('mobile.networkError'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card testID="delete-card" className="gap-3 p-4">
      <Text accessibilityRole="header" className="font-heading text-h4 text-heading">
        {t('account.privacy.deleteHeading')}
      </Text>
      <Text className="font-body text-body-sm text-foreground">
        {t('account.privacy.deleteIntro')}
      </Text>
      <Text className="font-body text-body-sm text-muted">
        {t('account.privacy.retention', { years: retentionYears })}
      </Text>
      {allowed ? (
        <>
          <ReauthFields
            requirements={requirements}
            proof={proof}
            onChange={setProof}
            idPrefix="delete"
          />
          <Input
            testID="delete-confirm"
            label={t('account.privacy.confirmLabel')}
            value={confirm}
            onChangeText={setConfirm}
            autoCapitalize="characters"
            autoCorrect={false}
          />
          {error ? (
            <Text accessibilityRole="alert" className="font-body text-body-sm text-danger">
              {error}
            </Text>
          ) : null}
          <Button
            testID="delete-submit"
            loading={busy}
            disabled={confirm.trim() !== 'DELETE'}
            onPress={() => void remove()}
          >
            {t('account.privacy.deleteButton')}
          </Button>
        </>
      ) : (
        <View testID="delete-blockers" className="gap-2">
          <Text className="font-body text-body text-foreground">
            {t('account.privacy.blockedIntro')}
          </Text>
          {blockers.map((blocker) => (
            <Text key={blocker} className="font-body text-body-sm text-foreground">
              • {t(`account.privacy.blockers.${blocker}`)}
            </Text>
          ))}
        </View>
      )}
    </Card>
  );
}

function Privacy({ onDeleted }: { onDeleted: () => void }) {
  const { api } = useApp();
  const { t } = useT();
  const requirements = useQuery({
    queryKey: ['reauth-requirements'],
    queryFn: async () => {
      const { data } = await api.GET('/v1/me/reauth');
      if (!data) throw new Error('reauth');
      return data;
    },
  });
  if (requirements.isPending) return <Loading label={t('mobile.loading')} />;
  if (!requirements.data) {
    return (
      <Notice
        body={t('account.loadError')}
        action={t('account.retry')}
        onAction={() => void requirements.refetch()}
      />
    );
  }
  return (
    <ScrollView
      testID="privacy"
      className="flex-1 bg-background"
      contentContainerClassName="gap-4 p-4 pb-12"
      keyboardShouldPersistTaps="handled"
    >
      <ExportCard requirements={requirements.data} />
      <DeleteCard requirements={requirements.data} onDeleted={onDeleted} />
    </ScrollView>
  );
}

/**
 * Your data (ADR-029): download everything the account holds, or delete the account, each after
 * re-authentication. Deletion is offered in the app because the stores require it.
 */
export function PrivacyScreen() {
  const { t } = useT();
  const router = useRouter();
  const [deleted, setDeleted] = useState(false);
  if (deleted) {
    return (
      <Notice
        testID="account-deleted"
        body={t('account.privacy.deleted')}
        action={t('common.close')}
        onAction={() => router.replace('/')}
      />
    );
  }
  return (
    <RequireAccount>
      <Privacy onDeleted={() => setDeleted(true)} />
    </RequireAccount>
  );
}
