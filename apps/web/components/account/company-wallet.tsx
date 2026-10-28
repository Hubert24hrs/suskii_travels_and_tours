'use client';

import { useFormatters } from '@suskii/i18n/react';
import { Badge, Button, Input } from '@suskii/ui-web';
import { useEffect, useState, type FormEvent } from 'react';

import { browserApi, idempotencyKey, problemSlug, type Schemas } from '../../lib/browser-api';
import { AppLink } from '../app-link';
import { NativeSelect } from '../search/native-select';

import { useAccountT } from './account-messages';
import { AccountCard, ErrorLine, StatusLine } from './account-shell';
import { decimalToMinor } from './decimal-money';

type Wallet = Schemas['CompanyWallet'];
type TopUp = Schemas['CompanyTopUp'];

/** How often, and for how long, the return page asks whether the provider confirmed. */
const POLL_MS = 3_000;
const POLL_TIMES = 20;
const SHOWN = 10;

const STATUS_VARIANT: Record<TopUp['status'], 'success' | 'danger' | 'neutral'> = {
  pending: 'neutral',
  succeeded: 'success',
  failed: 'danger',
  expired: 'neutral',
  cancelled: 'neutral',
};

/**
 * The company wallet (ADR-090) for admins and approvers: balances, recent movements and top-ups,
 * and, for admins, adding funds through the provider's hosted page. Coming back from that page
 * (`?topUp=`), the card follows the top-up until the provider confirms it.
 */
