'use client';

import { useFormatters } from '@suskii/i18n/react';
import { buttonVariants, Button } from '@suskii/ui-web';
import { useEffect, useState } from 'react';

import { browserApi, type Schemas } from '../../lib/browser-api';
import { AppLink } from '../app-link';

import { useAccountT } from './account-messages';
import { AccountCard, StatusLine } from './account-shell';

/** Membership status and terms (ADR-030). */
export function PrimeSection() {
  const { t } = useAccountT();
  const format = useFormatters();
  const [prime, setPrime] = useState<Schemas['MyPrime'] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void browserApi()
      .GET('/v1/me/prime')
      .then(({ data }) => {
        if (!cancelled && data) setPrime(data);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!prime) return null;
  const day = (instant: string) => format.date(instant.slice(0, 10));
  return (
    <AccountCard heading={t('account.prime.heading')} testId="account-prime">
      <p className="font-body text-body text-foreground" data-testid="prime-status">
        {prime.current
          ? t('account.prime.member', { date: day(prime.current.until) })
          : t('account.prime.notMember')}
      </p>
      {prime.current ? (
        <p className="font-body text-body-sm text-muted">{t('account.prime.refreshNote')}</p>
      ) : null}
      <AppLink href="/prime" className={buttonVariants({ variant: 'secondary' }) + ' self-start'}>
        {prime.current ? t('account.prime.renew') : t('account.prime.join')}
      </AppLink>
      {prime.terms.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h3 className="font-heading text-h4 font-bold text-heading">
            {t('account.prime.history')}
          </h3>
          <ul className="flex flex-col gap-1">
            {prime.terms.map((term) => (
              <li key={term.id} className="font-body text-body-sm text-foreground">
                <AppLink href={`/bookings/${term.bookingId}`} className="underline">
                  {t('account.prime.term', {
                    plan: term.planName,
                    start: day(term.startsAt),
                    end: day(term.endsAt),
                  })}
                </AppLink>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </AccountCard>
  );
}

/** The referral code, its link and how invitations are doing (ADR-031). */
export function ReferralsSection() {
  const { t } = useAccountT();
  const format = useFormatters();
  const [referrals, setReferrals] = useState<Schemas['MyReferrals'] | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void browserApi()
      .GET('/v1/me/referrals')
      .then(({ data }) => {
        if (!cancelled && data) setReferrals(data);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!referrals) return null;
  const { rewards } = referrals;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(referrals.shareUrl);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <AccountCard
      heading={t('account.referrals.heading')}
      intro={t('account.referrals.intro')}
      testId="account-referrals"
    >
      <div className="flex flex-col gap-1">
        <p className="font-body text-body-sm text-muted">{t('account.referrals.code')}</p>
        <p
          className="font-heading text-h3 font-bold tracking-wide text-heading"
          data-testid="referral-code"
        >
          {referrals.code}
        </p>
      </div>
      <div className="flex flex-col gap-2 md:flex-row md:items-center">
        <code className="font-body text-body-sm break-all text-foreground">
          {referrals.shareUrl}
        </code>
        <Button variant="ghost" onClick={() => void copy()}>
          {t('account.referrals.copy')}
        </Button>
      </div>
      <StatusLine message={copied ? t('account.referrals.copied') : null} />
      <p className="font-body text-body text-foreground">
        {rewards.referrer && rewards.referee
          ? t('account.referrals.rewards', {
              referrer: format.money(rewards.referrer),
              referee: format.money(rewards.referee),
            })
          : t('account.referrals.noRewards')}
      </p>
      {rewards.minSpend ? (
        <p className="font-body text-body-sm text-muted">
          {t('account.referrals.minSpend', { amount: format.money(rewards.minSpend) })}
        </p>
      ) : null}
      <dl className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {(['pending', 'qualified', 'rewarded', 'review', 'rejected'] as const).map((status) => (
          <div key={status} className="flex flex-col gap-1 rounded-md border border-border p-3">
            <dt className="font-body text-caption text-muted">
              {t(`account.referrals.counts.${status}`)}
            </dt>
            <dd className="font-heading text-h4 font-bold text-heading">
              {format.number(referrals.counts[status])}
            </dd>
          </div>
        ))}
      </dl>
      {referrals.referredBy ? (
        <p className="font-body text-body-sm text-muted">
          {t('account.referrals.referredBy', {
            status: t(`account.referrals.counts.${referrals.referredBy.status}`),
          })}
        </p>
      ) : null}
    </AccountCard>
  );
}

/** Watched routes (ADR-032). */
export function AlertsSection() {
  const { t } = useAccountT();
  const format = useFormatters();
  const [alerts, setAlerts] = useState<Schemas['PriceAlertList'] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void browserApi()
      .GET('/v1/me/price-alerts')
      .then(({ data }) => {
        if (!cancelled && data) setAlerts(data);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!alerts) return null;
  const remove = async (id: string) => {
    const { response } = await browserApi().DELETE('/v1/me/price-alerts/{id}', {
      params: { path: { id } },
    });
    if (response.ok) setAlerts({ ...alerts, alerts: alerts.alerts.filter((a) => a.id !== id) });
  };
  return (
    <AccountCard
      heading={t('account.alerts.heading')}
      intro={t('account.alerts.intro')}
      testId="account-alerts"
    >
      {alerts.alerts.length === 0 ? (
        <p className="font-body text-body text-muted">{t('account.alerts.empty')}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {alerts.alerts.map((alert) => {
            const route = t('account.alerts.route', {
              origin: alert.origin,
              destination: alert.destination,
            });
            return (
              <li key={alert.id} className="flex items-center justify-between gap-3 py-3">
                <div className="flex flex-col gap-1">
                  <p className="font-body text-body font-bold text-foreground">{route}</p>
                  <p className="font-body text-body-sm text-muted">
                    {alert.departureDate
                      ? t('account.alerts.on', { date: format.date(alert.departureDate) })
                      : t('account.alerts.inMonth', {
                          month: format
                            .date(`${alert.departureMonth ?? ''}-01`, 'long')
                            .replace(/^\d+\s/, ''),
                        })}
                    {alert.target
                      ? ` · ${t('account.alerts.target', { price: format.money(alert.target) })}`
                      : ''}
                  </p>
                  <p className="font-body text-body-sm text-foreground">
                    {!alert.active
                      ? t('account.alerts.ended')
                      : alert.lastPrice
                        ? t('account.alerts.lastPrice', { price: format.money(alert.lastPrice) })
                        : t('account.alerts.notChecked')}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  aria-label={t('account.alerts.remove', { route })}
                  onClick={() => void remove(alert.id)}
                >
                  {t('account.remove')}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      <p className="font-body text-body-sm text-muted">
        {t('account.alerts.limit', { count: alerts.limit })}
      </p>
    </AccountCard>
  );
}

/** Wallet balances and movements (ADR-017). */
export function WalletSection() {
  const { t } = useAccountT();
  const format = useFormatters();
  const [wallet, setWallet] = useState<Schemas['Wallet'] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void browserApi()
      .GET('/v1/me/wallet')
      .then(({ data }) => {
        if (!cancelled && data) setWallet(data);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!wallet) return null;
  return (
    <AccountCard
      heading={t('account.wallet.heading')}
      intro={t('account.wallet.intro')}
      testId="account-wallet"
    >
      {wallet.balances.length === 0 ? (
        <p className="font-body text-body text-muted">{t('account.wallet.empty')}</p>
      ) : (
        <dl className="flex flex-wrap gap-4">
          {wallet.balances.map((balance) => (
            <div key={balance.currency} className="flex flex-col gap-1">
              <dt className="font-body text-caption text-muted">{t('account.wallet.balance')}</dt>
              <dd
                className="font-heading text-h3 font-bold text-heading"
                data-testid="wallet-balance"
              >
                {format.money(balance)}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {wallet.movements.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h3 className="font-heading text-h4 font-bold text-heading">
            {t('account.wallet.history')}
          </h3>
          <ul className="flex flex-col divide-y divide-border">
            {wallet.movements.map((movement) => (
              <li key={movement.id} className="flex justify-between gap-3 py-2">
                <span className="font-body text-body-sm text-foreground">
                  {t(`account.wallet.kinds.${movement.kind}`)} ·{' '}
                  {format.date(movement.occurredAt.slice(0, 10))}
                </span>
                <span className="font-body text-body-sm font-bold text-foreground">
                  {movement.amount.amountMinor > 0 ? '+' : ''}
                  {format.money(movement.amount)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </AccountCard>
  );
}
