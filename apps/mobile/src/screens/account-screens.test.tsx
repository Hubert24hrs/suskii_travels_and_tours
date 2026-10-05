import { getMessages } from '@suskii/i18n';
import { fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { router } from 'expo-router';
import { File } from 'expo-file-system';
import { shareAsync } from 'expo-sharing';
import { Share } from 'react-native';

import { tripStore } from '../lib/trips';
import { json, mockApi, renderWithApp, signedInSession } from '../test/app';
import { ALERT_ID, myReferrals, notificationPreferences, priceAlert } from '../test/fixtures';

import { AccountScreen } from './account-screen';
import { NotificationSettingsScreen } from './notification-settings-screen';
import { PriceAlertsScreen } from './price-alerts-screen';
import { PrivacyScreen } from './privacy-screen';
import { ReferralsScreen } from './referrals-screen';
import { SessionsScreen } from './sessions-screen';

jest.mock('../lib/push', () => ({ followAccount: jest.fn(() => Promise.resolve(false)) }));

const m = getMessages('en-NG');
const OTHER_SESSION = '0192d3a0-7c1e-7b2a-9f00-00000000c003';

const problem = (slug: string, status: number) =>
  json({ type: `urn:suskii:problem:${slug}`, title: slug, status }, status);

describe('AccountScreen', () => {
  it('lists the account screens once signed in', async () => {
    mockApi({ 'GET /v1/me/wallet': () => json({ balances: [], movements: [] }) });
    await renderWithApp(<AccountScreen />, await signedInSession());

    await fireEvent.press(screen.getByTestId('account-row-privacy'));
    expect(router.push).toHaveBeenCalledWith('/account/privacy');
    await fireEvent.press(screen.getByRole('button', { name: m.account.nav.notifications }));
    expect(router.push).toHaveBeenCalledWith('/account/notifications');
  });

  it('asks visitors to sign in on account screens', async () => {
    mockApi({});
    await renderWithApp(<NotificationSettingsScreen />);
    expect(screen.getByTestId('account-required')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: m.mobile.account.signIn }));
    expect(router.push).toHaveBeenCalledWith('/sign-in');
  });
});

describe('NotificationSettingsScreen', () => {
  it('keeps booking email on and saves a channel at once', async () => {
    const saved: unknown[] = [];
    mockApi({
      'GET /v1/me/notification-preferences': () => json(notificationPreferences()),
      'PATCH /v1/me/notification-preferences': async (request) => {
        const body = (await request.json()) as {
          changes: { category: string; channel: string; enabled: boolean }[];
        };
        saved.push(body);
        const { changes } = body;
        const base = notificationPreferences();
        return json({
          ...base,
          preferences: base.preferences.map((row) =>
            changes.some((c) => c.category === row.category && c.channel === row.channel)
              ? { ...row, enabled: true }
              : row,
          ),
        });
      },
    });
    await renderWithApp(<NotificationSettingsScreen />, await signedInSession());

    const mandatory = await screen.findByTestId('notify-booking-email');
    expect(mandatory).toBeChecked();
    await fireEvent.press(mandatory);
    expect(saved).toHaveLength(0);

    await fireEvent.press(screen.getByTestId('notify-price_alert-whatsapp'));
    await waitFor(() => expect(screen.getByTestId('notify-price_alert-whatsapp')).toBeChecked());
    expect(saved).toEqual([
      { changes: [{ category: 'price_alert', channel: 'whatsapp', enabled: true }] },
    ]);
  });

  it('puts the previous state back when saving fails', async () => {
    mockApi({
      'GET /v1/me/notification-preferences': () => json(notificationPreferences()),
      'PATCH /v1/me/notification-preferences': () => problem('internal', 500),
    });
    await renderWithApp(<NotificationSettingsScreen />, await signedInSession());

    await fireEvent.press(await screen.findByTestId('notify-trip_reminder-sms'));
    expect(await screen.findByText(m.mobile.auth.error)).toBeOnTheScreen();
    expect(screen.getByTestId('notify-trip_reminder-sms')).not.toBeChecked();
  });
});

describe('SessionsScreen', () => {
  it('signs out another device', async () => {
    const sessions = [
      {
        id: '0192d3a0-7c1e-7b2a-9f00-00000000c002',
        authMethod: 'otp',
        userAgent: 'Suskii/1.0 (Android 16)',
        createdAt: '2026-10-05T09:00:00.000Z',
        lastSeenAt: '2026-10-05T10:00:00.000Z',
        mfaVerified: false,
        current: true,
      },
      {
        id: OTHER_SESSION,
        authMethod: 'password',
        userAgent: null,
        createdAt: '2026-09-01T09:00:00.000Z',
        lastSeenAt: '2026-09-02T10:00:00.000Z',
        mfaVerified: false,
        current: false,
      },
    ];
    const { calls } = mockApi({
      'GET /v1/me/sessions': () => json({ sessions }),
      [`DELETE /v1/me/sessions/${OTHER_SESSION}`]: () => new Response(null, { status: 204 }),
    });
    await renderWithApp(<SessionsScreen />, await signedInSession());

    const cards = await screen.findAllByTestId('session-card');
    expect(within(cards[0]!).getByText(m.account.security.sessions.current)).toBeOnTheScreen();
    expect(within(cards[1]!).getByText(m.mobile.account.unknownDevice)).toBeOnTheScreen();
    await fireEvent.press(
      within(cards[1]!).getByRole('button', { name: m.account.security.sessions.revoke }),
    );

    expect(await screen.findByText(m.account.security.sessions.revoked)).toBeOnTheScreen();
    expect(calls.some((request) => request.method === 'DELETE')).toBe(true);
  });
});

