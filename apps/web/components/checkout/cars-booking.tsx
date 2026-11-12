'use client';

import { useFormatters } from '@suskii/i18n/react';
import { Button, Card, Input } from '@suskii/ui-web';
import { useEffect, useState, type FormEvent } from 'react';
import { renderSVG } from 'uqr';

import { browserApi, problemSlug, type Schemas } from '../../lib/browser-api';
import { useHydrated } from '../../lib/use-hydrated';
import { AppLink } from '../app-link';

import { CarsDetails } from './cars-details';
import { useBookingT } from './checkout-messages';

type Booking = Schemas['Booking'];
type Reservation = Schemas['RentalReservation'];

const LICENCE_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];
// `other` (and anything new) reads as the generic reason; a key named `other` would be a plural.
const REJECTIONS = ['unreadable', 'expired', 'name_mismatch', 'not_a_licence'] as const;
const rejection = (reason: string | null): (typeof REJECTIONS)[number] | 'generic' =>
  REJECTIONS.find((known) => known === reason) ?? 'generic';

/**
 * The Cars part of a booking page (ADR-049 to ADR-051): what was booked, then boarding passes
 * with their QR codes (drawn here from the signed payload, never fetched as images), the live
 * ride, or the renter's licence for a self-drive car.
 */
export function CarsBooking({ booking, reload }: { booking: Booking; reload: () => void }) {
  const { t } = useBookingT();
  const paid = ['PAID', 'CONFIRMED'].includes(booking.status);
  return (
    <>
      <Card asChild className="flex flex-col gap-3 p-4">
        <section aria-labelledby="booking-cars">
          <h2 id="booking-cars" className="font-heading text-h3 font-bold text-heading">
            {booking.bus
              ? t('booking.cars.bus.heading')
              : booking.ride
                ? t('booking.cars.ride.heading')
                : t('booking.cars.rental.heading')}
          </h2>
          <CarsDetails items={booking} />
          {booking.ride ? (
            booking.ride.rideId ? (
              <AppLink
                href={`/rides/${booking.ride.rideId}`}
                className="inline-flex min-h-12 items-center self-start rounded-md bg-primary px-6 font-body text-body font-bold text-on-primary focus-visible:focus-ring"
                data-testid="track-ride"
              >
                {t('booking.cars.ride.track')}
              </AppLink>
            ) : (
              <p className="font-body text-body-sm text-foreground">
                {t('booking.cars.ride.pending')}
              </p>
            )
          ) : null}
        </section>
      </Card>
      {booking.bus ? <BoardingPasses booking={booking} /> : null}
      {booking.rental?.reservation?.licenceRequired ? (
        paid ? (
          <LicenceCard reservationId={booking.rental.reservation.id} onChange={reload} />
        ) : (
          <p className="font-body text-body-sm text-foreground">
            {t('booking.cars.rental.pending')}
          </p>
        )
      ) : null}
    </>
  );
}

