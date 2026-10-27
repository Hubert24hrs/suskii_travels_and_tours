'use client';

import { useFormatters } from '@suskii/i18n/react';
import { Button, Card, Dialog, DialogContent } from '@suskii/ui-web';
import { useId, useState } from 'react';

import { bookingHeaders } from '../../lib/booking-token';
import { browserApi, idempotencyKey, problemSlug, type Schemas } from '../../lib/browser-api';

import { useBookingT } from './checkout-messages';

type Change = Schemas['FlightScheduleChange'];
type Slice = Change['previous'][number];

const time = (local: string): string => local.slice(11, 16);

/**
 * An airline change to a ticketed flight (ADR-065): the booked and the new times side by side,
 * and Accept when the airline allows it online. A significant change also offers everything back
 * in one step (ADR-073); otherwise cancelling stays with "Cancel flight".
 */
export function ScheduleChange({
  bookingId,
  change,
  onDone,
}: {
  bookingId: string;
  change: Change;
  onDone: () => void;
}) {
  const { t } = useBookingT();
  const format = useFormatters();
  const headingId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [refunded, setRefunded] = useState<Schemas['Money'] | null>(null);

  const times = (slice: Slice): string =>
    t('booking.scheduleChange.times', {
      flights: slice.segments
        .map((segment) => `${segment.marketingCarrier.code} ${segment.flightNumber}`)
        .join(', '),
      departure: `${format.date(slice.departureLocal, 'weekday')} ${time(slice.departureLocal)}`,
      arrival: `${format.date(slice.arrivalLocal, 'weekday')} ${time(slice.arrivalLocal)}`,
    });

  const accept = async () => {
    setBusy(true);
    setError(null);
    const { data, error: problem } = await browserApi().POST(
      '/v1/bookings/{bookingId}/schedule-changes/{changeId}/accept',
      { params: { path: { bookingId, changeId: change.id } }, headers: bookingHeaders(bookingId) },
    );
    setBusy(false);
    if (data) {
      setAccepted(true);
      onDone();
      return;
    }
    setError(
      problemSlug(problem) === 'schedule-change-not-acceptable'
        ? t('booking.scheduleChange.notAcceptable')
        : t('booking.scheduleChange.failed'),
    );
  };

  const refund = async (amount: Schemas['Money']) => {
    setBusy(true);
    setError(null);
    const { data, error: problem } = await browserApi().POST(
      '/v1/bookings/{bookingId}/schedule-changes/{changeId}/refund',
      {
        params: {
          path: { bookingId, changeId: change.id },
          header: { ...bookingHeaders(bookingId), 'Idempotency-Key': idempotencyKey() },
        },
        body: { refund: amount },
      },
    );
    setBusy(false);
    setConfirming(false);
    if (data) {
      setRefunded(amount);
      onDone();
      return;
    }
    const slug = problemSlug(problem);
    setError(
      slug === 'refund-offer-unavailable'
        ? t('booking.scheduleChange.refundUnavailable')
        : slug === 'refund-offer-changed'
          ? t('booking.scheduleChange.refundChanged')
          : t('checkout.errors.generic'),
    );
    // The offer may have been handed to support: show the booking as it is now.
    if (slug === 'refund-offer-unavailable') onDone();
  };

  if (refunded) {
    return (
      <p role="status" className="font-body text-body-sm text-foreground">
        {t('booking.scheduleChange.refunded', { amount: format.money(refunded) })}
      </p>
    );
  }
  if (change.status === 'accepted') {
    return accepted ? (
      <p role="status" className="font-body text-body-sm text-foreground">
        {t('booking.scheduleChange.accepted')}
      </p>
    ) : null;
  }
  if (change.status !== 'open') return null;

  const rows = Math.max(change.previous.length, change.updated.length);
  return (
    <Card
      asChild
      className="flex flex-col gap-3 border-border-strong p-4"
      data-testid="schedule-change"
    >
      <section aria-labelledby={headingId}>
        <h2 id={headingId} className="font-heading text-h4 font-bold text-heading">
          {t('booking.scheduleChange.title')}
        </h2>
        <p className="font-body text-body-sm text-foreground">
          {t('booking.scheduleChange.intro')}
        </p>
        <ul className="flex flex-col gap-3">
          {Array.from({ length: rows }, (_, index) => {
            const before = change.previous[index];
            const after = change.updated[index];
            const route = before ?? after;
            if (!route) return null;
            return (
              <li key={index} className="flex flex-col gap-1">
                <p className="font-body text-body font-bold text-foreground">
                  {route.origin.cityName ?? route.origin.code} ({route.origin.code}) →{' '}
                  {route.destination.cityName ?? route.destination.code} ({route.destination.code})
                </p>
                {before ? (
                  <p className="font-body text-body-sm text-muted">
                    <span className="font-bold">{t('booking.scheduleChange.was')}:</span>{' '}
                    <s>{times(before)}</s>
                  </p>
                ) : null}
                <p className="font-body text-body-sm text-foreground">
                  <span className="font-bold">{t('booking.scheduleChange.now')}:</span>{' '}
                  {after ? times(after) : t('booking.scheduleChange.removed')}
                </p>
              </li>
            );
          })}
        </ul>
        {change.refundOffer ? (
          <p className="font-body text-body-sm text-foreground">
            {t('booking.scheduleChange.significant')}
          </p>
        ) : null}
        {change.acceptable ? (
          <div className="flex flex-col items-start gap-2">
            <Button loading={busy && !confirming} onClick={() => void accept()}>
              {t('booking.scheduleChange.accept')}
            </Button>
            {change.refundOffer ? null : (
              <p className="font-body text-caption text-muted">
                {t('booking.scheduleChange.acceptHint')}
              </p>
            )}
          </div>
        ) : change.refundOffer ? null : (
          <p className="font-body text-body-sm text-foreground">
            {t('booking.scheduleChange.support')}
          </p>
        )}
        {change.refundOffer ? (
          <div className="flex flex-col items-start gap-2">
            <Button
              variant="secondary"
              data-testid="schedule-change-refund"
              onClick={() => setConfirming(true)}
            >
              {t('booking.scheduleChange.refund', {
                amount: format.money(change.refundOffer.amount),
              })}
            </Button>
            <p className="font-body text-caption text-muted">
              {t('booking.scheduleChange.refundHint')}
            </p>
            <Dialog open={confirming} onOpenChange={setConfirming}>
              {confirming ? (
                <DialogContent
                  title={t('booking.scheduleChange.refundTitle')}
                  description={t('booking.scheduleChange.refundBody', {
                    amount: format.money(change.refundOffer.amount),
                  })}
                  closeLabel={t('common.close')}
                >
                  <div className="flex flex-col gap-2 md:flex-row md:justify-end">
                    <Button variant="ghost" onClick={() => setConfirming(false)}>
                      {t('booking.scheduleChange.refundKeep')}
                    </Button>
                    <Button
                      loading={busy}
                      data-testid="schedule-change-refund-confirm"
                      onClick={() => {
                        if (change.refundOffer) void refund(change.refundOffer.amount);
                      }}
                    >
                      {t('booking.scheduleChange.refundConfirm')}
                    </Button>
                  </div>
                </DialogContent>
              ) : null}
            </Dialog>
          </div>
        ) : null}
        {error ? (
          <p role="alert" className="font-body text-body-sm text-danger">
            {error}
          </p>
        ) : null}
      </section>
    </Card>
  );
}
