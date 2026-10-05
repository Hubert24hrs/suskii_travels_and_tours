'use client';

import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CHANNELS,
  type NotificationCategory,
  type NotificationChannel,
} from '@suskii/shared/lite';
import { useEffect, useState } from 'react';

import { browserApi, type Schemas } from '../../lib/browser-api';

import { useAccountT } from './account-messages';
import { AccountCard, ErrorLine, StatusLine } from './account-shell';

type Settings = Schemas['NotificationPreferences'];

/** One checkbox per category and channel; mandatory email is shown on and locked. */
export function NotificationsSection() {
  const { t } = useAccountT();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void browserApi()
      .GET('/v1/me/notification-preferences')
      .then(({ data }) => {
        if (!cancelled && data) setSettings(data);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!settings) return null;
  const find = (category: NotificationCategory, channel: NotificationChannel) =>
    settings.preferences.find((row) => row.category === category && row.channel === channel);

  const toggle = async (
    category: NotificationCategory,
    channel: NotificationChannel,
    enabled: boolean,
  ) => {
    setStatus(null);
    setError(null);
    const previous = settings;
    // Show the change at once; the API's answer (or the previous state) replaces it.
    setSettings({
      ...settings,
      preferences: settings.preferences.map((row) =>
        row.category === category && row.channel === channel ? { ...row, enabled } : row,
      ),
    });
    const { data } = await browserApi().PATCH('/v1/me/notification-preferences', {
      body: { changes: [{ category, channel, enabled }] },
    });
    if (data) {
      setSettings(data);
      setStatus(t('account.saved'));
    } else {
      setSettings(previous);
      setError(t('auth.signIn.errors.generic'));
    }
  };

  return (
    <AccountCard
      heading={t('account.notifications.heading')}
      intro={t('account.notifications.intro')}
      testId="account-notifications"
    >
      <div className="overflow-x-auto">
        <table className="w-full border-collapse font-body text-body-sm">
          <thead>
            <tr>
              <th scope="col" className="sr-only">
                {t('account.notifications.heading')}
              </th>
              {NOTIFICATION_CHANNELS.map((channel) => (
                <th key={channel} scope="col" className="p-2 text-center font-bold text-foreground">
                  {t(`account.notifications.channels.${channel}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {NOTIFICATION_CATEGORIES.map((category) => (
              <tr key={category} className="border-t border-border">
                <th scope="row" className="p-2 text-left font-medium text-foreground">
                  {t(`account.notifications.categories.${category}`)}
                </th>
                {NOTIFICATION_CHANNELS.map((channel) => {
                  const row = find(category, channel);
                  const label = `${t(`account.notifications.categories.${category}`)}: ${t(`account.notifications.channels.${channel}`)}`;
                  return (
                    <td key={channel} className="p-2 text-center">
                      <input
                        type="checkbox"
                        className="size-5 accent-primary focus-visible:focus-ring"
                        aria-label={
                          row?.mandatory
                            ? `${label} (${t('account.notifications.mandatory')})`
                            : label
                        }
                        checked={row?.enabled ?? false}
                        disabled={row?.mandatory}
                        data-testid={`notify-${category}-${channel}`}
                        onChange={(event) => void toggle(category, channel, event.target.checked)}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <StatusLine message={status} />
      <ErrorLine message={error} />
      {settings.phoneVerified ? null : (
        <p className="font-body text-body-sm text-muted">
          {t('account.notifications.phoneNeeded')}
        </p>
      )}
      <p className="font-body text-body-sm text-muted">{t('account.notifications.pushHint')}</p>
      <p className="font-body text-body-sm text-muted">
        {t('account.notifications.marketingNote')}
      </p>
    </AccountCard>
  );
}