function BoardingPasses({ booking }: { booking: Booking }) {
  const { t } = useBookingT();
  const format = useFormatters();
  const hydrated = useHydrated();
  return (
    <Card asChild className="flex flex-col gap-3 p-4">
      <section aria-labelledby="booking-boarding">
        <h2 id="booking-boarding" className="font-heading text-h3 font-bold text-heading">
          {t('booking.cars.bus.tickets')}
        </h2>
        {booking.busTickets.length === 0 ? (
          <p className="font-body text-body-sm text-foreground">
            {t('booking.cars.bus.ticketsPending')}
          </p>
        ) : (
          <ul className="grid gap-4 md:grid-cols-2" data-testid="boarding-passes">
            {booking.busTickets.map((ticket) => (
              <li
                key={ticket.id}
                className="flex flex-col gap-2 rounded-lg border border-border p-4"
              >
                <p className="font-body text-body font-bold text-foreground">
                  {t('booking.cars.bus.ticket', {
                    seat: ticket.seatNumber,
                    name: ticket.passengerName,
                  })}
                </p>
                <p className="font-body text-body-sm text-foreground">
                  {t(`booking.cars.bus.ticketStates.${ticket.status}`)}
                </p>
                {ticket.qrPayload && ticket.status === 'valid' ? (
                  <span
                    role="img"
                    aria-label={t('booking.cars.bus.qr', { seat: ticket.seatNumber })}
                    data-testid={`ticket-qr-${ticket.seatNumber}`}
                    className="block aspect-square w-full max-w-popover self-center rounded-md bg-surface p-2 [&>svg]:size-full"
                    dangerouslySetInnerHTML={{ __html: renderSVG(ticket.qrPayload, { border: 1 }) }}
                  />
                ) : null}
                {hydrated ? (
                  <p className="font-body text-caption text-muted">
                    {t('booking.cars.bus.window', {
                      from: format.dateTime(ticket.validFrom),
                      until: format.dateTime(ticket.validUntil),
                    })}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </Card>
  );
}

function LicenceCard({ reservationId, onChange }: { reservationId: string; onChange: () => void }) {
  const { t } = useBookingT();
  const format = useFormatters();
  const [reservation, setReservation] = useState<Reservation | null>(null);
  const [number, setNumber] = useState('');
  const [expiresOn, setExpiresOn] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void browserApi()
      .GET('/v1/rentals/reservations/{reservationId}', { params: { path: { reservationId } } })
      .then(({ data }) => {
        if (!cancelled && data) setReservation(data);
      });
    return () => {
      cancelled = true;
    };
  }, [reservationId, tick]);

  // A scan in progress settles in seconds: look again until it has.
  const scanning = reservation?.licence?.status === 'pending_scan';
  useEffect(() => {
    if (!scanning) return;
    const timer = window.setTimeout(() => setTick((value) => value + 1), 3_000);
    return () => window.clearTimeout(timer);
  }, [scanning, tick]);

  if (!reservation) return null;
  const licence = reservation.licence;
  const open = reservation.status === 'reserved' && licence?.status !== 'approved';
  const path = { params: { path: { reservationId } } };

  const failure = (slug: string | null, status: number) =>
    status === 413
      ? t('booking.cars.rental.licence.errors.size')
      : status === 415
        ? t('booking.cars.rental.licence.errors.type')
        : slug === 'rental-conflict' && status === 409
          ? t('booking.cars.rental.licence.errors.closed')
          : t('booking.cars.rental.licence.errors.generic');

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const {
        data,
        error: problem,
        response,
      } = await browserApi().PUT('/v1/rentals/reservations/{reservationId}/licence', {
        ...path,
        body: { number: number.trim(), expiresOn },
      });
      if (data) {
        setReservation(data);
        setNumber('');
        onChange();
      } else {
        const detail = (problem as { detail?: string } | undefined)?.detail ?? '';
        setError(
          /expires/i.test(detail)
            ? t('booking.cars.rental.licence.errors.expires')
            : failure(problemSlug(problem), response.status),
        );
      }
    } catch {
      setError(t('booking.cars.rental.licence.errors.generic'));
    } finally {
      setBusy(false);
    }
  };

  const upload = async (file: File) => {
    setError(null);
    if (!LICENCE_TYPES.includes(file.type)) {
      setError(t('booking.cars.rental.licence.errors.type'));
      return;
    }
    setBusy(true);
    try {
      const {
        data,
        error: problem,
        response,
      } = await browserApi().PUT('/v1/rentals/reservations/{reservationId}/licence/document', {
        ...path,
        // The raw file is the body; the declared type only picks the route's parser.
        body: file as unknown as string,
        bodySerializer: (body) => body,
        headers: { 'Content-Type': file.type },
      });
      if (data) setReservation(data);
      else setError(failure(problemSlug(problem), response.status));
    } catch {
      setError(t('booking.cars.rental.licence.errors.generic'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card asChild className="flex flex-col gap-3 p-4">
      <section aria-labelledby="booking-licence" data-testid="rental-licence">
        <h2 id="booking-licence" className="font-heading text-h3 font-bold text-heading">
          {t('booking.cars.rental.licence.heading')}
        </h2>
        <p className="font-body text-body-sm text-foreground">
          {t('booking.cars.rental.licence.intro')}
        </p>
        {licence ? (
          <>
            <p className="font-body text-body-sm text-foreground">
              {t('booking.cars.rental.licence.endsWith', {
                hint: licence.numberEndsWith,
                date: format.date(licence.expiresOn, 'medium'),
              })}
            </p>
            <p
              role="status"
              className="font-body text-body font-bold text-foreground"
              data-testid="licence-status"
            >
              {licence.status === 'rejected'
                ? t('booking.cars.rental.licence.states.rejected', {
                    reason: t(
                      `booking.cars.rental.licence.reasons.${rejection(licence.rejectionReason)}`,
                    ),
                  })
                : t(`booking.cars.rental.licence.states.${licence.status}`)}
            </p>
          </>
        ) : null}
        {open && (!licence || licence.status === 'rejected') ? (
          <form
            method="post"
            noValidate
            onSubmit={(event) => void save(event)}
            className="flex flex-col gap-3"
          >
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Input
                id="licence-number"
                autoComplete="off"
                label={t('booking.cars.rental.licence.number')}
                value={number}
                onChange={(event) => setNumber(event.target.value)}
              />
              <Input
                id="licence-expiry"
                type="date"
                label={t('booking.cars.rental.licence.expiresOn')}
                value={expiresOn}
                onChange={(event) => setExpiresOn(event.target.value)}
              />
            </div>
            <Button type="submit" className="self-start" loading={busy}>
              {t('booking.cars.rental.licence.save')}
            </Button>
          </form>
        ) : null}
        {open && licence && licence.status !== 'rejected' ? (
          <label className="flex flex-col gap-1 font-body text-body-sm text-foreground">
            {busy
              ? t('booking.cars.rental.licence.uploading')
              : t('booking.cars.rental.licence.upload')}
            <input
              type="file"
              accept={LICENCE_TYPES.join(',')}
              disabled={busy}
              data-testid="licence-file"
              className="font-body text-body-sm"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (file) void upload(file);
              }}
            />
          </label>
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
