'use client';

import { useFormatters } from '@suskii/i18n/react';
import { Button, Card } from '@suskii/ui-web';
import { useId, useState } from 'react';

import { bookingHeaders } from '../../lib/booking-token';
import { browserApi, problemSlug, type Schemas } from '../../lib/browser-api';

import { useBookingT } from './checkout-messages';

type Change = Schemas['FlightScheduleChange'];
type Slice = Change['previous'][number];

const time = (local: string): string => local.slice(11, 16);

/**
 * An airline change to a ticketed flight (ADR-065): the booked and the new times side by side,
 * and Accept when the airline allows it online. Cancelling instead stays with "Cancel flight".
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
        {change.acceptable ? (
          <div className="flex flex-col items-start gap-2">
            <Button loading={busy} onClick={() => void accept()}>
              {t('booking.scheduleChange.accept')}
            </Button>
            <p className="font-body text-caption text-muted">
              {t('booking.scheduleChange.acceptHint')}
            </p>
          </div>
        ) : (
          <p className="font-body text-body-sm text-foreground">
            {t('booking.scheduleChange.support')}
          </p>
        )}
        {error ? (
          <p role="alert" className="font-body text-body-sm text-danger">
            {error}
          </p>
        ) : null}
      </section>
    </Card>
  );
}