export function CompanyWallet() {
  const { t } = useAccountT();
  const format = useFormatters();
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [version, setVersion] = useState(0);
  const [returned, setReturned] = useState<TopUp | null>(null);

  useEffect(() => {
    let cancelled = false;
    void browserApi()
      .GET('/v1/me/company/wallet')
      .then(({ data }) => {
        if (!cancelled && data) setWallet(data);
      });
    return () => {
      cancelled = true;
    };
  }, [version]);

  // Back from the payment page: the webhook usually lands within seconds.
  useEffect(() => {
    const topUpId = new URLSearchParams(window.location.search).get('topUp');
    if (!topUpId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = async (attempt: number) => {
      const { data } = await browserApi().GET('/v1/me/company/wallet/top-ups/{topUpId}', {
        params: { path: { topUpId } },
      });
      if (cancelled || !data) return;
      setReturned(data);
      if (data.status !== 'pending') setVersion((value) => value + 1);
      else if (attempt < POLL_TIMES) timer = setTimeout(() => void check(attempt + 1), POLL_MS);
    };
    void check(1);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  if (!wallet) return null;
  const movements = wallet.movements.slice(0, SHOWN);
  const topUps = wallet.topUps.slice(0, SHOWN);

  return (
    <AccountCard
      heading={t('account.company.wallet.heading')}
      intro={t('account.company.wallet.intro')}
      testId="company-wallet"
    >
      {returned ? (
        returned.status === 'failed' ? (
          <ErrorLine message={t('account.company.wallet.returned.failed')} />
        ) : (
          <StatusLine message={t(`account.company.wallet.returned.${returned.status}`)} />
        )
      ) : null}
      <dl className="flex flex-wrap gap-6">
        <div className="flex flex-col gap-1">
          <dt className="font-body text-caption text-muted">
            {t('account.company.wallet.balance')}
          </dt>
          {wallet.balances.length === 0 ? (
            <dd className="font-body text-body text-muted">{t('account.company.wallet.empty')}</dd>
          ) : (
            wallet.balances.map((balance) => (
              <dd
                key={balance.currency}
                className="font-heading text-h3 font-bold text-heading"
                data-testid="company-wallet-balance"
              >
                {format.money(balance)}
              </dd>
            ))
          )}
        </div>
      </dl>

      {wallet.canTopUp ? (
        <AddFunds options={wallet.topUpOptions} />
      ) : (
        <p className="font-body text-body-sm text-muted">{t('account.company.wallet.adminOnly')}</p>
      )}

      {movements.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h3 className="font-heading text-body font-bold text-heading">
            {t('account.company.wallet.movements')}
          </h3>
          <ul className="flex flex-col divide-y divide-border">
            {movements.map((movement) => (
              <li
                key={movement.id}
                className="flex flex-col gap-1 py-2 md:flex-row md:items-center md:justify-between"
              >
                <span className="flex flex-col gap-1 font-body text-body-sm text-foreground">
                  <span className="font-bold">{movementLabel(movement.kind, t)}</span>
                  <span className="text-muted">
                    {movement.bookingId && movement.bookingReference ? (
                      <AppLink
                        href={`/bookings/${movement.bookingId}`}
                        className="inline-flex min-h-6 items-center text-primary underline focus-visible:focus-ring"
                      >
                        {t('account.company.wallet.forBooking', {
                          reference: movement.bookingReference,
                        })}
                      </AppLink>
                    ) : null}{' '}
                    {format.dateTime(movement.occurredAt)}
                  </span>
                </span>
                <span
                  className={
                    movement.amount.amountMinor < 0
                      ? 'font-body text-body font-bold text-foreground'
                      : 'font-body text-body font-bold text-success'
                  }
                >
                  {format.money(movement.amount)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {topUps.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h3 className="font-heading text-body font-bold text-heading">
            {t('account.company.wallet.topUps')}
          </h3>
          <ul className="flex flex-col divide-y divide-border">
            {topUps.map((topUp) => (
              <li
                key={topUp.id}
                className="flex flex-col gap-1 py-2 md:flex-row md:items-center md:justify-between"
                data-testid={`company-top-up-${topUp.reference}`}
              >
                <span className="flex flex-col gap-1 font-body text-body-sm text-foreground">
                  <span className="font-bold">{topUp.reference}</span>
                  <span className="text-muted">{format.dateTime(topUp.createdAt)}</span>
                </span>
                <span className="flex flex-wrap items-center gap-2">
                  <Badge variant={STATUS_VARIANT[topUp.status]}>
                    {t(`account.company.wallet.statuses.${topUp.status}`)}
                  </Badge>
                  <span className="font-body text-body font-bold text-foreground">
                    {format.money(topUp.received ?? topUp.amount)}
                  </span>
                  {topUp.checkoutUrl ? (
                    <Button asChild variant="secondary">
                      <a href={topUp.checkoutUrl}>{t('account.company.wallet.continue')}</a>
                    </Button>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <p className="font-body text-body-sm text-muted">{t('account.company.wallet.terms')}</p>
    </AccountCard>
  );
}

function movementLabel(
  kind: Wallet['movements'][number]['kind'],
  t: ReturnType<typeof useAccountT>['t'],
) {
  if (kind === 'company_topup_captured') return t('account.company.wallet.kinds.topUp');
  if (kind === 'refund_to_company_wallet') return t('account.company.wallet.kinds.refund');
  return t('account.company.wallet.kinds.payment');
}

function AddFunds({ options }: { options: Wallet['topUpOptions'] }) {
  const { t } = useAccountT();
  const format = useFormatters();
  const [currency, setCurrency] = useState(options[0]?.currency ?? '');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const option = options.find((candidate) => candidate.currency === currency);
  if (!option) return null;
  const limits = { min: format.money(option.min), max: format.money(option.max) };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    const minor = decimalToMinor(amount, currency);
    if (minor === null || minor < option.min.amountMinor || minor > option.max.amountMinor) {
      setError(t('account.company.wallet.errors.amount', limits));
      return;
    }
    setBusy(true);
    const { data, error: problem } = await browserApi().POST('/v1/me/company/wallet/top-ups', {
      params: { header: { 'Idempotency-Key': idempotencyKey() } },
      body: { amount: { amountMinor: minor, currency } },
    });
    if (data?.checkoutUrl) {
      window.location.assign(data.checkoutUrl);
      return;
    }
    setBusy(false);
    const slug = problemSlug(problem);
    setError(
      slug === 'top-up-limit'
        ? t('account.company.wallet.errors.limit')
        : slug === 'top-up-amount-out-of-range'
          ? t('account.company.wallet.errors.amount', limits)
          : slug === 'payment-provider-unavailable' || slug === 'top-up-currency-unavailable'
            ? t('account.company.wallet.errors.provider')
            : t('account.company.error'),
    );
  };

  return (
    <form
      method="post"
      noValidate
      onSubmit={(event) => void submit(event)}
      className="flex flex-col gap-4"
      aria-labelledby="company-wallet-add"
    >
      <h3 id="company-wallet-add" className="font-heading text-body font-bold text-heading">
        {t('account.company.wallet.addHeading')}
      </h3>
      <div className="grid gap-4 md:grid-cols-2">
        <Input
          id="company-wallet-amount"
          inputMode="decimal"
          label={t('account.company.wallet.amount')}
          hint={t('account.company.wallet.limits', limits)}
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
        />
        <NativeSelect
          id="company-wallet-currency"
          label={t('account.company.wallet.currency')}
          value={currency}
          onChange={(event) => setCurrency(event.target.value)}
          options={options.map(({ currency: code }) => ({ value: code, label: code }))}
        />
      </div>
      <div>
        <Button type="submit" loading={busy}>
          {t('account.company.wallet.add')}
        </Button>
      </div>
      <ErrorLine message={error} />
    </form>
  );
}