describe('ReferralsScreen', () => {
  it('shares the invite code through the system share sheet', async () => {
    const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' });
    mockApi({ 'GET /v1/me/referrals': () => json(myReferrals) });
    await renderWithApp(<ReferralsScreen />, await signedInSession());

    expect(await screen.findByTestId('referral-code')).toHaveTextContent('K7Q2MXRA');
    expect(screen.getByTestId('referrals-pending')).toHaveTextContent('2');
    await fireEvent.press(screen.getByTestId('referral-share'));

    expect(share).toHaveBeenCalledWith({
      message: m.mobile.account.referralMessage
        .replace('{code}', 'K7Q2MXRA')
        .replace('{url}', myReferrals.shareUrl),
    });
  });
});

describe('PriceAlertsScreen', () => {
  it('lists watched routes and stops one', async () => {
    let alerts = [priceAlert];
    const { calls } = mockApi({
      'GET /v1/me/price-alerts': () => json({ alerts, limit: 10 }),
      [`DELETE /v1/me/price-alerts/${ALERT_ID}`]: () => {
        alerts = [];
        return new Response(null, { status: 204 });
      },
    });
    await renderWithApp(<PriceAlertsScreen />, await signedInSession());

    const card = await screen.findByTestId('alert-card');
    expect(card).toHaveTextContent(/LOS to DXB/);
    expect(card).toHaveTextContent(/650,000/);
    await fireEvent.press(
      screen.getByRole('button', {
        name: m.account.alerts.remove.replace('{route}', 'LOS to DXB'),
      }),
    );

    expect(await screen.findByText(m.account.alerts.empty)).toBeOnTheScreen();
    expect(calls.some((request) => request.method === 'DELETE')).toBe(true);
  });
});

describe('PrivacyScreen', () => {
  const routes = (deletion: { allowed: boolean; blockers: string[] }) => ({
    'GET /v1/me/reauth': () => json({ method: 'password', mfa: false, recentSignInMinutes: 10 }),
    'GET /v1/me/deletion': () => json({ ...deletion, retentionYears: 7 }),
  });

  it('hands the export to the share sheet and deletes the app copy', async () => {
    const exported = JSON.stringify({ format: 'suskii-data-export', version: 1, data: {} });
    const { calls } = mockApi({
      ...routes({ allowed: true, blockers: [] }),
      'POST /v1/me/data-export': () =>
        new Response(exported, {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Content-Disposition': 'attachment; filename="suskii-data-export-2026-10-05.json"',
          },
        }),
    });
    await renderWithApp(<PrivacyScreen />, await signedInSession());

    await fireEvent.changeText(
      await screen.findByTestId('export-password'),
      'a perfectly long passphrase',
    );
    await fireEvent.press(screen.getByTestId('export-submit'));

    expect(await screen.findByText(m.mobile.account.exportShared)).toBeOnTheScreen();
    const uri = 'file:///data/cache/suskii-data-export-2026-10-05.json';
    expect(shareAsync).toHaveBeenCalledWith(
      uri,
      expect.objectContaining({ mimeType: 'application/json' }),
    );
    expect(new File(uri).exists).toBe(false);
    const request = calls.find((call) => call.url.endsWith('/v1/me/data-export'));
    expect(await request?.json()).toEqual({ password: 'a perfectly long passphrase' });
  });

  it('lists what blocks a deletion', async () => {
    mockApi(routes({ allowed: false, blockers: ['upcoming_trip', 'wallet_balance'] }));
    await renderWithApp(<PrivacyScreen />, await signedInSession());

    const blockers = await screen.findByTestId('delete-blockers');
    expect(blockers).toHaveTextContent(m.account.privacy.blockers.upcoming_trip, { exact: false });
    expect(blockers).toHaveTextContent(m.account.privacy.blockers.wallet_balance, {
      exact: false,
    });
    expect(screen.queryByTestId('delete-submit')).toBeNull();
  });

  it('deletes the account after the password and DELETE, then forgets it on the phone', async () => {
    const forget = jest.spyOn(tripStore, 'forgetAccount');
    const { calls } = mockApi({
      ...routes({ allowed: true, blockers: [] }),
      'POST /v1/me/deletion': () => json({ status: 'deleted' }),
    });
    const session = await signedInSession();
    await renderWithApp(<PrivacyScreen />, session);

    await fireEvent.changeText(
      await screen.findByTestId('delete-password'),
      'a perfectly long passphrase',
    );
    expect(screen.getByTestId('delete-submit')).toBeDisabled();
    await fireEvent.changeText(screen.getByTestId('delete-confirm'), 'DELETE');
    await fireEvent.press(screen.getByTestId('delete-submit'));

    expect(await screen.findByTestId('account-deleted')).toHaveTextContent(
      m.account.privacy.deleted,
      { exact: false },
    );
    expect(session.signedIn).toBe(false);
    expect(forget).toHaveBeenCalled();
    const request = calls.find(
      (call) => call.url.endsWith('/v1/me/deletion') && call.method === 'POST',
    );
    expect(await request?.json()).toEqual({
      password: 'a perfectly long passphrase',
      confirm: 'DELETE',
    });
  });

  it('says so when the password is wrong', async () => {
    mockApi({
      ...routes({ allowed: true, blockers: [] }),
      'POST /v1/me/deletion': () => problem('reauth-failed', 401),
    });
    const session = await signedInSession();
    await renderWithApp(<PrivacyScreen />, session);

    await fireEvent.changeText(await screen.findByTestId('delete-password'), 'wrong password!');
    await fireEvent.changeText(screen.getByTestId('delete-confirm'), 'DELETE');
    await fireEvent.press(screen.getByTestId('delete-submit'));

    expect(await screen.findByText(m.account.reauth.wrong)).toBeOnTheScreen();
    expect(session.signedIn).toBe(true);
  });
});
