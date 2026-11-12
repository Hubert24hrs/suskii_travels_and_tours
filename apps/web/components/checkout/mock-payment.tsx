'use client';

import { useFormatters } from '@suskii/i18n/react';
import { Button, Card } from '@suskii/ui-web';
import { FlaskConical } from 'lucide-react';
import { useEffect, useState } from 'react';

import { browserApi, type Schemas } from '../../lib/browser-api';
import { AppLink } from '../app-link';
import { ResultsLoading } from '../results/result-states';

import { useBookingT } from './checkout-messages';

type Payment = Schemas['MockPayment'];

/**
 * The MOCK payment provider's hosted page (ADR-014). A real provider's page replaces it in phase
 * 6; the buttons make the API send the same signed webhook a provider would.
 */
export function MockPayment({ reference }: { reference: string }) {
  const { t } = useBookingT();
  const format = useFormatters();
  const [payment, setPayment] = useState<Payment | null | 'missing'>(null);
  const [busy, setBusy] = useState<'succeeded' | 'failed' | null>(null);
  const [closed, setClosed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    browserApi()
      .GET('/v1/payments/mock/{reference}', { params: { path: { reference } } })
      .then(({ data }) => {
        if (!cancelled) setPayment(data ?? 'missing');
      })
      .catch(() => {
        if (!cancelled) setPayment('missing');
      });
    return () => {
      cancelled = true;
    };
  }, [reference]);

  const complete = async (outcome: 'succeeded' | 'failed') => {
    setBusy(outcome);
    const { data } = await browserApi().POST('/v1/payments/mock/{reference}/complete', {
      params: { path: { reference } },
      body: { outcome },
    });
    if (data) {
      window.location.assign(data.returnUrl);
      return;
    }
    setBusy(null);
    setClosed(true);
  };

  if (payment === null) return <ResultsLoading label={t('common.loading')} />;
  if (payment === 'missing')
    return (
      <Card role="alert" className="p-6">
        <p className="font-body text-body text-foreground">{t('payment.notFound')}</p>
      </Card>
    );

  const open = payment.status === 'pending' && !closed;
  return (
    <Card className="flex flex-col gap-6 p-6">
      <p className="flex items-start gap-3 rounded-md bg-primary-subtle p-4 font-body text-body-sm text-foreground">
        <FlaskConical aria-hidden="true" className="size-5 shrink-0" />
        {t('payment.notice')}
      </p>
      <dl className="flex flex-col gap-2 font-body text-body text-foreground">
        <div className="flex justify-between gap-4">
          <dt>{t('payment.reference')}</dt>
          <dd className="font-bold">{payment.bookingReference}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt>{t('payment.amount')}</dt>
          <dd className="font-heading text-h3 font-extrabold text-heading">
            {format.money(payment.amount)}
          </dd>
        </div>
      </dl>
      {open ? (
        <div className="flex flex-col gap-3 md:flex-row">
          <Button
            loading={busy === 'succeeded'}
            disabled={busy !== null}
            onClick={() => void complete('succeeded')}
          >
            {busy
              ? t('payment.processing')
              : t('payment.pay', { amount: format.money(payment.amount) })}
          </Button>
          <Button
            variant="ghost"
            loading={busy === 'failed'}
            disabled={busy !== null}
            onClick={() => void complete('failed')}
          >
            {t('payment.decline')}
          </Button>
        </div>
      ) : (
        <div className="flex flex-col items-start gap-3">
          <p role="status" className="font-body text-body text-foreground">
            {t('payment.closed')}
          </p>
          <Button asChild variant="secondary">
            <AppLink href={payment.returnUrl.replace(/^https?:\/\/[^/]+/, '')}>
              {t('payment.back')}
            </AppLink>
          </Button>
        </div>
      )}
    </Card>
  );
}
