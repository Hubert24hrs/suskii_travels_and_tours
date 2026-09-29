'use client';

import { useFormatters } from '@suskii/i18n/react';
import { BOOKING_IN_PROGRESS_STATUSES, type BookingStatus } from '@suskii/shared/lite';
import { Badge, Button, Card, type BadgeProps } from '@suskii/ui-web';
import { Download } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { bookingHeaders } from '../../lib/booking-token';
import { browserApi, idempotencyKey, problemSlug, type Schemas } from '../../lib/browser-api';
import { searchAgainHref } from '../../lib/search-links';
import { AppLink } from '../app-link';
import { ResultsLoading } from '../results/result-states';

import { useBookingT } from './checkout-messages';

type Booking = Schemas['Booking'];
type Phase =
  | { kind: 'loading' }
  | { kind: 'ready'; booking: Booking }
  | { kind: 'missing' }
  | { kind: 'error' };

const POLL_MS = 2500;
const SLOW_AFTER_MS = 60_000;
const STOP_AFTER_MS = 5 * 60_000;

const STATUS_VARIANT: Partial<Record<BookingStatus, NonNullable<BadgeProps['variant']>>> = {
  CONFIRMED: 'success',
  REFUND_PENDING: 'warning',
  REFUNDED: 'neutral',
  FAILED: 'danger',
  EXPIRED: 'neutral',
  CANCELLED: 'neutral',
};

const inProgress = (status: BookingStatus): boolean =>
  BOOKING_IN_PROGRESS_STATUSES.includes(status);
const time = (local: string): string => local.slice(11, 16);

/**
 * The booking page: polls while payment or ticketing is in flight (webhooks decide the outcome,
 * the redirect back only starts this poll), then shows the itinerary or stay, travellers, price
 * and documents. Guests are recognised by the token saved in this tab at checkout.
 */
