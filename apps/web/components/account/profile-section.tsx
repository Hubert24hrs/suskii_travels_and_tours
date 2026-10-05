'use client';

import { isSupportedLocale, SUPPORTED_CURRENCIES, SUPPORTED_LOCALES } from '@suskii/shared/lite';
import { Badge, Button, Input } from '@suskii/ui-web';
import { useEffect, useState, type FormEvent } from 'react';

import { browserApi, problemSlug, type Schemas } from '../../lib/browser-api';
import { NativeSelect } from '../search/native-select';

import { useAccountT } from './account-messages';
import { AccountCard, ErrorLine, StatusLine, useAccountUser } from './account-shell';

type Preferences = Schemas['AccountPreferences'];

function NameForm() {
  const { t } = useAccountT();
  const { user, replaceUser } = useAccountUser();
  const [name, setName] = useState(user.displayName ?? '');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setStatus(null);
    const { data } = await browserApi().PATCH('/v1/me', { body: { displayName: name.trim() } });
    setBusy(false);
    if (data) {
      replaceUser(data);
      setStatus(t('account.saved'));
    }
  };

  return (
    <form className="flex flex-col gap-3 md:flex-row md:items-end" onSubmit={(e) => void submit(e)}>
      <div className="flex-1">
        <Input
          label={t('account.profile.displayName')}
          autoComplete="name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
          maxLength={100}
        />
      </div>
      <Button type="submit" loading={busy}>
        {t('account.save')}
      </Button>
      <StatusLine message={status} />
    </form>
  );
}

function EmailLine() {
  const { t } = useAccountT();
  const { user } = useAccountUser();
  const [sent, setSent] = useState(false);
  if (!user.email) return null;
  return (
    <div className="flex flex-col gap-2">
      <p className="font-body text-body-sm text-muted">{t('account.profile.email')}</p>
      <p className="font-body text-body text-foreground">{user.email}</p>
      {user.emailVerified ? null : (
        <div className="flex flex-col items-start gap-2">
          <p className="font-body text-body-sm text-warning-text">
            {t('account.profile.emailUnverified')}
          </p>
          {sent ? (
            <StatusLine message={t('account.profile.verificationSent')} />
          ) : (
            <Button
              variant="ghost"
              onClick={() =>
                void browserApi()
                  .POST('/v1/me/email/verification')
                  .then(() => setSent(true))
              }
            >
              {t('account.profile.resendVerification')}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function PhoneForm() {
  const { t } = useAccountT();
  const { user, replaceUser } = useAccountUser();
  const [editing, setEditing] = useState(false);
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    if (!sent) {
      const { response } = await browserApi().POST('/v1/me/phone', { body: { phone } });
      setBusy(false);
      if (response.ok) setSent(true);
      else setError(t('auth.signIn.errors.generic'));
      return;
    }
    const { data, error: problem } = await browserApi().POST('/v1/me/phone/verify', {
      body: { phone, code },
    });
    setBusy(false);
    if (data) {
      replaceUser(data);
      setEditing(false);
      setSent(false);
      setCode('');
    } else {
      setError(
        problemSlug(problem) === 'phone-unavailable'
          ? t('account.profile.phoneUnavailable')
          : t('auth.signIn.errors.code'),
      );
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <p className="font-body text-body-sm text-muted">{t('account.profile.phone')}</p>
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-body text-body text-foreground">
          {user.phone ?? t('account.profile.phoneNone')}
        </p>
        {user.phone && user.phoneVerified ? (
          <Badge variant="success">{t('account.profile.phoneVerified')}</Badge>
        ) : null}
      </div>
      {editing ? (
        <form className="flex flex-col gap-3" onSubmit={(e) => void submit(e)}>
          <Input
            label={t('account.profile.phone')}
            hint={t('auth.signIn.phoneHint')}
            type="tel"
            autoComplete="tel"
            value={phone}
            onChange={(event) => setPhone(event.target.value.replace(/[\s-]/g, ''))}
            required
          />
          {sent ? (
            <Input
              label={t('account.profile.code')}
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(event) => setCode(event.target.value.trim())}
              required
            />
          ) : null}
          <ErrorLine message={error} />
          <div className="flex gap-2">
            <Button type="submit" loading={busy}>
              {sent ? t('account.profile.verifyPhone') : t('account.profile.sendCode')}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
              {t('account.cancel')}
            </Button>
          </div>
        </form>
      ) : (
        <Button variant="ghost" className="self-start" onClick={() => setEditing(true)}>
          {user.phone ? t('account.profile.changePhone') : t('account.profile.addPhone')}
        </Button>
      )}
    </div>
  );
}

function PreferencesForm() {
  const { t } = useAccountT();
  const [prefs, setPrefs] = useState<Preferences | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void browserApi()
      .GET('/v1/me/preferences')
      .then(({ data }) => {
        if (!cancelled && data) setPrefs(data);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!prefs) return null;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setStatus(null);
    const homeAirport = prefs.homeAirport?.trim().toUpperCase() ?? '';
    const { data } = await browserApi().PATCH('/v1/me/preferences', {
      body: {
        locale: prefs.locale && isSupportedLocale(prefs.locale) ? prefs.locale : null,
        currency: SUPPORTED_CURRENCIES.find((code) => code === prefs.currency) ?? null,
        homeAirport: homeAirport.length === 3 ? homeAirport : null,
      },
    });
    setBusy(false);
    if (data) {
      setPrefs(data);
      setStatus(t('account.saved'));
    }
  };

  return (
    <form className="flex flex-col gap-4" onSubmit={(e) => void submit(e)}>
      <div className="grid gap-4 md:grid-cols-3">
        <NativeSelect
          id="profile-locale"
          name="locale"
          label={t('account.profile.locale')}
          value={prefs.locale ?? ''}
          onChange={(event) => setPrefs({ ...prefs, locale: event.target.value || null })}
          options={[
            { value: '', label: '—' },
            ...SUPPORTED_LOCALES.map((v) => ({ value: v, label: v })),
          ]}
        />
        <NativeSelect
          id="profile-currency"
          name="currency"
          label={t('account.profile.currency')}
          value={prefs.currency ?? ''}
          onChange={(event) => setPrefs({ ...prefs, currency: event.target.value || null })}
          options={[
            { value: '', label: '—' },
            ...SUPPORTED_CURRENCIES.map((v) => ({ value: v, label: v })),
          ]}
        />
        <Input
          label={t('account.profile.homeAirport')}
          hint={t('account.profile.homeAirportHint')}
          maxLength={3}
          autoCapitalize="characters"
          value={prefs.homeAirport ?? ''}
          onChange={(event) => setPrefs({ ...prefs, homeAirport: event.target.value })}
        />
      </div>
      <div className="flex items-center gap-4">
        <Button type="submit" loading={busy}>
          {t('account.save')}
        </Button>
        <StatusLine message={status} />
      </div>
    </form>
  );
}

export function ProfileSection() {
  const { t } = useAccountT();
  return (
    <>
      <AccountCard heading={t('account.profile.heading')} testId="account-profile">
        <NameForm />
        <EmailLine />
        <PhoneForm />
      </AccountCard>
      <AccountCard heading={t('account.profile.preferencesHeading')}>
        <PreferencesForm />
      </AccountCard>
    </>
  );
}
