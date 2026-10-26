'use client';

import { useFormatters } from '@suskii/i18n/react';
import { Button, Dialog, DialogContent } from '@suskii/ui-web';
import { useState } from 'react';

import { bookingHeaders } from '../../lib/booking-token';
import { browserApi, problemSlug, type Schemas } from '../../lib/browser-api';

import { useBookingT } from './checkout-messages';

/**
 * Cancelling a ticketed flight online (ADR-064). The airline's refund comes first, from a quote
 * the API holds for a short while; the traveller confirms exactly that refund, and only then is
 * the flight cancelled.
 */
export function CancelFlight({ bookingId, onDone }: { bookingId: string; onDone: () => void }) {
  const { t } = useBookingT();
  const format = useFormatters();
  const [quote, setQuote] = useState<Schemas['FlightCancellationQuote'] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ask = async () => {
    setBusy(true);
    setError(null);
    const { data, error: problem } = await browserApi().POST(
      '/v1/bookings/{bookingId}/cancellation-quote',
      { params: { path: { bookingId } }, headers: bookingHeaders(bookingId) },
    );
    setBusy(false);
    if (data) setQuote(data);
    else
      setError(
        problemSlug(problem) === 'not-cancellable'
          ? t('booking.flightCancel.notOnline')
          : t('checkout.errors.generic'),
      );
  };

  const confirm = async (refund: Schemas['Money']) => {
    setBusy(true);
    setError(null);
    const { data, error: problem } = await browserApi().POST('/v1/bookings/{bookingId}/cancel', {
      params: { path: { bookingId } },
      headers: bookingHeaders(bookingId),
      body: { refund },
    });
    setBusy(false);
    setQuote(null);
    if (!data) {
      setError(
        problemSlug(problem) === 'cancellation-quote-expired'
          ? t('booking.flightCancel.expired')
          : t('checkout.errors.generic'),
      );
    }
    onDone();
  };

  return (
    <>
      <Button variant="ghost" loading={busy && !quote} onClick={() => void ask()}>
        {t('booking.flightCancel.action')}
      </Button>
      {error ? (
        <p role="alert" className="font-body text-body-sm text-danger">
          {error}
        </p>
      ) : null}
      <Dialog
        open={quote !== null}
        onOpenChange={(open) => {
          if (!open) setQuote(null);
        }}
      >
        {quote ? (
          <DialogContent
            title={t('booking.flightCancel.title')}
            description={
              quote.refund.amountMinor > 0
                ? t('booking.flightCancel.refund', { amount: format.money(quote.refund) })
                : t('booking.flightCancel.noRefund', { amount: format.money(quote.kept) })
            }
            closeLabel={t('common.close')}
          >
            <div className="flex flex-col gap-2">
              {quote.refund.amountMinor > 0 && quote.kept.amountMinor > 0 ? (
                <p className="font-body text-body-sm text-foreground">
                  {t('booking.flightCancel.kept', { amount: format.money(quote.kept) })}
                </p>
              ) : null}
              <p className="font-body text-body-sm text-muted" suppressHydrationWarning>
                {t('booking.flightCancel.expires', { time: format.dateTime(quote.expiresAt) })}
              </p>
            </div>
            <div className="flex flex-col gap-2 md:flex-row md:justify-end">
              <Button variant="ghost" onClick={() => setQuote(null)}>
                {t('booking.flightCancel.keep')}
              </Button>
              <Button loading={busy} onClick={() => void confirm(quote.refund)}>
                {t('booking.flightCancel.confirm')}
              </Button>
            </div>
          </DialogContent>
        ) : null}
      </Dialog>
    </>
  );
}