export function BookingView({ bookingId }: { bookingId: string }) {
  const { t } = useBookingT();
  const format = useFormatters();
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [slow, setSlow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState(false);
  const started = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    started.current ??= Date.now();
    const load = async () => {
      try {
        const { data, response } = await browserApi().GET('/v1/bookings/{bookingId}', {
          params: { path: { bookingId } },
          headers: bookingHeaders(bookingId),
        });
        if (cancelled) return;
        if (!data) {
          setPhase({
            kind: response.status === 404 || response.status === 400 ? 'missing' : 'error',
          });
          return;
        }
        setPhase({ kind: 'ready', booking: data });
        const elapsed = Date.now() - (started.current ?? Date.now());
        setSlow(inProgress(data.status) && elapsed > SLOW_AFTER_MS);
        if (inProgress(data.status) && elapsed < STOP_AFTER_MS)
          timer = setTimeout(() => void load(), POLL_MS);
      } catch {
        if (!cancelled) setPhase({ kind: 'error' });
      }
    };
    void load();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [bookingId, attempt]);

  const pay = async (booking: Booking) => {
    setBusy(true);
    setActionError(null);
    const headers = bookingHeaders(booking.id);
    if (booking.pendingPriceChange) {
      const consent = await browserApi().POST('/v1/bookings/{bookingId}/price-consent', {
        params: { path: { bookingId: booking.id } },
        headers,
        body: { total: booking.pendingPriceChange.current },
      });
      if (!consent.data) {
        setBusy(false);
        setAttempt((n) => n + 1);
        return;
      }
    }
    const { data, error } = await browserApi().POST('/v1/bookings/{bookingId}/payments', {
      params: {
        path: { bookingId: booking.id },
        header: { ...headers, 'Idempotency-Key': idempotencyKey() },
      },
    });
    if (data) {
      window.location.assign(data.checkoutUrl);
      return;
    }
    setBusy(false);
    // A price change shows up as a pending change on reload, with its consent button.
    if (problemSlug(error) !== 'price-changed') setActionError(t('checkout.errors.generic'));
    setAttempt((n) => n + 1);
  };

  const download = async (booking: Booking, document: Booking['documents'][number]) => {
    setDownloadError(false);
    try {
      const { data } = await browserApi().GET('/v1/bookings/{bookingId}/documents/{documentId}', {
        params: { path: { bookingId: booking.id, documentId: document.id } },
        headers: bookingHeaders(booking.id),
        parseAs: 'blob',
      });
      if (!(data instanceof Blob)) throw new Error('download');
      const url = URL.createObjectURL(data);
      const link = window.document.createElement('a');
      link.href = url;
      link.download = document.fileName;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch {
      setDownloadError(true);
    }
  };

  if (phase.kind === 'loading') return <ResultsLoading label={t('booking.loading')} />;
  if (phase.kind === 'missing')
    return (
      <Card role="status" className="flex flex-col items-start gap-4 p-6">
        <h2 className="font-heading text-h3 font-bold text-heading">
          {t('booking.notFound.heading')}
        </h2>
        <p className="font-body text-body text-foreground">{t('booking.notFound.body')}</p>
        <Button asChild variant="secondary">
          <AppLink href="/">{t('booking.notFound.home')}</AppLink>
        </Button>
      </Card>
    );
  if (phase.kind === 'error')
    return (
      <Card role="alert" className="flex flex-col items-start gap-4 p-6">
        <p className="font-body text-body text-foreground">{t('booking.error')}</p>
        <Button variant="secondary" onClick={() => setAttempt((n) => n + 1)}>
          {t('booking.retry')}
        </Button>
      </Card>
    );

  const { booking } = phase;
  const status = booking.status;
  const help =
    status === 'CONFIRMED'
      ? t('booking.statusHelp.confirmed', { email: booking.contact.email })
      : inProgress(status)
        ? slow
          ? t('booking.statusHelp.slow')
          : t('booking.statusHelp.working')
        : status === 'REFUND_PENDING'
          ? t('booking.statusHelp.refund')
          : status === 'FAILED'
            ? t('booking.statusHelp.failed')
            : status === 'EXPIRED'
              ? t('booking.statusHelp.expired')
              : status === 'CANCELLED'
                ? t('booking.statusHelp.cancelled')
                : t('booking.statusHelp.unpaid');
  const request = booking.flight?.request ?? booking.hotel?.request;
  const paid = status === 'CONFIRMED' || status === 'PAID' || status === 'TICKETING';

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3">
        <h1 className="font-heading text-h2 font-extrabold text-heading">
          {t('booking.heading', { reference: booking.reference })}
        </h1>
        <div role="status" aria-live="polite" className="flex flex-col items-start gap-2">
          <Badge variant={STATUS_VARIANT[status] ?? 'info'} data-testid="booking-status">
            {t(`booking.status.${status}`)}
          </Badge>
          <p className="font-body text-body text-foreground">{help}</p>
        </div>
        {actionError ? (
          <p role="alert" className="font-body text-body-sm text-danger">
            {actionError}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-3">
          {status === 'AWAITING_PAYMENT' && booking.payment?.checkoutUrl ? (
            <Button asChild>
              <a href={booking.payment.checkoutUrl}>{t('booking.completePayment')}</a>
            </Button>
          ) : null}
          {status === 'PRICED' ? (
            <Button loading={busy} onClick={() => void pay(booking)}>
              {booking.pendingPriceChange
                ? t('checkout.priceChange.accept')
                : t('booking.retryPayment')}
            </Button>
          ) : null}
          {(status === 'EXPIRED' || status === 'FAILED' || status === 'CANCELLED') && request ? (
            <Button asChild variant="secondary">
              <AppLink href={searchAgainHref(request)}>{t('booking.searchAgain')}</AppLink>
            </Button>
          ) : null}
        </div>
        {booking.pendingPriceChange ? (
          <p className="font-body text-body-sm text-foreground">
            {t('results.priceChanged', {
              previous: format.money(booking.pendingPriceChange.previous),
              current: format.money(booking.pendingPriceChange.current),
            })}
          </p>
        ) : null}
      </header>

      <div className="flex flex-col gap-6 lg:grid lg:grid-cols-3 lg:items-start lg:gap-8">
        <div className="flex flex-col gap-6 lg:col-span-2">
          {booking.flight ? (
            <Card asChild className="flex flex-col gap-3 p-4">
              <section aria-labelledby="booking-itinerary">
                <h2 id="booking-itinerary" className="font-heading text-h3 font-bold text-heading">
                  {t('booking.itinerary')}
                </h2>
                <p className="font-body text-body-sm text-foreground">
                  {booking.flight.owner.name} · {t(`cabins.${booking.flight.cabinClass}`)}
                </p>
                {booking.flight.airlineReference ? (
                  <p className="font-body text-body text-foreground">
                    {t('booking.airlineReference')}:{' '}
                    <span className="font-bold" data-testid="airline-reference">
                      {booking.flight.airlineReference}
                    </span>
                  </p>
                ) : null}
                <ol className="flex flex-col gap-3">
                  {booking.flight.slices.map((slice, index) => (
                    <li key={index} className="flex flex-col gap-1">
                      <p className="font-body text-caption font-bold text-muted">
                        {format.date(slice.departureLocal, 'weekday')}
                      </p>
                      <p className="font-body text-body text-foreground">
                        <span className="font-bold">{time(slice.departureLocal)}</span>{' '}
                        {slice.origin.cityName ?? slice.origin.code} ({slice.origin.code}) →{' '}
                        <span className="font-bold">{time(slice.arrivalLocal)}</span>
                        {slice.arrivalDayOffset > 0 ? ` +${slice.arrivalDayOffset}` : ''}{' '}
                        {slice.destination.cityName ?? slice.destination.code} (
                        {slice.destination.code})
                      </p>
                      <p className="font-body text-caption text-foreground">
                        {slice.segments
                          .map(
                            (segment) => `${segment.marketingCarrier.code} ${segment.flightNumber}`,
                          )
                          .join(', ')}
                      </p>
                    </li>
                  ))}
                </ol>
              </section>
            </Card>
          ) : null}

          {booking.hotel ? (
            <Card asChild className="flex flex-col gap-3 p-4">
              <section aria-labelledby="booking-stay">
                <h2 id="booking-stay" className="font-heading text-h3 font-bold text-heading">
                  {t('booking.stay')}
                </h2>
                <p className="font-body text-body font-bold text-foreground">
                  {booking.hotel.name}
                </p>
                <p className="font-body text-body-sm text-foreground">
                  {[booking.hotel.area, booking.hotel.cityName].filter(Boolean).join(', ')}
                </p>
                {booking.hotel.confirmationNumber ? (
                  <p className="font-body text-body text-foreground">
                    {t('booking.confirmationNumber')}:{' '}
                    <span className="font-bold" data-testid="hotel-confirmation">
                      {booking.hotel.confirmationNumber}
                    </span>
                  </p>
                ) : null}
                <dl className="grid grid-cols-2 gap-2 font-body text-body-sm text-foreground">
                  <dt>{t('booking.checkIn')}</dt>
                  <dd>{format.date(booking.hotel.checkIn, 'long')}</dd>
                  <dt>{t('booking.checkOut')}</dt>
                  <dd>{format.date(booking.hotel.checkOut, 'long')}</dd>
                </dl>
                <p className="font-body text-body-sm text-foreground">
                  {t('booking.nights', { count: booking.hotel.nights })} ·{' '}
                  {t('booking.rooms', { count: booking.hotel.rooms })} · {booking.hotel.roomName} ·{' '}
                  {t(`results.boards.${booking.hotel.board}`)}
                </p>
              </section>
            </Card>
          ) : null}

          <Card asChild className="flex flex-col gap-3 p-4">
            <section aria-labelledby="booking-travellers">
              <h2 id="booking-travellers" className="font-heading text-h3 font-bold text-heading">
                {booking.hotel ? t('booking.guests') : t('booking.travellers')}
              </h2>
              <ul className="flex flex-col gap-3">
                {booking.passengers.map((passenger) => (
                  <li key={passenger.position} className="flex flex-col gap-1">
                    <p className="font-body text-body font-bold text-foreground">
                      {passenger.title ? `${t(`checkout.fields.titles.${passenger.title}`)} ` : ''}
                      {passenger.givenNames} {passenger.surname}
                      {passenger.roomIndex !== null
                        ? ` · ${t('booking.room', { number: passenger.roomIndex + 1 })}`
                        : ''}
                    </p>
                    {passenger.ticketNumber ? (
                      <p
                        className="font-body text-body-sm text-foreground"
                        data-testid="ticket-number"
                      >
                        {t('booking.ticket', { number: passenger.ticketNumber })}
                      </p>
                    ) : null}
                    {passenger.document ? (
                      <p className="font-body text-caption text-foreground">
                        {t('booking.passport', { hint: passenger.document.hint })}
                      </p>
                    ) : null}
                    {passenger.extraBags > 0 ? (
                      <p className="font-body text-caption text-foreground">
                        {t('booking.extraBags', { count: passenger.extraBags })}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          </Card>
        </div>

        <aside className="flex flex-col gap-4">
          <Card className="flex flex-col gap-2 p-4">
            <p className="font-body text-body-sm text-foreground">{t('booking.reference')}</p>
            <p className="font-heading text-h3 font-extrabold text-heading">{booking.reference}</p>
            <p className="font-body text-body-sm text-foreground">
              {paid ? t('booking.paid') : t('booking.price')}
            </p>
            <p className="font-heading text-h3 font-extrabold text-heading">
              {format.money(booking.price.total)}
            </p>
          </Card>
          {booking.documents.length > 0 ? (
            <Card asChild className="flex flex-col gap-3 p-4">
              <section aria-labelledby="booking-documents">
                <h2 id="booking-documents" className="font-heading text-h4 font-bold text-heading">
                  {t('booking.documents')}
                </h2>
                {booking.documents.map((document) => (
                  <Button
                    key={document.id}
                    variant="secondary"
                    onClick={() => void download(booking, document)}
                  >
                    <Download aria-hidden="true" className="size-4" />
                    {t(`booking.download.${document.type}`)}
                  </Button>
                ))}
                {downloadError ? (
                  <p role="alert" className="font-body text-caption text-danger">
                    {t('booking.downloadFailed')}
                  </p>
                ) : null}
              </section>
            </Card>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
